import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { createHash, randomUUID } from "crypto";
import type { AdminRole, CurrentAdminUser } from "@/lib/auth-constants";
import { getSupabaseServiceRoleClient, getSupabaseServiceRoleEnvStatus } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";
import type { JsonRecord } from "@/lib/types";
import { isValidEmail, normalizeEmail } from "@/lib/identity";
import { findExactAuthUsers, resolveAuthOwnership } from "@/lib/account-auth-ownership";
import { executeManualStaffProvisioning, type ProvisioningResult } from "@/lib/manual-staff-provisioning";

export type AdminUserStatus = "invited" | "active" | "suspended" | "inactive";
export type ScopeRole = "full_access" | "operations" | "review" | "read";
export type ScopeStatus = "active" | "inactive";

export type AdminScopeAccessRow = {
  id: string;
  user_id: string;
  program_id: string | null;
  season_id: string | null;
  program?: string | null;
  season_code?: string | null;
  scope_level?: ScopeRole | null;
  role: ScopeRole;
  status: ScopeStatus;
  created_at: string;
  updated_at: string | null;
};

export type ManagedAdminUser = {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string | null;
  role: AdminRole;
  status: AdminUserStatus;
  created_at: string;
  updated_at: string;
  scopes: AdminScopeAccessRow[];
};

export type AdminAuditLogRow = {
  id: string;
  actor_admin_user_id: string | null;
  action_type: string;
  target_admin_user_id: string | null;
  before_data: JsonRecord | null;
  after_data: JsonRecord | null;
  created_at: string;
};

export type AdminUserMutationResult = {
  ok: boolean;
  message: string;
  status?: ProvisioningResult["status"];
  failureClass?: string;
  failureStage?: ProvisioningResult["failureStage"];
  operationId?: string;
  reconciliationRequired?: boolean;
  ownerAction?: ProvisioningResult["ownerAction"];
};

const ADMIN_ROLES = new Set(["viewer", "reviewer", "support_team", "core_team", "admin", "super_admin"]);
const ADMIN_STATUSES = new Set(["invited", "active", "suspended", "inactive"]);
const SCOPE_ROLES = new Set(["full_access", "operations", "review", "read"]);
const SCOPE_STATUSES = new Set(["active", "inactive"]);

function logAdminUsersRuntime(message: string, details?: Record<string, unknown>) {
  console.error("[admin-users]", message, details ?? {});
}

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  const envStatus = getSupabaseServiceRoleEnvStatus();
  if (!client) {
    return {
      client: null,
      error: `Thiếu ${envStatus.envName} trên server. Không thể quản lý người dùng an toàn từ UI.`
    };
  }
  return { client, error: null };
}

function serviceRoleErrorMessage(scope: string, message: string) {
  const envStatus = getSupabaseServiceRoleEnvStatus();
  const keyState = envStatus.loaded ? "đã load" : "chưa load";
  const publicState = envStatus.usesPublicPrefix ? "đang dùng biến public" : "server-only";
  const anonState = envStatus.sameAsAnonKey ? "trùng anon key" : "khác anon key";
  return `${scope}: ${message}. Kiểm tra ${envStatus.envName} trên Vercel (${keyState}, ${publicState}, ${anonState}).`;
}

export async function requireSuperAdmin(): Promise<CurrentAdminUser | null> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (adminUser?.role !== "super_admin" || adminUser.status !== "active") return null;
    return adminUser;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Dynamic server usage")) throw error;
    logAdminUsersRuntime("requireSuperAdmin failed", {
      message
    });
    return null;
  }
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function scopeText(value: unknown, fallback: string) {
  return String(value ?? "").trim() || fallback;
}

function validRole(value: unknown): AdminRole {
  const role = String(value ?? "viewer");
  return ADMIN_ROLES.has(role) ? (role as AdminRole) : "viewer";
}

