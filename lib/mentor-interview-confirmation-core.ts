import { sessionDayLabel, sessionTimeLabel, vietnamDateKeyOf } from "@/lib/mentee-interview-core";
import { formatTime } from "@/lib/utils";

/**
 * Thư xác nhận lịch phỏng vấn cho MENTOR tham gia chấm vòng phỏng vấn mentee
 * (mẫu "MENTOR_MAIL XÁC NHẬN LỊCH PV" của BTC, 02/10/2026).
 *
 * Phần thuần, không I/O: đọc CSV của Google Sheet đăng ký, ghép buổi của từng
 * mentor với ca phỏng vấn trong hệ thống (giờ, phòng, cơ sở, bản đồ), và dựng
 * nội dung thư. Ai được gửi do lib/mentor-interview-confirmation.ts quyết định.
 *
 * Giờ và địa điểm đọc từ chính các ca (`interview_sessions`), không gõ lại vào
 * đây: BTC đổi phòng trên màn hình ca thì thư gửi sau đó tự nói phòng mới. Hai
 * nơi cùng giữ địa chỉ là hai cơ hội để một nơi nói sai.
 */

export const CONFIRMATION_SUBJECT = "UEH MENTORING | THƯ XÁC NHẬN ĐĂNG KÝ LỊCH PHỎNG VẤN MENTEE MÙA 12";
export const ZALO_GROUP_URL = "https://zalo.me/g/vk1tvjxrvycq3rnk8k3s";
export const HOTLINE_LINE = "Hotline: Mỹ Anh (0394983679), Hoàng Vy (0936359670)";
/** Thư đi qua sổ thư với loại này — loại đã có trong outbound_emails_kind_check, không cần migration. */
export const CONFIRMATION_EMAIL_KIND = "general_announcement" as const;
/** Sheet lớn hơn thế này thì không phải sheet đăng ký — đừng đọc tiếp. */
export const MAX_SHEET_BYTES = 2_000_000;

export type SessionInput = { id: string; startsAtIso: string; endsAtIso: string; venue: string | null };

/**
 * Hướng dẫn RIÊNG CHO MENTOR của một buổi, khi nó khác địa điểm ghi trên ca.
 *
 * Địa điểm của ca là thứ mentee đọc (trang chọn ca, thư của mentee) — vd. "Check-in
 * tại phòng B1-502" là câu cho mentee; mentor Chủ nhật 11/10 lại đi thẳng tới phòng
 * phỏng vấn. Sửa địa điểm của ca để thư mentor nói đúng thì trang của mentee nói sai,
 * nên phần riêng của mentor nằm ở đây, theo khoá buổi.
 */
export type MentorBlockGuide = {
  /** Có = buổi phỏng vấn online: thay cả mục địa điểm bằng các dòng này. */
  online?: readonly string[];
  /** Thay ô "Cơ sở" đọc từ ca. */
  place?: string;
  /** Nhãn ô phòng, mặc định "Phòng". */
  roomsLabel?: string;
  /** Dòng thêm sau ô cơ sở (check-in…). Có thì không in câu "BTC xếp phòng khi check-in". */
  extra?: readonly string[];
};

const SUNDAY_11_10: MentorBlockGuide = {
  place: "Cơ sở B – UEH, 279 Nguyễn Tri Phương, Phường Diên Hồng, TP.HCM",
  roomsLabel: "Phòng PV",
  extra: [
    "- Check-in Mentee: B1-502",
    "- Check-in Mentor: Mentor chủ động đến các phòng B1-503, B1-504, B1-506, B1-802, B1-803; BTC hỗ trợ check-in và phân bàn trực tiếp tại phòng."
  ]
};

/**
 * BTC 08/10/2026 cho đợt 2 (10–11/10). Sáng Thứ Bảy dùng nguyên địa điểm trên ca
 * (Phòng E501, E502, E504 — Cơ sở E). Thêm đợt sau thì thêm khoá "YYYY-MM-DD:sang|chieu".
 */
