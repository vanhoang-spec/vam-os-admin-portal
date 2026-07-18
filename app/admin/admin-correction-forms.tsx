"use client";

import { useFormState } from "react-dom";
import {
  createActionItemAction,
  editRecapAction,
  softDeleteRecapAction,
  updateActionItemAction,
  type AdminCorrectionActionState
} from "./actions";
import { SEASON_CONFIG } from "@/lib/season-config";

const initialState: AdminCorrectionActionState = { ok: false, message: "" };
const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const buttonClass = "inline-flex w-fit justify-center rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90";

function StateMessage({ state }: { state: AdminCorrectionActionState }) {
  if (!state.message) return null;
  return (
    <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
      {state.message}
    </div>
  );
}

export function CreateIssueActionForm({
  type,
  targetPersonId,
  seasonCode,
  issueKey,
  defaultNotes
}: {
  type: string;
  targetPersonId?: string | null;
  seasonCode?: string | null;
  issueKey?: string | null;
  defaultNotes?: string | null;
}) {
  const [state, formAction] = useFormState(createActionItemAction, initialState);
  return (
    <form action={formAction} className="grid gap-2">
      <StateMessage state={state} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="target_person_id" value={targetPersonId ?? ""} />
      <input type="hidden" name="season_code" value={seasonCode ?? SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE} />
      <input type="hidden" name="issue_key" value={issueKey ?? ""} />
      <input type="hidden" name="notes" value={defaultNotes ?? ""} />
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Owner email</span>
        <input name="owner_email" type="email" className={inputClass} placeholder="owner@vam.org" />
      </label>
      <button type="submit" className={buttonClass}>Tạo action</button>
    </form>
  );
}

export function ActionItemUpdateForm({ id, ownerEmail, status }: { id: string; ownerEmail?: string | null; status?: string | null }) {
  const [state, formAction] = useFormState(updateActionItemAction, initialState);
  return (
    <form action={formAction} className="grid gap-2">
      <StateMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Status</span>
        <select name="status" defaultValue={status ?? "open"} className={inputClass}>
          <option value="open">open</option>
          <option value="in_progress">in_progress</option>
          <option value="resolved">resolved</option>
          <option value="dropped">dropped</option>
          <option value="no_response">no_response</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Owner email</span>
        <input name="owner_email" type="email" defaultValue={ownerEmail ?? ""} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Add note</span>
        <textarea name="note" rows={2} className={inputClass} />
      </label>
      <button type="submit" className={buttonClass}>Lưu</button>
    </form>
  );
}

export function QuickResolveForm({ id }: { id: string }) {
  const [state, formAction] = useFormState(updateActionItemAction, initialState);
  return (
    <form action={formAction} className="grid gap-2">
      <StateMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="resolved" />
      <input type="hidden" name="owner_email" value="" />
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Resolution note</span>
        <textarea name="note" rows={2} className={inputClass} />
      </label>
      <button type="submit" className={buttonClass}>Resolve</button>
    </form>
  );
}

export function EditRecapInlineForm({
  recap
}: {
  recap: {
    id: string;
    match_id?: string | null;
    mentor_person_id?: string | null;
    mentee_person_id?: string | null;
    meeting_date?: string | null;
    recap_url?: string | null;
    recap_note?: string | null;
    meeting_type?: string | null;
    issue_flag?: boolean | null;
    status?: string | null;
    admin_notes?: string | null;
  };
}) {
  const [editState, editAction] = useFormState(editRecapAction, initialState);
  const [deleteState, deleteAction] = useFormState(softDeleteRecapAction, initialState);
  return (
    <div className="grid gap-3">
      <form action={editAction} className="grid gap-3">
        <StateMessage state={editState} />
        <input type="hidden" name="id" value={recap.id} />
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Meeting date</span>
            <input name="meeting_date" type="date" defaultValue={String(recap.meeting_date ?? "").slice(0, 10)} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Status</span>
            <select name="status" defaultValue={recap.status ?? "submitted"} className={inputClass}>
              <option value="submitted">submitted</option>
              <option value="needs_review">needs_review</option>
              <option value="invalid">invalid</option>
              <option value="duplicate">duplicate</option>
              <option value="deleted">deleted</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mentor person id</span>
            <input name="mentor_person_id" defaultValue={recap.mentor_person_id ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Mentee person id</span>
            <input name="mentee_person_id" defaultValue={recap.mentee_person_id ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Match id</span>
            <input name="match_id" defaultValue={recap.match_id ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Recap URL</span>
            <input name="recap_url" defaultValue={recap.recap_url ?? ""} className={inputClass} />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Recap note</span>
          <textarea name="recap_note" defaultValue={recap.recap_note ?? ""} rows={2} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Admin notes</span>
          <textarea name="admin_notes" defaultValue={recap.admin_notes ?? ""} rows={2} className={inputClass} />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Reason</span>
          <textarea name="reason" rows={2} className={inputClass} />
        </label>
        <input type="hidden" name="meeting_type" value={recap.meeting_type ?? "1on1_primary"} />
        <input type="hidden" name="issue_flag" value={recap.issue_flag ? "true" : "false"} />
        <button type="submit" className={buttonClass}>Lưu recap</button>
      </form>
      <form action={deleteAction} className="grid gap-2 rounded-md border border-red-200 bg-red-50 p-3">
        <StateMessage state={deleteState} />
        <input type="hidden" name="id" value={recap.id} />
        <label className="block">
          <span className="text-xs font-medium uppercase text-red-700">Soft delete reason</span>
          <textarea name="reason" rows={2} className={inputClass} />
        </label>
        <button type="submit" className="inline-flex w-fit justify-center rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800">
          Soft delete recap
        </button>
      </form>
    </div>
  );
}