function validStatus(value: unknown): AdminUserStatus {
  const status = String(value ?? "active");
  return ADMIN_STATUSES.has(status) ? (status as AdminUserStatus) : "active";
}

function validScopeRole(value: unknown): ScopeRole {
  const role = String(value ?? "read");
  return SCOPE_ROLES.has(role) ? (role as ScopeRole) : "read";
}

function validScopeStatus(value: unknown): ScopeStatus {
  const status = String(value ?? "active");
  return SCOPE_STATUSES.has(status) ? (status as ScopeStatus) : "active";
}

function scopeRoleForAdminRole(role: AdminRole | string | null | undefined): ScopeRole {
  if (role === "admin" || role === "super_admin") return "full_access";
  if (role === "core_team" || role === "support_team") return "operations";
  if (role === "reviewer") return "review";
  return "read";
}

function normalizeScopeRow(row: JsonRecord): AdminScopeAccessRow {
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    program_id: cleanText(row.program_id ?? row.program),
    season_id: cleanText(row.season_id ?? row.season_code),
    program: cleanText(row.program ?? row.program_id),
    season_code: cleanText(row.season_code ?? row.season_id),
    role: validScopeRole(row.role ?? row.scope_level),
    scope_level: validScopeRole(row.scope_level ?? row.role),
    status: validScopeStatus(row.status),
    created_at: String(row.created_at ?? ""),
    updated_at: row.updated_at ? String(row.updated_at) : null
  };
}

async function getScopesForAuthUsers(client: any, authUserIds: string[]): Promise<{ data: AdminScopeAccessRow[]; error: string | null }> {
  if (!authUserIds.length) return { data: [], error: null };
  const { data, error } = await client
    .from("admin_scope_access")
    .select("*")
    .in("user_id", authUserIds)
    .order("created_at", { ascending: false });
  if (error) {
    logAdminUsersRuntime("admin_scope_access query failed", {
      code: error.code,
      message: error.message,
      hint: error.hint,
      details: error.details
    });
    return { data: [], error: `Không thể tải admin_scope_access: ${error.message}` };
  }
  return { data: ((data ?? []) as JsonRecord[]).map(normalizeScopeRow), error: null };
}

export async function listManagedAdminUsers(): Promise<{ data: ManagedAdminUser[]; error: string | null }> {
  try {
    const access = await requireSuperAdmin();
    if (!access) return { data: [], error: "Bạn không có quyền truy cập trang quản lý người dùng." };

    const { client, error } = serviceClient();
    if (!client) return { data: [], error };

    const { data, error: usersError } = await client
      .from("admin_users")
      .select("id,auth_user_id,email,full_name,role,status,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (usersError) {
      logAdminUsersRuntime("admin_users query failed", {
        code: usersError.code,
        message: usersError.message,
        hint: usersError.hint,
        details: usersError.details
      });
      return { data: [], error: `Không thể tải admin_users: ${usersError.message}` };
    }

    const users = ((data ?? []) as Omit<ManagedAdminUser, "scopes">[]).map((user) => ({
      ...user,
      email: user.email ?? "",
      role: validRole(user.role),
      status: validStatus(user.status)
    }));
    const scopesResult = await getScopesForAuthUsers(client, users.map((user) => user.auth_user_id).filter(Boolean) as string[]);
    const scopesByUserId = new Map<string, AdminScopeAccessRow[]>();
    for (const scope of scopesResult.data) {
      if (!scope.user_id) continue;
      scopesByUserId.set(scope.user_id, [...(scopesByUserId.get(scope.user_id) ?? []), scope]);
    }

    return {
      data: users.map((user) => ({
        ...user,
        scopes: user.auth_user_id ? scopesByUserId.get(user.auth_user_id) ?? [] : []
      })) as ManagedAdminUser[],
      error: scopesResult.error
    };
  } catch (error) {
    logAdminUsersRuntime("listManagedAdminUsers crashed", {
      message: error instanceof Error ? error.message : String(error)
    });
    return { data: [], error: "Không thể tải danh sách người dùng do lỗi runtime phía server. Vui lòng kiểm tra Vercel logs." };
  }
}