export const MENTOR_BLOCK_GUIDES: Readonly<Record<string, MentorBlockGuide>> = {
  "2026-10-10:chieu": {
    online: [
      "- Hình thức: PHỎNG VẤN ONLINE",
      "- Mỗi Mentor có 1 phòng online riêng, BTC điều phối Mentee vào phòng theo từng ca."
    ]
  },
  "2026-10-11:sang": SUNDAY_11_10,
  "2026-10-11:chieu": SUNDAY_11_10
};

export type InterviewBlock = {
  /** "2026-10-03:sang" */
  key: string;
  dateKey: string;
  period: "sang" | "chieu";
  /** Đúng chữ trên tiêu đề cột của sheet: "Sáng 3/10", "Chiều 4/10". */
  headerLabel: string;
  /** "Thứ Bảy 03/10/2026 — buổi sáng" */
  label: string;
  /** "08:00 – 11:30" */
  timeLabel: string;
  rooms: string;
  place: string;
  mapUrl: string;
  firstStartIso: string;
  firstSessionId: string;
  /** Hướng dẫn riêng cho mentor của buổi này, nếu BTC có. */
  guide: MentorBlockGuide | null;
};

const PERIOD_WORD = { sang: "Sáng", chieu: "Chiều" } as const;
const PERIOD_LABEL = { sang: "buổi sáng", chieu: "buổi chiều" } as const;

/**
 * Tách chuỗi địa điểm của ca — dạng BTC nhập trên màn hình ca:
 * "Phòng H101, H104 — Cơ sở H, 1A Hoàng Diệu, ... . Bản đồ: https://..."
 * Không đúng dạng thì giữ nguyên cả chuỗi ở ô cơ sở: thư nói thừa còn hơn nói thiếu.
 */
export function splitVenue(venue: string | null): { rooms: string; place: string; mapUrl: string } {
  let rest = String(venue ?? "").replace(/\s+/g, " ").trim();
  let mapUrl = "";
  const map = /\s*\.?\s*Bản đồ:\s*(https?:\/\/\S+)\s*$/i.exec(rest);
  if (map) {
    mapUrl = map[1].replace(/[.,;]+$/, "");
    rest = rest.slice(0, map.index).trim();
  }
  const dash = rest.indexOf(" — ");
  if (dash > 0 && /^phòng\s/i.test(rest)) {
    return { rooms: rest.slice(0, dash).replace(/^phòng\s+/i, "").trim(), place: rest.slice(dash + 3).trim(), mapUrl };
  }
  return { rooms: "", place: rest, mapUrl };
}

function periodOf(iso: string): "sang" | "chieu" {
  const hour = Number(formatTime(iso).slice(0, 2));
  return hour < 12 ? "sang" : "chieu";
}

/**
 * Gom các ca CHƯA KẾT THÚC thành từng buổi (ngày × sáng/chiều). Ca đã qua tự rơi
 * khỏi danh sách: thư gửi lúc đợt 2 mở sẽ không nhắc lại buổi của đợt 1.
 */
