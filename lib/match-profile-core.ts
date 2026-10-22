/**
 * Hồ sơ tóm tắt gửi kèm thư kết quả ghép cặp (BTC 22/10/2026). Phần thuần, không I/O.
 *
 * Mentee nhận hồ sơ mentor (13 trường), mentor nhận hồ sơ từng mentee (15 trường) — đúng thứ tự
 * và nhãn BTC chốt. Mỗi trường là một dòng trong DANH SÁCH CHO PHÉP: thẻ chỉ đọc đúng những khoá
 * ghi ở đây, nên một khoá mới thêm vào đơn về sau mặc nhiên KHÔNG hiện — `core_team_note` của đơn
 * gia hạn, MSSV, GPA, năm sinh, giới tính, ghi chú gửi BTC không bao giờ tới tay người đồng hành.
 *
 * Luật BTC:
 *   - Dùng dữ liệu sẵn có, cùng một định dạng cho người mùa cũ và mùa mới.
 *   - Thiếu thì lấy từ hồ sơ đăng ký cũ; không có ở đâu thì ẨN trường đó (không in "—").
 *   - SĐT và email chỉ hiện trong hồ sơ chia sẻ cho người đã ghép cặp: hai dòng này đến từ một khối
 *     liên hệ RIÊNG mà nơi gọi chỉ đưa vào sau khi đã kiểm cặp còn hoạt động. Payload của đơn có
 *     email/SĐT cũng không được đọc ra.
 *
 * Nhãn KHÔNG mượn của thẻ Vòng 2 (lib/matching-round2-link-core.ts): chữ BTC chốt cho thư này
 * khác ("03 câu hỏi…", "sau 01 năm"), và để một lần sửa chữ ở Vòng 2 lặng lẽ đổi hồ sơ gửi đi là
 * hai việc dính vào nhau không cần thiết. Chỉ dùng chung tên khoá, bảng nhãn lựa chọn và linkify.
 */
import { applicationOptionLabel } from "@/lib/application-form-options";
import { INDUSTRY_GROUPS } from "@/lib/matching-round2-groups-core";
import { linkify, type LinkPart } from "@/lib/text-links";

export type ProfileRole = "mentor" | "mentee";

/** Một dòng trên thẻ. `links` có mặt khi dòng là đường dẫn (CV, LinkedIn). */
export type ProfileField = {
  key: string;
  label: string;
  value: string;
  links?: LinkPart[];
};

export type ProfileCard = {
  role: ProfileRole;
  fields: ProfileField[];
};

/** Khối liên hệ — chỉ đưa vào khi người xem là người đồng hành của một cặp đang hoạt động. */
export type ProfileContact = { phone: string | null; email: string | null };

type Payload = Record<string, unknown>;

/** Chữ BTC chốt, đúng thứ tự trên thẻ. */
export const MENTEE_PROFILE_LABELS = [
  ["full_name", "Họ và tên"],
  ["group", "Nhóm ngành nghề mục tiêu"],
  ["phone", "Số điện thoại"],
  ["email", "Email"],
  ["school", "Trường / Năm học / Khoa / Ngành học"],
  ["target_industry", "Ngành nghề mục tiêu"],
  ["target_function", "Chức năng công việc mục tiêu"],
  ["profile_or_cv_url", "CV / Hồ sơ cá nhân"],
  ["mentoring_goals_text", "Mục tiêu khi tham gia Mentoring"],
  ["current_difficulty_text", "Khó khăn hiện tại"],
  ["mentor_reason_text", "Lý do muốn có Mentor đồng hành"],
  ["mentor_expectation_text", "Mong muốn về Mentor đồng hành"],
  ["desired_mentor_profile", "Chân dung Mentor phù hợp"],
  ["top_3_questions_for_mentor", "03 câu hỏi muốn hỏi Mentor"],
  ["one_year_vision_text", "Hình dung bản thân sau 01 năm"]
] as const;

