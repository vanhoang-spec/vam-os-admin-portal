"use server";

import { revalidatePath } from "next/cache";
import {
  createManagedAdminUser,
  removeManagedAdminAccess,
  setManagedAdminUserStatus,
  syncManagedAdminAuthUser,
  updateManagedAdminUser,
  type AdminUserMutationResult
} from "@/lib/admin-users";

export type AdminUserActionState = AdminUserMutationResult;

const initialState: AdminUserActionState = { ok: false, message: "" };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function textAny(formData: FormData, keys: string[]) {
  for (const key of keys) {
    const value = text(formData, key);
    if (value) return value;
  }
  return "";
}

function actionError(error: unknown): AdminUserActionState {
  console.error("[admin-users-action]", error instanceof Error ? error.message : String(error));
  return { ok: false, message: "Tác vụ không hoàn tất do lỗi server. Vui lòng kiểm tra Vercel logs." };
}

export async function createAdminUserAction(_previousState: AdminUserActionState = initialState, formData: FormData): Promise<AdminUserActionState> {
  try {
    const result = await createManagedAdminUser({
      email: text(formData, "email"),
      fullName: text(formData, "full_name"),
      role: text(formData, "role"),
      status: text(formData, "status"),
      programId: textAny(formData, ["program_id", "program"]),
      seasonId: textAny(formData, ["season_id", "season_code"]),
      scopeRole: textAny(formData, ["scope_role", "scope_level"]),
      scopeStatus: text(formData, "scope_status")
    });
    revalidatePath("/admin/users");
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function updateAdminUserAction(_previousState: AdminUserActionState = initialState, formData: FormData): Promise<AdminUserActionState> {
  try {
    const result = await updateManagedAdminUser({
      id: text(formData, "id"),
      fullName: text(formData, "full_name"),
      role: text(formData, "role"),
      status: text(formData, "status"),
      scopeId: text(formData, "scope_id"),
      programId: textAny(formData, ["program_id", "program"]),
      seasonId: textAny(formData, ["season_id", "season_code"]),
      scopeRole: textAny(formData, ["scope_role", "scope_level"]),
      scopeStatus: text(formData, "scope_status")
    });
    revalidatePath("/admin/users");
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function setAdminUserStatusAction(_previousState: AdminUserActionState = initialState, formData: FormData): Promise<AdminUserActionState> {
  try {
    const result = await setManagedAdminUserStatus(text(formData, "id"), text(formData, "status"));
    revalidatePath("/admin/users");
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function syncAdminUserAuthAction(_previousState: AdminUserActionState = initialState, formData: FormData): Promise<AdminUserActionState> {
  try {
    const result = await syncManagedAdminAuthUser(text(formData, "id"));
    revalidatePath("/admin/users");
    return result;
  } catch (error) {
    return actionError(error);
  }
}

export async function removeAdminAccessAction(_previousState: AdminUserActionState = initialState, formData: FormData): Promise<AdminUserActionState> {
  try {
    const result = await removeManagedAdminAccess(text(formData, "id"));
    revalidatePath("/admin/users");
    return result;
  } catch (error) {
    return actionError(error);
  }
}
