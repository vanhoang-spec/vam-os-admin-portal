/**
 * lib/ai-matching-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything about assisted matching that does not touch the network or the
 * database: what leaves this application, and what is done with what comes
 * back.
 *
 * Two rules shape the whole module.
 *
 * 1. NOTHING IDENTIFYING LEAVES. A mentee is "E001" and a mentor is "M001";
 *    the map from code to person exists only on our side. Attributes are taken
 *    from an allow-list — never by copying the record and deleting fields,
 *    because a form that gains a question later would then start leaking it.
 *    Free text is redacted (addresses, phone numbers, links, the applicant's
 *    own name) before it is included at all.
 *
 * 2. THE MODEL SCORES; THE CODE ASSIGNS. The provider is asked how well pairs
 *    fit, and nothing else. Which mentee ends up with which mentor, and how
 *    many mentees a mentor may take, is decided here by `assignPairs` against
 *    the capacity the mentors themselves confirmed. A model that hallucinates
 *    a code, returns twenty pairs for one mentee, or scores 1.0 for everybody
 *    cannot create a pairing that breaks a rule.
 */

/** Bumped when the prompt changes, so a stored run can be judged by what produced it. */
export const PROMPT_VERSION = "vam-match-v1-2026-08";

export const DEFAULT_SHORTLIST_SIZE = 10;
export const DEFAULT_MENTEE_BATCH_SIZE = 6;
export const MAX_ROUNDS = 3;
export const MAX_FREE_TEXT_LENGTH = 400;
export const MAX_RATIONALE_LENGTH = 300;

const REDACTED = "[đã ẩn]";

// ── Sources ──────────────────────────────────────────────────────────────────

export type MenteeSource = {
  applicationId: string;
  fullName?: string | null;
  rawPayload?: Record<string, unknown> | null;
  interviewScore?: number | null;
};

export type MentorSource = {
  personId: string;
  fullName?: string | null;
  industry?: string | null;
  functionArea?: string | null;
  yearsExperienceMin?: number | null;
  /** Places this mentor still has in the season. */
  freeSlots: number;
};

export type AnonymousMentee = {
  code: string;
  applicationId: string;
  attributes: Record<string, string | number>;
};

export type AnonymousMentor = {
  code: string;
  personId: string;
  capacity: number;
  attributes: Record<string, string | number>;
};

/**
 * The mentee answers that say something about fit, and only those.
 *
 * Deliberately absent: full_name, email_primary, phone_primary, social_contact,
 * mssv, university, school_or_faculty, class_cohort, year_of_birth,
 * referrer_or_source and additional_notes. The last one is free text with no
 * matching purpose, which is exactly where contact details end up.
 */
export const MENTEE_ATTRIBUTE_FIELDS = [
  { key: "target_industry", label: "nganh_muc_tieu", free: false },
  { key: "target_function", label: "linh_vuc_muc_tieu", free: false },
  { key: "target_soft_skills", label: "ky_nang_muon_phat_trien", free: false },
  { key: "training_topics_interest", label: "chu_de_quan_tam", free: false },
  { key: "major", label: "nganh_hoc", free: false },
  { key: "year_of_study", label: "nam_hoc", free: false },
  { key: "meeting_format_preference", label: "hinh_thuc_gap", free: false },
  { key: "mentor_gender_preference", label: "mong_muon_gioi_tinh_mentor", free: false },
  { key: "mentoring_goals_text", label: "muc_tieu", free: true },
  { key: "one_year_vision_text", label: "muc_tieu_mot_nam", free: true },
  { key: "current_difficulty_text", label: "kho_khan_hien_tai", free: true },
  { key: "mentoring_plan_text", label: "ke_hoach_dong_hanh", free: true }
] as const;

/** What a mentor is described by. Company and job title are omitted: together
 *  they identify a person as surely as a name does. */
export const MENTOR_ATTRIBUTE_KEYS = ["nganh", "linh_vuc", "so_nam_kinh_nghiem"] as const;

// ── Redaction ────────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/gi;
const HANDLE_PATTERN = /(^|\s)@[A-Za-z0-9._-]{2,}/g;
/** Eight digits or more is a phone number or a student id, never a year. */
const LONG_DIGITS_PATTERN = /\d[\d\s.-]{6,}\d/g;