export function buildInterviewBlocks(
  sessions: readonly SessionInput[],
  nowIso: string,
  guides: Readonly<Record<string, MentorBlockGuide>> = MENTOR_BLOCK_GUIDES
): InterviewBlock[] {
  const groups = new Map<string, SessionInput[]>();
  for (const s of sessions) {
    if (!s.startsAtIso || !s.endsAtIso || s.endsAtIso <= nowIso) continue;
    const dateKey = vietnamDateKeyOf(s.startsAtIso);
    if (!dateKey) continue;
    const key = `${dateKey}:${periodOf(s.startsAtIso)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  // Xếp theo giờ bắt đầu, KHÔNG theo khoá: "…:chieu" < "…:sang" theo bảng chữ cái,
  // và thư sẽ kể buổi chiều trước buổi sáng của cùng một ngày.
  const earliest = (list: SessionInput[]) => list.map((s) => s.startsAtIso).sort()[0];
  return Array.from(groups.entries())
    .sort((a, b) => earliest(a[1]).localeCompare(earliest(b[1])))
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
      const first = sorted[0];
      const lastEnd = sorted.map((s) => s.endsAtIso).sort().at(-1) ?? first.endsAtIso;
      const [dateKey, period] = key.split(":") as [string, "sang" | "chieu"];
      const [, month, day] = dateKey.split("-");
      const venues = Array.from(new Set(sorted.map((s) => String(s.venue ?? "").trim()).filter(Boolean)));
      const parts = venues.map(splitVenue);
      return {
        key,
        dateKey,
        period,
        headerLabel: `${PERIOD_WORD[period]} ${Number(day)}/${Number(month)}`,
        label: `${sessionDayLabel(first.startsAtIso)} — ${PERIOD_LABEL[period]}`,
        timeLabel: sessionTimeLabel(first.startsAtIso, lastEnd),
        rooms: Array.from(new Set(parts.map((p) => p.rooms).filter(Boolean))).join("; "),
        place: Array.from(new Set(parts.map((p) => p.place).filter(Boolean))).join("; "),
        mapUrl: parts.map((p) => p.mapUrl).find(Boolean) ?? "",
        firstStartIso: first.startsAtIso,
        firstSessionId: first.id,
        guide: guides[key] ?? null
      };
    });
}

/**
 * Link sheet BTC dán → địa chỉ xuất CSV. Chỉ nhận đúng dạng link Google Sheets và
 * TỰ dựng địa chỉ đọc: server không bao giờ gọi một địa chỉ do người dùng gõ.
 *
 * Đường `/export?format=csv`, KHÔNG phải `/gviz/tq`: gviz tự đoán hàng tiêu đề và
 * gộp chúng lại. 08/10/2026 BTC thêm khối hướng dẫn trên đầu sheet; gviz gộp nhầm
 * cả khối đó làm "tiêu đề" và làm rơi mất hàng "Sáng 10/10, Chiều 10/10…" — trang
 * báo "Sheet không có cột cho buổi". `/export` trả đúng lưới ô như trên màn hình.
 */
export function sheetCsvUrl(link: unknown): string | null {
  const text = String(link ?? "").trim();
  const match = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#][^\s]*)?$/.exec(text);
  if (!match) return null;
  const gid = /[?#&]gid=(\d{1,12})(?!\d)/.exec(text)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

/** CSV theo RFC 4180 — ô có xuống dòng và dấu nháy kép (tiêu đề cột của sheet có cả hai). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (value: string) => value.replace(/\s+/g, " ").trim();

export type SignupRow = {
  name: string;
  email: string;
  phone: string;
  note: string;
  blockKeys: string[];
};

export type SheetParse =
  | { ok: true; rows: SignupRow[]; duplicates: string[] }
  | { ok: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Tiêu đề nhiều tầng hiếm khi quá ba hàng; quá thế là đã đọc vào dữ liệu. */
const MAX_SUBHEADER_ROWS = 3;

/**
 * Đọc sheet đăng ký theo TIÊU ĐỀ cột, không theo vị trí: BTC chèn thêm cột thì
 * vẫn đọc đúng. Thiếu cột của một buổi đang có ca thì từ chối cả sheet — đọc
 * nhầm cột là gửi nhầm lịch cho người thật.
 *
 * Tiêu đề có thể nhiều tầng (sheet 08/10/2026: hàng "Họ và tên | Email | …", rồi
 * hàng "Đợt 1 | Đợt 2", rồi hàng "Sáng 4/10 | … | Sáng 10/10 | …"). Nhãn buổi được
 * tìm trên hàng tiêu đề VÀ các hàng ngay dưới nó cho tới dòng dữ liệu đầu tiên (dòng
 * đầu có email). Một ô gộp cả tầng trên ("Đợt 2 Sáng 10/10") cũng khớp.
 */
export function parseSignupSheet(csv: string, blocks: readonly InterviewBlock[]): SheetParse {
  const table = parseCsv(csv);
  const headerIndex = table.findIndex(
    (r) => r.some((c) => /họ và tên/i.test(c)) && r.some((c) => /^email/i.test(norm(c)))
  );
  if (headerIndex < 0) return { ok: false, message: "Không tìm thấy hàng tiêu đề (cần cột \"Họ và tên\" và \"Email\")." };
  const header = table[headerIndex].map(norm);
  const find = (test: (h: string) => boolean) => header.findIndex(test);
  const nameCol = find((h) => /họ và tên/i.test(h));
  const emailCol = find((h) => /^email/i.test(h));
  const phoneCol = find((h) => /số điện thoại/i.test(h));
  const noteCol = find((h) => /^note/i.test(h) || /\snote\b/i.test(h));

  const headerRows = [header];
  for (const r of table.slice(headerIndex + 1, headerIndex + 1 + MAX_SUBHEADER_ROWS)) {
    if (EMAIL_PATTERN.test(norm(r[emailCol] ?? "").toLowerCase())) break;
    headerRows.push(r.map(norm));
  }
  const labelCol = (label: string) => {
    for (const row of headerRows) {
      const col = row.findIndex((h) => h === label || h.endsWith(` ${label}`));
      if (col >= 0) return col;
    }
    return -1;
  };
  const blockCols = blocks.map((b) => ({ key: b.key, col: labelCol(b.headerLabel) }));
  const missing = blocks.filter((_, i) => blockCols[i].col < 0).map((b) => b.headerLabel);
  if (missing.length) return { ok: false, message: `Sheet không có cột cho buổi: ${missing.join(", ")}.` };

  const byEmail = new Map<string, SignupRow>();
  const duplicates: string[] = [];
  for (const r of table.slice(headerIndex + 1)) {
    const email = norm(r[emailCol] ?? "").toLowerCase();
    if (!EMAIL_PATTERN.test(email)) continue;
    const blockKeys = blockCols.filter(({ col }) => norm(r[col] ?? "").toUpperCase() === "TRUE").map(({ key }) => key);
    const row: SignupRow = {
      name: norm(r[nameCol] ?? ""),
      email,
      phone: phoneCol >= 0 ? norm(r[phoneCol] ?? "") : "",
      note: noteCol >= 0 ? norm(r[noteCol] ?? "") : "",
      blockKeys
    };
    const prev = byEmail.get(email);
    if (prev) {
      // Một người điền hai dòng: gộp buổi, không gửi hai thư.
      duplicates.push(email);
      prev.blockKeys = Array.from(new Set([...prev.blockKeys, ...blockKeys]));
      if (!prev.note && row.note) prev.note = row.note;
    } else {
      byEmail.set(email, row);
    }
  }
  return { ok: true, rows: Array.from(byEmail.values()), duplicates };
}

/** Chín số cuối — sheet ghi "093 9067841", "915767858", "0938...": cùng một số. */
export function phoneKey(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

const COMBINING = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
/** "Nguyễn Viết Tuấn" → "nguyen viet tuan" — so tên mà không vấp dấu. */
export function nameKey(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(COMBINING, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type Participant = {
  email: string;
  fullName: string;
  phone: string;
  /** false = có tài khoản nhưng CHƯA từng đăng nhập → thư mang link đặt mật khẩu. */
  signedIn?: boolean;
};

export type MatchedBy = "email" | "phone_and_name";

/**
 * Dòng đăng ký này là ai trong danh sách `candidates`.
 *
 * Email trên sheet khớp thẳng là cách chính. Không khớp thì thử số điện thoại —
 * nhưng chỉ nhận khi số trùng ĐÚNG MỘT người VÀ tên cũng trùng: một số gõ nhầm
 * không được trao lịch, hay quyền chấm, của người này cho người khác. Một luật cho
 * cả bước cấp quyền lẫn bước gửi thư: hai luật là hai cơ hội để người được cấp
 * quyền khác người nhận thư.
 */
export function matchSignup<T extends { email: string; fullName: string; phone: string }>(
  row: Pick<SignupRow, "email" | "name" | "phone">,
  candidates: readonly T[]
): { candidate: T; matchedBy: MatchedBy } | null {
  const byEmail = candidates.find((c) => c.email.trim().toLowerCase() === row.email);
  if (byEmail) return { candidate: byEmail, matchedBy: "email" };
  const key = phoneKey(row.phone);
  const samePhone = key ? candidates.filter((c) => phoneKey(c.phone) === key) : [];
  if (samePhone.length === 1 && nameKey(row.name) && nameKey(samePhone[0].fullName) === nameKey(row.name)) {
    return { candidate: samePhone[0], matchedBy: "phone_and_name" };
  }
  return null;
}

export type RecipientStatus = "ready" | "already_sent" | "no_access" | "no_blocks";

export type PlannedRecipient = SignupRow & {
  status: RecipientStatus;
  /** Email tài khoản chấm — cũng là nơi nhận thư. */
  loginEmail: string | null;
  matchedBy: MatchedBy | null;
  /** Có tài khoản nhưng chưa từng đăng nhập: thư thật mang link đặt mật khẩu riêng. */
  needsPasswordLink: boolean;
};

/**
 * Ai được nhận thư, gửi tới đâu.
 *
 * Chỉ người ĐÃ có quyền phỏng vấn mùa này mới nhận: thư nói "đây là tài khoản
 * của anh/chị", nên gửi cho người chưa vào được màn hình chấm là gửi một câu sai.
 */
export function planRecipients(
  rows: readonly SignupRow[],
  participants: readonly Participant[],
  alreadySent: ReadonlySet<string>
): PlannedRecipient[] {
  return rows.map((row) => {
    const match = matchSignup(row, participants);
    const loginEmail = match ? match.candidate.email.trim().toLowerCase() : null;
    const status: RecipientStatus = row.blockKeys.length === 0
      ? "no_blocks"
      : !loginEmail
        ? "no_access"
        : alreadySent.has(loginEmail)
          ? "already_sent"
          : "ready";
    return {
      ...row,
      status,
      loginEmail,
      matchedBy: match?.matchedBy ?? null,
      needsPasswordLink: Boolean(match && match.candidate.signedIn === false)
    };
  });
}

/** Mốc của đợt: ca sớm nhất còn chưa kết thúc. Thư của đợt nào ghi sổ theo mốc đợt đó. */
export function roundAnchor(blocks: readonly InterviewBlock[]): { sessionId: string; startsAtIso: string } | null {
  const first = [...blocks].sort((a, b) => a.firstStartIso.localeCompare(b.firstStartIso))[0];
  return first ? { sessionId: first.firstSessionId, startsAtIso: first.firstStartIso } : null;
}

export type ConfirmationInput = {
  name: string;
  loginEmail: string;
  matchedBy: PlannedRecipient["matchedBy"];
  note: string;
  blocks: readonly InterviewBlock[];
  origin: string;
  /**
   * Link đặt mật khẩu riêng (chỉ có trong thư THẬT gửi cho chính mentor), hoặc
   * "placeholder" cho bản xem trước / bản thử — bản thử đi tới người bấm, nên
   * không bao giờ được mang link mở tài khoản của mentor.
   */
  passwordLink?: string | "placeholder" | null;
};

export const PASSWORD_LINK_PLACEHOLDER = "[link đặt mật khẩu riêng của mentor — chỉ có trong thư gửi thật]";

/**
 * Nội dung thư — giữ đúng 5 mục và lời văn của mẫu BTC. Văn bản thuần: sổ thư
 * dựng HTML từ đây (textToHtmlEmail tự thoát ký tự và tự gắn link), nên tên hay
 * ghi chú người đăng ký tự gõ không chèn được thẻ nào vào thư.
 */
export function renderConfirmation(input: ConfirmationInput): { subject: string; body: string } {
  const origin = input.origin.replace(/\/+$/, "");
  const name = input.name || input.loginEmail;
  const time = input.blocks.map((b) => `- ${b.label}: ${b.timeLabel}`);
  const places = input.blocks.map((b) => {
    const guide = b.guide;
    if (guide?.online?.length) return [b.label, ...guide.online].join("\n");
    return [
      b.label,
      b.rooms ? `- ${guide?.roomsLabel ?? "Phòng"}: ${b.rooms}` : null,
      `- Cơ sở: ${guide?.place || b.place || "BTC sẽ thông báo trong Group Zalo"}`,
      ...(guide?.extra ?? []),
      b.mapUrl ? `- Link maps: ${b.mapUrl}` : null,
      // Buổi có hướng dẫn check-in riêng thì câu chung này nói ngược với nó.
      guide?.extra?.length ? null : "- Phòng và bàn phỏng vấn cụ thể BTC sẽ xếp khi Anh/Chị check-in."
    ].filter(Boolean).join("\n");
  });
  const onlineOnly = input.blocks.length > 0 && input.blocks.every((b) => Boolean(b.guide?.online?.length));
  const lines = [
    `Kính gửi Anh/Chị Mentor ${name},`,
    "BTC UEH Mentoring Mùa 12 xin xác nhận lịch tham gia Vòng phỏng vấn Tuyển Mentee của Anh/Chị như sau:",
    [
      "1. Thời gian",
      ...time,
      onlineOnly
        ? "- Anh/Chị vui lòng sẵn sàng trước 15 phút để chuẩn bị trước khi bắt đầu phỏng vấn."
        : "- Anh/Chị vui lòng có mặt trước 15 phút để check-in và chuẩn bị trước khi bắt đầu phỏng vấn.",
      input.note ? `- Ghi chú Anh/Chị đã đăng ký: ${input.note}` : null
    ].filter(Boolean).join("\n"),
    "2. Địa điểm",
    ...places,
    [
      "3. Tài khoản chấm & Hướng dẫn đăng nhập",
      `- Tài khoản: ${input.loginEmail}`,
      input.passwordLink
        ? `- Đặt mật khẩu lần đầu: ${input.passwordLink === "placeholder" ? PASSWORD_LINK_PLACEHOLDER : input.passwordLink} (link dùng một lần và có hạn)`
        : null,
      `- Hướng dẫn đăng nhập: vào ${origin}/login và đăng nhập bằng email trên. Chưa có hoặc quên mật khẩu thì bấm "Đặt lại mật khẩu" ngay trên trang đăng nhập — link đặt mật khẩu gửi về đúng email này. Đăng nhập xong, vào menu Phỏng vấn → Phỏng vấn mentee trực tiếp.`,
      input.matchedBy === "phone_and_name"
        ? "- Lưu ý: tài khoản dùng email Anh/Chị đã nộp đơn mentor trên VAM OS, khác email điền trong form đăng ký phỏng vấn."
        : null
    ].filter(Boolean).join("\n"),
    [
      "4. Bảng tiêu chí & Hướng dẫn chấm",
      "- Bảng tiêu chí chấm: hiện ngay trên màn hình chấm của từng mentee sau khi đăng nhập.",
      `- Hướng dẫn chấm: ${origin}/interviews/mentee-offline/huong-dan (bấm nút "Hướng dẫn phỏng vấn mùa này" ở đầu màn hình phỏng vấn).`
    ].join("\n"),
    [
      "5. Group Zalo hỗ trợ",
      "Anh/Chị vui lòng tham gia Group Zalo Mentor - Vòng phỏng vấn để nhận các thông tin cập nhật và được BTC hỗ trợ trong suốt quá trình phỏng vấn:",
      ZALO_GROUP_URL
    ].join("\n"),
    "Anh/Chị vui lòng dành ít phút xem trước tài khoản, tiêu chí và hướng dẫn chấm để quá trình phỏng vấn diễn ra thuận lợi nhất.",
    "BTC rất mong được gặp Anh/Chị tại Vòng phỏng vấn.\nCảm ơn Anh/Chị đã đồng hành cùng UEH Mentoring Mùa 12!",
    `Trân trọng,\nBTC UEH Mentoring Mùa 12\n${HOTLINE_LINE}`
  ];
  return { subject: CONFIRMATION_SUBJECT, body: lines.join("\n\n") };
}

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  ready: "Sẵn sàng gửi",
  already_sent: "Đã gửi thư đợt này",
  no_access: "Chưa có quyền phỏng vấn",
  no_blocks: "Không đăng ký buổi nào của đợt này"
};
