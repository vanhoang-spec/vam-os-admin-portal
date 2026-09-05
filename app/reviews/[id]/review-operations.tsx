"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  cancelApplicationReviewAction,
  reassignApplicationReviewAction
} from "@/app/actions/application-reviews";
import { initialReviewActionState } from "@/lib/review-action-types";
import type { ReviewEligibleReviewer } from "@/lib/types";

function CancelButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
    >
      {pending ? "Đang huỷ..." : "Huỷ Review này"}
    </button>
  );
}

function ReassignButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-vam-ink px-4 text-sm font-medium text-white hover:bg-vam-ink/90 disabled:opacity-50"
    >
      {pending ? "Đang đổi..." : "Đổi Người Review"}
    </button>
  );
}

export function ReviewOperations({
  reviewId,
  applicationId,
  isSubmitted,
  isCancelled,
  allowReassign,
  reviewers
}: {
  reviewId: string;
  applicationId: string;
  isSubmitted: boolean;
  isCancelled: boolean;
  allowReassign: boolean;
  reviewers: ReviewEligibleReviewer[];
}) {
  const [cancelState, cancelAction] = useFormState(
    cancelApplicationReviewAction,
    initialReviewActionState
  );

  const [reassignState, reassignAction] = useFormState(
    reassignApplicationReviewAction,
    initialReviewActionState
  );

  if (isSubmitted || isCancelled) return null;

  return (
    <div className="space-y-4">
      {/* Cancel section */}
      <form action={cancelAction} className="rounded-md border border-red-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-red-700">Huỷ Review</h3>
        <p className="mb-4 text-xs text-red-600/80">
          Huỷ giao review này. Không xoá dữ liệu nhưng sẽ đổi trạng thái thành &quot;Đã huỷ&quot;.
        </p>
        {cancelState.message && (
          <div className={`mb-3 text-sm ${cancelState.ok ? "text-green-600" : "text-red-600"}`}>
            {cancelState.message}
          </div>
        )}
        <input type="hidden" name="review_id" value={reviewId} />
        <input type="hidden" name="application_id" value={applicationId} />
        <input required minLength={3} name="reason" placeholder="Lý do huỷ" className="mb-3 block w-full rounded-md border border-vam-line px-3 py-2 text-sm" />
        <CancelButton />
      </form>

      {/* Reassign creates operational work and is never offered on a terminal parent. */}
      {allowReassign ? <form action={reassignAction} className="rounded-md border border-vam-line bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Đổi Người Review</h3>
        <p className="mb-4 text-xs text-slate-500">
          Huỷ review hiện tại và tạo review mới giao cho người bạn chọn.
        </p>
        {reassignState.message && (
          <div className={`mb-3 text-sm ${reassignState.ok ? "text-green-600" : "text-red-600"}`}>
            {reassignState.message}
          </div>
        )}
        <input type="hidden" name="review_id" value={reviewId} />
        <input type="hidden" name="application_id" value={applicationId} />
        <input required minLength={3} name="reason" placeholder="Lý do đổi người" className="block w-full rounded-md border border-vam-line px-3 py-2 text-sm" />
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 flex-col gap-1 min-w-[200px]">
            <label className="text-xs font-medium text-slate-500">Người review mới</label>
            <select
              name="new_reviewer_admin_user_id"
              required
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="">-- Chọn --</option>
              {reviewers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.full_name ?? r.email} ({r.role})
                </option>
              ))}
            </select>
          </div>
          <ReassignButton />
        </div>
      </form> : null}
    </div>
  );
}
