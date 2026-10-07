/**
 * Ghép cặp Vòng 2 — xếp mỗi mentor/mentee vào đúng 1 trong 9 nhóm ngành (BTC 07/10/2026).
 *
 * Phần thuần, tất định: cùng dữ liệu luôn ra cùng nhóm, không đồng hồ, không ngẫu nhiên,
 * không phụ thuộc thứ tự đầu vào. Nội dung hồ sơ chỉ được tách từ và so khớp, không bao
 * giờ được "đọc như lệnh" — một câu "hãy xếp tôi vào nhóm 1" chỉ là chữ.
 *
 * Mentor — sức nặng bằng chứng từ cao xuống thấp: chức danh > chức năng > ngành >
 * chức năng khác. Bậc cao nhất có tín hiệu quyết định; bậc dưới chỉ để tách khi bậc trên
 * gợi nhiều nhóm.
 *
 * Mentee — chức năng mục tiêu là căn cứ chính, ngành mục tiêu tinh chỉnh; ngành học và
 * khoa là bằng chứng phụ; mục tiêu tự viết chỉ dùng khi vẫn còn mơ hồ. BTC chốt:
 * "Chưa xác định" coi như để trống; "Khác" chỉ đưa về nhóm 9 khi trường còn lại cũng
 * không rõ.
 */
import { keywordGroups, OTHER_GROUP, type KeywordResult } from "@/lib/matching-round2-groups-core";

export const CLASSIFICATION_RULE_VERSION = "2026-10-07.1";
export const REVIEW_FLAG = "CAN_BTC_XEM";

export type Confidence = "cao" | "trung_binh" | "thap";

export type Classification = {
  group: number;
  confidence: Confidence;
  flags: string[];
  /** Các nhóm khác có tín hiệu, theo thứ tự bằng chứng rồi mã nhóm. */
  secondary: number[];
  /** Lý do bằng tiếng Việt cho BTC đọc. */
  reasons: string[];
};

export type MentorInput = {
  title: string | null;
  functionCode: string | null;
  industryCode: string | null;
  functionOther: string | null;
};

export type MenteeInput = {
  targetFunction: string | null;
  targetFunctionOther: string | null;
  targetIndustry: string | null;
  targetIndustryOther: string | null;
  major: string | null;
  faculty: string | null;
  goals: string | null;
};

// Mã chức năng → nhóm. Không có trong bảng = mã hợp lệ nhưng không thuộc nhóm 1–8
// (vận hành, chiến lược, quản trị tổng hợp…). finance_accounting gợi cả 1, 2 và 3: biểu
// mẫu không có chức năng "Ngân hàng", nên người muốn làm ngân hàng cũng chọn ô này —
// chỉ gợi 2/3 thì nhóm 1 không bao giờ có mentee nào.
const FUNCTION_GROUPS: Record<string, number[]> = {
  marketing: [4],
  sales_bd: [4],
  finance_accounting: [1, 2, 3],
  hr_people: [6],
  tech_engineering: [8],
  data_analytics: [8],
  product: [8],
  supply_chain: [5],
  legal_compliance: [7]
};
const KNOWN_FUNCTION_CODES = new Set([
  ...Object.keys(FUNCTION_GROUPS),
  "operations",
  "strategy_consulting",
  "general_management",
  "other",
  "undecided"
]);

// Mã ngành → nhóm. "Tài chính / Ngân hàng" gợi cả 1 và 3.
const INDUSTRY_GROUPS_BY_CODE: Record<string, number[]> = {
  finance_banking: [1, 3],
  logistics: [5],
  manufacturing: [5],
  tech: [8],
  fmcg: [4],
  media_creative: [4]
};
const KNOWN_INDUSTRY_CODES = new Set([
  ...Object.keys(INDUSTRY_GROUPS_BY_CODE),
  "consulting",
  "education",
  "healthcare",
  "real_estate",
  "energy_environment",
  "public_nonprofit",
  "other",
  "undecided"
]);

// Khoa (mentee). Kinh doanh quốc tế, Quản trị, Khác: để ngành học quyết định.
const FACULTY_GROUPS: Record<string, number[]> = {
  he_thong_thong_tin: [8],
  marketing: [4],
  ke_toan: [2],
  tai_chinh: [3]
};

type Level = { key: string; label: string; groups: number[]; note: string };

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function keywordNote(result: KeywordResult): string {
  return result.hits.map((h) => h.phrase).join(", ");
}

/** Bậc bằng chứng từ một mã lựa chọn; mã lạ (chữ tự do của đơn cũ) thì so từ khoá. */
function codeLevel(
  key: string,
  label: string,
  value: string | null,
  table: Record<string, number[]>,
  known: Set<string>
): Level {
  const v = text(value);
  if (!v) return { key, label, groups: [], note: "" };
  if (known.has(v)) return { key, label, groups: table[v] ? [...table[v]] : [], note: v };
  const kw = keywordGroups(v);
  return { key, label, groups: kw.groups, note: kw.groups.length ? `“${v}” (${keywordNote(kw)})` : `“${v}”` };
}