export const MENTOR_PROFILE_LABELS = [
  ["full_name", "Họ và tên"],
  ["group", "Nhóm ngành nghề chuyên môn"],
  ["phone", "Số điện thoại"],
  ["email", "Email"],
  ["title_current", "Chức danh hiện tại"],
  ["company_current", "Công ty / Tổ chức"],
  ["industry", "Ngành nghề / Lĩnh vực làm việc"],
  ["years", "Số năm kinh nghiệm"],
  ["strengths", "Chuyên môn / Thế mạnh nổi bật"],
  ["mentoring_topics", "Lĩnh vực có thể hỗ trợ Mentee"],
  ["motivation_text", "Lý do muốn tham gia Mentoring"],
  ["preferred_mentee_persona", "Mong muốn về Mentee đồng hành"],
  ["linkedin", "LinkedIn / Hồ sơ nghề nghiệp"]
] as const;

/**
 * Những khoá trong ĐƠN mà thẻ được phép đọc — nơi gọi chỉ kéo đúng những khoá này lên từ database
 * (không kéo cả raw_payload). Thêm một khoá vào đây là một quyết định: nó sẽ tới tay người đồng hành.
 */
export const MENTEE_PAYLOAD_KEYS = [
  "university", "university_other", "year_of_study", "school_or_faculty", "school_or_faculty_other", "major",
  "target_industry", "target_industry_other", "target_function", "target_function_other",
  "profile_or_cv_url", "mentoring_goals_text", "current_difficulty_text", "mentor_reason_text",
  "mentor_expectation_text", "top_3_questions_for_mentor", "one_year_vision_text"
] as const;

export const MENTOR_PAYLOAD_KEYS = [
  "title_current", "company_current", "industry_primary", "industry_primary_other",
  "years_of_experience", "mentor_total_work_years",
  "function_primary", "function_primary_other", "secondary_industries_functions", "secondary_industries_functions_other",
  "mentoring_topics", "motivation_text", "preferred_mentee_persona", "linkedin_url", "bio_or_cv_url"
] as const;

/** Cột của mentor_profiles mà thẻ được đọc (nguồn thứ hai sau đơn mùa này). */
export type MentorProfileRow = {
  title_current?: unknown;
  company_current?: unknown;
  industry?: unknown;
  function_area?: unknown;
  years_experience_text?: unknown;
  years_experience_min?: unknown;
  bio_url?: unknown;
};

/** Cột của mentee_profiles mà thẻ được đọc (dự phòng cho dòng trường học). */
export type MenteeProfileRow = { school_raw?: unknown; major?: unknown };

/**
 * Chữ của một ô, hoặc null nếu ô coi như trống. Chữ "null"/"undefined" là dấu vết nhập liệu hỏng
 * (đã gặp ở file Vòng 3), không phải dữ liệu.
 */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "null" || lower === "undefined") return null;
  return s;
}

/** Giá trị đầu tiên không trống, theo đúng thứ tự nguồn. */
function firstText(...values: unknown[]): string | null {
  for (const v of values) {
    const t = cleanText(v);
    if (t) return t;
  }
  return null;
}

/** Giá trị của một khoá ở nguồn đầu tiên có nó (đơn mùa này, rồi tới các đơn cũ hơn). */
function fromPayloads(payloads: readonly (Payload | null | undefined)[], key: string): unknown {
  for (const p of payloads) {
    if (!p) continue;
    const v = p[key];
    if (Array.isArray(v) ? v.length > 0 : cleanText(v)) return v;
  }
  return null;
}

/** Nhóm ngành (tag) — chữ trơn, không số thứ tự; người chưa được phân nhóm thì ẩn. */
export function groupTag(code: unknown): string | null {
  const n = Number(code);
  if (!Number.isInteger(n)) return null;
  return INDUSTRY_GROUPS.find((g) => g.code === n)?.label ?? null;
}

const OTHER_CODES = new Set(["other", "OTHER"]);

/**
 * Chữ của một câu hỏi có lựa chọn, kèm ô "Khác: …". Mã lạ (đơn cũ, BTC tạo tay) trả nguyên giá
 * trị — `applicationOptionLabel` cố ý làm vậy: thà hiện mã còn hơn hiện sai chữ.
 */
function optionWithOther(key: string, raw: unknown, other: unknown): string | null {
  const code = cleanText(raw);
  const otherText = cleanText(other);
  if (!code) return otherText;
  if (OTHER_CODES.has(code)) {
    if (!otherText) return applicationOptionLabel(key, code);
    // Trường khác: tên trường đã đủ nghĩa, không cần tiền tố "Trường khác:".
    return key === "university" ? otherText : `${applicationOptionLabel(key, code)}: ${otherText}`;
  }
  return applicationOptionLabel(key, code);
}

