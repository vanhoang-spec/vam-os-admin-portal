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

/** Tên là chữ cuối, họ là chữ đầu, phần giữa là tên đệm. So sánh bỏ dấu, bỏ hoa thường. */
export function nameSortParts(fullName: string) {
  const words = fold(fullName).trim().split(/\s+/).filter(Boolean);
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
