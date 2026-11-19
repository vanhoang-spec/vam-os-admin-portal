/**
 * Mail › tệp đính kèm tải lên từ thiết bị (VAM00037) — phần thuần, không I/O.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TỆP KHÔNG ĐI QUA MÁY CHỦ VAM
 * ---------------------------------------------------------------------------
 * Trình duyệt PUT thẳng tệp lên kho riêng 'mail-dinh-kem' của Supabase Storage qua link ký sẵn;
 * máy chủ chỉ cấp link tải lên (đúng thư mục <mùa>/<người tải>/), đọc SIÊU DỮ LIỆU (tên, cỡ, loại)
 * để kiểm, và lúc gửi thì cấp link tải xuống ký sẵn cho NHÀ CUNG CẤP thư (Brevo `attachment.url`,
 * Resend `attachments.path`) tự lấy tệp. Hai cái giá của lối khác:
 *   - đi qua server action thì Vercel cắt thân yêu cầu ở ~4,5 MB, và mỗi lần "Gửi tiếp" phải đọc lại
 *     byte của mọi tệp vào bộ nhớ hàm;
 *   - máy chủ cầm byte là mở thêm một đường tới bộ giải mã ảnh (sharp, xem
 *     __tests__/image-optimizer-attack-surface.test.ts mục 3e).
 *
 * ---------------------------------------------------------------------------
 * GIỚI HẠN — vì sao những con số này
 * ---------------------------------------------------------------------------
 * Brevo nhận tổng thư (kể cả tệp, sau mã hoá base64 ≈ +33 %) tới khoảng 20 MB; Resend 40 MB. Hộp thư
 * người nhận (Gmail 25 MB, Outlook 20 MB) cũng tính sau mã hoá. 10 MB tệp gốc ≈ 13,4 MB sau mã hoá:
 * vừa với nhà cung cấp chặt nhất, kèm chỗ cho thân thư. Danh sách đuôi tệp là phần giao của danh sách
 * Brevo nhận, BỎ những loại chạy được mã (tệp thực thi, script, macro Office, HTML/SVG) và tệp nén
 * (giấu được tệp thực thi bên trong mà ta không mở ra kiểm).
 */
import type { EmailAttachment } from "@/lib/email-core";

export const MAIL_DINH_KEM_BUCKET = "mail-dinh-kem";

/** Tên ô ẩn mang danh sách tệp đã tải lên trong các form gửi (JSON `[{ path, name }]`). */
export const MAIL_DINH_KEM_FIELD = "attachments";

export const SO_TEP_TOI_DA = 10;
const MB = 1024 * 1024;
/** Tổng dung lượng các tệp của MỘT lá thư. Một tệp cũng không vượt được con số này. */
export const TONG_DUNG_LUONG_TOI_DA = 10 * MB;
/** Giới hạn của kho (file_size_limit trong migration) — trùng tổng, vì một tệp là trường hợp riêng của tổng. */
export const CO_TEP_TOI_DA = TONG_DUNG_LUONG_TOI_DA;

/** Đuôi tệp nhận được → MIME. Kho chỉ nhận đúng các MIME này (allowed_mime_types trong migration). */
export const LOAI_TEP_DINH_KEM: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  csv: "text/csv",
  txt: "text/plain",
  ics: "text/calendar",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif"
};

/** Chuỗi `accept` cho ô chọn tệp — suy từ đúng danh sách trên, không viết tay lần thứ hai. */
export const MAIL_DINH_KEM_ACCEPT = Object.keys(LOAI_TEP_DINH_KEM)
  .map((ext) => `.${ext}`)
  .join(",");

/** Các đuôi chạy được mã. Không có trong danh sách nhận nên đằng nào cũng bị chặn; tách riêng để báo đúng lý do. */
const DUOI_THUC_THI = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys", "lnk", "reg", "hta",
  "js", "mjs", "cjs", "jse", "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "sh", "bash", "zsh", "csh", "command",
  "py", "pyc", "pl", "rb", "php", "jar", "class", "apk", "app", "dmg", "pkg", "deb", "rpm", "iso", "img",
  "html", "htm", "xhtml", "svg", "xml", "docm", "dotm", "xlsm", "xltm", "xlam", "pptm", "potm", "ppsm"
]);
const DUOI_NEN = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]);

/** Nhãn ngắn của giới hạn, dùng chung cho giao diện và thông báo lỗi. */
export const MAIL_DINH_KEM_GIOI_HAN_TEXT =
  `Tối đa ${SO_TEP_TOI_DA} tệp, tổng không quá ${TONG_DUNG_LUONG_TOI_DA / MB} MB. ` +
  "Nhận PDF, Word, Excel, PowerPoint, OpenDocument, RTF, CSV, TXT, lịch .ics và ảnh JPG/PNG/GIF. " +
  "Không nhận tệp nén và tệp chạy được (.exe, .bat, .js, .sh, macro…).";

