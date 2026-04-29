"use client";

import { useFormState } from "react-dom";
import type { ManagedAdminUser } from "@/lib/admin-users";
import { createAdminUserAction, updateAdminUserAction, type AdminUserActionState } from "./actions";

const initialState: AdminUserActionState = { ok: false, message: "" };
const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const buttonClass = "inline-flex rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90";
const quietButtonClass = "inline-flex rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint";

function ActionMessage({ state }: { state: AdminUserActionState }) {
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
      <option value="admin">Admin</option>
      <option value="super_admin">Super admin</option>
    </select>
  );
}

function StatusSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select name="status" defaultValue={defaultValue} className={inputClass}>
      <option value="active">Kích hoạt</option>
      <option value="invited">Đã mời</option>
      <option value="suspended">Tạm khóa</option>
      <option value="inactive">Không hoạt động</option>
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
          <StatusSelect defaultValue="active" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Mùa/Chương trình được truy cập</span>
          <input name="season_id" className={inputClass} defaultValue="UEHM-S11" placeholder="UEHM-S11" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Program</span>
          <input name="program_id" className={inputClass} placeholder="VAM" />
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
  const scope = user.scopes[0];
  return (
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
          <span className="text-xs font-medium uppercase text-slate-500">Mùa/Chương trình được truy cập</span>
          <input name="season_id" defaultValue={scope?.season_id ?? ""} disabled={!user.auth_user_id} className={inputClass} placeholder="UEHM-S11" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Program</span>
          <input name="program_id" defaultValue={scope?.program_id ?? ""} disabled={!user.auth_user_id} className={inputClass} placeholder="VAM" />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Phân quyền</span>
          <ScopeRoleSelect defaultValue={scope?.role ?? "read"} />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái phân quyền</span>
          <ScopeStatusSelect defaultValue={scope?.status ?? "active"} />
        </label>
        <div className="flex items-end">
          <button type="submit" className={quietButtonClass}>
            Lưu thay đổi
          </button>
        </div>
      </div>
      {!user.auth_user_id ? (
        <p className="text-xs text-amber-700">Người dùng chưa có auth_user_id nên chưa thể ghi phân quyền scope.</p>
      ) : null}
    </form>
  );
}