export async function listAdminAuditLogs(): Promise<{ data: AdminAuditLogRow[]; error: string | null }> {
  try {
    const access = await requireSuperAdmin();
    if (!access) return { data: [], error: "Bạn không có quyền xem nhật ký thay đổi quyền." };

    const { client, error } = serviceClient();
    if (!client) return { data: [], error };

    const { data, error: logsError } = await client
      .from("admin_audit_log")
      .select("id,actor_admin_user_id,action_type,target_admin_user_id,before_data,after_data,created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (logsError) {
      logAdminUsersRuntime("admin_audit_log query failed", {
        code: logsError.code,
        message: logsError.message,
        hint: logsError.hint,
        details: logsError.details
      });
      return { data: [], error: `Không thể tải admin_audit_log: ${logsError.message}` };
    }
    return { data: (data ?? []) as AdminAuditLogRow[], error: null };
  } catch (error) {
    logAdminUsersRuntime("listAdminAuditLogs crashed", {
      message: error instanceof Error ? error.message : String(error)
    });
    return { data: [], error: "Không thể tải nhật ký thay đổi quyền do lỗi runtime phía server." };
  }
}

async function snapshotAdminUser(client: any, adminUserId: string) {
  const { data: user } = await client
    .from("admin_users")
    .select("id,auth_user_id,email,full_name,role,status,created_at,updated_at")
    .eq("id", adminUserId)
    .maybeSingle();
  const scopes = user?.auth_user_id ? await getScopesForAuthUsers(client, [user.auth_user_id]) : { data: [], error: null };
  return user ? { user, scopes: scopes.data } : null;
}

async function writeAuditLog(client: any, input: {
  actorAdminUserId?: string | null;
  actionType: string;
  targetAdminUserId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
}) {
  const { error } = await client.from("admin_audit_log").insert({
    actor_admin_user_id: input.actorAdminUserId ?? null,
    action_type: input.actionType,
    target_admin_user_id: input.targetAdminUserId ?? null,
    before_data: input.beforeData ?? null,
    after_data: input.afterData ?? null
  });
  if (error) {
    logAdminUsersRuntime("admin_audit_log insert failed", {
      code: error.code,
      message: error.message,
      hint: error.hint,
      details: error.details
    });
    const auditError = new Error("Không thể hoàn tất tác vụ vì nhật ký kiểm toán bắt buộc thất bại.");
    auditError.name = "MandatoryAuditError";
    throw auditError;
  }
}

