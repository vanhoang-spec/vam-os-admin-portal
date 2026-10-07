/**
 * Ghép cặp Vòng 2 — trang mentor chọn mentee qua link riêng (BTC 07/10/2026). Phần thuần.
 *
 * Thẻ hồ sơ mentee dùng DANH SÁCH TRƯỜNG ĐƯỢC HIỆN (allowlist), không phải danh sách
 * trường bị ẩn: một trường mới thêm vào đơn sau này mặc nhiên KHÔNG hiện cho mentor, thay
 * vì mặc nhiên lộ ra. BTC chốt mentor thấy họ tên, hồ sơ học tập, mục tiêu, tự luận, CV
 * và GPA; không bao giờ thấy email, SĐT, MSSV, năm sinh, giới tính, mạng xã hội.
 */
import { applicationOptionLabel } from "@/lib/application-form-options";

export const MENTOR_PICK_PATH_PREFIX = "/chon-mentee";
export const PICK_UNDO_MINUTES = 30;

export function mentorPickUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${MENTOR_PICK_PATH_PREFIX}/${encodeURIComponent(token)}`;
}

const FACT_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["year_of_study", "Năm học"],
  ["school_or_faculty", "Khoa"],
  ["major", "Ngành học"],
  ["target_industry", "Ngành nghề mục tiêu"],
  ["target_function", "Chức năng mục tiêu"],
  ["gpa_4", "GPA (thang 4)"]
];

const TEXT_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["mentoring_goals_text", "Mục tiêu khi tham gia mentoring"],
  ["current_difficulty_text", "Khó khăn hiện tại"],
  ["top_3_questions_for_mentor", "3 câu hỏi muốn hỏi mentor"],
  ["one_year_vision_text", "Hình dung bản thân sau 1 năm"],
  ["mentor_expectation_text", "Mong đợi ở mentor"]
];

/** Các khoá được phép hiện, xuất ra để test soát. */
export const MENTEE_CARD_KEYS: readonly string[] = [
  ...FACT_FIELDS.map(([k]) => k),
  "target_industry_other",
  "target_function_other",
  ...TEXT_FIELDS.map(([k]) => k),
  "profile_or_cv_url"
];

export type LinkPart = { kind: "text"; value: string } | { kind: "link"; value: string; href: string };

const WHITESPACE = new Set([" ", String.fromCharCode(9), String.fromCharCode(10), String.fromCharCode(13)]);

/**
 * Biến các đoạn http(s):// trong chữ tự do thành link; mọi thứ khác giữ nguyên là chữ.
 * Chỉ http/https: một "javascript:..." trong ô CV vẫn chỉ là chữ.
 */
export function linkify(text: string): LinkPart[] {
  const words: string[] = [];
  let current = "";
  for (const ch of text) {
    if (WHITESPACE.has(ch)) {
      if (current) words.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) words.push(current);

  const parts: LinkPart[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) parts.push({ kind: "text", value: buffer.join(" ") });
    buffer = [];
  };
  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.startsWith("https://") || lower.startsWith("http://")) {
      flush();
      parts.push({ kind: "link", value: word, href: word });
    } else {
      buffer.push(word);
    }
  }
  flush();
  return parts;
}

export type MenteeCard = {
  applicationId: string;
  name: string;
  facts: Array<[label: string, value: string]>;
  texts: Array<[label: string, value: string]>;
  cv: LinkPart[] | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function menteeCard(input: { applicationId: string; name: string; payload: Record<string, unknown> }): MenteeCard {
  const p = input.payload;
  const facts: Array<[string, string]> = [];
  for (const [key, label] of FACT_FIELDS) {
    const raw = text(p[key]);
    if (!raw) continue;
    let value = applicationOptionLabel(key, raw);
    const other = text(p[`${key}_other`]);
    if (raw === "other" && other && (key === "target_industry" || key === "target_function")) value = `${value}: ${other}`;
    facts.push([label, value]);
  }
  const texts: Array<[string, string]> = [];
  for (const [key, label] of TEXT_FIELDS) {
    const raw = text(p[key]);
    if (raw) texts.push([label, raw]);
  }
  const cvRaw = text(p.profile_or_cv_url);
  return { applicationId: input.applicationId, name: input.name, facts, texts, cv: cvRaw ? linkify(cvRaw) : null };
}

/**
 * Thứ tự danh sách riêng cho từng mentor, cố định giữa các lần tải: cùng một thứ tự cho
 * mọi mentor thì vài hồ sơ đầu danh sách luôn bị chọn trước chỉ vì nằm trên cùng.
 */
export function stableOrderKey(seed: string, id: string): number {
  let h = 2166136261;
  for (const ch of `${seed}|${id}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export type WindowState = "not_open" | "open" | "closed";

export function windowState(settings: { opensAt: string | null; closesAt: string | null } | null, nowMs: number): WindowState {
  if (!settings?.opensAt) return "not_open";
  const opens = Date.parse(settings.opensAt);
  if (!Number.isFinite(opens) || nowMs < opens) return "not_open";
  const closes = settings.closesAt ? Date.parse(settings.closesAt) : NaN;
  if (Number.isFinite(closes) && nowMs >= closes) return "closed";
  return "open";
}

/** Số phút còn bỏ chọn được (0 = hết hạn). */
export function undoMinutesLeft(pickedAt: string | null, nowMs: number): number {
  if (!pickedAt) return 0;
  const picked = Date.parse(pickedAt);
  if (!Number.isFinite(picked)) return 0;
  const left = picked + PICK_UNDO_MINUTES * 60_000 - nowMs;
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

export const PICK_MESSAGES: Record<string, string> = {
  invalid_token: "Đường dẫn không đúng hoặc đã hết hiệu lực.",
  link_revoked: "Đường dẫn này đã bị ban tổ chức thu hồi.",
  window_not_open: "Vòng 2 chưa mở.",
  window_closed: "Vòng 2 đã đóng.",
  mentor_not_eligible: "Anh/chị hiện không thuộc danh sách mentor của mùa này. Vui lòng liên hệ ban tổ chức.",
  mentor_not_classified: "Ban tổ chức chưa xếp nhóm ngành cho anh/chị. Vui lòng liên hệ ban tổ chức.",
  mentor_identity_ambiguous: "Hồ sơ mentor của anh/chị đang cần ban tổ chức gộp lại trước khi chọn. Vui lòng liên hệ ban tổ chức.",
  mentee_not_found: "Không tìm thấy hồ sơ mentee này — có thể bạn ấy đã rút. Anh/chị chọn bạn khác nhé.",
  mentee_not_in_group: "Mentee này không thuộc nhóm ngành của anh/chị.",
  mentee_taken: "Bạn này vừa được mentor khác chọn — anh/chị chọn bạn khác nhé.",
  mentor_full: "Anh/chị đã nhận đủ số mentee của vòng này.",
  match_not_found: "Không tìm thấy lựa chọn này để bỏ.",
  undo_expired: `Đã quá ${PICK_UNDO_MINUTES} phút kể từ lúc chọn — muốn đổi, anh/chị vui lòng liên hệ ban tổ chức.`,
  pick_failed: "Chưa lưu được lựa chọn. Anh/chị thử lại sau ít phút."
};

export function pickMessage(code: unknown): string {
  return PICK_MESSAGES[String(code ?? "")] ?? "Hệ thống đang bận. Anh/chị thử lại sau ít phút.";
}
