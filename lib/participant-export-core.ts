import { genderLabel } from "@/lib/application-export";
import { displayYearOfStudy, firstSeasonLabel, memberCodeOrder } from "@/lib/member-code-core";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { XlsxCell, XlsxColumn, XlsxGroupStyle, XlsxTable } from "@/lib/xlsx-grouped-table";

/**
 * VAM00025 — bảng xuất Excel toàn bộ hồ sơ Mentor / Mentee (phần thuần, không I/O).
 *
 * Yêu cầu của BTC: mỗi người một dòng, mỗi trường một cột, xuất MỌI trường đang có trong hệ thống chứ không chỉ các cột
 * trên danh sách, không bỏ cột trống, ảnh / tệp đính kèm là đường dẫn dạng chữ.
 *
 * Vì thế cột được sinh từ CHÍNH dữ liệu đọc bằng `select *` (bảng `people` và `mentor_profiles` / `mentee_profiles`):
 * - cột đã biết thì có tên tiếng Việt và đứng theo thứ tự cố định;
 * - cột lạ (thêm vào database về sau) vẫn được xuất, tiêu đề là tên cột gốc, để không trường nào bị lặng lẽ bỏ sót —
 *   bỏ sót là lỗi không ai thấy, còn một tiêu đề tiếng Anh thì ai cũng thấy và báo được;
 * - cột nào có trong dữ liệu là có cột, kể cả khi mọi ô đều trống;
 * - chưa có ai để xuất thì vẫn ra đủ các cột đã biết.
 *
 * Chỉ loại những cột KHÔNG được rời khỏi hệ thống (EXCLUDED_COLUMNS / isExcludedColumn). Loại cột thì nói rõ ở đây và
 * trong PR, đừng loại lặng lẽ.
 */

export type ParticipantRole = "mentor" | "mentee";
export type ParticipantGroup = "person" | "profile" | "participation";
type Row = Record<string, unknown>;

export const PARTICIPANT_GROUP_ORDER: readonly ParticipantGroup[] = ["person", "profile", "participation"];

export function participantGroupStyles(role: ParticipantRole): Record<ParticipantGroup, XlsxGroupStyle> {
  return {
    person: { title: "1. THÔNG TIN CÁ NHÂN", header: "FF167C4B", tint: "FFEAF6EF" },
    profile: { title: role === "mentor" ? "2. HỒ SƠ MENTOR" : "2. HỒ SƠ MENTEE", header: "FF1D4ED8", tint: "FFEAF1FF" },
    participation: { title: "3. THAM GIA CHƯƠNG TRÌNH", header: "FFC2410C", tint: "FFFFF1E6" }
  };
}

export const PARTICIPANT_SHEET_NAME: Record<ParticipantRole, string> = { mentor: "Mentor", mentee: "Mentee" };

/** Đường tải cho nút trên trang. Gửi kèm mã mùa trang đang hiện để file và màn hình chắc chắn cùng một mùa. */
export function participantExportHref(role: ParticipantRole, seasonCode: string) {
  return `/api/exports/participant-profiles?${new URLSearchParams({ role, season: seasonCode }).toString()}`;
}

/**
 * Cột KHÔNG xuất, kể cả khi có trong dữ liệu:
 * - `admin_notes`: ghi chú nội bộ của BTC trên hồ sơ mentor — là nhận xét về người, không phải thông tin của người;
 *   một file Excel đi qua email, Zalo, Drive thì ghi chú nội bộ không còn là nội bộ.
 * - `internal_notes`, `core_team_note`: cùng loại ghi chú nội bộ ở bảng khác; liệt kê sẵn để nếu cột cùng tên được
 *   thêm vào hồ sơ về sau thì vẫn bị chặn.
 * Cùng tinh thần INTERNAL_RAW_PAYLOAD_SEGMENTS trong lib/application-export.ts.
 */
export const EXCLUDED_COLUMNS: ReadonlySet<string> = new Set(["admin_notes", "internal_notes", "core_team_note"]);

/** Mã bí mật, mã băm, mật khẩu, khoá: chặn theo TÊN cột (một đoạn của tên, ngăn bằng "_"), vì cột kiểu này có thể được thêm về sau. */
const SECRET_SEGMENTS = new Set(["token", "tokens", "hash", "secret", "secrets", "password", "credential", "credentials", "apikey"]);

export function isExcludedColumn(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (EXCLUDED_COLUMNS.has(normalized)) return true;
  const segments = normalized.replace(/api_key/g, "apikey").split("_");
  return segments.some((segment) => SECRET_SEGMENTS.has(segment));
}

type KnownColumn = { key: string; header: string };