async function wouldRemoveLastActiveSuperAdmin(client: any, targetId: string, nextRole: AdminRole, nextStatus: AdminUserStatus) {
  const { data: current, error } = await client
    .from("admin_users")
    .select("id,role,status")
    .eq("id", targetId)
    .maybeSingle();
  if (error || !current) return false;
  if (current.role !== "super_admin" || current.status !== "active") return false;
  if (nextRole === "super_admin" && nextStatus === "active") return false;

  const { count, error: countError } = await client
    .from("admin_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("status", "active")
    .neq("id", targetId);
  if (countError) return true;
  return (count ?? 0) < 1;
}

async function ensureAuthUserForEmail(client: any, email: string) {
  const result = await resolveAuthOwnership(client, email);
  return { authUserId: result.state === "preexisting" || result.state === "proven_created" ? result.id : null, created: result.state === "proven_created" && result.deleteAllowed, ownershipAmbiguous: result.state === "ambiguous" || result.state === "not_found", warning: result.state === "failed" ? "Không thể xác minh Supabase Auth user." : null };
}

async function recordAuthReconciliation(client:any,actorId:string,operationId:string,email:string,actionType:string,failureClass:string,retryStatus:"required"|"resolved"){
  const identifierHash=createHash("sha256").update(normalizeEmail(email),"utf8").digest("hex");
  const {error}=await client.rpc("vam062_record_auth_reconciliation",{p_actor_admin_user_id:actorId,p_operation_id:operationId,p_identifier_hash:identifierHash,p_action_type:actionType,p_failure_class:failureClass,p_retry_status:retryStatus,p_correlation_metadata:{source:"account_admin"}});
  if(error)throw new Error("CRITICAL_RECONCILIATION_RECORDING_FAILED");
}

async function upsertScope(client: any, input: {
  authUserId: string;
  scopeId?: string | null;
  programId?: unknown;
  seasonId?: unknown;
  role?: unknown;
  status?: unknown;
}) {
  const payload = {
    user_id: input.authUserId,
    program_id: scopeText(input.programId, "VAM"),
    season_id: scopeText(input.seasonId, SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE),
    role: validScopeRole(input.role),
    status: validScopeStatus(input.status)
  };

  const scopeId = String(input.scopeId ?? "").trim();
  if (scopeId) {
    const { error } = await client.from("admin_scope_access").update(payload).eq("id", scopeId);
    if (error) throw new Error(`Không thể cập nhật phân quyền: ${error.message}`);
    return;
  }

  const { data: existingRows, error: existingError } = await client
    .from("admin_scope_access")
    .select("id")
    .eq("user_id", input.authUserId)
    .eq("program_id", payload.program_id)
    .eq("season_id", payload.season_id)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (existingError) throw new Error(`KhĂ´ng thá»ƒ kiá»ƒm tra phĂ¢n quyá»n hiá»‡n cĂ³: ${existingError.message}`);

  const existing = existingRows?.[0];

  const result = existing?.id
    ? await client.from("admin_scope_access").update(payload).eq("id", existing.id)
    : await client.from("admin_scope_access").insert(payload);
  if (result.error) throw new Error(`Không thể lưu phân quyền: ${result.error.message}`);
}

export async function createManagedAdminUser(input: {
  operationId?: unknown;
  email: unknown;
  fullName: unknown;
  role: unknown;
  status: unknown;
  programId: unknown;
  seasonId: unknown;
  scopeRole: unknown;
  scopeStatus: unknown;
}): Promise<AdminUserMutationResult> {
  const actor = await requireSuperAdmin();
  if (!actor) return { ok: false, message: "Chỉ super_admin mới được tạo người dùng nội bộ." };

  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, message: "Email không hợp lệ." };

  const requestedOperationId = String(input.operationId ?? "").trim();
  const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOperationId)
    ? requestedOperationId
    : randomUUID();
  const emailHash = createHash("sha256").update(email, "utf8").digest("hex");
  const authHash = (id: string | null) => id ? createHash("sha256").update(id, "utf8").digest("hex") : null;
  const logSafe = (stage: string, failureClass: string, code?: string) => logAdminUsersRuntime("staff provisioning", { operationId, stage, failureClass, code: code ?? null });
  const result = await executeManualStaffProvisioning(operationId, {
    beginJournal: async () => {
      const { data, error: beginError } = await client.rpc("vam062_begin_auth_operation", { p_actor_admin_user_id: actor.id, p_operation_id: operationId, p_operation_type: "manual", p_identifier_hash: emailHash, p_retry_of: null });
      if (beginError) { logSafe("journal", "journal_creation_failed", beginError.code); return false; }
      const row = Array.isArray(data) ? data[0] : data;
      return row?.accepted === true;
    },
    recordStage: async (stage, ownership, authId, deleteAllowed, failureClass) => {
      const { error: stageError } = await client.rpc("vam062_record_auth_operation_stage", {
        p_actor_admin_user_id: actor.id, p_operation_id: operationId, p_stage: stage, p_ownership_state: ownership,
        p_auth_user_id_hash: authHash(authId), p_delete_allowed: deleteAllowed, p_failure_class: failureClass ?? null
      });
      if (stageError) { logSafe(stage, failureClass ?? "stage_recording_failed", stageError.code); throw new Error("STAGE_RECORDING_FAILED"); }
    },
    preLookup: () => findExactAuthUsers(client, email).then((lookup) => ({ ok: lookup.ok, ids: lookup.users.map((user) => user.id) })),
    invite: async () => { const invitation = await client.auth.admin.inviteUserByEmail(email); return { id: String(invitation?.data?.user?.id ?? "").trim() || null, error: Boolean(invitation?.error) }; },
    postLookup: () => findExactAuthUsers(client, email).then((lookup) => ({ ok: lookup.ok, ids: lookup.users.map((user) => user.id) })),
    commitApplication: async (authUserId) => {
      const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", {
        p_actor_admin_user_id: actor.id, p_operation: "upsert", p_target_admin_user_id: null,
        p_payload: { auth_user_id: authUserId, email, full_name: cleanText(input.fullName), role: validRole(input.role), status: "invited", program_id: scopeText(input.programId,"VAM"), season_id: scopeText(input.seasonId,SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE), scope_role: validScopeRole(input.scopeRole), scope_status: validScopeStatus(input.scopeStatus) }
      });
      if (atomicError) { logSafe("application", "application_mutation_failed", atomicError.code); throw new Error("APPLICATION_MUTATION_FAILED"); }
    },
    compensate: async (authUserId) => { const compensation = await client.auth.admin.deleteUser(authUserId); if (compensation.error) { logSafe("compensation", "auth_compensation_failed", compensation.error.code); throw new Error("COMPENSATION_FAILED"); } },
    recordReconciliation: (failureClass, resolved) => recordAuthReconciliation(client, String(actor.id), operationId, email, "create_admin_user", failureClass, resolved ? "resolved" : "required")
  });
  const reference = `Mã tham chiếu: ${result.operationId}`;
  const base = { ...result, operationId: result.operationId };
  if (result.ok) return { ...base, message: `Đã gửi lời mời và tạo tài khoản ở trạng thái đã mời. ${reference}` };
  if (result.status === "rejected") return { ...base, message: `Danh tính đã tồn tại. Không có dữ liệu nào được cập nhật; hãy dùng quy trình xem xét tài khoản hiện có. ${reference}` };
  if (result.reconciliationRequired) return { ...base, message: `Trạng thái cần đối soát thủ công. Không tự động thử lại. ${reference}` };
  return { ...base, message: `Tác vụ dừng an toàn trước khi hoàn tất. Không tự động thử lại. ${reference}` };
  /* Legacy direct-write path retained unreachable for rollback comparison; remove after staging RPC verification.

  const { data: existing } = await client
    .from("admin_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  const adminPayload = {
    email,
    full_name: cleanText(input.fullName),
    role: validRole(input.role),
    status: auth.created ? "invited" : validStatus(input.status),
    auth_user_id: auth.authUserId
  };
  const before = existing?.id ? await snapshotAdminUser(client, existing.id) : null;
  const result = existing?.id
    ? await client.from("admin_users").update(adminPayload).eq("id", existing.id).select("id").maybeSingle()
    : await client.from("admin_users").insert(adminPayload).select("id").maybeSingle();
  if (result.error || !result.data?.id) return { ok: false, message: serviceRoleErrorMessage("Không thể tạo/cập nhật admin user", result.error?.message ?? "unknown error") };

  try {
    await upsertScope(client, {
      authUserId: auth.authUserId,
      programId: input.programId,
      seasonId: input.seasonId,
      role: input.scopeRole,
      status: input.scopeStatus
    });
  } catch (scopeError: any) {
    return { ok: false, message: scopeError.message };
  }

  const after = await snapshotAdminUser(client, result.data.id);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: existing?.id ? "update_admin_user" : "create_admin_user",
    targetAdminUserId: result.data.id,
    beforeData: before,
    afterData: after
  });

  return { ok: true, message: auth.created ? "Đã gửi lời mời và tạo tài khoản ở trạng thái đã mời." : "Đã cập nhật tài khoản hiện có an toàn." };
  */
}

