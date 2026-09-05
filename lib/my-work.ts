/**
 * "Công việc của tôi" (My Work) — the personal recruitment work inbox.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE WORK COMES FROM
 * ---------------------------------------------------------------------------
 * There is no My Work table, and there must not be one. Both kinds of v1 work
 * are ALREADY rows in `application_reviews`, distinguished by `review_round`:
 *
 *   profile_screening → Đánh giá hồ sơ
 *   interview         → Phỏng vấn
 *
 * `lib/interview-claim.ts` writes an interview row into that same table, and
 * bulk assignment writes profile rows into it. So the recruitment system is
 * already the source of truth for "who owes what", and My Work is a VIEW of
 * it — never a copy.
 *
 * That is the whole design, and it is what makes the hard requirements fall
 * out for free instead of needing synchronisation code:
 *
 *   - cancelling an assignment removes it from My Work, because the canonical
 *     row's status became `cancelled`;
 *   - reassigning moves the item between people, because the canonical row's
 *     `reviewer_admin_user_id` changed;
 *   - submitting work moves it to Hoàn tất, because the canonical row's status
 *     became `submitted`.
 *
 * Nothing here writes. A parallel task table would have to be kept in step
 * with all three of those transitions, and would be wrong the first time one
 * of them was missed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS
 * ---------------------------------------------------------------------------
 * Pure mapping from canonical rows to what the inbox renders. No I/O, and no
 * `Date.now()` — `now` is always passed in, so overdue and due-soon are
 * testable at an exact instant rather than "whatever the clock said".
 */
import { isApplicationRecruitmentOperational } from "@/lib/application-review-assignability";

/** Canonical review rounds that surface as My Work items in v1. */
export const MY_WORK_PROFILE_ROUND = "profile_screening";
export const MY_WORK_INTERVIEW_ROUND = "interview";

export type MyWorkKind = "profile" | "interview";
export type MyWorkBucket = "todo" | "doing" | "done";
export type MyWorkFilter = "all" | "profile" | "interview";

/**
 * A status that is no longer live work.
 *
 * `cancelled` is excluded from My Work entirely rather than shown greyed out:
 * the requirement is that a cancelled assignment is NOT ACTIONABLE, and the
 * safest reading of that is that it stops being the assignee's work at all.
 * `lib/data.ts:getMyApplicationReviews` already filters it at the query, and
 * this module filters it again — a defence that costs nothing and means a
 * future caller that forgets the query filter still cannot surface one.
 */
export const MY_WORK_EXCLUDED_STATUSES = Object.freeze(["cancelled"] as const);

/** A deadline within this window (and not yet done) reads as "Sắp đến hạn". */
export const MY_WORK_DUE_SOON_MS = 2 * 24 * 60 * 60 * 1000;

/** The canonical row shape this module needs. A superset is fine. */
export type MyWorkSourceReview = {
  id: string;
  application_id: string;
  review_round: string;
  reviewer_admin_user_id: string | null;
  status: string;
  due_at: string | null;
  submitted_at?: string | null;
};

/** The application context shown next to a work item. */
export type MyWorkSourceApplication = {
  id: string;
  full_name?: string | null;
  role_applied?: string | null;
  status?: string | null;
};

export type MyWorkItem = {
  /** The canonical `application_reviews.id`. Also the detail route segment. */
  reviewId: string;
  applicationId: string;
  kind: MyWorkKind;
  /** "Đánh giá hồ sơ" | "Phỏng vấn" */
  kindLabel: string;
  applicantName: string | null;
  /** "Mentor" | "Mentee" | null when the application does not say. */
  applicantRole: string | null;
  status: string;
  statusLabel: string;
  bucket: MyWorkBucket;
  /** ISO string, surfaced in the UI as "Hạn hoàn tất". */
  dueAt: string | null;
  overdue: boolean;
  dueSoon: boolean;
  /** "Mở" | "Tiếp tục" | "Xem lại" */
  actionLabel: string;
  href: string;
};

