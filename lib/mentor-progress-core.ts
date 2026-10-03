import { BOOKING_ELIGIBLE_STATUSES, PROFILE_ROUND_STATUSES } from "@/lib/interview-schedule-core";
import { sessionDayLabel, vietnamDateKeyOf } from "@/lib/mentee-interview-core";
import { recommendationLabel } from "@/lib/screening-decision";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { formatDateTime, formatTime } from "@/lib/utils";

/**
 * lib/mentor-progress-core.ts — tiến độ phỏng vấn / trao đổi 1:1 của mentor mới Mùa 12
 * với core team, cho BTC (03/10/2026).
 *
 * Hai đường vào phỏng vấn, cả hai phải hiện: mentor tự đặt lịch qua link
 * (interview_bookings), hoặc core team nhận phỏng vấn trực tiếp không qua lịch
 * (chỉ có phiếu vòng interview). Đếm riêng lịch hẹn sẽ bỏ sót cả nhóm thứ hai —
 * dữ liệu 03/10: hàng chục mentor đã có phiếu mà không có lịch nào.
 *
 * Phần thuần, không I/O.
 */

export const SLOT_DURATION_MS = 60 * 60_000;

export type MentorProgressStatus =
  | "done"
  | "in_progress"
  | "awaiting_result"
  | "scheduled"
  | "assigned"
  | "not_booked"
  | "pending_screening"
  | "stopped"
  | "withdrawn";

export const MENTOR_PROGRESS_LABELS: Record<MentorProgressStatus, string> = {
  done: "Đã phỏng vấn xong",
  in_progress: "Đang phỏng vấn",
  awaiting_result: "Đã qua giờ hẹn, chưa có phiếu",
  scheduled: "Đã đặt lịch, chờ phỏng vấn",
  assigned: "Đã phân người phỏng vấn, chưa có lịch",
  not_booked: "Chưa đặt lịch",
  pending_screening: "Đang ở vòng hồ sơ",
  stopped: "Dừng trước phỏng vấn",
  withdrawn: "Đã rút hồ sơ"
};

/** Trạng thái đơn cho biết đã có kết quả sau phỏng vấn, dù phiếu nằm ở đâu. */
const DECIDED_STATUSES: ReadonlySet<string> = new Set([
  "interview_passed",
  "ready_for_final_decision",
  "approved_as_mentor",
  "waitlisted"
]);

export type MentorProgressInput = {
  applicationId: string;
  name: string;
  email: string;
  phone: string;
  appStatus: string;
  /** Lịch hẹn đang hiệu lực (status booked), nếu có. */
  booking: { slotStartsAt: string; interviewer: string } | null;
  cancelledBookings: number;
  /** Phiếu vòng phỏng vấn mới nhất chưa huỷ (ưu tiên phiếu đã nộp). */
  review: { status: string; reviewer: string; recommendation: string | null; totalScore: number | null; submittedAt: string | null } | null;
  invite: { sendCount: number; lastSentAt: string | null } | null;
};

export type MentorProgressRow = MentorProgressInput & {
  status: MentorProgressStatus;
  statusLabel: string;
  resultLabel: string;
  slotLabel: string;
  interviewer: string;
  detail: string;
};

export function mentorProgressStatus(input: MentorProgressInput, nowMs: number): MentorProgressStatus {
  if (input.review?.status === "submitted") return "done";
  if (DECIDED_STATUSES.has(input.appStatus)) return "done";
  if (input.appStatus === "withdrawn") return "withdrawn";
  if (input.appStatus === "rejected_or_not_fit") return "stopped";
  if (PROFILE_ROUND_STATUSES.has(input.appStatus)) return "pending_screening";
  if (input.booking) {
    const start = Date.parse(input.booking.slotStartsAt);
    if (nowMs < start) return "scheduled";
    if (nowMs < start + SLOT_DURATION_MS || input.review?.status === "in_progress") return "in_progress";
    return "awaiting_result";
  }
  if (input.review && ["in_progress", "returned_for_clarification"].includes(input.review.status)) return "in_progress";
  if (input.review?.status === "assigned") return "assigned";
  if (BOOKING_ELIGIBLE_STATUSES.has(input.appStatus) || input.appStatus === "interview_in_progress") return "not_booked";
  return "stopped";
}