export async function updateManagedAdminUser(input: {
  id: unknown;
  fullName: unknown;
  role: unknown;
  status: unknown;
  scopeId: unknown;
  programId: unknown;
  seasonId: unknown;
  scopeRole: unknown;
  scopeStatus: unknown;
}): Promise<AdminUserMutationResult> {
  const actor = await requireSuperAdmin();
  if (!actor) return { ok: false, message: "Chỉ super_admin mới được chỉnh sửa người dùng nội bộ." };

  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, message: "Thiếu admin user id." };

  const nextRole = validRole(input.role);
  const nextStatus = validStatus(input.status);
  if (await wouldRemoveLastActiveSuperAdmin(client, id, nextRole, nextStatus)) {
    return { ok: false, message: "Không thể tạm khóa hoặc hạ quyền super_admin active cuối cùng." };
  }

  const before = await snapshotAdminUser(client, id);
  if (!before) return { ok: false, message: "Không tìm thấy admin user." };
  const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", { p_actor_admin_user_id: actor.id, p_operation: "update", p_target_admin_user_id: id, p_payload: { full_name: cleanText(input.fullName), role: nextRole, status: nextStatus, scope_id: String(input.scopeId??""), program_id: scopeText(input.programId,"VAM"), season_id: scopeText(input.seasonId,SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE), scope_role: validScopeRole(input.scopeRole), scope_status: validScopeStatus(input.scopeStatus) } });
  if (atomicError) return { ok: false, message: "Không thể cập nhật tài khoản và audit trong cùng giao dịch." };
  return { ok: true, message: "Đã cập nhật người dùng và phân quyền." };
  /* Legacy direct-write path retained unreachable for rollback comparison; remove after staging RPC verification.

  const { error: updateError } = await client
    .from("admin_users")
    .update({
      full_name: cleanText(input.fullName),
      role: nextRole,
      status: nextStatus
    })
    .eq("id", id);
  if (updateError) return { ok: false, message: `Không thể cập nhật admin user: ${updateError.message}` };

  if (before.user?.auth_user_id) {
    try {
      await upsertScope(client, {
        authUserId: before.user.auth_user_id,
        scopeId: String(input.scopeId ?? ""),
        programId: input.programId,
        seasonId: input.seasonId,
        role: input.scopeRole,
        status: input.scopeStatus
      });
    } catch (scopeError: any) {
      return { ok: false, message: scopeError.message };
    }
  }

  const after = await snapshotAdminUser(client, id);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: "update_admin_user",
    targetAdminUserId: id,
    beforeData: before,
    afterData: after
  });

  return { ok: true, message: "Đã cập nhật người dùng và phân quyền." };
  */
}