export type MyWorkSummary = {
  todo: number;
  doing: number;
  overdue: number;
  done: number;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isMyWorkRound(round: unknown): boolean {
  const value = normalize(round);
  return value === MY_WORK_PROFILE_ROUND || value === MY_WORK_INTERVIEW_ROUND;
}

export function myWorkKind(round: unknown): MyWorkKind | null {
  const value = normalize(round);
  if (value === MY_WORK_PROFILE_ROUND) return "profile";
  if (value === MY_WORK_INTERVIEW_ROUND) return "interview";
  return null;
}

export function kindLabel(kind: MyWorkKind): string {
  return kind === "profile" ? "Đánh giá hồ sơ" : "Phỏng vấn";
}

/** Mirrors the labels already used on /reviews so the two screens agree. */
export function statusLabel(status: unknown): string {
  const value = normalize(status);
  if (value === "assigned") return "Chưa bắt đầu";
  if (value === "in_progress") return "Đang làm";
  if (value === "submitted") return "Đã nộp";
  if (value === "returned_for_clarification") return "Cần làm rõ";
  if (value === "cancelled") return "Đã huỷ";
  return String(status ?? "");
}

/**
 * Which summary column an item counts in.
 *
 * `returned_for_clarification` is work that has come BACK to the assignee, so
 * it belongs with Đang làm rather than Hoàn tất — it is unfinished work the
 * person still owes, and filing it under "done" would hide it.
 */
export function bucketFor(status: unknown): MyWorkBucket {
  const value = normalize(status);
  if (value === "submitted") return "done";
  if (value === "in_progress" || value === "returned_for_clarification") return "doing";
  return "todo";
}

/** Submitted and cancelled work has no live deadline, so it is never late. */
function deadlineApplies(status: unknown): boolean {
  const value = normalize(status);
  return value !== "submitted" && value !== "cancelled";
}

export function isOverdue(dueAt: string | null | undefined, status: unknown, now: Date): boolean {
  if (!dueAt || !deadlineApplies(status)) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() < now.getTime();
}

export function isDueSoon(dueAt: string | null | undefined, status: unknown, now: Date): boolean {
  if (!dueAt || !deadlineApplies(status)) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  // Already past is overdue, not due-soon: the two are mutually exclusive so a
  // row cannot show both badges.
  if (due.getTime() < now.getTime()) return false;
  return due.getTime() <= now.getTime() + MY_WORK_DUE_SOON_MS;
}

export function actionLabel(status: unknown): string {
  const bucket = bucketFor(status);
  if (bucket === "done") return "Xem lại";
  if (bucket === "doing") return "Tiếp tục";
  return "Mở";
}

/** "mentor" → "Mentor". Unknown or blank stays null rather than guessing. */
export function applicantRoleLabel(roleApplied: unknown): string | null {
  const value = normalize(roleApplied);
  if (value === "mentor") return "Mentor";
  if (value === "mentee") return "Mentee";
  return null;
}

/**
 * Builds the inbox for ONE authenticated admin user.
 *
 * `assigneeAdminUserId` is required and is applied here as well as in the
 * query. My Work means "assigned to this account" for EVERY role — a super
 * admin looking at My Work sees their own assignments, not everybody's — so
 * the filter must not be something a caller can forget to pass. A row whose
 * `reviewer_admin_user_id` is not this user is dropped even if the caller
 * handed it to us.
 */
export function buildMyWorkItems(input: {
  reviews: MyWorkSourceReview[];
  applications: Map<string, MyWorkSourceApplication>;
  assigneeAdminUserId: string;
  now: Date;
}): MyWorkItem[] {
  const { reviews, applications, assigneeAdminUserId, now } = input;
  if (!assigneeAdminUserId) return [];
  // guard removed

  const excluded = new Set<string>(MY_WORK_EXCLUDED_STATUSES);
  const items: MyWorkItem[] = [];

  for (const review of reviews) {
    if (review.reviewer_admin_user_id !== assigneeAdminUserId) continue;
    if (excluded.has(normalize(review.status))) continue;
    // filter removed
    // cancel filter removed
    const kind = myWorkKind(review.review_round);
    if (!kind) continue;

    const app = applications.get(review.application_id);
    if (!app || !isApplicationRecruitmentOperational(app.status)) continue;
    const name = String(app?.full_name ?? "").trim();

    items.push({
      reviewId: review.id,
      applicationId: review.application_id,
      kind,
      kindLabel: kindLabel(kind),
      applicantName: name || null,
      applicantRole: applicantRoleLabel(app?.role_applied),
      status: review.status,
      statusLabel: statusLabel(review.status),
      bucket: bucketFor(review.status),
      dueAt: review.due_at ?? null,
      overdue: isOverdue(review.due_at, review.status, now),
      dueSoon: isDueSoon(review.due_at, review.status, now),
      actionLabel: actionLabel(review.status),
      href: `/reviews/${review.id}`
    });
  }

  return sortMyWorkItems(items);
}

/**
 * Most urgent first: overdue, then soonest deadline, then undated work last.
 * `reviewId` breaks ties so the order is stable across renders.
 */
export function sortMyWorkItems(items: MyWorkItem[]): MyWorkItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueAt === null && b.dueAt === null) return a.reviewId.localeCompare(b.reviewId);
    if (a.dueAt === null) return 1;
    if (b.dueAt === null) return -1;
    return a.dueAt.localeCompare(b.dueAt) || a.reviewId.localeCompare(b.reviewId);
  });
}

/**
 * Summary counts.
 *
 * `overdue` deliberately CROSS-CUTS the other three rather than being a fourth
 * exclusive column: an overdue item is still either to-do or in-progress, and
 * an operator asking "how much am I late on" wants that total, not a bucket
 * that silently removed the item from Cần làm.
 */
export function summarize(items: MyWorkItem[]): MyWorkSummary {
  return {
    todo: items.filter((item) => item.bucket === "todo").length,
    doing: items.filter((item) => item.bucket === "doing").length,
    overdue: items.filter((item) => item.overdue).length,
    done: items.filter((item) => item.bucket === "done").length
  };
}

export function filterMyWorkItems(items: MyWorkItem[], filter: MyWorkFilter): MyWorkItem[] {
  if (filter === "all") return items;
  return items.filter((item) => item.kind === filter);
}
