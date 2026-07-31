"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import type { ManagedAdminUser } from "@/lib/admin-users";
import {
  createAdminUserAction,
  removeAdminAccessAction,
  setAdminUserStatusAction,
  syncAdminUserAuthAction,
  updateAdminUserAction,
  type AdminUserActionState
} from "./actions";
import { SEASON_CONFIG } from "@/lib/season-config";

const initialState: AdminUserActionState = { ok: false, message: "" };
const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const buttonClass = "inline-flex rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90";
const quietButtonClass = "inline-flex rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint";
const dangerButtonClass = "inline-flex rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function ActionMessage({ state }: { state: AdminUserActionState }) {
  const router = useRouter();
  const refreshedMessage = useRef("");
  useEffect(() => {
    if (state.ok && state.message && refreshedMessage.current !== state.message) {
      refreshedMessage.current = state.message;
      router.refresh();
    }
  }, [router, state.message, state.ok]);

  if (!state.message) return null;
  return (
    <div className={state.ok ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
      {state.message}
    </div>
  );
}

function RoleSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="role" defaultValue={defaultValue} className={inputClass}>
      <option value="viewer">Viewer</option>
      <option value="reviewer">Reviewer</option>
      <option value="support_team">Support team</option>
      <option value="core_team">Core team</option>
      <option value="admin">Admin</option>
      <option value="super_admin">Super admin</option>
    </select>
  );
}

function StatusSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="status" defaultValue={defaultValue} className={inputClass}>
      <option value="invited">Đã mời — chưa kích hoạt</option>
      <option value="active">Kích hoạt</option>
      <option value="suspended">Tạm khóa</option>
      <option value="inactive">Ngừng quyền truy cập</option>
    </select>
  );
}

function ScopeRoleSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="scope_role" defaultValue={defaultValue} className={inputClass}>
      <option value="read">Read</option>
      <option value="review">Review</option>
      <option value="operations">Operations</option>
      <option value="full_access">Full access</option>
    </select>
  );
}

function ScopeStatusSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="scope_status" defaultValue={defaultValue} className={inputClass}>
      <option value="active">Kích hoạt</option>
      <option value="inactive">Tạm khóa</option>
    </select>
  );
}

export function CreateAdminUserForm() {
  const [state, formAction] = useFormState(createAdminUserAction, initialState);
  return (
    <form action={formAction} className="grid gap-3">
      <ActionMessage state={state} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Email</span>
          <input name="email" type="email" required className={inputClass} placeholder="name@example.com" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Họ tên</span>
          <input name="full_name" className={inputClass} placeholder="Tên người dùng" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Vai trò</span>
          <RoleSelect defaultValue="viewer" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
          <StatusSelect defaultValue="invited" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">season_code</span>
          <input name="season_code" className={inputClass} defaultValue={SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE} placeholder={SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE} />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Program</span>
          <input name="program" className={inputClass} defaultValue="VAM" placeholder="VAM" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Phân quyền</span>
          <ScopeRoleSelect defaultValue="read" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái phân quyền</span>
          <ScopeStatusSelect defaultValue="active" />
        </label>
      </div>
      <button type="submit" className={buttonClass}>
        Tạo / mời người dùng
      </button>
    </form>
  );
}

export function EditAdminUserForm({ user }: { user: ManagedAdminUser }) {
  const [state, formAction] = useFormState(updateAdminUserAction, initialState);
  const scopes = Array.isArray(user.scopes) ? user.scopes : [];
  const scope = scopes[0];
  const canSaveScope = Boolean(user.auth_user_id);
  const scopeProgram = scope?.program_id ?? scope?.program ?? "VAM";
  const scopeSeason = scope?.season_id ?? scope?.season_code ?? SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE;
  const scopeLevel = scope?.role ?? scope?.scope_level ?? "read";
  return (
    <div className="grid gap-3">
      <div className={canSaveScope ? "rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"}>
        {canSaveScope ? "Danh tính Auth: đã liên kết" : "Danh tính Auth: chưa liên kết; cần Đồng bộ Auth trước khi lưu scope."}
      </div>
      {!canSaveScope ? <SyncAuthForm user={user} /> : null}
      {canSaveScope && !scope ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Chưa có row trong admin_scope_access. Bấm Lưu thay đổi sẽ tạo scope mặc định cho user này.
        </div>
      ) : null}
      <form action={formAction} className="grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3">
        <input type="hidden" name="id" value={user.id} />
        <input type="hidden" name="scope_id" value={scope?.id ?? ""} />
        <ActionMessage state={state} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Họ tên</span>
            <input name="full_name" defaultValue={user.full_name ?? ""} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Vai trò</span>
            <RoleSelect defaultValue={user.role} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
            <StatusSelect defaultValue={user.status} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Program</span>
            <input name="program" defaultValue={scopeProgram} disabled={!canSaveScope} className={inputClass} placeholder="VAM" />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">season_code</span>
            <input name="season_code" defaultValue={scopeSeason} disabled={!canSaveScope} className={inputClass} placeholder={SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE} />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">scope_level</span>
            <div className={!canSaveScope ? "pointer-events-none opacity-60" : undefined}>
              <ScopeRoleSelect defaultValue={scopeLevel} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">scope_status</span>
            <div className={!canSaveScope ? "pointer-events-none opacity-60" : undefined}>
              <ScopeStatusSelect defaultValue={scope?.status ?? "active"} />
            </div>
          </label>
          <div className="flex items-end">
            <button type="submit" className={quietButtonClass}>
              Lưu thay đổi
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function StatusToggleForm({ user, disabled }: { user: ManagedAdminUser; disabled: boolean }) {
  const [state, formAction] = useFormState(setAdminUserStatusAction, initialState);
  const nextStatus = user.status === "active" ? "inactive" : "active";
  return (
    <form action={formAction} className="grid gap-1" onSubmit={(event) => { if (nextStatus !== "active" && !window.confirm("Tạm khóa tài khoản này? Người dùng sẽ mất quyền truy cập.")) event.preventDefault(); }}>
      <input type="hidden" name="id" value={user.id} />
      <input type="hidden" name="status" value={nextStatus} />
      <button type="submit" disabled={disabled} className={nextStatus === "active" ? quietButtonClass : dangerButtonClass}>
        {nextStatus === "active" ? "Kích hoạt lại" : "Tạm khóa"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function SyncAuthForm({ user }: { user: ManagedAdminUser }) {
  const [state, formAction] = useFormState(syncAdminUserAuthAction, initialState);
  return (
    <form action={formAction} className="grid gap-1">
      <input type="hidden" name="id" value={user.id} />
      <button type="submit" className={quietButtonClass}>
        Đồng bộ Auth
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function RemoveAccessForm({ user, disabled }: { user: ManagedAdminUser; disabled: boolean }) {
  const [state, formAction] = useFormState(removeAdminAccessAction, initialState);
  return (
    <form action={formAction} className="grid gap-1" onSubmit={(event) => { if (!window.confirm("Ngừng quyền quản trị? Auth user sẽ không bị xóa.")) event.preventDefault(); }}>
      <input type="hidden" name="id" value={user.id} />
      <button type="submit" disabled={disabled} className={dangerButtonClass}>
        Xóa quyền admin
      </button>
      <ActionMessage state={state} />
    </form>
  );
}
