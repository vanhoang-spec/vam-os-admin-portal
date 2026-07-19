"use client";

import { useFormState } from "react-dom";
import { correctMentoringRecapAction, type CorrectionActionState } from "@/app/actions/activity-corrections";
import type { MentoringRecap } from "@/lib/types";

const initialState: CorrectionActionState = {
  ok: false,
  message: null
};

export function RecapCorrectionForm({ recap, personId, correctedByDefault }: { recap: MentoringRecap; personId?: string | null; correctedByDefault?: string }) {
  const [state, formAction] = useFormState(correctMentoringRecapAction, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="id" value={recap.id} />
      <input type="hidden" name="person_id" value={personId ?? ""} />

      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">meeting_date</span>
        <input
          name="meeting_date"
          type="date"
          defaultValue={String(recap.meeting_date ?? "").slice(0, 10)}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">status</span>
        <select
          name="status"
          defaultValue={String(recap.status ?? "submitted")}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        >
          <option value="submitted">submitted</option>
          <option value="needs_review">needs_review</option>
          <option value="invalid">invalid</option>
          <option value="duplicate">duplicate</option>
          <option value="excluded">excluded (sync-managed)</option>
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">issue_flag</span>
        <select
          name="issue_flag"
          defaultValue={recap.issue_flag === true ? "true" : "false"}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">admin_notes</span>
        <textarea
          name="admin_notes"
          defaultValue={String(recap.admin_notes ?? "")}
          rows={4}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">reason</span>
        <textarea
          name="reason"
          rows={3}
          placeholder="Lý do chỉnh sửa"
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">corrected_by</span>
        <input
          name="corrected_by"
          defaultValue={correctedByDefault ?? "admin"}
          placeholder="admin"
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
        Lưu correction
      </button>
    </form>
  );
}
