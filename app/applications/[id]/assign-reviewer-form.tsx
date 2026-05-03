"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  assignApplicationReviewAction,
  initialReviewActionState
} from "@/app/actions/application-reviews";
import type { AdminUserPublic } from "@/lib/types";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:opacity-50"
    >
      {pending ? "Đang giao…" : "Giao Review"}
    </button>
  );
}

export function AssignReviewerForm({
  applicationId,
  reviewers
}: {
  applicationId: string;
  reviewers: AdminUserPublic[];
}) {
  const [state, action] = useFormState(
    assignApplicationReviewAction,
    initialReviewActionState
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="application_id" value={applicationId} />

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

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Reviewer */}
        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Reviewer <span className="text-red-500">*</span>
          </label>
          <select
            name="reviewer_admin_user_id"
            required
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="">-- Chọn reviewer --</option>
            {reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name ?? r.email} ({r.role})
              </option>
            ))}
          </select>
        </div>

        {/* Review round */}
        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Vòng review <span className="text-red-500">*</span>
          </label>
          <select
            name="review_round"
            required
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="profile_screening">Hồ sơ (Profile Screening)</option>
            <option value="interview">Phỏng vấn (Interview)</option>
          </select>
        </div>

        {/* Due date */}
        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Hạn nộp (tuỳ chọn)
          </label>
          <input
            type="date"
            name="due_at"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          />
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
