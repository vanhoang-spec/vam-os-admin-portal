/**
 * lib/bulk-mail-external-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Người nhận ngoài VAM cho nhóm "Danh sách tùy chỉnh" (VAM00027): email gõ tay hoặc tải từ
 * file Excel, KHÔNG có hồ sơ trong VAM OS và không tạo hồ sơ nào.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐÂY LÀ CHỖ DUY NHẤT EMAIL ĐI TỪ FORM VÀO LÔ
 * ---------------------------------------------------------------------------
 * VAM00026 cố ý không nhận email từ form: mọi dòng phải dựng lại được từ database. Người ngoài
 * thì không có gì trong database để dựng lại — email chỉ có trong chữ người bấm gõ hay file họ
 * tải lên. Nên chữ đó đi qua MỘT bộ đọc (parseExternalRecipientText) ở cả bước xem trước lẫn bước
 * gửi, và mọi điều kiện giữ an toàn nằm ở đây, thuần, kiểm được bằng test:
 *   - định dạng email chặt hơn `normalizeEmailAddress` (đuôi tên miền, dấu chấm, độ dài);
 *   - trần số email ngoài một lô (EXTERNAL_MAX_PER_BATCH) — vượt là từ chối cả danh sách,
 *     không lặng lẽ cắt bớt;
 *   - tên lấy từ chữ người bấm đưa vào, làm sạch (ký tự điều khiển, đường link, ô điền);
 *   - người ngoài trùng email với người lấy từ VAM thì bản VAM thắng: một email một lá.
 *
 * ---------------------------------------------------------------------------
 * TÊN NGƯỜI NGOÀI
 * ---------------------------------------------------------------------------
 * Không có hồ sơ thì không có tên, mã thành viên, giới tính. Tên lấy từ cột "Họ tên" của file
 * Excel hoặc phần chữ đi cùng email trên dòng gõ tay; không có thì để TRỐNG. Mẫu thư dùng
 * {{ten_nguoi_nhan}} thì không gửi được cho người trống tên — bước xem trước nói rõ ai, nút gửi
 * khoá lại, và lệnh gửi phía máy chủ từ chối cả lượt (không gửi "Xin chào ," lặng lẽ, và
 * renderTemplate cũng chặn lá đó). Mã thành viên và xưng hô của người ngoài luôn trống
 * (ô `emptyAllowed` tự gộp khoảng trắng); vai trò là "khách mời".
 *
 * Không I/O.
 */

import {
  BULK_SEND_CHUNK,
  foldPersonName,
  type BulkRecipient,
  type RecipientPartition
} from "@/lib/bulk-mail-core";
import { normalizeEmailAddress } from "@/lib/email-core";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-quota-core";
import { extractPlaceholders } from "@/lib/email-templates-core";

/** Tên ô form mang danh sách người ngoài (chữ). Cùng một ô ở form xem trước và form gửi. */
export const EXTERNAL_RECIPIENTS_FIELD = "external_recipients";
/** Tên ô chọn file Excel. */
export const EXTERNAL_FILE_FIELD = "external_file";
/** Ô xác nhận riêng cho người ngoài: giá trị phải bằng đúng số người ngoài sẽ nhận thư. */
export const EXTERNAL_CONFIRM_FIELD = "confirm_external";

/**
 * Tối đa bao nhiêu email ngoài VAM trong MỘT lô. Gửi nhầm cho người lạ không gỡ được và làm
 * hỏng uy tín tên miền gửi thư hơn gửi nhầm cho thành viên, nên trần này thấp hơn nhiều so với
 * trần cả lô (CUSTOM_LIST_MAX_RECIPIENTS) và hạn mức ngày. Danh sách dài hơn thì chia nhiều lô.
 */
