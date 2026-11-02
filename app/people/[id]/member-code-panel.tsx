"use client";

import { useFormState, useFormStatus } from "react-dom";
import { assignMemberCodeAction, setMemberCodeAction, type MemberCodeActionState } from "@/app/actions/member-code";
import { Card } from "@/components/ui";

const initial: MemberCodeActionState = { ok: false, message: null };
const field = "rounded-md border border-vam-line px-3 py-1.5 text-sm";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-vam-green px-3 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-60">
      {pending ? "Đang lưu…" : label}
    </button>
  );
}

function Message({ state }: { state: MemberCodeActionState }) {
  if (!state.message) return null;
  return <p role="status" className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>;
}

export function MemberCodePanel({ personId, memberCode, canManage }: { personId: string; memberCode: string | null; canManage: boolean }) {
  const [assignState, assign] = useFormState(assignMemberCodeAction, initial);
  const [editState, edit] = useFormState(setMemberCodeAction, initial);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase text-slate-500">Mã thành viên</div>
          <div className="mt-1 font-mono text-base font-semibold text-vam-ink">{memberCode ?? "Chưa có mã"}</div>
        </div>
        {canManage ? (
          memberCode ? (
            <form action={edit} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="person_id" value={personId} />
              <input name="code" aria-label="Mã thành viên mới" defaultValue={memberCode} maxLength={8} required className={`${field} font-mono`} />
              <Submit label="Sửa mã" />
            </form>
          ) : (
            <form action={assign} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="person_id" value={personId} />
              <select name="group" aria-label="Nhóm" defaultValue="" required className={field}>
                <option value="" disabled>Chọn nhóm</option>
                <option value="C">C · Core team</option>
                <option value="S">S · Support team</option>
                <option value="R">R · Mentor</option>
                <option value="E">E · Mentee</option>
              </select>
              <Submit label="Cấp mã" />
            </form>
          )
        ) : null}
      </div>
      <div className="mt-2">
        <Message state={assignState} />
        <Message state={editState} />
      </div>
    </Card>
  );
}
