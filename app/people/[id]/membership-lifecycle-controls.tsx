"use client";
import { useFormState } from "react-dom";
import { addMembershipRoleAction, initialMembershipLifecycleState, transitionMembershipAction } from "@/app/actions/membership-lifecycle";
import { availableMembershipActions, MEMBERSHIP_ACTION_LABELS, membershipOperationNeedsReason, type MembershipLifecycleOperation } from "@/lib/membership-lifecycle";

type Membership = { id: string; role: string; status: string; intakeBatchCode: string | null; programLabel: string; seasonLabel: string; authorizationScopeLevel?: string | null; programCode?: string | null; seasonCode?: string | null; };
type Option = { id: string; label: string };
function Feedback({ state }: { state: typeof initialMembershipLifecycleState }) {
  return state.message ? <p role="status" className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{state.message}</p> : null;
}
function TransitionForm({ personId, membership, operation }: { personId: string; membership: Membership; operation: MembershipLifecycleOperation }) {
  const [state, action] = useFormState(transitionMembershipAction, initialMembershipLifecycleState);
  const required = membershipOperationNeedsReason(operation), label = MEMBERSHIP_ACTION_LABELS[operation];
  return <form action={action} className="grid gap-2 rounded-md border border-vam-line bg-white p-3" onSubmit={(event) => { if (!window.confirm(`Xác nhận ${label.toLowerCase()} cho membership này?`)) event.preventDefault(); }}>
    <input type="hidden" name="person_id" value={personId} /><input type="hidden" name="membership_id" value={membership.id} />
    <input type="hidden" name="expected_status" value={membership.status} /><input type="hidden" name="operation" value={operation} />
    <label className="text-xs text-slate-600">Lý do {required ? "(bắt buộc)" : "(không bắt buộc)"}<input name="reason" required={required} maxLength={500} className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm" /></label>
    <button className="justify-self-start rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green">{label}</button><Feedback state={state} />
  </form>;
}
export function MembershipLifecycleControls({ personId, memberships, programs, seasons, enabled }: { personId: string; memberships: Membership[]; programs: Option[]; seasons: Option[]; enabled: boolean }) {
  const [addState, addAction] = useFormState(addMembershipRoleAction, initialMembershipLifecycleState);
  if (!enabled) return <p className="text-sm text-slate-600">Cần quyền operations hoặc full_access trong season để quản lý lifecycle.</p>;
  return <div className="grid gap-4">
    {memberships.map((membership) => { const actions = availableMembershipActions(membership.status); return <section key={membership.id} data-vam-membership-id={membership.id} data-vam-intake-batch={membership.intakeBatchCode ?? undefined} data-vam-program-scope={membership.authorizationScopeLevel ?? undefined} data-vam-program-code={membership.programCode ?? undefined} data-vam-season-code={membership.seasonCode ?? undefined} className="rounded-md border border-vam-line bg-slate-50 p-3">
      <div className="mb-3 text-sm"><strong>{membership.programLabel} / {membership.seasonLabel}</strong><span className="ml-2">{membership.role} · {membership.status}</span></div>
      {actions.length ? <div className="grid gap-2 lg:grid-cols-2">{actions.map((operation) => <TransitionForm key={operation} personId={personId} membership={membership} operation={operation} />)}</div> : <p className="text-sm text-slate-600">Không có thao tác lifecycle hợp lệ từ trạng thái này.</p>}
    </section>; })}
    <form action={addAction} className="grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3" onSubmit={(event) => { if (!window.confirm("Xác nhận thêm vai trò active cho person này?")) event.preventDefault(); }}>
      <h3 className="font-medium">Thêm vai trò membership</h3><input type="hidden" name="person_id" value={personId} />
      <label className="text-sm">Program<select name="program_id" required className="mt-1 w-full rounded-md border border-vam-line px-3 py-2">{programs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="text-sm">Season<select name="season_id" required className="mt-1 w-full rounded-md border border-vam-line px-3 py-2">{seasons.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="text-sm">Vai trò<select name="role" required className="mt-1 w-full rounded-md border border-vam-line px-3 py-2"><option value="mentor">Mentor</option><option value="mentee">Mentee</option></select></label>
      <label className="text-sm">Lý do (không bắt buộc)<input name="reason" maxLength={500} className="mt-1 w-full rounded-md border border-vam-line px-3 py-2" /></label>
      <button className="justify-self-start rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white">Thêm vai trò active</button><Feedback state={addState} />
    </form>
  </div>;
}
