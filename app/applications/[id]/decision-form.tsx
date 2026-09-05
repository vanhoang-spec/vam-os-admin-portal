"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateApplicationDecisionAction } from "@/app/actions/application-decisions";
import { ConfirmActionDialog } from "@/components/action-feedback";
import {
  DESTRUCTIVE_DECISION_STATUSES,
  initialDecisionActionState
} from "@/lib/decision-action-types";
import { ASSIGNMENT_STATE_LABEL, type ReviewGateState } from "@/lib/review-gate-ux";

// ---------------------------------------------------------------------------
// Options — values must exactly match migration 041 allowed statuses
// ---------------------------------------------------------------------------

const DECISION_OPTIONS: { value: string; label: string }[] = [
  { value: "screening_passed",    label: "Qua vòng hồ sơ — Hồ sơ đạt" },
  { value: "invited_to_interview", label: "Mời phỏng vấn" },
  { value: "waitlisted",          label: "Đưa vào danh sách chờ" },
  { value: "rejected_or_not_fit", label: "Không phù hợp / từ chối" },
  { value: "under_data_check",    label: "Cần kiểm tra dữ liệu" },
  { value: "needs_more_review",   label: "Cần review thêm" },
  { value: "withdrawn",           label: "Ứng viên rút đơn" },
  { value: "interview_scheduled", label: "Đã đặt lịch phỏng vấn" },
  { value: "interview_passed", label: "Qua vòng phỏng vấn" }
];

/**
 * Suffix appended to a lifecycle option the database gate will refuse today.
 * The option stays in the list — it is still the next lifecycle action, the
 * operator just cannot take it yet — so it is rendered disabled and labelled
 * rather than removed.
 */
export const BLOCKED_OPTION_SUFFIX = " — chưa đủ review";

// Decision options that require at least one submitted profile_screening review.
const PROFILE_REVIEW_GATED = new Set(["screening_passed", "invited_to_interview"]);

// Decision options that require at least one submitted interview review.
const INTERVIEW_REVIEW_GATED = new Set(["interview_passed"]);

// Application statuses where the profile-stage guidance block is relevant.
const PROFILE_STAGE_STATUSES = new Set([
  "submitted", "ready_for_screening", "under_data_check",
  "screening_completed", "needs_admin_review", "needs_more_review",
]);

/**
 * Application statuses where the interview-stage guidance block is relevant.
 *
 * `screening_passed` is deliberately absent: at that point the next operational
 * step is the interview *invitation*, not an interview review, so it gets the
 * handoff block below instead. Legacy records already sitting at
 * `invited_to_interview` therefore see interview-stage guidance and are never
 * pushed back into profile screening.
 */
const INTERVIEW_STAGE_STATUSES = new Set([
  "invited_to_interview", "interview_scheduled",
  "interview_in_progress", "interview_completed", "ready_for_final_decision",
  "needs_more_review",
]);

const ASSIGN_SURFACE_ANCHOR = "#assign-review-card";

const CTA_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50";

// ---------------------------------------------------------------------------
// Review gate guidance block
// ---------------------------------------------------------------------------