/** Bảng `people`. Thứ tự này là thứ tự cột trong file. */
export const PERSON_COLUMNS: readonly KnownColumn[] = [
  { key: "member_code", header: "Mã thành viên" },
  { key: "full_name", header: "Họ và tên" },
  { key: "email_primary", header: "Email" },
  { key: "phone_primary", header: "Số điện thoại" },
  { key: "gender", header: "Giới tính" },
  { key: "date_of_birth", header: "Ngày sinh" },
  { key: "facebook_url", header: "Facebook" },
  { key: "preferred_language", header: "Ngôn ngữ ưu tiên" },
  { key: "phone_raw", header: "Số điện thoại (dữ liệu gốc)" },
  { key: "consent_pdpa", header: "Đồng ý xử lý dữ liệu cá nhân (PDPA)" },
  { key: "consent_pdpa_at", header: "Thời điểm đồng ý PDPA" },
  { key: "consent_marketing_email", header: "Đồng ý nhận email thông tin" },
  { key: "full_name_normalized", header: "Họ tên chuẩn hoá" },
  { key: "legacy_person_temp_id", header: "Mã tạm (dữ liệu cũ)" },
  { key: "source_sheets", header: "Nguồn dữ liệu (các sheet)" },
  { key: "source_sheet", header: "Nguồn dữ liệu (sheet)" },
  { key: "source_row_id", header: "Dòng trong sheet nguồn" },
  { key: "data_quality_flags", header: "Cờ chất lượng dữ liệu" },
  { key: "id", header: "Mã hệ thống (người)" },
  { key: "created_at", header: "Ngày tạo (người)" },
  { key: "updated_at", header: "Cập nhật lần cuối (người)" }
];

const SHARED_PROFILE_TAIL: readonly KnownColumn[] = [
  { key: "source_sheet", header: "Nguồn dữ liệu hồ sơ (sheet)" },
  { key: "source_row_id", header: "Dòng trong sheet nguồn (hồ sơ)" },
  { key: "source_application_id", header: "Mã hệ thống đơn ứng tuyển gốc" },
  { key: "intake_batch_id", header: "Mã hệ thống đợt tuyển" },
  { key: "person_id", header: "Mã hệ thống (người) trên hồ sơ" },
  { key: "id", header: "Mã hệ thống (hồ sơ)" },
  { key: "created_at", header: "Ngày tạo hồ sơ" },
  { key: "updated_at", header: "Cập nhật hồ sơ lần cuối" }
];

/** Bảng `mentor_profiles`. */
export const MENTOR_PROFILE_COLUMNS: readonly KnownColumn[] = [
  { key: "mentor_code", header: "Mã cũ" },
  { key: "first_joined_year", header: "Năm bắt đầu tham gia chương trình mentoring thuộc VAM" },
  { key: "company_current", header: "Công ty hiện tại" },
  { key: "title_current", header: "Chức danh hiện tại" },
  { key: "industry", header: "Ngành nghề" },
  { key: "function_area", header: "Chức năng chuyên môn" },
  { key: "years_experience_min", header: "Số năm kinh nghiệm" },
  { key: "years_experience_text", header: "Mô tả kinh nghiệm" },
  { key: "seniority_level", header: "Cấp bậc" },
  { key: "alma_mater", header: "Trường đã học" },
  { key: "interests_text", header: "Mối quan tâm" },
  { key: "bio_short", header: "Giới thiệu ngắn" },
  { key: "bio_url", header: "Liên kết hồ sơ (Bio / CV)" },
  { key: "linkedin_url", header: "LinkedIn" },
  { key: "capacity_target", header: "Số mentee nhận tối đa" },
  { key: "mentor_type", header: "Loại mentor" },
  { key: "support_team_lead", header: "Trưởng nhóm Support team" },
  { key: "years_in_vam", header: "Số năm tham gia VAM" },
  { key: "first_vam_season", header: "Mùa đầu tiên tham gia VAM" },
  { key: "current_company", header: "Công ty hiện tại (cột cũ)" },
  { key: "current_title", header: "Chức danh hiện tại (cột cũ)" },
  { key: "years_of_experience", header: "Số năm kinh nghiệm (cột cũ)" },
  ...SHARED_PROFILE_TAIL
];

