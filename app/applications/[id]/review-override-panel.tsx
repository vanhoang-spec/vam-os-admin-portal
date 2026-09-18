"use client";

import React, { useState } from "react";
import { useFormState } from "react-dom";
import { overrideApplicationReviewAction } from "@/app/actions/application-reviews";
import { SubmitButton } from "@/components/submit-button";
import { initialReviewActionState } from "@/lib/review-action-types";

/**
 * Khung ban tổ chức sửa nội dung bài chấm.
 *
 * Cố ý tách khỏi ô chấm của reviewer ở `/reviews/[id]`: ô kia là chỗ người được giao
 * tự chấm bài của mình, còn đây là chỗ ban tổ chức sửa bài của người khác, kể cả bài
 * đã nộp. Gộp hai thứ vào một ô là mời người ta nhầm mình đang làm việc nào.
 *
 * Mỗi bài một form riêng và mặc định đóng lại: mở cả năm ô điểm của mọi bài chấm cùng
 * lúc là cách nhanh nhất để sửa nhầm sang bài của người khác.
 */
const SCORE_FIELDS = [
  { name: "score_motivation", label: "Động lực" },
  { name: "score_goal_clarity", label: "Mục tiêu rõ ràng" },
  { name: "score_commitment", label: "Cam kết" },
  { name: "score_fit", label: "Mức phù hợp" },
  { name: "score_communication", label: "Giao tiếp" }
] as const;

const RECOMMENDATIONS = [
  { value: "pass_to_interview", label: "Nên mời phỏng vấn" },
  { value: "approve_recommended", label: "Nên nhận" },
  { value: "waitlist", label: "Danh sách chờ" },
  { value: "reject", label: "Không phù hợp" },
  { value: "needs_admin_review", label: "Cần Core Team xem thêm" }
] as const;

export type OverridableReview = {
  id: string;
  roundLabel: string;
  reviewerName: string;
  statusLabel: string;
  scoreMotivation: number | null;
  scoreGoalClarity: number | null;
  scoreCommitment: number | null;
  scoreFit: number | null;
  scoreCommunication: number | null;
  totalScore: number | null;
  recommendation: string | null;
  reviewerNote: string | null;
};

function ReviewOverrideForm({
  applicationId,
  review
}: {
  applicationId: string;
  review: OverridableReview;
}) {
  const [state, action] = useFormState(overrideApplicationReviewAction, initialReviewActionState);
  const [open, setOpen] = useState(false);
  const defaults: Record<string, number | null> = {
    score_motivation: review.scoreMotivation,
    score_goal_clarity: review.scoreGoalClarity,
    score_commitment: review.scoreCommitment,
    score_fit: review.scoreFit,
    score_communication: review.scoreCommunication
  };

  return (
    <section
      data-review-override-id={review.id}
      className="rounded-md border border-vam-line bg-slate-50 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <strong className="text-vam-ink">{review.roundLabel}</strong>
          <span className="ml-2 text-slate-600">
            {review.reviewerName} · {review.statusLabel}
            {review.totalScore !== null ? ` · ${review.totalScore} điểm` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint"
        >
          {open ? "Đóng" : "Sửa bài chấm"}
        </button>
      </div>

      {open ? (
        <form action={action} className="mt-3 grid gap-3">
          <input type="hidden" name="review_id" value={review.id} />
          <input type="hidden" name="application_id" value={applicationId} />

          <div className="grid gap-2 sm:grid-cols-5">
            {SCORE_FIELDS.map((field) => (
              <label key={field.name} className="text-xs text-slate-600">
                {field.label}
                <input
                  name={field.name}
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  defaultValue={defaults[field.name] ?? ""}
                  className="mt-1 w-full rounded-md border border-vam-line px-2 py-2 text-sm"
                />
              </label>
            ))}
          </div>

          <label className="text-sm">
            Đề xuất
            <select
              name="recommendation"
              required
              defaultValue={review.recommendation ?? ""}
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            >
              <option value="" disabled>
                — Chọn đề xuất —
              </option>
              {RECOMMENDATIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            Nhận xét
            <textarea
              name="reviewer_note"
              rows={3}
              defaultValue={review.reviewerNote ?? ""}
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            />
          </label>

          <p className="text-xs text-slate-500">
            Ô để trống nghĩa là không chấm mục đó. Mỗi lần sửa đều ghi lại người sửa và giá trị
            trước đó; điểm tổng và trạng thái vòng chấm của hồ sơ được tính lại ngay.
          </p>

          <SubmitButton
            className="justify-self-start px-3 py-2 text-sm font-medium"
            pendingText="Đang lưu..."
          >
            Lưu bài chấm
          </SubmitButton>

          {state.message ? (
            <p
              role="status"
              className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}
            >
              {state.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

export function ReviewOverridePanel({
  applicationId,
  reviews
}: {
  applicationId: string;
  reviews: OverridableReview[];
}) {
  if (!reviews.length) return null;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-slate-600">
        Sửa điểm, đề xuất và nhận xét của một bài chấm — kể cả bài đã nộp. Bài đã huỷ thì không
        sửa được.
      </p>
      {reviews.map((review) => (
        <ReviewOverrideForm key={review.id} applicationId={applicationId} review={review} />
      ))}
    </div>
  );
}
