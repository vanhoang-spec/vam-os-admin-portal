"use client";

import { useFormState } from "react-dom";
import { restoreWithdrawnApplicationAction } from "@/app/actions/application-decisions";
import { ConfirmActionDialog } from "@/components/action-feedback";
import { initialDecisionActionState } from "@/lib/decision-action-types";

export function RestoreWithdrawnForm({ applicationId }: { applicationId: string }) {
  const [state, action] = useFormState(
    restoreWithdrawnApplicationAction,
    initialDecisionActionState
  );

  return (
    <form action={action} className="mt-4 space-y-3 rounded-md border border-amber-300 bg-white p-4">
      <input type="hidden" name="application_id" value={applicationId} />
      {state.message ? (
        <div
          role={state.ok ? "status" : "alert"}
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      ) : null}
      <label className="block text-xs font-medium uppercase text-slate-600">
        Lý do nội bộ <span className="text-red-600">*</span>
        <textarea
          name="restore_reason"
          required
          minLength={3}
          rows={3}
          placeholder="Nêu lý do cần khôi phục hồ sơ…"
          className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm normal-case text-vam-ink"
        />
      </label>
      <ConfirmActionDialog
        triggerLabel="Khôi phục hồ sơ"
        pendingLabel="Đang khôi phục…"
        title="Xác nhận khôi phục hồ sơ"
        description="Hệ thống sẽ khôi phục đúng trạng thái trước lần rút gần nhất. Các phân công đã huỷ sẽ không được kích hoạt lại."
        confirmLabel="Xác nhận khôi phục"
        triggerClassName="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
        confirmClassName="bg-amber-600 text-white hover:bg-amber-700"
      />
    </form>
  );
}