function listLabels(key: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => cleanText(v)).filter((v): v is string => !!v && !OTHER_CODES.has(v)).map((v) => applicationOptionLabel(key, v));
}

/**
 * Số năm kinh nghiệm — MỘT hàm cho mọi nguồn, để người mùa cũ và mùa mới cùng một định dạng:
 * đơn gia hạn ghi số năm ("12" → "12 năm"), form mới ghi khoảng ("7-10" → "7-10 năm"),
 * mentor_profiles có thể giữ mã khoảng, chữ tự do, hoặc chỉ một số tối thiểu ("Từ 5 năm").
 */
export function yearsOfExperienceText(input: {
  totalWorkYears?: unknown;
  bucket?: unknown;
  profileText?: unknown;
  profileMin?: unknown;
}): string | null {
  const total = Number(cleanText(input.totalWorkYears));
  if (Number.isFinite(total) && total > 0) return `${Math.round(total)} năm`;
  const bucket = cleanText(input.bucket);
  if (bucket) return applicationOptionLabel("years_of_experience", bucket);
  const profileText = cleanText(input.profileText);
  if (profileText) {
    const asNumber = Number(profileText);
    if (Number.isFinite(asNumber) && asNumber > 0) return `${Math.round(asNumber)} năm`;
    return applicationOptionLabel("years_of_experience", profileText);
  }
  const min = Number(cleanText(input.profileMin));
  if (Number.isFinite(min) && min > 0) return `Từ ${Math.round(min)} năm`;
  return null;
}

/** "Trường / Năm học / Khoa / Ngành học" gộp một dòng; phần nào trống thì bỏ. */
export function schoolLine(payload: Payload | null, menteeProfile: MenteeProfileRow | null): string | null {
  const p = payload ?? {};
  const school = optionWithOther("university", p.university, p.university_other) ?? cleanText(menteeProfile?.school_raw);
  const year = optionWithOther("year_of_study", p.year_of_study, null);
  const faculty = optionWithOther("school_or_faculty", p.school_or_faculty, p.school_or_faculty_other);
  const major = cleanText(p.major) ?? cleanText(menteeProfile?.major);
  const parts = [school, year, faculty, major].filter((x): x is string => !!x);
  return parts.length ? parts.join(" / ") : null;
}

function field(key: string, label: string, value: string | null, isLink = false): ProfileField | null {
  if (!value) return null;
  return isLink ? { key, label, value, links: linkify(value) } : { key, label, value };
}

function contactFields(labels: readonly (readonly [string, string])[], contact: ProfileContact | null) {
  if (!contact) return { phone: null, email: null };
  const label = (k: string) => labels.find(([key]) => key === k)![1];
  return {
    phone: field("phone", label("phone"), cleanText(contact.phone)),
    email: field("email", label("email"), cleanText(contact.email))
  };
}

const MENTEE_LABEL = Object.fromEntries(MENTEE_PROFILE_LABELS) as Record<(typeof MENTEE_PROFILE_LABELS)[number][0], string>;
const MENTOR_LABEL = Object.fromEntries(MENTOR_PROFILE_LABELS) as Record<(typeof MENTOR_PROFILE_LABELS)[number][0], string>;

export type MenteeProfileInput = {
  fullName: unknown;
  groupCode: unknown;
  /** null = không hiện SĐT/email (xem trước cho admin dùng chính khối này khi cần). */
  contact: ProfileContact | null;
  /** Đơn mentee mùa này (chỉ các khoá trong MENTEE_PAYLOAD_KEYS). */
  payload: Payload | null;
  /** Đơn mentee mùa trước của cùng người, mới nhất trước — chỉ dùng khoá trùng tên. */
  olderPayloads?: readonly Payload[];
  menteeProfile: MenteeProfileRow | null;
  /** Mục "Chân dung Mentor phù hợp" trên phiếu phỏng vấn mới nhất. */
  desiredMentorProfile: unknown;
};