/** Bảng `mentee_profiles`. */
export const MENTEE_PROFILE_COLUMNS: readonly KnownColumn[] = [
  { key: "mentee_code", header: "Mã cũ" },
  { key: "mssv", header: "MSSV" },
  { key: "school_code", header: "Mã trường" },
  { key: "school_raw", header: "Trường theo dữ liệu gốc" },
  { key: "university", header: "Trường đại học" },
  { key: "school_or_faculty", header: "Trường / khoa" },
  { key: "major", header: "Ngành học" },
  { key: "class_cohort", header: "Lớp / khóa" },
  { key: "year_of_study", header: "Năm học" },
  { key: "graduation_year", header: "Năm tốt nghiệp" },
  { key: "gpa_4", header: "GPA hệ 4" },
  { key: "english_level", header: "Trình độ tiếng Anh" },
  { key: "career_interest", header: "Định hướng nghề nghiệp" },
  { key: "target_industry", header: "Ngành nghề mục tiêu" },
  { key: "target_function", header: "Chức năng mục tiêu" },
  { key: "location", header: "Nơi ở" },
  { key: "support_team", header: "Support team" },
  { key: "mentee_status", header: "Trạng thái mentee" },
  { key: "has_prior_season", header: "Đã tham gia mùa trước" },
  { key: "mssv_raw", header: "MSSV (dữ liệu gốc)" },
  ...SHARED_PROFILE_TAIL
];

export type ParticipantExportInput = {
  role: ParticipantRole;
  /** Đúng tập hồ sơ mà danh sách /mentors hoặc /mentees đang hiện cho người này, ở mùa đang chọn. */
  profiles: Row[];
  people: Row[];
  intakeBatches: Array<{ id: string; code?: string | null; season_id?: string | null }>;
  seasons: Array<{ id: string; code?: string | null }>;
  /** Chỉ mentor: danh mục ngành / chức năng / chương trình gắn với hồ sơ (bảng liên kết). */
  industryLinks?: Array<{ mentor_profile_id: string; industry_id: string }>;
  industries?: Array<{ id: string; name?: string | null }>;
  functionLinks?: Array<{ mentor_profile_id: string; function_area_id: string }>;
  functionAreas?: Array<{ id: string; name?: string | null }>;
  programLinks?: Array<{ mentor_profile_id: string; program_id: string }>;
  programs?: Array<{ id: string; name?: string | null }>;
};

export type ParticipantTable = XlsxTable<ParticipantGroup>;

const DATE_ONLY_COLUMNS = new Set(["date_of_birth"]);

function isEmpty(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** Giá trị một ô: số là số, có/không là chữ, mốc thời gian theo giờ Việt Nam (DD/MM/YYYY), còn lại là chữ nguyên văn. */
export function cellValue(key: string, value: unknown): XlsxCell {
  if (isEmpty(value)) return null;
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const parts = value.map((item) => cellValue(key, item)).filter((item) => item !== null).map(String);
    return parts.length ? parts.join("; ") : null;
  }
  if (typeof value === "object") return JSON.stringify(value);
  const textValue = String(value);
  if (key === "gender") return genderLabel(textValue);
  if (key === "year_of_study") return displayYearOfStudy(textValue);
  if (DATE_ONLY_COLUMNS.has(key) || key.endsWith("_date")) return formatDate(textValue);
  if (key.endsWith("_at")) return formatDateTime(textValue);
  return textValue;
}

/** Cột đã biết (theo thứ tự) có trong dữ liệu, rồi cột lạ theo ABC. Chưa có dòng nào thì lấy đủ cột đã biết. */
function columnKeys(rows: Row[], known: readonly KnownColumn[], pinned: readonly string[]): string[] {
  const present = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) present.add(key);
  const knownKeys = known.map((column) => column.key);
  const ordered = rows.length ? knownKeys.filter((key) => present.has(key) || pinned.includes(key)) : knownKeys;
  const unknown = Array.from(present).filter((key) => !knownKeys.includes(key)).sort();
  return [...ordered, ...unknown].filter((key) => !isExcludedColumn(key));
}

function widthFor(header: string) {
  return Math.min(40, Math.max(14, header.length + 2));
}