export async function setManagedAdminUserStatus(id: unknown, status: unknown): Promise<AdminUserMutationResult> {
  const actor = await requireSuperAdmin();
  if (!actor) return { ok: false, message: "Chỉ super_admin mới được đổi trạng thái người dùng." };
  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const targetId = String(id ?? "").trim();
  const nextStatus = validStatus(status);
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const { data: current } = await client.from("admin_users").select("role,status,auth_user_id").eq("id", targetId).maybeSingle();
  const nextRole = validRole(current?.role);
  if (current?.status === "invited" && nextStatus === "active") {
    if (!current.auth_user_id) return { ok: false, message: "Tài khoản chưa liên kết Auth nên chưa thể kích hoạt." };
    const { data: authData, error: authError } = await client.auth.admin.getUserById(current.auth_user_id);
    if (authError || !authData?.user?.email_confirmed_at) {
      return { ok: false, message: "Người dùng chưa hoàn tất xác nhận thông tin đăng nhập; trạng thái vẫn là đã mời." };
    }
  }
  if (await wouldRemoveLastActiveSuperAdmin(client, targetId, nextRole, nextStatus)) {
    return { ok: false, message: "Không thể tạm khóa super_admin active cuối cùng." };
  }
  const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", { p_actor_admin_user_id: actor.id, p_operation: "status", p_target_admin_user_id: targetId, p_payload: { status: nextStatus } });
  if (atomicError) return { ok: false, message: "Không thể đổi trạng thái và ghi audit trong cùng giao dịch." };
  return { ok: true, message: nextStatus === "active" ? "Đã kích hoạt lại người dùng." : "Đã tạm khóa người dùng. Supabase Auth user không bị xóa." };
  /* Legacy direct-write path retained unreachable for rollback comparison; remove after staging RPC verification.

  const before = await snapshotAdminUser(client, targetId);
  const { error: updateError } = await client.from("admin_users").update({ status: nextStatus }).eq("id", targetId);
  if (updateError) return { ok: false, message: `Không thể đổi trạng thái: ${updateError.message}` };

  if (current?.auth_user_id) {
    await client.from("admin_scope_access").update({ status: nextStatus === "active" ? "active" : "inactive" }).eq("user_id", current.auth_user_id);
  }

  const after = await snapshotAdminUser(client, targetId);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: nextStatus === "active" ? "reactivate_admin_user" : "deactivate_admin_user",
    targetAdminUserId: targetId,
    beforeData: before,
    afterData: after
  });

  return { ok: true, message: nextStatus === "active" ? "Đã kích hoạt lại người dùng." : "Đã tạm khóa người dùng. Supabase Auth user không bị xóa." };
  */
}