export function menteeProfileCard(input: MenteeProfileInput): ProfileCard {
  const sources = [input.payload, ...(input.olderPayloads ?? [])];
  const get = (key: string) => fromPayloads(sources, key);
  const contact = contactFields(MENTEE_PROFILE_LABELS, input.contact);
  const merged: Payload = {};
  for (const key of MENTEE_PAYLOAD_KEYS) merged[key] = get(key);
  const fields = [
    field("full_name", MENTEE_LABEL.full_name, cleanText(input.fullName)),
    field("group", MENTEE_LABEL.group, groupTag(input.groupCode)),
    contact.phone,
    contact.email,
    field("school", MENTEE_LABEL.school, schoolLine(merged, input.menteeProfile)),
    field("target_industry", MENTEE_LABEL.target_industry, optionWithOther("target_industry", merged.target_industry, merged.target_industry_other)),
    field("target_function", MENTEE_LABEL.target_function, optionWithOther("target_function", merged.target_function, merged.target_function_other)),
    field("profile_or_cv_url", MENTEE_LABEL.profile_or_cv_url, cleanText(merged.profile_or_cv_url), true),
    field("mentoring_goals_text", MENTEE_LABEL.mentoring_goals_text, cleanText(merged.mentoring_goals_text)),
    field("current_difficulty_text", MENTEE_LABEL.current_difficulty_text, cleanText(merged.current_difficulty_text)),
    field("mentor_reason_text", MENTEE_LABEL.mentor_reason_text, cleanText(merged.mentor_reason_text)),
    field("mentor_expectation_text", MENTEE_LABEL.mentor_expectation_text, cleanText(merged.mentor_expectation_text)),
    field("desired_mentor_profile", MENTEE_LABEL.desired_mentor_profile, cleanText(input.desiredMentorProfile)),
    field("top_3_questions_for_mentor", MENTEE_LABEL.top_3_questions_for_mentor, cleanText(merged.top_3_questions_for_mentor)),
    field("one_year_vision_text", MENTEE_LABEL.one_year_vision_text, cleanText(merged.one_year_vision_text))
  ];
  return { role: "mentee", fields: fields.filter((f): f is ProfileField => !!f) };
}

export type MentorProfileInput = {
  fullName: unknown;
  groupCode: unknown;
  contact: ProfileContact | null;
  /** Đơn mentor mùa này, đã bóc lớp gia hạn (applicantPayload), chỉ các khoá trong MENTOR_PAYLOAD_KEYS. */
  payload: Payload | null;
  mentorProfile: MentorProfileRow | null;
  /** Đơn mentor mùa trước của cùng người, mới nhất trước — chỉ dùng khoá trùng tên. */
  olderPayloads?: readonly Payload[];
};

/**
 * Thứ tự nguồn cho mentor: đơn mùa này → mentor_profiles → đơn mùa trước. Đơn mùa này đứng đầu vì
 * là chữ mentor tự khai gần nhất; mentor_profiles đứng giữa vì nó mang hồ sơ BTC đã rà của mentor
 * gia hạn (đơn gia hạn không hỏi lại mọi thứ).
 */