/** Punctuation around a word, so a name followed by a comma is still recognised. */
const PUNCTUATION_EDGES = /^[\s.,;:!?()\[\]{}\"'\u201c\u201d\u2018\u2019\u2026\-\u2013\u2014/|]+|[\s.,;:!?()\[\]{}\"'\u201c\u201d\u2018\u2019\u2026\-\u2013\u2014/|]+$/g;

/** Word separators inside an answer: whitespace and the usual list punctuation. */
const WORD_SEPARATORS = /[\s,;:/|()\[\]{}.!?\u2013\u2014-]+/;

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D");
}

function normalizeToken(value: string): string {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Remove the things that identify a person from a free-text answer.
 *
 * Name removal is token-based and diacritic-insensitive, because the same name
 * is written "Nguyễn", "Nguyen" and "NGUYEN" in the same form.
 */
export function redactFreeText(
  value: unknown,
  options: { names?: Array<string | null | undefined>; maxLength?: number } = {}
): string {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  text = text
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(URL_PATTERN, REDACTED)
    .replace(HANDLE_PATTERN, `$1${REDACTED}`)
    .replace(LONG_DIGITS_PATTERN, REDACTED);

  const nameTokens = new Set<string>();
  for (const name of options.names ?? []) {
    for (const part of String(name ?? "").split(/\s+/)) {
      const token = normalizeToken(part);
      if (token.length >= 2) nameTokens.add(token);
    }
  }

  if (nameTokens.size) {
    text = text
      .split(/(\s+)/)
      .map((word) => {
        if (!word.trim()) return word;
        // Keep surrounding punctuation, replace only the word itself.
        const bare = word.replace(PUNCTUATION_EDGES, "");
        if (!bare) return word;
        return nameTokens.has(normalizeToken(bare)) ? word.replace(bare, REDACTED) : word;
      })
      .join("");
  }

  const limit = options.maxLength ?? MAX_FREE_TEXT_LENGTH;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function shortValue(value: unknown, maxLength = 120): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// ── Anonymisation ────────────────────────────────────────────────────────────

export function menteeCode(index: number): string {
  return `E${String(index + 1).padStart(3, "0")}`;
}

export function mentorCode(index: number): string {
  return `M${String(index + 1).padStart(3, "0")}`;
}

export function anonymizeMentee(source: MenteeSource, index: number): AnonymousMentee {
  const payload = (source.rawPayload ?? {}) as Record<string, unknown>;
  const attributes: Record<string, string | number> = {};

  for (const field of MENTEE_ATTRIBUTE_FIELDS) {
    const raw = payload[field.key];
    if (raw === null || raw === undefined || raw === "") continue;
    const flat = Array.isArray(raw) ? raw.map((item) => String(item)).join(", ") : raw;
    const text = field.free
      ? redactFreeText(flat, { names: [source.fullName] })
      : redactFreeText(shortValue(flat), { names: [source.fullName], maxLength: 120 });
    if (text) attributes[field.label] = text;
  }

  return { code: menteeCode(index), applicationId: source.applicationId, attributes };
}

export function anonymizeMentor(source: MentorSource, index: number): AnonymousMentor {
  const attributes: Record<string, string | number> = {};
  const industry = shortValue(source.industry);
  const functionArea = shortValue(source.functionArea);
  if (industry) attributes.nganh = industry;
  if (functionArea) attributes.linh_vuc = functionArea;
  if (typeof source.yearsExperienceMin === "number" && Number.isFinite(source.yearsExperienceMin)) {
    attributes.so_nam_kinh_nghiem = Math.max(0, Math.floor(source.yearsExperienceMin));
  }

  return {
    code: mentorCode(index),
    personId: source.personId,
    capacity: Math.max(0, Math.floor(source.freeSlots)),
    attributes
  };
}

export type AnonymousPool = {
  mentees: AnonymousMentee[];
  mentors: AnonymousMentor[];
  menteeByCode: Map<string, AnonymousMentee>;
  mentorByCode: Map<string, AnonymousMentor>;
};

export function buildAnonymousPool(mentees: MenteeSource[], mentors: MentorSource[]): AnonymousPool {
  const anonMentees = mentees.map((mentee, index) => anonymizeMentee(mentee, index));
  const anonMentors = mentors
    .map((mentor, index) => anonymizeMentor(mentor, index))
    .filter((mentor) => mentor.capacity > 0);

  return {
    mentees: anonMentees,
    mentors: anonMentors,
    menteeByCode: new Map(anonMentees.map((row) => [row.code, row])),
    mentorByCode: new Map(anonMentors.map((row) => [row.code, row]))
  };
}

// ── Shortlist ────────────────────────────────────────────────────────────────

function tokenSet(values: Array<string | number | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const part of String(value ?? "").split(WORD_SEPARATORS)) {
      const token = normalizeToken(part);
      if (token.length >= 3) tokens.add(token);
    }
  }
  return tokens;
}