function keywordLevel(key: string, label: string, value: string | null): Level {
  const v = text(value);
  if (!v) return { key, label, groups: [], note: "" };
  const kw = keywordGroups(v);
  return { key, label, groups: kw.groups, note: kw.groups.length ? keywordNote(kw) : "" };
}

/**
 * Hoà còn lại sau khi đã thu hẹp hết (luôn kèm cờ CAN_BTC_XEM): Ngân hàng/Tài chính → 1
 * (người làm trong ngành ngân hàng); còn lại trong 1–3 → 3 Tài chính - Đầu tư (rộng nhất
 * của khối tài chính); ngoài khối tài chính → mã nhỏ nhất.
 */
function tieBreak(groups: number[]): number {
  if (groups.length === 2 && groups.includes(1) && groups.includes(3)) return 1;
  if (groups.includes(3) && groups.every((g) => g <= 3)) return 3;
  return Math.min(...groups);
}

function groupsText(groups: number[]): string {
  return groups.join("/");
}

/**
 * Thu hẹp tập nhóm của bậc quyết định bằng các bậc sau, theo thứ tự. Bậc nào không giao
 * với tập hiện tại thì bỏ qua — bằng chứng yếu không được lật bằng chứng mạnh.
 */
function narrow(decisive: Level, later: Level[]): { groups: number[]; by: Level[] } {
  let groups = [...decisive.groups];
  const by: Level[] = [];
  for (const level of later) {
    if (groups.length <= 1) break;
    const inter = groups.filter((g) => level.groups.includes(g));
    if (inter.length && inter.length < groups.length) {
      groups = inter;
      by.push(level);
    }
  }
  return { groups, by };
}

function secondaryOf(levels: Level[], chosen: number): number[] {
  const out: number[] = [];
  for (const level of levels) {
    for (const g of [...level.groups].sort((a, b) => a - b)) {
      if (g !== chosen && !out.includes(g)) out.push(g);
    }
  }
  return out;
}

function noEvidence(levels: Level[], reason: string, confidence: Confidence = "thap"): Classification {
  return {
    group: OTHER_GROUP,
    confidence,
    flags: confidence === "thap" ? [REVIEW_FLAG] : [],
    secondary: secondaryOf(levels, OTHER_GROUP),
    reasons: [reason]
  };
}

function describe(level: Level): string {
  const groups = level.groups.length ? ` → nhóm ${groupsText(level.groups)}` : "";
  return `${level.label}: ${level.note || "—"}${groups}`;
}

export function classifyMentor(input: MentorInput): Classification {
  const title = keywordLevel("title", "Chức danh", input.title);
  const fn = codeLevel("function", "Chức năng", input.functionCode, FUNCTION_GROUPS, KNOWN_FUNCTION_CODES);
  const industry = codeLevel("industry", "Ngành", input.industryCode, INDUSTRY_GROUPS_BY_CODE, KNOWN_INDUSTRY_CODES);
  const fnOther = keywordLevel("function_other", "Chức năng khác", input.functionOther);
  const levels = [title, fn, industry, fnOther];

  const decisiveIndex = levels.findIndex((l) => l.groups.length > 0);
  if (decisiveIndex < 0) {
    return noEvidence(levels, "Chức danh, chức năng và ngành đều không khớp nhóm 1–8 → nhóm 9 (Khác), cần BTC xem.");
  }
  const decisive = levels[decisiveIndex];
  const { groups, by } = narrow(decisive, levels.slice(decisiveIndex + 1));
  const tie = groups.length > 1;
  const group = tie ? tieBreak(groups) : groups[0];

  const reasons = [describe(decisive)];
  for (const level of by) reasons.push(`Tách bằng ${level.label.toLowerCase()}: ${level.note} → nhóm ${groupsText(level.groups)}`);

  let confidence: Confidence;
  const weak = decisive.key === "industry" || decisive.key === "function_other";
  if (tie) {
    confidence = "thap";
    reasons.push(`Còn hoà giữa nhóm ${groupsText(groups)} → tạm chọn nhóm ${group}, cần BTC xem.`);
  } else if (weak) {
    confidence = "thap";
    reasons.push(`Chỉ có ${decisive.label.toLowerCase()} làm căn cứ → cần BTC xem.`);
  } else if (decisive.key === "title" && levels.slice(1).some((l) => l.groups.includes(group))) {
    confidence = "cao";
  } else {
    confidence = "trung_binh";
  }
  return {
    group,
    confidence,
    flags: confidence === "thap" ? [REVIEW_FLAG] : [],
    secondary: secondaryOf(levels, group),
    reasons
  };
}

type TargetState =
  | { kind: "blank" }
  | { kind: "other" }
  | { kind: "unmapped"; value: string }
  | { kind: "mapped"; level: Level };

