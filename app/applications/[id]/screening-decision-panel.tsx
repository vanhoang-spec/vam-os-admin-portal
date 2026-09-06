"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateApplicationDecisionAction } from "@/app/actions/application-decisions";
import { ConfirmActionDialog } from "@/components/action-feedback";
import { initialDecisionActionState } from "@/lib/decision-action-types";
import { DIRECT_INVITE_REASON_MESSAGE } from "@/lib/direct-interview-eligibility";
import {
  ASSIGNMENT_STATE_LABEL,
  BLOCKED_CHOICE_SUFFIX,
  SCREENING_DECISION_CHOICES,
  allScreeningChoicesBlocked,
  isScreeningChoiceBlocked,
  primaryBlockedReason,
  screeningChoiceEvaluation,
  type ScreeningDecisionState
} from "@/lib/screening-decision";

/**
 * The profile-round decision, as ONE Core Team action.
 *
 * Core Team used to record "Qua vòng hồ sơ" and then "Mời phỏng vấn" for a
 * single judgement. This surface offers the three decisions that actually carry
 * judgement — invite, ask for more, reject — and nothing else.
 *
 * Every enabled/disabled state below comes from the database's own eligibility
 * function, carried in `state.eligibility`. This component never decides what
 * the server would allow; it only says so.
 */

const ASSIGN_ANCHOR = "#assign-review-card";

const CTA_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50";

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Đang lưu…" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Evidence — one block per submitted review, never averaged
// ---------------------------------------------------------------------------

