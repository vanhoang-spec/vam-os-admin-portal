"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { handleReviewFormAction } from "@/app/actions/application-reviews";
import {
  initialReviewActionState
} from "@/lib/review-action-types";
import type { ReviewActionState } from "@/lib/review-action-types";

// ---------------------------------------------------------------------------
// Score radio group (1–5)
// ---------------------------------------------------------------------------

function ScoreRadio({
  name,
  label,
  defaultValue,
  disabled,
  onPick
}: {
  name: string;
  label: string;
  defaultValue?: number | null;
  disabled?: boolean;
  onPick?: (value: number) => void;
}) {
  return (
    <fieldset className="rounded-md border border-vam-line bg-slate-50 px-3 py-2.5">
      <legend className="px-1 text-xs font-medium uppercase text-slate-500">{label}</legend>
      <div className="mt-2 flex gap-4">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="flex cursor-pointer flex-col items-center gap-1">
            <input
              type="radio"
              name={name}
              value={String(n)}
              defaultChecked={defaultValue === n}
              disabled={disabled}
              onChange={() => onPick?.(n)}
              className="accent-vam-green"
            />
            <span className="text-xs font-medium text-slate-600">{n}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Action banner
// ---------------------------------------------------------------------------

function ActionBanner({ state }: { state: ReviewActionState }) {
  if (!state.message) return null;
  return (
    <div
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${
        state.ok
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {state.message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submit buttons — reads pending state from nearest <form>
// ---------------------------------------------------------------------------

function FormButtons({ isSubmitted }: { isSubmitted: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-3 border-t border-vam-line pt-4">
      {!isSubmitted && (
        <>
          <button
            type="submit"
            name="_intent"
            value="draft"
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-vam-line bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {pending ? "Đang lưu…" : "Lưu nháp"}
          </button>
          <button
            type="submit"
            name="_intent"
            value="submit"
            disabled={pending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:opacity-50"
          >
            {pending ? "Đang nộp…" : "Nộp Review"}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export type ReviewFormProps = {
  reviewId: string;
  /** "profile_screening" | "interview" — controls recommendation options. */
  reviewRound?: string | null;
  isSubmitted: boolean;
  defaultScoreMotivation?: number | null;
  defaultScoreGoalClarity?: number | null;
  defaultScoreCommitment?: number | null;
  defaultScoreFit?: number | null;
  defaultScoreCommunication?: number | null;
  defaultRecommendation?: string | null;
  defaultReviewerNote?: string | null;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewForm({
  reviewId,
  reviewRound,
  isSubmitted,
  defaultScoreMotivation,
  defaultScoreGoalClarity,
  defaultScoreCommitment,
  defaultScoreFit,
  defaultScoreCommunication,
  defaultRecommendation,
  defaultReviewerNote
}: ReviewFormProps) {
  const isInterview = reviewRound === "interview";
  const [state, action] = useFormState(
    handleReviewFormAction,
    initialReviewActionState
  );

  /**
   * Running total of the five scores.
   *
   * The server stores `total_score` as the plain sum, but it only ever
   * appeared after submitting — so a reviewer weighing whether a borderline
   * application clears the bar had to add five numbers in their head, on every
   * application. Kept uncontrolled: each radio reports its pick, the inputs
   * stay the DOM's, and nothing about how the form submits changes.
   */
  const [scores, setScores] = useState<Record<string, number>>(() => {
    const seeded: Record<string, number> = {};
    if (typeof defaultScoreMotivation === "number") seeded.score_motivation = defaultScoreMotivation;
    if (typeof defaultScoreGoalClarity === "number") seeded.score_goal_clarity = defaultScoreGoalClarity;
    if (typeof defaultScoreCommitment === "number") seeded.score_commitment = defaultScoreCommitment;
    if (typeof defaultScoreFit === "number") seeded.score_fit = defaultScoreFit;
    if (typeof defaultScoreCommunication === "number") seeded.score_communication = defaultScoreCommunication;
    return seeded;
  });
  const pick = (field: string) => (value: number) =>
    setScores((previous) => ({ ...previous, [field]: value }));

  const scored = Object.values(scores);
  const total = scored.reduce((sum, value) => sum + value, 0);
  const remaining = 5 - scored.length;

  return (
    <div>
      <ActionBanner state={state} />

      {isSubmitted && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Review đã được submit. Nội dung hiển thị bên dưới ở chế độ chỉ đọc.
        </div>
      )}

      <form action={action} className="space-y-4">
        <input type="hidden" name="review_id" value={reviewId} />

        {/* Score grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ScoreRadio
            onPick={pick("score_motivation")}
            name="score_motivation"
            label="Động lực (1–5)"
            defaultValue={defaultScoreMotivation}
            disabled={isSubmitted}
          />
          <ScoreRadio
            onPick={pick("score_goal_clarity")}
            name="score_goal_clarity"
            label="Rõ ràng mục tiêu (1–5)"
            defaultValue={defaultScoreGoalClarity}
            disabled={isSubmitted}
          />
          <ScoreRadio
            onPick={pick("score_commitment")}
            name="score_commitment"
            label="Cam kết (1–5)"
            defaultValue={defaultScoreCommitment}
            disabled={isSubmitted}
          />
          <ScoreRadio
            onPick={pick("score_fit")}
            name="score_fit"
            label="Phù hợp chương trình (1–5)"
            defaultValue={defaultScoreFit}
            disabled={isSubmitted}
          />
          <ScoreRadio
            onPick={pick("score_communication")}
            name="score_communication"
            label="Giao tiếp (1–5)"
            defaultValue={defaultScoreCommunication}
            disabled={isSubmitted}
          />
        </div>

        {/*
          Sits directly under the five inputs, where the question "does this
          add up to enough?" is actually asked.
        */}
        <div
          data-testid="review-score-total"
          className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-vam-line bg-vam-mint px-3 py-2.5"
        >
          <span className="text-xs font-semibold uppercase text-slate-600">Tổng điểm</span>
          <span className="text-sm text-slate-600">
            <b className="text-lg font-semibold tabular-nums text-vam-ink">{total}</b>
            <span className="ml-1 text-vam-ink">/ 25</span>
            {remaining > 0 ? (
              <span className="ml-2 text-slate-500">còn {remaining} tiêu chí chưa chấm</span>
            ) : null}
          </span>
        </div>

        {/* Recommendation */}
        <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2.5">
          <label className="block text-xs font-medium uppercase text-slate-500">
            Đề xuất kết quả <span className="text-red-500">*</span>
          </label>
          <select
            name="recommendation"
            defaultValue={defaultRecommendation ?? ""}
            disabled={isSubmitted}
            className="mt-2 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green disabled:bg-slate-100 disabled:text-slate-500"
          >
            <option value="">-- Chọn kết quả --</option>
            {isInterview ? (
              <>
                <option value="approve_recommended">Đề xuất duyệt</option>
                <option value="waitlist">Danh sách chờ</option>
                <option value="reject">Không phù hợp / từ chối</option>
                <option value="needs_admin_review">Cần core team xem thêm</option>
              </>
            ) : (
              <>
                <option value="pass_to_interview">Mời vào vòng phỏng vấn</option>
                <option value="waitlist">Đưa vào danh sách chờ</option>
                <option value="reject">Không phù hợp / từ chối</option>
                <option value="needs_admin_review">Cần core team/admin xem thêm</option>
              </>
            )}
          </select>
        </div>

        {/* Reviewer note */}
        <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2.5">
          <label className="block text-xs font-medium uppercase text-slate-500">
            Ghi chú reviewer
          </label>
          <textarea
            name="reviewer_note"
            rows={4}
            defaultValue={defaultReviewerNote ?? ""}
            disabled={isSubmitted}
            placeholder="Nhận xét, ghi chú về ứng viên này…"
            className="mt-2 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-vam-green disabled:bg-slate-100 disabled:text-slate-500"
          />
        </div>

        <FormButtons isSubmitted={isSubmitted} />
      </form>
    </div>
  );
}