export function mentorProfileCard(input: MentorProfileInput): ProfileCard {
  const p = input.payload ?? {};
  const older = input.olderPayloads ?? [];
  const mp = input.mentorProfile ?? {};
  const fromOlder = (key: string) => fromPayloads(older, key);
  const contact = contactFields(MENTOR_PROFILE_LABELS, input.contact);

  const industry =
    optionWithOther("industry_primary", p.industry_primary, p.industry_primary_other) ??
    optionWithOther("industry_primary", mp.industry, null) ??
    optionWithOther("industry_primary", fromOlder("industry_primary"), fromOlder("industry_primary_other"));

  const strengthsFrom = (src: Payload): string | null => {
    const parts = [
      optionWithOther("function_primary", src.function_primary, src.function_primary_other),
      ...listLabels("secondary_industries_functions", src.secondary_industries_functions),
      cleanText(src.secondary_industries_functions_other)
    ].filter((x): x is string => !!x);
    const unique = parts.filter((x, i) => parts.indexOf(x) === i);
    return unique.length ? unique.join("; ") : null;
  };
  const strengths =
    strengthsFrom(p) ??
    optionWithOther("function_primary", mp.function_area, null) ??
    (older.length ? older.map(strengthsFrom).find((x) => !!x) ?? null : null);

  const years =
    yearsOfExperienceText({ totalWorkYears: p.mentor_total_work_years, bucket: p.years_of_experience }) ??
    yearsOfExperienceText({ profileText: mp.years_experience_text, profileMin: mp.years_experience_min }) ??
    yearsOfExperienceText({ totalWorkYears: fromOlder("mentor_total_work_years"), bucket: fromOlder("years_of_experience") });

  const fields = [
    field("full_name", MENTOR_LABEL.full_name, cleanText(input.fullName)),
    field("group", MENTOR_LABEL.group, groupTag(input.groupCode)),
    contact.phone,
    contact.email,
    field("title_current", MENTOR_LABEL.title_current, firstText(p.title_current, mp.title_current, fromOlder("title_current"))),
    field("company_current", MENTOR_LABEL.company_current, firstText(p.company_current, mp.company_current, fromOlder("company_current"))),
    field("industry", MENTOR_LABEL.industry, industry),
    field("years", MENTOR_LABEL.years, years),
    field("strengths", MENTOR_LABEL.strengths, strengths),
    field("mentoring_topics", MENTOR_LABEL.mentoring_topics, firstText(p.mentoring_topics, fromOlder("mentoring_topics"))),
    field("motivation_text", MENTOR_LABEL.motivation_text, firstText(p.motivation_text, fromOlder("motivation_text"))),
    field("preferred_mentee_persona", MENTOR_LABEL.preferred_mentee_persona, firstText(p.preferred_mentee_persona, fromOlder("preferred_mentee_persona"))),
    field(
      "linkedin",
      MENTOR_LABEL.linkedin,
      firstText(p.linkedin_url, p.bio_or_cv_url, mp.bio_url, fromOlder("linkedin_url"), fromOlder("bio_or_cv_url")),
      true
    )
  ];
  return { role: "mentor", fields: fields.filter((f): f is ProfileField => !!f) };
}

/**
 * Cột PostgREST kéo đúng từng khoá được phép của đơn, ở cả tầng ngoài lẫn tầng `renewal` (đơn gia
 * hạn lưu câu trả lời của mentor dưới raw_payload.renewal). `->` giữ nguyên kiểu JSON, để mảng
 * (ngành/chức năng phụ) về đúng là mảng.
 */
export function profilePayloadProjection(keys: readonly string[]): string {
  return keys.flatMap((key) => [`${key}:raw_payload->${key}`, `r__${key}:raw_payload->renewal->${key}`]).join(",");
}

/** Dựng lại payload từ một dòng đã chiếu: đơn gia hạn lấy tầng `renewal`, đơn thường lấy tầng ngoài. */
export function payloadFromProjectedRow(row: Record<string, unknown>, keys: readonly string[]): Payload {
  const renewal = row.source === "s12_mentor_renewal";
  const out: Payload = {};
  for (const key of keys) {
    const v = renewal ? row[`r__${key}`] : row[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out;
}

/** Phiếu phỏng vấn mới nhất có ghi "Chân dung Mentor phù hợp", theo từng đơn. */
export function latestDesiredMentorProfile(
  reviews: readonly { application_id?: unknown; desired_mentor_profile?: unknown; updated_at?: unknown }[]
): Map<string, string> {
  const best = new Map<string, { text: string; at: number }>();
  for (const r of reviews) {
    const text = cleanText(r.desired_mentor_profile);
    if (!text) continue;
    const at = Date.parse(String(r.updated_at ?? "")) || 0;
    const key = String(r.application_id ?? "");
    if (!key) continue;
    const prev = best.get(key);
    if (!prev || at > prev.at) best.set(key, { text, at });
  }
  // Array.from thay vì trải Map: dự án biên dịch xuống ES5, không bật downlevelIteration.
  return new Map(Array.from(best.entries()).map(([k, v]) => [k, v.text] as [string, string]));
}

/** Câu báo DUY NHẤT khi link không dùng được — không phân biệt lý do. */
export const PROFILE_LINK_FAILURE_MESSAGE =
  "Đường dẫn hồ sơ không hợp lệ hoặc đã hết hiệu lực. Vui lòng liên hệ Ban Tổ chức UEH Mentoring qua hello@alumni-mentoring.edu.vn.";

export const PROFILE_PATH_PREFIX = "/ho-so";

export function profileLinkUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}${PROFILE_PATH_PREFIX}/${encodeURIComponent(token)}`;
}