function EvidencePanel({ state }: { state: ScreeningDecisionState }) {
  if (!state.evidence.length) return null;
  return (
    <section data-testid="screening-evidence" className="grid gap-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Đánh giá hồ sơ đã nộp ({state.evidence.length})
      </h3>
      {state.evidence.map((row) => (
        <article
          key={row.reviewId}
          data-testid="screening-evidence-row"
          className="rounded-md border border-vam-line bg-white px-3 py-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-vam-ink">{row.reviewerName}</span>
            <span className="text-xs text-slate-500">
              {row.submittedAt ? `Nộp: ${row.submittedAt}` : "Đã nộp"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span>
              <span className="text-slate-500">Đề xuất: </span>
              <strong className="font-medium text-vam-ink">{row.recommendationLabel}</strong>
            </span>
            <span>
              <span className="text-slate-500">Điểm tổng: </span>
              <strong className="font-medium text-vam-ink tabular-nums">
                {row.totalScore ?? "—"}
              </strong>
            </span>
          </div>

          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {row.components.map((component) => (
              <div key={component.label}>
                <dt className="inline">{component.label}: </dt>
                <dd className="inline tabular-nums">{component.value ?? "—"}</dd>
              </div>
            ))}
          </dl>

          {row.reviewerNote ? (
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
              {row.reviewerNote}
            </p>
          ) : null}
        </article>
      ))}
      {state.evidence.length > 1 ? (
        <p className="text-xs text-slate-500">
          Mỗi đánh giá hiển thị riêng. Hệ thống không tính trung bình đề xuất của các
          reviewer.
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Guidance — shown while the server would refuse the decision Core Team wants
// ---------------------------------------------------------------------------

function Guidance({
  state,
  canAssign
}: {
  state: ScreeningDecisionState;
  canAssign: boolean;
}) {
  const reason = primaryBlockedReason(state);
  const unknown = reason === "eligibility_unknown";
  const showAssignCta = !state.myOpenReviewId && !state.otherActiveReviews.length;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="screening-gate"
      className={`rounded-md border px-3 py-3 text-sm ${
        unknown
          ? "border-red-300 bg-red-50 text-red-900"
          : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <p className="font-medium">
        {unknown ? "Không xác định được điều kiện quyết định." : "Chưa đủ review hồ sơ để quyết định."}
      </p>
      <p className="mt-1">{DIRECT_INVITE_REASON_MESSAGE[reason]}</p>

      {!unknown ? (
        <>
          <p className="mt-1 text-amber-700">
            Đã nộp {state.submittedCount}/{state.requiredCount ?? "?"} đánh giá hồ sơ. Đánh giá
            đang mở hoặc mới lưu nháp không được tính — chỉ đánh giá đã nộp mới tính.
          </p>

          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-amber-700">
            <div>
              <dt className="inline font-medium">Trạng thái phân công: </dt>
              <dd className="inline">{ASSIGNMENT_STATE_LABEL[state.assignmentState]}</dd>
            </div>
          </dl>

          {state.otherActiveReviews.length ? (
            <ul data-testid="screening-other-reviewers" className="mt-2 grid gap-1 text-xs text-amber-700">
              {state.otherActiveReviews.map((row) => (
                <li key={row.id}>
                  Đang do <strong className="font-medium">{row.reviewerName}</strong> phụ trách (
                  {row.statusLabel}). Bạn không chỉnh sửa đánh giá của người khác.
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {state.myOpenReviewId ? (
              <a href={`/reviews/${state.myOpenReviewId}`} className={CTA_CLASS}>
                Mở đánh giá của tôi →
              </a>
            ) : null}

            {showAssignCta &&
              (canAssign ? (
                <a href={ASSIGN_ANCHOR} className={CTA_CLASS}>
                  Giao review hồ sơ ↑
                </a>
              ) : (
                <span className="text-xs text-amber-700">
                  Giao review hồ sơ: liên hệ admin / core team để phân công.
                </span>
              ))}

            {!showAssignCta && !state.myOpenReviewId && canAssign ? (
              <a href={ASSIGN_ANCHOR} className={CTA_CLASS}>
                Chỉnh sửa phân công ↑
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export type ScreeningDecisionPanelProps = {
  applicationId: string;
  currentStatus: string | null;
  state: ScreeningDecisionState;
  canAssignReview: boolean;
};

export function ScreeningDecisionPanel({
  applicationId,
  currentStatus,
  state,
  canAssignReview
}: ScreeningDecisionPanelProps) {
  const [formState, action] = useFormState(
    updateApplicationDecisionAction,
    initialDecisionActionState
  );
  const [selected, setSelected] = useState("");

  const choice = SCREENING_DECISION_CHOICES.find((c) => c.value === selected);
  const isDestructive = Boolean(choice?.destructive);
  const nothingAvailable = allScreeningChoicesBlocked(state);

  return (
    <div className="space-y-4">
      {formState.message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            formState.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {formState.message}
        </div>
      ) : null}

      <EvidencePanel state={state} />

      {nothingAvailable ? <Guidance state={state} canAssign={canAssignReview} /> : null}

      <form action={action} className="space-y-3">
        <input type="hidden" name="application_id" value={applicationId} />
        <input type="hidden" name="previous_status" value={currentStatus ?? ""} />

        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Quyết định vòng hồ sơ <span className="text-red-500">*</span>
          </label>
          <select
            name="new_status"
            required
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            data-testid="screening-decision-select"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="" disabled>
              -- Chọn quyết định --
            </option>
            {SCREENING_DECISION_CHOICES.map((option) => {
              const blocked = isScreeningChoiceBlocked(option.value, state);
              const evaluation = screeningChoiceEvaluation(option.value, state);
              return (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={blocked}
                  title={blocked ? DIRECT_INVITE_REASON_MESSAGE[evaluation.reason] : undefined}
                >
                  {blocked ? `${option.label}${BLOCKED_CHOICE_SUFFIX}` : option.label}
                </option>
              );
            })}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Chọn xong là xong — không cần bước &ldquo;qua vòng hồ sơ&rdquo; riêng nữa.
          </p>
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
            description={`Bạn đang chọn: "${choice?.label}". Đây là quyết định có tính kết thúc cho hồ sơ ứng viên này. Vui lòng xác nhận trước khi ghi nhận.`}
            confirmLabel="Xác nhận"
            triggerClassName="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
          />
        ) : (
          <SubmitButton label="Ghi nhận quyết định" disabled={nothingAvailable} />
        )}
      </form>
    </div>
  );
}