/**
 * Cut the mentor list down to the ones worth asking about.
 *
 * With hundreds of confirmed mentors, a prompt holding all of them would be
 * enormous, expensive and worse: a model given 400 options ranks them poorly.
 * This is a cheap deterministic pre-filter on shared industry, field and
 * vocabulary — the ranking itself is still the model's job.
 */
export function shortlistMentors(
  mentee: AnonymousMentee,
  mentors: AnonymousMentor[],
  limit = DEFAULT_SHORTLIST_SIZE
): AnonymousMentor[] {
  const menteeIndustry = tokenSet([mentee.attributes.nganh_muc_tieu]);
  const menteeFunction = tokenSet([mentee.attributes.linh_vuc_muc_tieu]);
  const menteeWords = tokenSet([
    mentee.attributes.nganh_muc_tieu,
    mentee.attributes.linh_vuc_muc_tieu,
    mentee.attributes.ky_nang_muon_phat_trien,
    mentee.attributes.chu_de_quan_tam,
    mentee.attributes.nganh_hoc,
    mentee.attributes.muc_tieu
  ]);

  const scored = mentors.map((mentor) => {
    const industry = tokenSet([mentor.attributes.nganh]);
    const functionArea = tokenSet([mentor.attributes.linh_vuc]);

    let score = 0;
    for (const token of Array.from(industry)) if (menteeIndustry.has(token)) score += 3;
    for (const token of Array.from(functionArea)) if (menteeFunction.has(token)) score += 2;
    const mentorTokens = Array.from(new Set(Array.from(industry).concat(Array.from(functionArea))));
    for (const token of mentorTokens) {
      if (menteeWords.has(token)) score += 1;
    }
    return { mentor, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic: the same pool twice gives the same shortlist.
    return a.mentor.code.localeCompare(b.mentor.code);
  });

  return scored.slice(0, Math.max(1, limit)).map((row) => row.mentor);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += step) {
    out.push(items.slice(index, index + step));
  }
  return out;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = [
  "Bạn là trợ lý ghép cặp của một chương trình mentoring dành cho sinh viên Việt Nam.",
  "Bạn nhận danh sách mentee và mentor đã được ẩn danh, chỉ còn mã và các tiêu chí.",
  "Nhiệm vụ: chấm mức độ phù hợp của từng cặp mentee–mentor trong danh sách được đưa ra.",
  "Bạn KHÔNG quyết định ai ghép với ai và KHÔNG giới hạn số lượng — phần đó do hệ thống xử lý.",
  "Chỉ trả về JSON đúng định dạng được yêu cầu, không thêm lời dẫn."
].join(" ");

export type PromptPair = { mentee: AnonymousMentee; mentors: AnonymousMentor[] };

/**
 * One request covers a handful of mentees, each with their own shortlist.
 * The output shape is fixed and small: a score and one sentence per pair.
 */
export function buildMatchPrompt(input: { batch: PromptPair[]; round: number }): string {
  const payload = {
    vong: input.round,
    huong_dan: [
      "Với mỗi mentee, chấm điểm phù hợp cho từng mentor trong danh sách của mentee đó.",
      "Điểm từ 0 đến 1, một chữ số thập phân trở lên. 1 = rất phù hợp, 0 = không phù hợp.",
      "Căn cứ vào ngành, lĩnh vực, mục tiêu và kỳ vọng. Không suy đoán thông tin không có.",
      "Lý do viết bằng tiếng Việt, tối đa một câu ngắn."
    ],
    dinh_dang_tra_ve: {
      pairs: [{ mentee: "E001", mentor: "M001", score: 0.8, reason: "cùng ngành tài chính" }]
    },
    du_lieu: input.batch.map((row) => ({
      mentee: { ma: row.mentee.code, ...row.mentee.attributes },
      mentors: row.mentors.map((mentor) => ({ ma: mentor.code, ...mentor.attributes }))
    }))
  };

  return JSON.stringify(payload, null, 2);
}

// ── Parsing what comes back ──────────────────────────────────────────────────

export type ParsedPair = {
  menteeCode: string;
  mentorCode: string;
  score: number;
  rationale: string;
};

export type ParseResult = {
  pairs: ParsedPair[];
  /** Reasons rows were dropped — surfaced to operators, never to applicants. */
  warnings: string[];
};

function extractJson(text: string): string {
  const trimmed = text.trim();
  // Models wrap JSON in a fenced block even when told not to.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  return trimmed;
}

/**
 * Read the provider's answer defensively: anything unrecognised is dropped with
 * a warning rather than trusted. A hallucinated code must not become a pair.
 */
export function parseMatchResponse(
  text: string,
  known: { menteeCodes: Set<string>; mentorCodes: Set<string> }
): ParseResult {
  const warnings: string[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    return { pairs: [], warnings: ["Không đọc được JSON từ mô hình."] };
  }

  const rawPairs = (parsed as { pairs?: unknown })?.pairs;
  if (!Array.isArray(rawPairs)) {
    return { pairs: [], warnings: ["Kết quả không có danh sách pairs."] };
  }

  const seen = new Set<string>();
  const pairs: ParsedPair[] = [];

  for (const item of rawPairs) {
    const row = item as Record<string, unknown>;
    const menteeCode = String(row?.mentee ?? "").trim().toUpperCase();
    const mentorCode = String(row?.mentor ?? "").trim().toUpperCase();

    if (!known.menteeCodes.has(menteeCode) || !known.mentorCodes.has(mentorCode)) {
      warnings.push(`Bỏ qua cặp không có trong danh sách: ${menteeCode || "?"}–${mentorCode || "?"}`);
      continue;
    }

    const key = `${menteeCode}|${mentorCode}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rawScore = Number(row?.score);
    if (!Number.isFinite(rawScore)) {
      warnings.push(`Bỏ qua cặp không có điểm: ${menteeCode}–${mentorCode}`);
      continue;
    }
    const score = Math.min(1, Math.max(0, rawScore));

    pairs.push({
      menteeCode,
      mentorCode,
      score,
      rationale: shortValue(row?.reason ?? row?.rationale ?? "", MAX_RATIONALE_LENGTH)
    });
  }

  return { pairs, warnings };
}

// ── Assignment ───────────────────────────────────────────────────────────────

export type AssignedPair = ParsedPair & { round: number };

export type AssignmentResult = {
  assigned: AssignedPair[];
  /** Mentee codes still without a mentor after this pass. */
  unassignedMentees: string[];
  /** Capacity left per mentor code, for the next round. */
  remainingCapacity: Map<string, number>;
};

/**
 * Turn scores into a pairing. This is the part the model does not do.
 *
 * Greedy by descending score: one mentor per mentee, never more mentees than a
 * mentor has places. Ties break on mentee code then mentor code, so the same
 * scores always produce the same pairing and a run can be repeated.
 */
export function assignPairs(input: {
  pairs: ParsedPair[];
  capacity: Map<string, number>;
  menteeCodes: string[];
  round?: number;
  minScore?: number;
}): AssignmentResult {
  const remaining = new Map(input.capacity);
  const round = input.round ?? 1;
  const minScore = input.minScore ?? 0;

  const ordered = [...input.pairs]
    .filter((pair) => pair.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.menteeCode !== b.menteeCode) return a.menteeCode.localeCompare(b.menteeCode);
      return a.mentorCode.localeCompare(b.mentorCode);
    });

  const takenMentees = new Set<string>();
  const assigned: AssignedPair[] = [];

  for (const pair of ordered) {
    if (takenMentees.has(pair.menteeCode)) continue;
    const left = remaining.get(pair.mentorCode) ?? 0;
    if (left <= 0) continue;

    remaining.set(pair.mentorCode, left - 1);
    takenMentees.add(pair.menteeCode);
    assigned.push({ ...pair, round });
  }

  return {
    assigned,
    unassignedMentees: input.menteeCodes.filter((code) => !takenMentees.has(code)),
    remainingCapacity: remaining
  };
}

/** Is there any point in running another round? */
export function shouldContinue(input: {
  round: number;
  unassignedCount: number;
  remainingCapacity: Map<string, number>;
  maxRounds?: number;
}): boolean {
  if (input.round >= (input.maxRounds ?? MAX_ROUNDS)) return false;
  if (input.unassignedCount <= 0) return false;
  let free = 0;
  for (const value of Array.from(input.remainingCapacity.values())) free += Math.max(0, value);
  return free > 0;
}

/**
 * Last line of defence before anything is written: a pair may only exist for a
 * known mentee and a known mentor, once per mentee, within capacity.
 */
export function validateAssignment(input: {
  assigned: AssignedPair[];
  capacity: Map<string, number>;
  menteeCodes: Set<string>;
}): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const perMentor = new Map<string, number>();
  const seenMentees = new Set<string>();

  for (const pair of input.assigned) {
    if (!input.menteeCodes.has(pair.menteeCode)) {
      problems.push(`Mentee không có trong danh sách: ${pair.menteeCode}`);
    }
    if (seenMentees.has(pair.menteeCode)) {
      problems.push(`Mentee được ghép nhiều lần: ${pair.menteeCode}`);
    }
    seenMentees.add(pair.menteeCode);

    const used = (perMentor.get(pair.mentorCode) ?? 0) + 1;
    perMentor.set(pair.mentorCode, used);
    const cap = input.capacity.get(pair.mentorCode) ?? 0;
    if (used > cap) {
      problems.push(`Mentor vượt hạn mức: ${pair.mentorCode} (${used}/${cap})`);
    }
  }

  return { ok: problems.length === 0, problems };
}

// ── Configuration gate ───────────────────────────────────────────────────────

export type AiMatchingEnv = {
  VAM_OS_AI_MATCHING_ENABLED?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
};

export type AiMatchingGateResult =
  | { canRun: true; apiKey: string; model: string; baseUrl: string }
  | { canRun: false; reason: string };

export const DEFAULT_MODEL = "deepseek-chat";
export const DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * Assisted matching is off unless it is deliberately switched on and
 * configured, the same convention as outbound email. Unlike email it is not
 * limited to production: staging is exactly where a run should be tried first,
 * on data that is not real.
 */
export function evaluateAiMatchingGate(env: AiMatchingEnv): AiMatchingGateResult {
  if (env.VAM_OS_AI_MATCHING_ENABLED !== "true") {
    return { canRun: false, reason: "VAM_OS_AI_MATCHING_ENABLED chưa bật" };
  }
  const apiKey = (env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) {
    return { canRun: false, reason: "DEEPSEEK_API_KEY chưa cấu hình" };
  }
  const baseUrl = (env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) {
    return { canRun: false, reason: "DEEPSEEK_BASE_URL phải là https" };
  }
  return {
    canRun: true,
    apiKey,
    model: (env.DEEPSEEK_MODEL ?? "").trim() || DEFAULT_MODEL,
    baseUrl
  };
}

/** How the run is summarised for the operator once it finishes. */
export function summarizeRun(input: {
  menteeCount: number;
  pairCount: number;
  rounds: number;
  warnings: string[];
}): string {
  const leftover = Math.max(0, input.menteeCount - input.pairCount);
  const parts = [`Đã đề xuất ${input.pairCount}/${input.menteeCount} mentee sau ${input.rounds} vòng`];
  if (leftover > 0) parts.push(`${leftover} mentee chưa có đề xuất phù hợp`);
  if (input.warnings.length) parts.push(`${input.warnings.length} cảnh báo khi đọc kết quả`);
  return `${parts.join(" · ")}. Chưa có cặp nào được tạo — cần ban tổ chức duyệt.`;
}
