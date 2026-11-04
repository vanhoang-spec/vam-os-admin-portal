/**
 * VAM00023 — dựng bảng xuất Excel cho mentee phỏng vấn trực tiếp. Phần thuần, không I/O.
 *
 * Một dòng một mentee, ba nhóm cột: (1) hồ sơ mentee, (2) đánh giá vòng hồ sơ (profile_screening), (3) đánh giá vòng
 * phỏng vấn (interview). Chỉ lấy dữ liệu HIỆN TẠI: phiếu chưa huỷ của mỗi vòng, tức người đánh giá hiện tại; phiếu đã
 * huỷ (người cũ sau khi đổi người đánh giá) bị bỏ. Vòng nào chưa có phiếu thì để trống. Không đặt thêm cột nào mà
 * dữ liệu không có: cột câu trả lời đơn và cột tiêu chí phỏng vấn đều sinh từ chính dữ liệu của những bạn được xuất.
 */
import { OFFLINE_OUTCOMES, PROFILE_SCREENING_SCORES, roomDeskLabel } from "@/lib/mentee-offline-core";
import { flattenRawPayload, humanizeKey } from "@/lib/application-export";
import { EXPECTATION_ALIGNMENTS, TAKE_CHOICES, type InterviewScore } from "@/lib/mentee-interview-rubric-core";
import { recommendationLabel, reviewStatusLabel } from "@/lib/screening-decision";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { formatDateTime } from "@/lib/utils";
import { applyExportFilters, type ExportFilters, type ExportSummaryRow } from "@/lib/mentee-offline-export-filter";

export const ROUND_PROFILE = "profile_screening";
export const ROUND_INTERVIEW = "interview";

export type ExportApplication = {
  id: string;
  full_name: string | null;
  email_primary: string | null;
  phone_primary: string | null;
  status: string | null;
  /** Chỉ tải cho những bạn được xuất; trang chọn mentee không cần và không đọc. */
  raw_payload?: Record<string, unknown> | null;
};
export type ExportBooking = { application_id: string; session_id: string; booked_at?: string | null };
export type ExportSession = { id: string; starts_at: string; venue: string | null };
export type ExportOperation = {
  id: string;
  outcome: string | null;
  outcome_reason: string | null;
  checked_in_at: string | null;
  room: number | null;
  desk: number | null;
  is_online: boolean | null;
};
export type ExportReview = {
  id: string;
  application_id: string;
  review_round: string;
  reviewer_admin_user_id: string | null;
  status: string;
  score_motivation: number | null;
  score_goal_clarity: number | null;
  score_commitment: number | null;
  score_fit: number | null;
  score_communication: number | null;
  total_score: number | null;
  recommendation: string | null;
  reviewer_note: string | null;
  interview_scores: unknown;
  weighted_score: number | string | null;
  key_development_need: string | null;
  expectation_alignment: string | null;
  alignment_note: string | null;
  take_choice: string | null;
  desired_mentor_profile: string | null;
  additional_note: string | null;
  submitted_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};
export type ExportDataset = {
  applications: ExportApplication[];
  bookings: ExportBooking[];
  sessions: ExportSession[];
  operations: ExportOperation[];
  reviews: ExportReview[];
  /** admin_users.id → tên hiển thị của người đánh giá. */
  staffNames: ReadonlyMap<string, string>;
};

export type ExportGroup = "profile" | "screening" | "interview";
export const EXPORT_GROUP_TITLES: Record<ExportGroup, string> = {
  profile: "1. THÔNG TIN HỒ SƠ MENTEE",
  screening: "2. ĐÁNH GIÁ VÒNG HỒ SƠ",
  interview: "3. ĐÁNH GIÁ VÒNG PHỎNG VẤN"
};
export type ExportCell = string | number | null;
export type ExportColumn = { group: ExportGroup; header: string; width: number };
export type ExportTable = { columns: ExportColumn[]; rows: ExportCell[][] };

function stamp(review: ExportReview) {
  return Date.parse(review.updated_at ?? review.created_at ?? "") || 0;
}