/** "1,2 MB" / "350 KB" — định dạng Việt Nam (dấu phẩy thập phân). */
export function dinhDangDungLuong(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1).replace(/\.0$/, "").replace(".", ",")} MB`;
}

/** Đuôi tệp, chữ thường, không dấu chấm. Tệp không có đuôi → chuỗi rỗng. */
export function duoiTep(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Tên hiển thị người nhận thấy: bỏ đường dẫn, ký tự điều khiển và ký tự hộp thư hay từ chối; gọn
 * khoảng trắng; tối đa 120 ký tự nhưng GIỮ đuôi (cắt phần thân, không cắt mất ".pdf").
 */
export function tenTepAnToan(name: string): string {
  const base = (String(name ?? "").split(/[\\/]/).pop() ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (base.length <= 120) return base;
  const ext = duoiTep(base);
  const keep = 120 - (ext ? ext.length + 1 : 0);
  return ext ? `${base.slice(0, keep).trim()}.${ext}` : base.slice(0, 120);
}

/** Phần thân tên tệp dạng ASCII cho khoá trong kho (Storage không nhận mọi ký tự; nhà cung cấp đọc được đuôi từ URL). */
export function slugTenTep(name: string): string {
  const ext = duoiTep(name);
  const stem = ext ? name.slice(0, name.length - ext.length - 1) : name;
  const slug = stem
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "tep";
}

export type TepKhaiBao = { name: string; size: number };
export type TepHopLe = { name: string; size: number; ext: string; mime: string };

/** Kiểm một tệp theo tên và cỡ (máy khách khai). Máy chủ kiểm lại cỡ thật trong kho lúc gắn vào thư. */
export function kiemMotTep(file: TepKhaiBao): { ok: true; file: TepHopLe } | { ok: false; message: string } {
  const name = tenTepAnToan(file?.name ?? "");
  const shown = name || "Tệp không tên";
  const ext = duoiTep(name);
  if (!name || !ext) return { ok: false, message: `${shown}: tệp không có đuôi, không biết là loại gì.` };
  if (DUOI_THUC_THI.has(ext)) {
    return { ok: false, message: `${shown}: tệp .${ext} chạy được mã nên bị chặn.` };
  }
  if (DUOI_NEN.has(ext)) {
    return { ok: false, message: `${shown}: không nhận tệp nén (.${ext}). Đính kèm từng tệp riêng.` };
  }
  const mime = LOAI_TEP_DINH_KEM[ext];
  if (!mime) return { ok: false, message: `${shown}: chưa nhận loại tệp .${ext}.` };
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, message: `${shown}: tệp rỗng.` };
  if (size > CO_TEP_TOI_DA) {
    return {
      ok: false,
      message: `${shown}: ${dinhDangDungLuong(size)}, vượt mức ${dinhDangDungLuong(CO_TEP_TOI_DA)} một lá thư.`
    };
  }
  return { ok: true, file: { name, size, ext, mime } };
}

/**
 * Thêm tệp vào danh sách đang có: kiểm từng tệp, rồi số tệp và tổng dung lượng. Tệp hỏng hoặc làm
 * vượt giới hạn bị bỏ RIÊNG tệp đó (kèm lý do), các tệp còn lại vẫn được nhận.
 */
export function kiemThemTep(
  current: Array<{ size: number }>,
  adding: TepKhaiBao[]
): { accepted: TepHopLe[]; problems: string[] } {
  const accepted: TepHopLe[] = [];
  const problems: string[] = [];
  let count = current.length;
  let total = current.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  for (const raw of adding) {
    const checked = kiemMotTep(raw);
    if (!checked.ok) {
      problems.push(checked.message);
      continue;
    }
    if (count >= SO_TEP_TOI_DA) {
      problems.push(`${checked.file.name}: đã đủ ${SO_TEP_TOI_DA} tệp cho một lá thư.`);
      continue;
    }
    if (total + checked.file.size > TONG_DUNG_LUONG_TOI_DA) {
      problems.push(
        `${checked.file.name}: thêm tệp này thì tổng thành ${dinhDangDungLuong(total + checked.file.size)}, vượt ${dinhDangDungLuong(TONG_DUNG_LUONG_TOI_DA)}.`
      );
      continue;
    }
    accepted.push(checked.file);
    count += 1;
    total += checked.file.size;
  }
  return { accepted, problems };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);

/** Khoá trong kho: <mùa>/<người tải>/<uuid>/<tên-ascii>.<đuôi>. Thư mục uuid riêng cho từng tệp để liệt kê được đúng một tệp. */
export function duongDanTepMoi(seasonId: string, actorId: string, uuid: string, name: string): string {
  return `${seasonId}/${actorId}/${uuid}/${slugTenTep(name)}.${duoiTep(name)}`;
}

/** Đường dẫn đúng dạng do máy chủ cấp, trong thư mục của chính người này ở mùa này, đuôi nằm trong danh sách nhận. */
export function laTepCuaNguoiTai(seasonId: string, actorId: string, path: unknown): boolean {
  if (typeof path !== "string" || !UUID_RE.test(seasonId) || !UUID_RE.test(actorId)) return false;
  const m = new RegExp(`^${seasonId}/${actorId}/${UUID}/[a-z0-9][a-z0-9-]{0,59}\\.([a-z0-9]{1,5})$`).exec(path);
  return Boolean(m && LOAI_TEP_DINH_KEM[m[1]]);
}

/** Thư mục chứa đúng một tệp (phần trước tên tệp). */
export function thuMucCuaTep(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

export type TepThamChieu = { path: string; name: string };

/**
 * Đọc ô MAIL_DINH_KEM_FIELD của form gửi. Ô trống / thiếu → không đính kèm (hành vi cũ). Mọi đường
 * dẫn phải là của chính người bấm ở mùa này (form là thứ người gửi tự đặt được), không trùng, tên
 * hiển thị cùng đuôi với tệp trong kho, và không quá SO_TEP_TOI_DA tệp.
 */
export function docTepTuForm(
  raw: unknown,
  scope: { seasonId: string; actorId: string }
): { ok: true; files: TepThamChieu[] } | { ok: false; message: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: true, files: [] };
  const fail = { ok: false as const, message: "Danh sách tệp đính kèm không hợp lệ. Chọn lại tệp rồi gửi." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail;
  }
  if (!Array.isArray(parsed)) return fail;
  if (parsed.length > SO_TEP_TOI_DA) {
    return { ok: false, message: `Một lá thư đính kèm tối đa ${SO_TEP_TOI_DA} tệp.` };
  }
  const files: TepThamChieu[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const path = (item as { path?: unknown })?.path;
    const name = tenTepAnToan(String((item as { name?: unknown })?.name ?? ""));
    if (!laTepCuaNguoiTai(scope.seasonId, scope.actorId, path)) return fail;
    const p = path as string;
    if (seen.has(p)) return fail;
    if (!name || duoiTep(name) !== duoiTep(p)) return fail;
    seen.add(p);
    files.push({ path: p, name });
  }
  return { ok: true, files };
}

export type TepTrongKho = { path: string; size: number; mimetype: string | null };
export type TepDaKiem = { path: string; name: string; size: number; mime: string };

/**
 * Đối chiếu tệp form khai với thứ THẬT có trong kho (siêu dữ liệu Storage): tệp phải tồn tại, đúng
 * MIME của đuôi, cỡ và tổng trong giới hạn. Đây là phép kiểm của máy chủ — con số trình duyệt khai
 * lúc chọn tệp không được tin.
 */
export function doiChieuTepTrongKho(
  refs: TepThamChieu[],
  stored: TepTrongKho[]
): { ok: true; files: TepDaKiem[] } | { ok: false; message: string } {
  const byPath = new Map(stored.map((row) => [row.path, row]));
  const files: TepDaKiem[] = [];
  let total = 0;
  for (const ref of refs) {
    const found = byPath.get(ref.path);
    if (!found) return { ok: false, message: `${ref.name}: tệp chưa tải lên xong. Bỏ tệp này rồi chọn lại.` };
    const mime = LOAI_TEP_DINH_KEM[duoiTep(ref.path)];
    if (!mime || (found.mimetype && found.mimetype !== mime)) {
      return { ok: false, message: `${ref.name}: loại tệp trong kho không khớp đuôi tệp.` };
    }
    if (!(found.size > 0) || found.size > CO_TEP_TOI_DA) {
      return { ok: false, message: `${ref.name}: dung lượng không hợp lệ (${dinhDangDungLuong(found.size)}).` };
    }
    total += found.size;
    files.push({ path: ref.path, name: ref.name, size: found.size, mime });
  }
  if (total > TONG_DUNG_LUONG_TOI_DA) {
    return {
      ok: false,
      message: `Tổng tệp đính kèm ${dinhDangDungLuong(total)}, vượt ${dinhDangDungLuong(TONG_DUNG_LUONG_TOI_DA)} một lá thư.`
    };
  }
  return { ok: true, files };
}

/** Tệp đã có link tải ký sẵn → dạng đính kèm của lib/email.ts (nhà cung cấp tự lấy tệp theo URL). */
export function dungDinhKemThu(
  files: Array<{ name: string; mime: string; url: string }>
): EmailAttachment[] {
  return files
    .filter((file) => file.url)
    .map((file) => ({ filename: file.name, url: file.url, contentType: file.mime }));
}

/** Lỗi PostgREST / Postgres nghĩa là "bảng chưa có" — migration chưa áp, nên chưa lô nào có tệp. */
export function laLoiThieuBang(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /email_attachments/.test(String(error.message ?? "")) && /does not exist|schema cache/i.test(String(error.message ?? ""));
}