export async function removeManagedAdminAccess(id: unknown): Promise<AdminUserMutationResult> {
  const actor = await requireSuperAdmin();
  if (!actor) return { ok: false, message: "Chỉ super_admin mới được xóa quyền admin." };
  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const targetId = String(id ?? "").trim();
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const { data: current } = await client.from("admin_users").select("role,status,auth_user_id").eq("id", targetId).maybeSingle();
  if (await wouldRemoveLastActiveSuperAdmin(client, targetId, validRole(current?.role), "inactive")) {
    return { ok: false, message: "Không thể xóa quyền admin của super_admin active cuối cùng." };
  }
  const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", { p_actor_admin_user_id: actor.id, p_operation: "remove", p_target_admin_user_id: targetId, p_payload: {} });
  if (atomicError) return { ok: false, message: "Không thể ngừng quyền và ghi audit trong cùng giao dịch." };
  return { ok: true, message: "Đã ngừng quyền admin trong VAM OS. Supabase Auth user không bị xóa." };
  /* Legacy direct-write path retained unreachable for rollback comparison; remove after staging RPC verification.

  const before = await snapshotAdminUser(client, targetId);
  const { error: updateError } = await client.from("admin_users").update({ status: "inactive" }).eq("id", targetId);
  if (updateError) return { ok: false, message: `Không thể xóa quyền admin: ${updateError.message}` };
  if (current?.auth_user_id) await client.from("admin_scope_access").update({ status: "inactive" }).eq("user_id", current.auth_user_id);

  const after = await snapshotAdminUser(client, targetId);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: "remove_admin_access",
    targetAdminUserId: targetId,
    beforeData: before,
    afterData: after
  });

  return { ok: true, message: "Đã xóa quyền admin trong VAM OS. Supabase Auth user không bị xóa." };
  */
}