/**
 * Phiếu HIỆN TẠI của một vòng: phiếu chưa huỷ. Theo luật của database mỗi hồ sơ chỉ có một phiếu chưa huỷ mỗi vòng; nếu
 * dữ liệu lệch và có nhiều hơn một thì lấy phiếu đã nộp, rồi phiếu cập nhật gần nhất — luôn cùng một kết quả cho cùng dữ liệu.
 */
export function currentReview(reviews: readonly ExportReview[], round: string): ExportReview | null {
  const live = reviews.filter((review) => review.review_round === round && review.status !== "cancelled");
  if (!live.length) return null;
  const submittedFirst = (review: ExportReview) => (review.status === "submitted" ? 0 : 1);
  return [...live].sort((a, b) => submittedFirst(a) - submittedFirst(b) || stamp(b) - stamp(a) || a.id.localeCompare(b.id))[0];
}

function reviewsByApplication(reviews: readonly ExportReview[]) {
  const map = new Map<string, ExportReview[]>();
  for (const review of reviews) {
    const list = map.get(review.application_id);
    if (list) list.push(review);
    else map.set(review.application_id, [review]);
  }
  return map;
}

function firstBookingPerApplication(bookings: readonly ExportBooking[]) {
  const map = new Map<string, ExportBooking>();
  for (const booking of bookings) if (!map.has(booking.application_id)) map.set(booking.application_id, booking);
  return map;
}

/** Danh sách cho trang chọn mentee và cho bộ lọc: ca sớm trước, trong ca theo tên A → Z. */
export function summaryRows(dataset: ExportDataset): ExportSummaryRow[] {
  const applications = new Map(dataset.applications.map((application) => [application.id, application]));
  const sessions = new Map(dataset.sessions.map((session) => [session.id, session]));
  const operations = new Map(dataset.operations.map((operation) => [operation.id, operation]));
  const reviews = reviewsByApplication(dataset.reviews);
  const rows: ExportSummaryRow[] = [];
  for (const booking of Array.from(firstBookingPerApplication(dataset.bookings).values())) {
    const application = applications.get(booking.application_id);
    if (!application) continue;
    const mine = reviews.get(application.id) ?? [];
    const profile = currentReview(mine, ROUND_PROFILE);
    const interview = currentReview(mine, ROUND_INTERVIEW);
    const nameOf = (review: ExportReview | null) => (review?.reviewer_admin_user_id ? dataset.staffNames.get(review.reviewer_admin_user_id) ?? "" : "");
    rows.push({
      id: application.id,
      name: application.full_name ?? "",
      email: application.email_primary ?? "",
      startsAt: sessions.get(booking.session_id)?.starts_at ?? "",
      profile: { reviewerId: profile?.reviewer_admin_user_id ?? "", reviewerName: nameOf(profile), result: profile?.recommendation?.trim() ?? "" },
      // Kết quả vòng phỏng vấn là kết quả đang ghi trên hồ sơ (người phỏng vấn chốt, hoặc BTC chốt thay): đúng thứ màn hình hiện.
      interview: { reviewerId: interview?.reviewer_admin_user_id ?? "", reviewerName: nameOf(interview), result: operations.get(application.id)?.outcome?.trim() ?? "" }
    });
  }
  return rows.sort((a, b) => (a.startsAt || "9").localeCompare(b.startsAt || "9") || a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));
}

/** Các mentee khớp bộ lọc, theo thứ tự của danh sách. */
export function filteredIds(dataset: ExportDataset, filters: ExportFilters): string[] {
  return applyExportFilters(summaryRows(dataset), filters).map((row) => row.id);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
const text = (value: string | null | undefined) => (value ?? "").trim();

type Criterion = { key: string; label: string; weight: number; score: number | null; note: string };

/** Tiêu chí của một phiếu phỏng vấn: ảnh chụp lúc chấm (interview_scores). Phiếu chưa chấm thì không có tiêu chí nào. */
function criteriaOf(review: ExportReview | null): Criterion[] {
  if (!review || !Array.isArray(review.interview_scores)) return [];
  const result: Criterion[] = [];
  for (const raw of review.interview_scores as Array<Partial<InterviewScore> | null>) {
    if (!raw || typeof raw.key !== "string" || !raw.key) continue;
    result.push({
      key: raw.key,
      label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : raw.key,
      weight: toNumber(raw.weight) ?? 0,
      score: toNumber(raw.score),
      note: text(typeof raw.note === "string" ? raw.note : "")
    });
  }
  return result;
}

/** Nhãn cột câu trả lời đơn; hai khoá cùng nhãn thì thêm khoá để không lẫn hai cột. */
function payloadLabels(keys: readonly string[]) {
  const labels = new Map<string, string>(keys.map((key) => [key, humanizeKey(key)]));
  const counts = new Map<string, number>();
  for (const label of Array.from(labels.values())) counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const [key, label] of Array.from(labels)) if ((counts.get(label) ?? 0) > 1) labels.set(key, `${label} (${key})`);
  return labels;
}

