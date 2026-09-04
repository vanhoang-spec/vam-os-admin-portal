"use client";

import { useFormState, useFormStatus } from "react-dom";
import { assignApplicationReviewAction, cancelApplicationReviewAction } from "@/app/actions/application-reviews";
import { initialReviewActionState } from "@/lib/review-action-types";
import type { AdminUserPublic, ApplicationReview } from "@/lib/types";
import { staffDisplayLabel } from "@/lib/ui-labels";

function SubmitButton({ label, pendingLabel, variant = "primary" }: { label: string; pendingLabel: string; variant?: "primary" | "danger" | "secondary" }) {
  const { pending } = useFormStatus();
  
  let btnClass = "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium text-white disabled:opacity-50";
  if (variant === "primary") btnClass += " bg-vam-green hover:bg-vam-ink";
  if (variant === "secondary") btnClass += " bg-vam-ink hover:bg-vam-ink/90";
  if (variant === "danger") btnClass = "inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50";
  
  return (
    <button type="submit" disabled={pending} className={btnClass}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function reviewStatusLabel(status: string) {
  switch (status) {
    case "assigned": return "Chưa bắt đầu";
    case "in_progress": return "Đang làm";
    case "submitted": return "Đã nộp";
    case "returned_for_clarification": return "Cần làm rõ";
    case "cancelled": return "Đã huỷ";
    default: return status;
  }
}

function ActiveAssignmentCard({ 
  review, 
  reviewers,
  title 
}: { 
  review: ApplicationReview & { reviewer_name: string }; 
  reviewers: AdminUserPublic[];
  title: string;
}) {
  const [cancelState, cancelAction] = useFormState(cancelApplicationReviewAction, initialReviewActionState);

  return (
    <div className="rounded-md border border-vam-line bg-slate-50 p-4">
      <h3 className="mb-2 text-sm font-semibold text-vam-ink">{title}</h3>
      <div className="mb-4 space-y-1 text-sm text-slate-700">
        <div><span className="font-medium">Người phụ trách hiện tại:</span> {review.reviewer_name}</div>
        <div><span className="font-medium">Trạng thái:</span> {reviewStatusLabel(review.status)}</div>
        {review.due_at && <div><span className="font-medium">Hạn nộp:</span> {new Date(review.due_at).toLocaleDateString("vi-VN")}</div>}
      </div>

      <div className="mt-4">
        {/* Cancel form */}
        <form action={cancelAction} className="rounded-md border border-red-200 bg-white p-3">
          <h4 className="mb-2 text-xs font-semibold text-red-700">Huỷ phân công (Cancel)</h4>
          <p className="mb-3 text-xs italic text-slate-600">
            Để đổi người phụ trách, hãy huỷ phân công hiện tại rồi giao reviewer mới.
          </p>
          {cancelState.message && (
            <div className={`mb-3 text-xs ${cancelState.ok ? "text-green-600" : "text-red-600"}`}>
              {cancelState.message}
            </div>
          )}
          <input type="hidden" name="review_id" value={review.id} />
          <input type="hidden" name="application_id" value={review.application_id} />
          <input required minLength={3} name="reason" placeholder="Lý do huỷ (*)" className="mb-2 w-full rounded-md border border-vam-line px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400" />
          <SubmitButton label="Huỷ phân công" pendingLabel="Đang huỷ..." variant="danger" />
        </form>
      </div>
    </div>
  );
}

function AssignNewForm({
  applicationId,
  reviewers,
  round,
  title
}: {
  applicationId: string;
  reviewers: AdminUserPublic[];
  round: "profile_screening" | "interview";
  title: string;
}) {
  const [state, action] = useFormState(assignApplicationReviewAction, initialReviewActionState);

  return (
    <form action={action} className="rounded-md border border-vam-line bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-vam-ink">{title}</h3>
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="review_round" value={round} />
      
      {state.message && (
        <div className={`mb-3 rounded-md border px-3 py-2 text-sm ${state.ok ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {state.message}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 mb-3">
        <div>
          <label className="block text-xs font-medium uppercase text-slate-500 mb-1">
            Reviewer <span className="text-red-500">*</span>
          </label>
          <select
            name="reviewer_admin_user_id"
            required
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="">-- Chọn người phụ trách --</option>
            {reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {staffDisplayLabel({ adminFullName: r.full_name, email: r.email, role: r.role })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-slate-500 mb-1">
            Hạn nộp (tuỳ chọn)
          </label>
          <input
            type="date"
            name="due_at"
            className="w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          />
        </div>
      </div>
      <SubmitButton label="Giao Review" pendingLabel="Đang giao..." />
    </form>
  );
}

export function AssignmentControls({
  applicationId,
  profileReviewers,
  interviewers,
  activeProfileReview,
  activeInterviewReview
}: {
  applicationId: string;
  profileReviewers: AdminUserPublic[];
  interviewers: AdminUserPublic[];
  activeProfileReview?: ApplicationReview & { reviewer_name: string };
  activeInterviewReview?: ApplicationReview & { reviewer_name: string };
}) {
  return (
    <div className="space-y-6">
      <div>
        {activeProfileReview ? (
          <ActiveAssignmentCard 
            title="Đánh giá hồ sơ" 
            review={activeProfileReview} 
            reviewers={profileReviewers} 
          />
        ) : (
          <AssignNewForm 
            title="Đánh giá hồ sơ" 
            applicationId={applicationId} 
            reviewers={profileReviewers} 
            round="profile_screening" 
          />
        )}
      </div>

      <div>
        {activeInterviewReview ? (
          <ActiveAssignmentCard 
            title="Phỏng vấn" 
            review={activeInterviewReview} 
            reviewers={interviewers} 
          />
        ) : (
          <AssignNewForm 
            title="Phỏng vấn" 
            applicationId={applicationId} 
            reviewers={interviewers} 
            round="interview" 
          />
        )}
      </div>
    </div>
  );
}
