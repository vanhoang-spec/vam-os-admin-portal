"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { loadProgramContextCatalog } from "@/lib/program-context";
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
  const requestedReference = text(formData, "client_reference_id");
  const validationReference = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedReference) ? requestedReference : randomUUID();
  try {
    const email = text(formData, "email").toLowerCase();
    const fullName = text(formData, "full_name");
    const role = text(formData, "role");
    const status = text(formData, "status");
    const programId = textAny(formData, ["program_id", "program"]);
    const seasonId = textAny(formData, ["season_id", "season_code"]);
    const scopeRole = textAny(formData, ["scope_role", "scope_level"]);
    const scopeStatus = text(formData, "scope_status");
    const catalog = await loadProgramContextCatalog();
    const program = catalog.programs.find((row) => row.id === programId && row.isActive);
    const season = catalog.seasons.find((row) => row.id === seasonId && row.programId === program?.id);
    const validRole = ["viewer", "reviewer", "support_team", "core_team", "admin", "super_admin"].includes(role);
    const validScopeRole = ["read", "review", "operations", "full_access"].includes(scopeRole);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length < 2 || !validRole || status !== "invited" || !program || !season || !validScopeRole || !["active", "inactive"].includes(scopeStatus)) {
      return { ok: false, status: "rejected", failureClass: "invalid_catalog_or_form_input", failureStage: "pre_lookup", operationId: validationReference, reconciliationRequired: false, ownerAction: "none", message: "Dữ liệu biểu mẫu hoặc phạm vi program/season không hợp lệ. Chưa gọi nhà cung cấp Auth." };
    }
    const result = await createManagedAdminUser({
      operationId: validationReference,
      email,
      fullName, role, status, programId, seasonId, scopeRole, scopeStatus
    });
    revalidatePath("/admin/users");
    return { ...result, operationId: result.operationId ?? validationReference };
  } catch (error) {
    const safe = actionError(error);
    return { ...safe, status: "failed", failureStage: "journal", operationId: validationReference, reconciliationRequired: false, ownerAction: "do_not_retry" };
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
