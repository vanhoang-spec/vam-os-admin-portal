"use server";

import { revalidatePath } from "next/cache";
import {
  createManagedAdminUser,
  deactivateManagedAdminUser,
  updateManagedAdminUser,
  type AdminUserMutationResult
} from "@/lib/admin-users";

export type AdminUserActionState = AdminUserMutationResult;

const initialState: AdminUserActionState = { ok: false, message: "" };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function createAdminUserAction(_previousState: AdminUserActionState = initialState, formData: FormData): Promise<AdminUserActionState> {
  const result = await createManagedAdminUser({
    email: text(formData, "email"),
    fullName: text(formData, "full_name"),
    role: text(formData, "role"),
    status: text(formData, "status"),
    programId: text(formData, "program_id"),
    seasonId: text(formData, "season_id"),
    scopeRole: text(formData, "scope_role"),
    scopeStatus: text(formData, "scope_status")
  });
  revalidatePath("/admin/users");
  return result;
}

export async function updateAdminUserAction(_previousState: AdminUserActionState = initialState, formData: FormData): Promise<AdminUserActionState> {
  const result = await updateManagedAdminUser({
    id: text(formData, "id"),
    fullName: text(formData, "full_name"),
    role: text(formData, "role"),
    status: text(formData, "status"),
    scopeId: text(formData, "scope_id"),
    programId: text(formData, "program_id"),
    seasonId: text(formData, "season_id"),
    scopeRole: text(formData, "scope_role"),
    scopeStatus: text(formData, "scope_status")
  });
  revalidatePath("/admin/users");
  return result;
}

export async function deactivateAdminUserAction(formData: FormData): Promise<void> {
  await deactivateManagedAdminUser(text(formData, "id"));
  revalidatePath("/admin/users");
}