/** Một trường mục tiêu của mentee: trống/"Chưa xác định", "Khác", không thuộc 1–8, hay có nhóm. */
function targetState(
  key: string,
  label: string,
  value: string | null,
  otherText: string | null,
  table: Record<string, number[]>,
  known: Set<string>
): TargetState {
  const v = text(value);
  if (!v || v === "undecided") return { kind: "blank" };
  if (v === "other") {
    const kw = keywordGroups(otherText);
    return kw.groups.length
      ? { kind: "mapped", level: { key, label, groups: kw.groups, note: `Khác: “${text(otherText)}” (${keywordNote(kw)})` } }
      : { kind: "other" };
  }
  const level = codeLevel(key, label, v, table, known);
  if (level.groups.length) return { kind: "mapped", level };
  return known.has(v) ? { kind: "unmapped", value: v } : { kind: "other" };
}

export function classifyMentee(input: MenteeInput): Classification {
  const fn = targetState("function", "Chức năng mục tiêu", input.targetFunction, input.targetFunctionOther, FUNCTION_GROUPS, KNOWN_FUNCTION_CODES);
  const industry = targetState("industry", "Ngành mục tiêu", input.targetIndustry, input.targetIndustryOther, INDUSTRY_GROUPS_BY_CODE, KNOWN_INDUSTRY_CODES);
  const major = keywordLevel("major", "Ngành học", input.major);
  const facultyCode = text(input.faculty);
  const faculty: Level = {
    key: "faculty",
    label: "Khoa",
    groups: FACULTY_GROUPS[facultyCode] ? [...FACULTY_GROUPS[facultyCode]] : [],
    note: facultyCode
  };
  const goals = keywordLevel("goals", "Mục tiêu tự viết", input.goals);
  const industryLevel = industry.kind === "mapped" ? industry.level : null;
  const fnLevel = fn.kind === "mapped" ? fn.level : null;
  const allLevels = [fnLevel, industryLevel, major, faculty, goals].filter((l): l is Level => Boolean(l));

  let decisive: Level;
  let later: Level[];
  if (fnLevel) {
    decisive = fnLevel;
    // Ngành học và khoa tách "Tài chính / Kế toán" trước ngành mục tiêu: "Tài chính / Ngân
    // hàng" gợi cả 1 và 3, để nó tách trước thì mọi bạn khoa Kế toán đều mất nhóm 2.
    later = [major, faculty, ...(industryLevel ? [industryLevel] : []), goals];
  } else if (industryLevel) {
    decisive = industryLevel;
    later = [major, faculty, goals];
  } else if (fn.kind === "blank" && industry.kind === "blank") {
    const fallback = [major, faculty].find((l) => l.groups.length > 0);
    if (fallback) {
      decisive = fallback;
      later = fallback === major ? [faculty, goals] : [goals];
    } else if (goals.groups.length) {
      const { groups } = narrow(goals, []);
      const group = groups.length > 1 ? tieBreak(groups) : groups[0];
      return {
        group,
        confidence: "thap",
        flags: [REVIEW_FLAG],
        secondary: secondaryOf(allLevels, group),
        reasons: ["Hai trường mục tiêu đều chưa xác định; ngành học/khoa không rõ.", `${describe(goals)} → tạm chọn nhóm ${group}, cần BTC xem.`]
      };
    } else {
      return noEvidence(allLevels, "Hai trường mục tiêu đều chưa xác định; ngành học, khoa và mục tiêu tự viết không rõ → nhóm 9, cần BTC xem.");
    }
  } else if (fn.kind === "unmapped" || industry.kind === "unmapped") {
    // Chọn thật một hướng ngoài 1–8 (Chiến lược, Vận hành, Giáo dục…): đủ căn cứ cho nhóm 9.
    const chosen = [fn, industry]
      .map((s) => (s.kind === "unmapped" ? s.value : null))
      .filter(Boolean)
      .join(", ");
    return noEvidence(allLevels, `Mục tiêu (${chosen}) không thuộc nhóm 1–8 → nhóm 9 (Khác).`, "trung_binh");
  } else {
    return noEvidence(allLevels, "Mục tiêu chọn “Khác”, trường còn lại không rõ → nhóm 9, cần BTC xem.");
  }

  const { groups, by } = narrow(decisive, later);
  const tie = groups.length > 1;
  const group = tie ? tieBreak(groups) : groups[0];
  const reasons = [describe(decisive)];
  for (const level of by) reasons.push(`Tách bằng ${level.label.toLowerCase()}: ${level.note} → nhóm ${groupsText(level.groups)}`);

  let confidence: Confidence;
  if (tie) {
    confidence = "thap";
    reasons.push(`Còn hoà giữa nhóm ${groupsText(groups)} → tạm chọn nhóm ${group}, cần BTC xem.`);
  } else if (by.some((l) => l.key === "goals")) {
    confidence = "thap";
    reasons.push("Chỉ tách được nhờ mục tiêu tự viết → cần BTC xem.");
  } else if (decisive === fnLevel && industryLevel && industryLevel.groups.length === 1 && industryLevel.groups[0] === group) {
    confidence = "cao";
  } else {
    confidence = "trung_binh";
  }
  if (decisive === major || decisive === faculty) {
    reasons.unshift("Hai trường mục tiêu đều chưa xác định → dùng ngành học/khoa.");
  }
  return {
    group,
    confidence,
    flags: confidence === "thap" ? [REVIEW_FLAG] : [],
    secondary: secondaryOf(allLevels, group),
    reasons
  };
}
