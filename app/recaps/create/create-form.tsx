"use client";

import { useFormState } from "react-dom";
import { createMentoringRecapAction, type CorrectionActionState } from "@/app/actions/activity-corrections";

const initialState: CorrectionActionState = {
  ok: false,
  message: null
};

export function RecapCreateForm({ 
  seasons, 
  matches, 
  people 
}: { 
  seasons: { id: string; code: string | null }[], 
  matches: { id: string; mentor_person_id: string | null; mentee_person_id: string | null }[],
  people: { id: string; email_primary: string | null; full_name: string | null }[]
}) {
  const [state, formAction] = useFormState(createMentoringRecapAction, initialState);

  return (
    <form action={formAction} className="grid gap-4">
      {state.message ? (
        <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">season_code (*)</span>
          <select
            name="season_code"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            required
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.code || ""}>{s.code}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">meeting_date (*)</span>
          <input
            name="meeting_date"
            type="date"
            required
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">mentor_person_id</span>
          <select
            name="mentor_person_id"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="">-- Chọn Mentor --</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email_primary}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">mentee_person_id</span>
          <select
            name="mentee_person_id"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="">-- Chọn Mentee --</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.full_name || p.email_primary}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">match_id</span>
          <select
            name="match_id"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="">-- Chọn Match --</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>{m.id.slice(0, 8)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">meeting_type</span>
          <select
            name="meeting_type"
            defaultValue="1on1_primary"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="1on1_primary">1on1_primary</option>
            <option value="1on1_cross">1on1_cross</option>
            <option value="group_training">group_training</option>
            <option value="other">other</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">status</span>
          <select
            name="status"
            defaultValue="submitted"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          >
            <option value="submitted">submitted</option>
            <option value="needs_review">needs_review</option>
            <option value="invalid">invalid</option>
            <option value="duplicate">duplicate</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">recap_url</span>
        <input
          name="recap_url"
          type="url"
          placeholder="https://..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">recap_note / summary</span>
        <textarea
          name="recap_note"
          rows={3}
          placeholder="Tóm tắt nội dung recap..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">issue_flag</span>
        <select
          name="issue_flag"
          defaultValue="false"
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
          rows={3}
          placeholder="Ghi chú nội bộ cho admin..."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>

      <div className="mt-4 flex gap-3">
        <button type="submit" disabled={state.ok} className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50">
          Tạo recap
        </button>
        {state.ok && (
          <a href="/data-issues" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Quay lại Data Issues
          </a>
        )}
      </div>
    </form>
  );
}