export async function syncManagedAdminAuthUser(id: unknown): Promise<AdminUserMutationResult> {
  const actor = await requireSuperAdmin();
  if (!actor) return { ok: false, message: "Chỉ super_admin mới được đồng bộ Auth." };
  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const targetId = String(id ?? "").trim();
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const before = await snapshotAdminUser(client, targetId);
  if (!before?.user) return { ok: false, message: "Không tìm thấy admin user." };
  if (before.user.auth_user_id) {
    await writeAuditLog(client, {
      actorAdminUserId: actor.id,
      actionType: "sync_auth",
      targetAdminUserId: targetId,
      beforeData: before,
      afterData: before
    });
    return { ok: true, message: "Người dùng đã có auth_user_id, không cần đồng bộ." };
  }

  const operationId=randomUUID();
  const auth = await ensureAuthUserForEmail(client, before.user.email);
  if (!auth.authUserId) { if (auth.ownershipAmbiguous) { try { await recordAuthReconciliation(client,String(actor.id),operationId,String(before.user.email??""),"sync_auth","ambiguous_auth_ownership","required"); } catch { return { ok:false,message:"Lỗi nghiêm trọng khi ghi trạng thái đối soát; dừng thử lại tự động." }; } } return { ok: false, message: auth.ownershipAmbiguous ? "Không xác định được quyền sở hữu Auth; trạng thái đối soát đã được ghi nhận." : auth.warning ?? "Không thể tìm hoặc tạo Supabase Auth user." }; }
  const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", { p_actor_admin_user_id: actor.id, p_operation: "link_auth", p_target_admin_user_id: targetId, p_payload: { auth_user_id: auth.authUserId, program_id: "VAM", season_id: SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE, scope_role: scopeRoleForAdminRole(before.user.role), scope_status: before.user.status === "active" ? "active" : "inactive" } });
  if (atomicError) {
    if (auth.created) {
      const compensation = await client.auth.admin.deleteUser(auth.authUserId);
      if(compensation.error){try{await recordAuthReconciliation(client,String(actor.id),operationId,String(before.user.email??""),"sync_auth","auth_compensation_failed","required");return{ok:false,message:"Đồng bộ thất bại; trạng thái đối soát đã được ghi nhận."}}catch{return{ok:false,message:"Lỗi nghiêm trọng khi ghi trạng thái đối soát; dừng thử lại tự động."}}}
      try{await recordAuthReconciliation(client,String(actor.id),operationId,String(before.user.email??""),"sync_auth","database_failed_auth_compensated","resolved")}catch{return{ok:false,message:"Lời mời đã thu hồi nhưng ghi nhận bù trừ thất bại; dừng thử lại tự động."}}
      return { ok: false, message: "Đồng bộ cơ sở dữ liệu thất bại; lời mời mới đã được thu hồi." };
    }
    return { ok: false, message: "Đồng bộ cơ sở dữ liệu và audit thất bại; Auth hiện có không bị thay đổi." };
  }
  return { ok: true, message: "Đã đồng bộ danh tính Auth an toàn." };
  /* Legacy direct-write path retained unreachable for rollback comparison; remove after staging RPC verification.

  const { error: updateError } = await client.from("admin_users").update({ auth_user_id: auth.authUserId }).eq("id", targetId);
  if (updateError) return { ok: false, message: `Không thể cập nhật auth_user_id: ${updateError.message}` };

  try {
    await upsertScope(client, {
      authUserId: auth.authUserId,
      programId: "VAM",
      seasonId: SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE,
      role: scopeRoleForAdminRole(before.user.role),
      status: before.user.status === "active" ? "active" : "inactive"
    });
  } catch (scopeError: any) {
    return { ok: false, message: scopeError.message };
  }

  const after = await snapshotAdminUser(client, targetId);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: "sync_auth",
    targetAdminUserId: targetId,
    beforeData: before,
    afterData: after
  });

  return { ok: true, message: "Đã đồng bộ danh tính Auth an toàn." };
  */
}

export async function deactivateManagedAdminUser(id: unknown): Promise<AdminUserMutationResult> {
  return setManagedAdminUserStatus(id, "inactive");
}
