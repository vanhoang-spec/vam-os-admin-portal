/**
 * Mã thành viên UEH: UEH + R/E/S/C + 4 số. Phần thuần, dùng chung cho danh sách cấp mã BTC duyệt và phần hiển thị.
 * Cách cấp số nằm ở migration 20261101200000; ở đây chỉ có luật đọc mã cũ và luật xếp thứ tự.
 */

export type MemberCodeGroup = "R" | "E" | "S" | "C";

const MEMBER_CODE = /^UEH[RESC]\d{4}$/;
// Mã cũ 10 ký tự: UEHRF01005 là mùa 1, người thứ 005. UM02001 là dạng cũ hơn của mùa 2.
const LEGACY_CODE = /^(?:UEH[A-Z]{2}|UM)(\d{2})\d{3}$/;

export function isMemberCode(value: string | null | undefined) {
  return MEMBER_CODE.test(value ?? "") && !value!.endsWith("0000");
}

export function isMemberCodeGroup(value: string): value is MemberCodeGroup {
  return ["R", "E", "S", "C"].includes(value);
}

const ERROR_MESSAGES: Record<string, string> = {
  MEMBER_CODE_GROUP_NOT_OPEN: "Nhóm này chưa mở cấp mã. Chờ xong đợt cấp mã ban đầu.",
  MEMBER_CODE_TAKEN: "Mã này đã có người dùng.",
  MEMBER_CODE_BAD_FORMAT: "Mã phải có dạng UEH + R/E/S/C + 4 số, ví dụ UEHR0001.",
  MEMBER_CODE_RANGE_EXHAUSTED: "Nhóm này đã dùng hết dãy số.",
  MEMBER_CODE_PERSON_NOT_FOUND: "Không tìm thấy hồ sơ người này."
};

export function memberCodeErrorMessage(raw: string | null | undefined) {
  const key = Object.keys(ERROR_MESSAGES).find((code) => raw?.includes(code));
  return key ? ERROR_MESSAGES[key] : "Không lưu được mã. Vui lòng thử lại.";
}

/** Rỗng là chưa rõ năm; ngoài khoảng là gõ nhầm, vì chương trình bắt đầu từ 2016. */
export function parseStartYear(value: unknown): { ok: true; value: number | null } | { ok: false } {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true, value: null };
  const year = Number(text);
  return Number.isInteger(year) && year >= 2016 && year <= 2099 ? { ok: true, value: year } : { ok: false };
}

export function legacyCodeSeason(code: string | null | undefined): number | null {
  const season = Number(LEGACY_CODE.exec((code ?? "").trim().toUpperCase())?.[1] ?? 0);
  return season > 0 ? season : null;
}

/** Mùa 1 và 2 chỉ dài nửa năm và cùng nằm trong 2016; từ mùa 3 mỗi mùa là một năm. */
export function seasonStartYear(season: number) {
  return season <= 2 ? 2016 : 2014 + season;
}

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

function fold(value: string) {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").replace(/[đĐ]/g, "d").toLowerCase();
}

/** Tên là chữ cuối, họ là chữ đầu, phần giữa là tên đệm. So sánh bỏ dấu, bỏ hoa thường, bỏ biệt danh trong ngoặc. */
export function nameSortParts(fullName: string) {
  const words = fold(fullName).replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  const ten = words.at(-1) ?? "";
  return { ten, ho: words.length > 1 ? words[0] : "", dem: words.slice(1, -1).join(" ") };
}

export type MemberCodeCandidate = { fullName: string; startYear: number; createdAt: string };

/** Năm bắt đầu, rồi Tên, Họ, Tên đệm; trùng hết thì hồ sơ tạo trước đứng trước để thứ tự luôn xác định. */
export function compareMemberCodeCandidates(a: MemberCodeCandidate, b: MemberCodeCandidate) {
  if (a.startYear !== b.startYear) return a.startYear - b.startYear;
  const left = nameSortParts(a.fullName);
  const right = nameSortParts(b.fullName);
  for (const key of ["ten", "ho", "dem"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function displayMemberCode(memberCode: string | null | undefined, legacyCode: string | null | undefined) {
  const current = memberCode?.trim();
  const legacy = legacyCode?.trim();
  if (current && legacy) return `${current} (${legacy})`;
  return current || legacy || null;
}

/**
 * Danh sách Mentor, Mentee chỉ hiện mã mới, không kèm mã cũ trong ngoặc (VAM00016, VAM00017). Người chưa có mã mới
 * (mentee các mùa trước, không hồi tố) thì hiện mã cũ để dòng không trống.
 */
export function displayCurrentMemberCode(memberCode: string | null | undefined, legacyCode: string | null | undefined) {
  return memberCode?.trim() || legacyCode?.trim() || null;
}

const CODE_PARTS = /^UEH([RESC])(\d{4})$/;

/**
 * Số để xếp theo mã mới (VAM00020, VAM00021). `groups` là thứ tự các nhóm: mentor "CR" (Core team rồi Mentor), mentee
 * "SE" (Support team rồi Mentee); trong nhóm xếp theo số. Người chưa có mã mới, hoặc mã thuộc nhóm không có trong
 * `groups`, xuống cuối.
 */
export function memberCodeOrder(code: string | null | undefined, groups: string) {
  const parts = CODE_PARTS.exec((code ?? "").trim().toUpperCase());
  const rank = parts ? groups.indexOf(parts[1]) : -1;
  return parts && rank >= 0 ? rank * 10000 + Number(parts[2]) : groups.length * 10000;
}

export type FirstSeasonInput = { legacyCode?: string | null; startYear?: number | null; hasMemberCode?: boolean };

/**
 * Mùa và năm mentoring đầu tiên (VAM00016, VAM00017), theo thứ tự tin cậy: mùa đọc từ mã cũ; không có mã cũ thì dùng năm
 * bắt đầu đã ghi trên hồ sơ (từ 2017 mỗi năm một mùa; 2016 gồm cả mùa 1 lẫn 2 nên chưa biết mùa nào); không có cả hai mà
 * đã có mã mới thì là người của mùa 12, năm 2026.
 */
export function firstSeasonOf(input: FirstSeasonInput): { season: number | null; year: number | null } {
  const legacySeason = legacyCodeSeason(input.legacyCode);
  if (legacySeason) return { season: legacySeason, year: seasonStartYear(legacySeason) };
  const year = Number(input.startYear);
  if (Number.isInteger(year) && year >= 2017 && year <= 2099) return { season: year - 2014, year };
  if (year === 2016) return { season: null, year };
  return input.hasMemberCode ? { season: 12, year: 2026 } : { season: null, year: null };
}

/** "Mùa 11 - Năm 2025"; chỉ biết năm thì "Năm 2016"; chưa rõ thì "-". */
export function firstSeasonLabel(input: FirstSeasonInput) {
  const { season, year } = firstSeasonOf(input);
  if (season && year) return `Mùa ${String(season).padStart(2, "0")} - Năm ${year}`;
  return year ? `Năm ${year}` : "-";
}

/** Số để xếp sớm nhất trước; chưa rõ xuống cuối. */
export function firstSeasonOrder(input: FirstSeasonInput) {
  const { season, year } = firstSeasonOf(input);
  return year ? year * 100 + (season ?? 0) : 999999;
}

/** Năm học của sinh viên: "1".."4" là năm thứ mấy, "graduated" là đã tốt nghiệp; giá trị lạ giữ nguyên. */
export function displayYearOfStudy(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  if (/^[1-9]$/.test(text)) return `Năm ${text}`;
  return text.toLowerCase() === "graduated" ? "Đã tốt nghiệp" : text;
}