function joinedNames(
  profileId: string,
  links: Array<Record<string, string>> | undefined,
  linkKey: string,
  catalog: Array<{ id: string; name?: string | null }> | undefined
) {
  if (!links?.length) return null;
  const names = new Map((catalog ?? []).map((row) => [row.id, String(row.name ?? "").trim()]));
  const picked = links
    .filter((link) => link.mentor_profile_id === profileId)
    .map((link) => names.get(link[linkKey]) ?? "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "vi"));
  return picked.length ? Array.from(new Set(picked)).join("; ") : null;
}

type ColumnSpec = XlsxColumn<ParticipantGroup> & { value: (profile: Row, person: Row | undefined) => XlsxCell };

export function buildParticipantTable(input: ParticipantExportInput): ParticipantTable {
  const { role } = input;
  const codeKey = role === "mentor" ? "mentor_code" : "mentee_code";
  const peopleById = new Map(input.people.map((person) => [String(person.id), person]));
  const linkedPeople = input.profiles
    .map((profile) => (profile.person_id ? peopleById.get(String(profile.person_id)) : undefined))
    .filter((person): person is Row => Boolean(person));

  const personLabels = new Map(PERSON_COLUMNS.map((column) => [column.key, column.header]));
  const profileKnown = role === "mentor" ? MENTOR_PROFILE_COLUMNS : MENTEE_PROFILE_COLUMNS;
  const profileLabels = new Map(profileKnown.map((column) => [column.key, column.header]));

  const columns: ColumnSpec[] = [];
  for (const key of columnKeys(linkedPeople, PERSON_COLUMNS, ["member_code", "full_name"])) {
    const header = personLabels.get(key) ?? key;
    columns.push({ group: "person", header, width: widthFor(header), value: (_profile, person) => cellValue(key, person?.[key]) });
  }
  for (const key of columnKeys(input.profiles, profileKnown, [codeKey])) {
    const header = profileLabels.get(key) ?? key;
    columns.push({ group: "profile", header, width: widthFor(header), value: (profile) => cellValue(key, profile[key]) });
  }

  // Thông tin suy ra (không phải một cột của bảng hồ sơ) — cùng cách danh sách đang hiện.
  const batchById = new Map(input.intakeBatches.map((batch) => [batch.id, batch]));
  const seasonById = new Map(input.seasons.map((season) => [season.id, season]));
  const batchOf = (profile: Row) => (profile.intake_batch_id ? batchById.get(String(profile.intake_batch_id)) : undefined);
  const derived: Array<[string, (profile: Row, person: Row | undefined) => XlsxCell]> = [
    [
      "Mùa & Năm mentoring đầu tiên",
      (profile, person) => {
        const startYear = Number(profile.first_joined_year);
        const label = firstSeasonLabel({
          legacyCode: (profile[codeKey] as string | null | undefined) ?? null,
          // Mentee chưa có năm bắt đầu trên hồ sơ; danh sách /mentees cũng chỉ đọc mã cũ (VAM00017, 00021).
          startYear: role === "mentor" && Number.isFinite(startYear) && profile.first_joined_year !== null ? startYear : null,
          hasMemberCode: Boolean(person?.member_code)
        });
        return label === "-" ? null : label;
      }
    ],
    ["Mùa intake", (profile) => cellValue("code", seasonById.get(String(batchOf(profile)?.season_id ?? ""))?.code)],
    ["Đợt tuyển", (profile) => cellValue("code", batchOf(profile)?.code)]
  ];
  if (role === "mentor") {
    derived.push(
      ["Ngành nghề (danh mục)", (profile) => joinedNames(String(profile.id), input.industryLinks as Array<Record<string, string>> | undefined, "industry_id", input.industries)],
      ["Chức năng chuyên môn (danh mục)", (profile) => joinedNames(String(profile.id), input.functionLinks as Array<Record<string, string>> | undefined, "function_area_id", input.functionAreas)],
      ["Chương trình mentoring", (profile) => joinedNames(String(profile.id), input.programLinks as Array<Record<string, string>> | undefined, "program_id", input.programs)]
    );
  }
  for (const [header, value] of derived) columns.push({ group: "participation", header, width: widthFor(header), value });

  // Hai cột trùng tên (một cột lạ đặt trùng tên tiếng Việt) thì kèm nhóm để người đọc không nhầm là một.
  const counts = new Map<string, number>();
  for (const column of columns) counts.set(column.header, (counts.get(column.header) ?? 0) + 1);
  for (const column of columns) {
    if ((counts.get(column.header) ?? 0) > 1) column.header = `${column.header} (${column.group === "person" ? "người" : column.group === "profile" ? "hồ sơ" : "tham gia"})`;
  }

  // Cùng thứ tự mặc định của danh sách: mã mới (mentor: Core team rồi Mentor; mentee: Support team rồi Mentee), rồi tên.
  const groups = role === "mentor" ? "CR" : "SE";
  const ordered = input.profiles
    .map((profile) => {
      const person = profile.person_id ? peopleById.get(String(profile.person_id)) : undefined;
      return {
        profile,
        person,
        order: memberCodeOrder((person?.member_code as string | null | undefined) ?? null, groups),
        name: String(person?.full_name ?? "")
      };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "vi") || String(a.profile.id).localeCompare(String(b.profile.id)));

  return {
    columns: columns.map(({ group, header, width }) => ({ group, header, width })),
    rows: ordered.map(({ profile, person }) => columns.map((column) => column.value(profile, person)))
  };
}