export const EXTERNAL_MAX_PER_BATCH = 300;
/** Trần chữ và số dòng của ô gõ tay — chặn một form phình to bất thường. */
export const EXTERNAL_MAX_TEXT_CHARS = 200_000;
export const EXTERNAL_MAX_LINES = 2000;
/** Trần số dòng dữ liệu của file Excel (không tính dòng tiêu đề). */
export const EXTERNAL_FILE_MAX_ROWS = 2000;
export const EXTERNAL_NAME_MAX_LENGTH = 120;
/** Hiện tối đa bấy nhiêu dòng lỗi để còn đọc nổi; con số đầy đủ vẫn báo riêng. */
export const EXTERNAL_PROBLEMS_SHOWN = 30;

/** Chừa bấy nhiêu thư trong hạn mức ngày cho các thư khác của hệ thống — như bộ gửi thư mời. */
export const BULK_CUSTOM_QUOTA_RESERVE = 80;

export type ExternalEntry = { email: string; name: string };

export type ExternalParse =
  | {
      ok: true;
      entries: ExternalEntry[];
      /** Dòng lỗi, đã cắt còn EXTERNAL_PROBLEMS_SHOWN dòng. */
      problems: string[];
      /** Số dòng/địa chỉ không nhận (email sai, dòng không có email). */
      invalidCount: number;
      /** Số địa chỉ lặp lại trong chính danh sách này (chỉ giữ lần đầu). */
      duplicates: number;
    }
  | { ok: false; message: string };

const clip = (value: string, max = 60) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;

/**
 * Email của người ngoài: chặt hơn `normalizeEmailAddress` (vốn chỉ cần `x@y.z`), vì đây là chữ
 * người bấm gõ hay file Excel mang vào chứ không phải dữ liệu đã qua form đăng ký. Bắt được các
 * lỗi gõ hay gặp: dấu phẩy thay dấu chấm, hai dấu chấm liền, thiếu đuôi tên miền, dấu cách.
 * Không bắt được "gmail.con" — đó là một tên miền hợp lệ về hình thức.
 */
export function externalEmailAddress(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/^mailto:/i, "");
  const email = normalizeEmailAddress(text);
  if (!email || email.length > 254) return null;
  const at = email.lastIndexOf("@");
  if (at !== email.indexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || local.length > 64 || !LOCAL_PART.test(local)) return null;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label))) return null;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return null;
  return email;
}

/**
 * Làm sạch tên người ngoài. Tên đi thẳng vào thư mang tên miền VAM, nên:
 *   - ký tự điều khiển, xuống dòng, tab → khoảng trắng (tên không được chẻ tiêu đề thư);
 *   - tên chứa đường link bị BỎ (textToHtmlEmail tự biến http… thành link bấm được — một file
 *     Excel không được là cách chèn link lạ vào thư của VAM);
 *   - tên chứa `{{` / `}}` bị bỏ, để không ai đọc nhầm là ô điền;
 *   - dài quá EXTERNAL_NAME_MAX_LENGTH thì cắt.
 */
