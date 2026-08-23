'use client';

import { useActionState, useState } from 'react';
import { unassignApplicationReviewAction } from '@/app/actions/application-reviews';
import { LoadingButton } from '@/components/action-feedback';

export function UnassignReviewButton({ reviewId, applicationId }: { reviewId: string, applicationId: string }) {
  const [state, formAction] = useActionState(unassignApplicationReviewAction, { ok: false, message: '' });
  const [showConfirm, setShowConfirm] = useState(false);

  if (showConfirm) {
    return (
      <form action={formAction} className="inline-flex items-center gap-2">
        <input type="hidden" name="review_id" value={reviewId} />
        <input type="hidden" name="application_id" value={applicationId} />
        <input type="text" name="cancel_reason" placeholder="Lý do hủy..." required className="text-xs px-2 py-1 rounded border border-vam-line w-32" />
        <LoadingButton pendingLabel="Hủy..." className="h-6 rounded bg-red-600 text-white text-xs px-2 hover:bg-red-700">Xác nhận</LoadingButton>
        <button type="button" className="h-6 text-xs px-2 text-slate-600 hover:text-slate-900" onClick={() => setShowConfirm(false)}>Hủy</button>
        {!state?.ok && state?.message && <span className="text-red-500 text-xs ml-1">{state.message}</span>}
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowConfirm(true)}
      className="inline-flex h-6 items-center rounded border border-red-200 bg-white text-xs px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
    >
      Hủy giao
    </button>
  );
}