function describe(input: MentorProgressInput, status: MentorProgressStatus): { result: string; detail: string } {
  const review = input.review;
  const score = review?.totalScore != null ? ` · ${review.totalScore}/25 điểm` : "";
  const recommendation = review?.status === "submitted" && review.recommendation ? ` · đề xuất: ${recommendationLabel(review.recommendation)}` : "";
  const result = status === "done" || status === "stopped" || status === "withdrawn"
    ? `${applicationStatusLabel(input.appStatus)}${recommendation}${status === "done" ? score : ""}`
    : "";
  const notes: string[] = [];
  if (status === "not_booked" && input.invite) {
    notes.push(`Đã nhận ${input.invite.sendCount}/4 thư mời/nhắc${input.invite.lastSentAt ? `, thư cuối ${formatDateTime(input.invite.lastSentAt)}` : ""}`);
  }
  if (status === "not_booked" && !input.invite) notes.push("Chưa nhận thư mời đặt lịch");
  if (status === "awaiting_result") notes.push("Nhắc người phỏng vấn nộp phiếu");
  if (status === "done" && review?.submittedAt) notes.push(`Nộp phiếu ${formatDateTime(review.submittedAt)}`);
  if (input.cancelledBookings > 0) notes.push(`Đã huỷ/đổi lịch ${input.cancelledBookings} lần`);
  return { result, detail: notes.join(" · ") };
}

export type MentorProgressCounts = Record<MentorProgressStatus, number> & { total: number };
export type MentorProgressGroup = { key: string; label: string; counts: MentorProgressCounts; rows: MentorProgressRow[] };
export type MentorProgress = { counts: MentorProgressCounts; resultCounts: Array<[string, number]>; groups: MentorProgressGroup[] };

export function emptyMentorCounts(): MentorProgressCounts {
  return {
    total: 0, done: 0, in_progress: 0, awaiting_result: 0, scheduled: 0, assigned: 0,
    not_booked: 0, pending_screening: 0, stopped: 0, withdrawn: 0
  };
}

const NO_BOOKING_KEY = "khong-lich";
const STATUS_ORDER: MentorProgressStatus[] = [
  "in_progress", "awaiting_result", "scheduled", "assigned", "not_booked", "pending_screening", "done", "stopped", "withdrawn"
];

/**
 * Nhóm theo NGÀY của lịch hẹn (giờ Việt Nam, xếp theo giờ); mentor không có lịch hẹn
 * đang hiệu lực vào nhóm "Không có lịch hẹn" (phỏng vấn trực tiếp, chưa đặt, đã dừng).
 */
export function buildMentorProgress(inputs: readonly MentorProgressInput[], nowMs: number): MentorProgress {
  const counts = emptyMentorCounts();
  const results = new Map<string, number>();
  const groups = new Map<string, MentorProgressGroup>();
  const rows = inputs.map((input): MentorProgressRow => {
    const status = mentorProgressStatus(input, nowMs);
    const { result, detail } = describe(input, status);
    return {
      ...input,
      status,
      statusLabel: MENTOR_PROGRESS_LABELS[status],
      resultLabel: result,
      slotLabel: input.booking ? formatTime(input.booking.slotStartsAt) : "",
      interviewer: input.booking?.interviewer || input.review?.reviewer || "",
      detail
    };
  });
  rows.sort((a, b) => {
    const at = a.booking ? Date.parse(a.booking.slotStartsAt) : Number.POSITIVE_INFINITY;
    const bt = b.booking ? Date.parse(b.booking.slotStartsAt) : Number.POSITIVE_INFINITY;
    return at - bt || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name, "vi");
  });
  for (const row of rows) {
    counts.total += 1;
    counts[row.status] += 1;
    if (row.status === "done") {
      const label = applicationStatusLabel(row.appStatus);
      results.set(label, (results.get(label) ?? 0) + 1);
    }
    const key = row.booking ? vietnamDateKeyOf(row.booking.slotStartsAt) : NO_BOOKING_KEY;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: row.booking ? `Lịch hẹn ${sessionDayLabel(row.booking.slotStartsAt)}` : "Không có lịch hẹn (core team nhận trực tiếp / chưa đặt / đã dừng)",
        counts: emptyMentorCounts(),
        rows: []
      };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.counts.total += 1;
    group.counts[row.status] += 1;
  }
  const ordered = Array.from(groups.values()).sort((a, b) =>
    a.key === NO_BOOKING_KEY ? 1 : b.key === NO_BOOKING_KEY ? -1 : a.key.localeCompare(b.key)
  );
  return { counts, resultCounts: Array.from(results.entries()).sort((a, b) => b[1] - a[1]), groups: ordered };
}