export function cleanExternalName(value: unknown): { name: string; dropped: boolean } {
  const control = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]+`, "g");
  const text = String(value ?? "")
    .normalize("NFC")
    .replace(control, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { name: "", dropped: false };
  if (/:\/\/|www\.|\{\{|\}\}|@/i.test(text)) return { name: "", dropped: true };
  return { name: text.length > EXTERNAL_NAME_MAX_LENGTH ? text.slice(0, EXTERNAL_NAME_MAX_LENGTH).trim() : text, dropped: false };
}

/** Mọi cụm có "@" trên một dòng — kể cả cụm sai, để báo được là sai chứ không lặng lẽ bỏ. */
const EMAIL_TOKEN = /[^\s<>,;"'()[\]]*@[^\s<>,;"'()[\]]*/g;

/**
 * Tên trên một dòng gõ tay có đúng một email: phần chữ còn lại sau khi bỏ email, bỏ dấu <>,
 * nháy, rồi tách theo tab / phẩy / chấm phẩy / gạch đứng. Ô toàn chữ số (STT, số điện thoại) bị
 * bỏ qua; lấy ô chữ đầu tiên. "Nguyễn Văn A <a@x.vn>", "a@x.vn, Nguyễn Văn A" và một dòng dán từ
 * Excel "1<TAB>a@x.vn<TAB>Nguyễn Văn A" đều ra "Nguyễn Văn A".
 */
function nameOnLine(line: string, token: string): string {
  const rest = line.replace(token, " ").replace(/[<>"]/g, " ");
  const parts = rest
    .split(/[\t,;|]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part && !/^[\d\s+().-]+$/.test(part));
  return parts[0] ?? "";
}

type Collector = {
  entries: Map<string, ExternalEntry>;
  problems: string[];
  invalidCount: number;
  duplicates: number;
};

function collector(): Collector {
  return { entries: new Map(), problems: [], invalidCount: 0, duplicates: 0 };
}

function problem(into: Collector, text: string, invalid: boolean) {
  if (invalid) into.invalidCount += 1;
  if (into.problems.length < EXTERNAL_PROBLEMS_SHOWN) into.problems.push(text);
}

function accept(into: Collector, where: string, email: string, rawName: string) {
  const cleaned = cleanExternalName(rawName);
  if (cleaned.dropped) problem(into, `${where}: bỏ tên “${clip(rawName)}” vì có đường link hoặc ký tự lạ — ${email} sẽ nhận thư không kèm tên`, false);
  const existing = into.entries.get(email);
  if (existing) {
    into.duplicates += 1;
    // Lần sau có tên mà lần đầu không có thì giữ tên — cùng một người, thêm thông tin chứ không đổi người.
    if (!existing.name && cleaned.name) existing.name = cleaned.name;
    return;
  }
  into.entries.set(email, { email, name: cleaned.name });
}

function finish(into: Collector): ExternalParse {
  const entries = Array.from(into.entries.values());
  if (entries.length > EXTERNAL_MAX_PER_BATCH) {
    return {
      ok: false,
      message: `Có ${entries.length} email ngoài VAM — một lô chỉ nhận tối đa ${EXTERNAL_MAX_PER_BATCH}. Chia danh sách thành nhiều lô.`
    };
  }
  return { ok: true, entries, problems: into.problems, invalidCount: into.invalidCount, duplicates: into.duplicates };
}

/**
 * Đọc ô "Email ngoài VAM": mỗi dòng một người — `email`, `email, Họ tên`, `Họ tên <email>`, hoặc
 * một dòng dán từ Excel. Một dòng có nhiều email (dán từ Outlook: `a@x.vn; b@y.vn`) thì mỗi email
 * một người, không kèm tên.
 *
 * Dùng cho CẢ bước xem trước lẫn bước gửi: hai bước đọc cùng một chữ bằng cùng một hàm, nên ra
 * cùng một danh sách.
 */
export function parseExternalRecipientText(value: unknown): ExternalParse {
  const text = String(value ?? "");
  if (text.length > EXTERNAL_MAX_TEXT_CHARS) {
    return { ok: false, message: "Danh sách email ngoài VAM quá dài. Chia thành nhiều lô." };
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.filter((line) => line.trim()).length > EXTERNAL_MAX_LINES) {
    return { ok: false, message: `Danh sách email ngoài VAM quá ${EXTERNAL_MAX_LINES} dòng. Chia thành nhiều lô.` };
  }

  const into = collector();
  lines.forEach((line, index) => {
    const content = line.trim();
    if (!content) return;
    const where = `Dòng ${index + 1}`;
    const tokens = (content.match(EMAIL_TOKEN) ?? []).filter((token) => token.replace(/^mailto:/i, "") !== "@");
    if (!tokens.length) {
      problem(into, `${where}: không thấy địa chỉ email (“${clip(content)}”)`, true);
      return;
    }
    const name = tokens.length === 1 ? nameOnLine(content, tokens[0]) : "";
    for (const token of tokens) {
      const email = externalEmailAddress(token);
      if (!email) {
        problem(into, `${where}: “${clip(token)}” không phải email hợp lệ`, true);
        continue;
      }
      accept(into, where, email, name);
    }
  });
  return finish(into);
}

const EMAIL_HEADERS = new Set(["email", "e mail", "mail", "dia chi email", "dia chi e mail", "thu dien tu", "dia chi thu dien tu", "email address", "gmail"]);
/** Theo thứ tự ưu tiên: "Họ tên" thắng "Tên" khi file có cả hai cột. */
const NAME_HEADERS = ["ho va ten", "ho ten", "ho ten day du", "ho va ten day du", "full name", "fullname", "ten nguoi nhan", "name", "ten"];

const foldHeader = (value: string) => foldPersonName(value.replace(/[-_.:*]+/g, " "));

/**
 * Đọc bảng chữ của file Excel (lib/ai/uploads.ts › readEmailListXlsx, mỗi dòng
 * `số dòng<TAB>ô A<TAB>ô B…`).
 *
 * - Có dòng tiêu đề (dòng có dữ liệu đầu tiên có một ô "Email" / "E-mail" / "Địa chỉ email"…):
 *   email đọc ở cột đó, tên ở cột "Họ và tên" / "Họ tên" / "Full name" / "Tên" nếu có.
 * - Không có tiêu đề: mỗi dòng lấy ô đầu tiên có "@" làm email, tên để trống (không đoán cột nào
 *   là tên — có thể là số điện thoại, MSSV).
 * Lỗi báo theo SỐ DÒNG EXCEL, để người dùng mở file ra sửa đúng chỗ.
 */
export function parseExternalRecipientTable(table: unknown): ExternalParse {
  const rows = String(table ?? "")
    .split("\n")
    .map((line) => {
      const [number, ...cells] = line.split("\t");
      return { row: Number(number) || 0, cells: cells.map((cell) => cell.trim()) };
    })
    .filter((row) => row.cells.some(Boolean));
  if (!rows.length) return { ok: false, message: "File không có dòng nào có dữ liệu ở sheet đầu tiên." };

  const header = rows[0].cells.map(foldHeader);
  const emailColumn = header.findIndex((cell) => EMAIL_HEADERS.has(cell));
  let nameColumn = -1;
  if (emailColumn >= 0) {
    for (const wanted of NAME_HEADERS) {
      nameColumn = header.findIndex((cell, index) => index !== emailColumn && cell === wanted);
      if (nameColumn >= 0) break;
    }
  }
  const data = emailColumn >= 0 ? rows.slice(1) : rows;
  if (data.length > EXTERNAL_FILE_MAX_ROWS) {
    return { ok: false, message: `File có ${data.length} dòng dữ liệu — tối đa ${EXTERNAL_FILE_MAX_ROWS} dòng một file.` };
  }

  const into = collector();
  for (const row of data) {
    const where = `Dòng ${row.row}`;
    const cell = emailColumn >= 0 ? row.cells[emailColumn] ?? "" : row.cells.find((value) => value.includes("@")) ?? "";
    if (!cell) {
      problem(into, `${where}: không có email`, true);
      continue;
    }
    const tokens = cell.split(/[\s,;]+/).filter(Boolean);
    if (tokens.length > 1) {
      problem(into, `${where}: một ô có nhiều địa chỉ (“${clip(cell)}”) — mỗi dòng một email`, true);
      continue;
    }
    const email = externalEmailAddress(tokens[0]);
    if (!email) {
      problem(into, `${where}: “${clip(cell)}” không phải email hợp lệ`, true);
      continue;
    }
    accept(into, where, email, nameColumn >= 0 ? row.cells[nameColumn] ?? "" : "");
  }
  return finish(into);
}

/** Viết danh sách đã đọc thành chữ của ô "Email ngoài VAM": mỗi dòng `email<TAB>Họ tên`. */
export function externalEntriesToText(entries: ExternalEntry[]): string {
  return entries.map((entry) => (entry.name ? `${entry.email}\t${entry.name}` : entry.email)).join("\n");
}

export function isExternalRecipient(row: Pick<BulkRecipient, "relationTable">): boolean {
  return row.relationTable === "external";
}

/**
 * Nối người ngoài vào danh sách lấy từ VAM. Người lấy từ VAM đứng trước và THẮNG khi trùng email:
 * họ có tên, mã, xưng hô thật, và một email chỉ nhận một lá. `overlap` đếm những email ngoài đã
 * có sẵn trong danh sách VAM, để bước xem trước nói ra.
 *
 * Người ngoài chưa có `personId` (chưa có dòng nào trong database). Sau khi chốt vào lô, id của
 * họ là id dòng chốt — xem lib/bulk-mail.ts › readFrozenRecipients.
 */
export function appendExternalRecipients(
  vam: RecipientPartition,
  entries: ExternalEntry[]
): { partition: RecipientPartition; overlap: number; added: number } {
  const taken = new Set(vam.sendable.map((row) => row.email));
  const externals: BulkRecipient[] = [];
  let overlap = 0;
  for (const entry of entries) {
    if (taken.has(entry.email)) {
      overlap += 1;
      continue;
    }
    taken.add(entry.email);
    externals.push({ personId: "", fullName: entry.name, email: entry.email, role: "external", relationTable: "external" });
  }
  return { partition: { sendable: [...vam.sendable, ...externals], unreachable: vam.unreachable }, overlap, added: externals.length };
}

/** Mẫu thư có dùng ô tên người nhận không — người ngoài trống tên thì không gửi được mẫu đó. */
export function templateUsesRecipientName(subject: unknown, body: unknown): boolean {
  return extractPlaceholders(`${String(subject ?? "")}\n${String(body ?? "")}`).includes("ten_nguoi_nhan");
}

/** Người ngoài trống tên trong một danh sách. */
export function namelessExternals(rows: BulkRecipient[]): BulkRecipient[] {
  return rows.filter((row) => isExternalRecipient(row) && !row.fullName.trim());
}

/**
 * Dòng sổ thư (`outbound_emails.related_table/related_id`) của một lá thư trong lô.
 * Người ngoài không có hồ sơ để nối về, nên lá thư nối về chính dòng chốt của họ trong
 * `email_batch_recipients` — dòng đó mang email và tên đã gửi. `related_id` là cột uuid: nối về
 * email hay một id bịa thì dòng sổ không ghi được, và "Gửi tiếp" sẽ gửi lại lá đó.
 */
export function outboundRelationFor(recipient: Pick<BulkRecipient, "relationTable" | "personId">): { table: string; id: string } {
  if (isExternalRecipient(recipient)) return { table: "email_batch_recipients", id: recipient.personId };
  return { table: recipient.relationTable ?? "people", id: recipient.personId };
}

/**
 * Một lần chạy của lô Danh sách tùy chỉnh được gửi bao nhiêu thư: không quá BULK_SEND_CHUNK, và
 * không ăn vào hạn mức chung 24 giờ (DAILY_EMAIL_LIMIT) trừ phần chừa cho các thư khác. 0 là đã
 * chạm hạn mức — danh sách vẫn nằm trong lô, "Gửi tiếp" sau khi cửa sổ 24 giờ trượt đi.
 */
export function customRunAllowance(sentInWindow: number): number {
  const sent = Number.isFinite(sentInWindow) && sentInWindow > 0 ? Math.floor(sentInWindow) : 0;
  return Math.max(0, Math.min(BULK_SEND_CHUNK, DAILY_EMAIL_LIMIT - BULK_CUSTOM_QUOTA_RESERVE - sent));
}

/** Dấu vân tay rẻ của chữ ô người ngoài — chỉ để màn hình biết bản xem trước đã cũ. */
export function externalTextSignature(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}

/** Nhãn của lô: thêm "N email ngoài VAM" vào nhãn nguồn VAM. */
export function withExternalLabel(label: string, externalCount: number): string {
  if (!externalCount) return label;
  const part = `${externalCount} email ngoài VAM`;
  return label.includes(":") ? `${label} + ${part}` : `${label}: ${part}`;
}