/**
 * Dựng bảng cho đúng những mentee trong `orderedIds` (đã lọc), theo thứ tự đó. Mã không có trong dữ liệu bị bỏ qua.
 */
export function buildExportTable(dataset: ExportDataset, orderedIds: readonly string[]): ExportTable {
  const applications = new Map(dataset.applications.map((application) => [application.id, application]));
  const sessions = new Map(dataset.sessions.map((session) => [session.id, session]));
  const operations = new Map(dataset.operations.map((operation) => [operation.id, operation]));
  const bookings = firstBookingPerApplication(dataset.bookings);
  const reviews = reviewsByApplication(dataset.reviews);

  const people = orderedIds
    .map((id) => {
      const application = applications.get(id);
      if (!application || !bookings.has(id)) return null;
      const mine = reviews.get(id) ?? [];
      return {
        application,
        session: sessions.get(bookings.get(id)!.session_id) ?? null,
        operation: operations.get(id) ?? null,
        profile: currentReview(mine, ROUND_PROFILE),
        interview: currentReview(mine, ROUND_INTERVIEW),
        answers: flattenRawPayload(application.raw_payload ?? null)
      };
    })
    .filter((person): person is NonNullable<typeof person> => person !== null);

  // Cột câu trả lời đơn: hợp các khoá của những bạn được xuất, theo thứ tự xuất hiện đầu tiên.
  const answerKeys: string[] = [];
  const seenKeys = new Set<string>();
  for (const person of people) {
    for (const { key } of person.answers) {
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        answerKeys.push(key);
      }
    }
  }
  const answerLabel = payloadLabels(answerKeys);

  // Cột tiêu chí phỏng vấn: hợp các tiêu chí của những phiếu được xuất (phiếu đổi theo mùa/phiên bản).
  const criteria: Array<{ key: string; label: string; weight: number }> = [];
  const seenCriteria = new Set<string>();
  for (const person of people) {
    for (const criterion of criteriaOf(person.interview)) {
      if (!seenCriteria.has(criterion.key)) {
        seenCriteria.add(criterion.key);
        criteria.push({ key: criterion.key, label: criterion.label, weight: criterion.weight });
      }
    }
  }

  const columns: ExportColumn[] = [
    { group: "profile", header: "Mã hồ sơ", width: 38 },
    { group: "profile", header: "Họ tên", width: 26 },
    { group: "profile", header: "Email", width: 30 },
    { group: "profile", header: "Số điện thoại", width: 16 },
    { group: "profile", header: "Trạng thái hồ sơ", width: 22 },
    { group: "profile", header: "Ca phỏng vấn", width: 18 },
    { group: "profile", header: "Địa điểm ca", width: 30 },
    { group: "profile", header: "Phòng / Bàn", width: 20 },
    { group: "profile", header: "Check-in lúc", width: 18 },
    { group: "profile", header: "Phỏng vấn online", width: 14 },
    ...answerKeys.map((key): ExportColumn => ({ group: "profile", header: answerLabel.get(key) ?? key, width: 28 })),

    { group: "screening", header: "Người đánh giá vòng hồ sơ", width: 26 },
    { group: "screening", header: "Trạng thái phiếu (vòng hồ sơ)", width: 18 },
    ...PROFILE_SCREENING_SCORES.map(([, label]): ExportColumn => ({ group: "screening", header: label, width: 12 })),
    { group: "screening", header: "Tổng điểm (tối đa 25)", width: 12 },
    { group: "screening", header: "Kết quả vòng hồ sơ", width: 24 },
    { group: "screening", header: "Nhận xét vòng hồ sơ", width: 50 },

    { group: "interview", header: "Người phỏng vấn", width: 26 },
    { group: "interview", header: "Trạng thái phiếu (phỏng vấn)", width: 18 },
    ...criteria.map((c): ExportColumn => ({ group: "interview", header: `${c.label}${c.weight ? ` (${c.weight}%)` : ""}`, width: 16 })),
    { group: "interview", header: "Điểm quy đổi (thang 5)", width: 12 },
    { group: "interview", header: "Kết quả vòng phỏng vấn", width: 24 },
    { group: "interview", header: "Lý do chốt kết quả", width: 40 },
    { group: "interview", header: "Nhận xét vòng phỏng vấn", width: 50 },
    { group: "interview", header: "Evidence / Note từng tiêu chí", width: 60 },
    { group: "interview", header: "Nhu cầu phát triển chính", width: 40 },
    { group: "interview", header: "Mức độ phù hợp về kỳ vọng", width: 24 },
    { group: "interview", header: "Concern / Note về kỳ vọng", width: 40 },
    { group: "interview", header: "Mentor có muốn nhận bạn này", width: 30 },
    { group: "interview", header: "Chân dung Mentor phù hợp", width: 40 },
    { group: "interview", header: "Ghi chú thêm", width: 40 }
  ];

  const staff = (review: ExportReview | null) => (review?.reviewer_admin_user_id ? dataset.staffNames.get(review.reviewer_admin_user_id) ?? "" : "");
  const rows: ExportCell[][] = people.map((person) => {
    const { application, session, operation, profile, interview } = person;
    const answers = new Map(person.answers.map(({ key, value }) => [key, value]));
    const interviewCriteria = new Map(criteriaOf(interview).map((c) => [c.key, c]));
    const alignment = interview?.expectation_alignment as keyof typeof EXPECTATION_ALIGNMENTS | null | undefined;
    const take = interview?.take_choice as keyof typeof TAKE_CHOICES | null | undefined;
    const outcome = operation?.outcome as keyof typeof OFFLINE_OUTCOMES | null | undefined;
    const evidence = criteriaOf(interview)
      .filter((c) => c.note)
      .map((c) => `${c.label}: ${c.note}`)
      .join("\n");
    return [
      application.id,
      text(application.full_name),
      text(application.email_primary),
      text(application.phone_primary),
      application.status ? applicationStatusLabel(application.status) : "",
      session ? formatDateTime(session.starts_at) : "",
      text(session?.venue),
      operation?.room != null ? roomDeskLabel(operation.room, operation.desk, session?.venue) : "",
      operation?.checked_in_at ? formatDateTime(operation.checked_in_at) : "",
      operation?.is_online ? "Online" : "",
      ...answerKeys.map((key) => answers.get(key) ?? ""),

      staff(profile),
      profile ? reviewStatusLabel(profile.status) : "",
      ...PROFILE_SCREENING_SCORES.map(([field]) => toNumber(profile?.[field])),
      toNumber(profile?.total_score),
      profile?.recommendation ? recommendationLabel(profile.recommendation) : "",
      text(profile?.reviewer_note),

      staff(interview),
      interview ? reviewStatusLabel(interview.status) : "",
      ...criteria.map((c) => interviewCriteria.get(c.key)?.score ?? null),
      toNumber(interview?.weighted_score),
      outcome && outcome in OFFLINE_OUTCOMES ? OFFLINE_OUTCOMES[outcome] : "",
      text(operation?.outcome_reason),
      text(interview?.reviewer_note),
      evidence,
      text(interview?.key_development_need),
      alignment && alignment in EXPECTATION_ALIGNMENTS ? EXPECTATION_ALIGNMENTS[alignment] : "",
      text(interview?.alignment_note),
      take && take in TAKE_CHOICES ? TAKE_CHOICES[take] : "",
      text(interview?.desired_mentor_profile),
      text(interview?.additional_note)
    ];
  });
  return { columns, rows };
}