function ReviewGateGuidance({
  gate,
  canAssign
}: {
  gate: ReviewGateState;
  canAssign: boolean;
}) {
  const isProfile = gate.stage === "profile";
  const stageNoun = isProfile ? "hồ sơ" : "phỏng vấn";
  const assignLabel = isProfile ? "Giao review hồ sơ" : "Giao review phỏng vấn";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={`review-gate-${gate.stage}`}
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800"
    >
      <p className="font-medium">
        {`Chưa đủ đánh giá ${stageNoun} để ra quyết định.`}
      </p>
      <p className="mt-1 text-amber-700">
        Đã nộp {gate.submittedCount}/{gate.requiredCount} đánh giá {stageNoun}. Đánh giá
        đang mở hoặc mới lưu nháp không được tính — chỉ đánh giá đã SUBMIT mới tính.
      </p>

      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-amber-700">
        <div>
          <dt className="inline font-medium">Trạng thái phân công: </dt>
          <dd className="inline">{ASSIGNMENT_STATE_LABEL[gate.assignmentState]}</dd>
        </div>
        {gate.activeReview && (
          <div>
            <dt className="inline font-medium">Người phụ trách: </dt>
            <dd className="inline">
              {gate.activeReview.reviewerName ?? "Không xác định"}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {gate.cta === "assign" &&
          (canAssign ? (
            <a href={ASSIGN_SURFACE_ANCHOR} className={CTA_CLASS}>
              {assignLabel} ↑
            </a>
          ) : (
            <span className="text-xs text-amber-700">
              {assignLabel}: liên hệ admin / core team để phân công.
            </span>
          ))}

        {gate.cta === "open_mine" && gate.myOpenReviewId && (
          <a href={`/reviews/${gate.myOpenReviewId}`} className={CTA_CLASS}>
            Mở đánh giá của tôi →
          </a>
        )}

        {gate.cta === "await_other" && (
          <>
            <span className="text-xs text-amber-700">
              Đánh giá đang do{" "}
              <strong className="font-medium">
                {gate.otherReviewerName ?? "Không xác định"}
              </strong>{" "}
              phụ trách ({ASSIGNMENT_STATE_LABEL[gate.assignmentState]}). Bạn không
              chỉnh sửa đánh giá của người khác.
            </span>
            {canAssign && (
              <a href={ASSIGN_SURFACE_ANCHOR} className={CTA_CLASS}>
                Chỉnh sửa phân công ↑
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interview handoff — screening_passed → invited_to_interview
// ---------------------------------------------------------------------------

function InterviewHandoff() {
  return (
    <div
      role="status"
      data-testid="interview-handoff"
      className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-800"
    >
      <p className="font-medium">Bước tiếp theo: Mời phỏng vấn</p>
      <p className="mt-1 text-sky-700">
        Hồ sơ đã qua vòng hồ sơ. Chọn &ldquo;Mời phỏng vấn&rdquo; bên dưới, hoặc dùng
        màn hình mời hàng loạt để xử lý nhiều đơn cùng lúc.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submit button
// ---------------------------------------------------------------------------

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:opacity-50"
    >
      {pending ? "Đang lưu…" : "Ghi nhận quyết định"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type DecisionFormProps = {
  applicationId: string;
  currentStatus: string | null;
  /** Mirror of the database profile_screening minimum-review gate. */
  profileGate: ReviewGateState;
  /** Mirror of the database interview minimum-review gate. */
  interviewGate: ReviewGateState;
  /** Whether the assignment surface is rendered on this page for this actor. */
  canAssignReview: boolean;
  latestRecommendation?: string | null;
  latestTotalScore?: number | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DecisionForm({
  applicationId,
  currentStatus,
  profileGate,
  interviewGate,
  canAssignReview,
  latestRecommendation,
  latestTotalScore
}: DecisionFormProps) {
  const [state, action] = useFormState(
    updateApplicationDecisionAction,
    initialDecisionActionState
  );
  const [selectedStatus, setSelectedStatus] = useState("");

  const hasSubmittedReview =
    profileGate.submittedCount > 0 || interviewGate.submittedCount > 0;
  const isDestructive = DESTRUCTIVE_DECISION_STATUSES.has(selectedStatus);
  const selectedLabel = DECISION_OPTIONS.find((o) => o.value === selectedStatus)?.label ?? selectedStatus;

  // Show profile-stage guidance when status is in profile stage AND the profile
  // minimum is not met.
  const showProfileGuidance =
    !profileGate.met && !!currentStatus && PROFILE_STAGE_STATUSES.has(currentStatus);

  // Show interview-stage guidance when status is in interview stage AND the
  // interview minimum is not met.
  // Guard against needs_more_review edge (can appear in either stage) — profile guidance takes priority.
  const showInterviewGuidance =
    !interviewGate.met &&
    !!currentStatus &&
    INTERVIEW_STAGE_STATUSES.has(currentStatus) &&
    !showProfileGuidance;

  // Once screening has passed, the next operational step is the invitation.
  const showInterviewHandoff = currentStatus === "screening_passed";

  function isOptionBlocked(value: string): boolean {
    if (PROFILE_REVIEW_GATED.has(value) && !profileGate.met) return true;
    if (INTERVIEW_REVIEW_GATED.has(value) && !interviewGate.met) return true;
    return false;
  }

  return (
    <div className="space-y-4">
      {/* Action feedback banner */}
      {state.message && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      )}

      {/* Context: current status + latest review summary */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium uppercase text-slate-500">Trạng thái hiện tại</div>
          <div className="mt-1 text-sm font-medium text-vam-ink">
            {currentStatus ?? "-"}
          </div>
        </div>
        <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium uppercase text-slate-500">Review mới nhất</div>
          <div className="mt-1 text-sm text-vam-ink">
            {hasSubmittedReview ? (
              <>
                {latestRecommendation ?? "-"}
                {latestTotalScore !== null && latestTotalScore !== undefined
                  ? ` · Điểm: ${latestTotalScore}`
                  : ""}
              </>
            ) : (
              <span className="text-slate-400 italic">Chưa có review được nộp</span>
            )}
          </div>
        </div>
      </div>

      {/* Structured guidance when profile review minimum not met */}
      {showProfileGuidance && (
        <ReviewGateGuidance gate={profileGate} canAssign={canAssignReview} />
      )}

      {/* Structured guidance when interview review minimum not met */}
      {showInterviewGuidance && (
        <ReviewGateGuidance gate={interviewGate} canAssign={canAssignReview} />
      )}

      {/* Next operational step after screening_passed */}
      {showInterviewHandoff && <InterviewHandoff />}

      {/* Decision form */}
      <form action={action} className="space-y-3">
        <input type="hidden" name="application_id" value={applicationId} />
        <input
          type="hidden"
          name="previous_status"
          value={currentStatus ?? ""}
        />

        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Quyết định <span className="text-red-500">*</span>
          </label>
          <select
            name="new_status"
            required
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="" disabled>-- Chọn quyết định --</option>
            {DECISION_OPTIONS.map((opt) => {
              const blocked = isOptionBlocked(opt.value);
              return (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={blocked}
                  title={blocked ? "Chưa đủ số đánh giá đã nộp cho vòng này." : undefined}
                >
                  {blocked ? `${opt.label}${BLOCKED_OPTION_SUFFIX}` : opt.label}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Ghi chú (tuỳ chọn)
          </label>
          <textarea
            name="decision_note"
            rows={3}
            placeholder="Lý do, ghi chú thêm về quyết định này…"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-vam-green"
          />
        </div>

        {isDestructive ? (
          <ConfirmActionDialog
            triggerLabel="Ghi nhận quyết định"
            pendingLabel="Đang lưu…"
            title="Xác nhận quyết định"
            description={`Bạn đang chọn: "${selectedLabel}". Đây là quyết định có tính kết thúc cho hồ sơ ứng viên này. Vui lòng xác nhận trước khi ghi nhận.`}
            confirmLabel="Xác nhận"
            triggerClassName="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
          />
        ) : (
          <SubmitButton />
        )}
      </form>
    </div>
  );
}
