import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { createHash, randomUUID } from "crypto";
import type { AdminRole, CurrentAdminUser } from "@/lib/auth-constants";
import { getSupabaseServiceRoleClient, getSupabaseServiceRoleEnvStatus } from "@/lib/supabase-server";
import type { JsonRecord } from "@/lib/types";
import { isValidEmail, normalizeEmail } from "@/lib/identity";
import { findExactAuthUsers, resolveAuthOwnership } from "@/lib/account-auth-ownership";
import { executeManualStaffProvisioning, type ProvisioningResult } from "@/lib/manual-staff-provisioning";
import { sendStaffInvite } from "@/lib/email";
import { adminRoleLabel } from "@/lib/ui-labels";
import { getPublicOrigin } from "@/lib/public-url";
import { canManageAdminAccount, canOpenAdminUsers, manageableAdminRoles } from "@/lib/permissions";

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

const CANONICAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalScopeIdentifier(value: unknown) {
  return typeof value === "string" && CANONICAL_ID_PATTERN.test(value.trim());
}

/**
 * The canonical write boundary for a scope grant.
 *
 * Every grant this module persists must name a program and a season by their
 * catalog UUID, proven to exist and proven to belong to each other. A program
 * name, a season code, or any other human-readable identifier is rejected here
 * rather than resolved implicitly — Production already carries one grant that
 * stored a program NAME, which the application's tolerant matching accepted and
 * `vam063_authorized_for_scope`'s exact matching refused. Resolution of
 * human-readable codes belongs at an import/UI boundary that looks them up in
 * the catalog first; it does not belong in the persistence path.
 */
export async function validateExplicitAdminScope(client: any, programValue: unknown, seasonValue: unknown): Promise<
  | { ok: true; programId: string; seasonId: string }
  | { ok: false; result: AdminUserMutationResult }
> {
  const programId = String(programValue ?? "").trim();
  const seasonId = String(seasonValue ?? "").trim();
  const reject = (failureClass: string, message: string) => ({
    ok: false as const,
    result: {
      ok: false,
      status: "rejected" as const,
      failureClass,
      failureStage: "pre_lookup" as const,
      reconciliationRequired: false,
      ownerAction: "none" as const,
      message
    }
  });
  if (!programId) return reject("missing_program", "Phải chọn chương trình hợp lệ. Không có thay đổi nào được thực hiện.");
  if (!seasonId) return reject("missing_season", "Phải chọn season hợp lệ. Không có thay đổi nào được thực hiện.");
  // Reject a non-canonical identifier before it reaches the database, so the
  // failure is a named validation outcome rather than a driver-level cast error.
  if (!isCanonicalScopeIdentifier(programId)) {
    return reject("non_canonical_program", "Chương trình phải được chọn theo định danh chuẩn. Không có thay đổi nào được thực hiện.");
  }
  if (!isCanonicalScopeIdentifier(seasonId)) {
    return reject("non_canonical_season", "Season phải được chọn theo định danh chuẩn. Không có thay đổi nào được thực hiện.");
  }

  const { data: program, error: programError } = await client
    .from("programs")
    .select("id,is_active")
    .eq("id", programId)
    .eq("is_active", true)
    .maybeSingle();
  if (programError || !program?.id) return reject("invalid_program", "Chương trình không tồn tại hoặc không hoạt động. Không có thay đổi nào được thực hiện.");

  const { data: season, error: seasonError } = await client
    .from("seasons")
    .select("id,program_id")
    .eq("id", seasonId)
    .maybeSingle();
  if (seasonError || !season?.id) return reject("invalid_season", "Season không tồn tại. Không có thay đổi nào được thực hiện.");
  if (String(season.program_id) !== String(program.id)) {
    return reject("unrelated_program_season", "Season không thuộc chương trình đã chọn. Không có thay đổi nào được thực hiện.");
  }
  return { ok: true, programId: String(program.id), seasonId: String(season.id) };
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

/**
 * Người mở được trang quản lý tài khoản.
 *
 * Chủ dự án chốt 20/09/2026: admin quản core team, core team quản support team.
 * Trước đó mọi cửa ở file này đều là super_admin, nên một tài khoản support team
 * cấp nhầm phải chờ super admin mới gỡ được.
 *
 * Mở được trang KHÔNG phải là sửa được mọi dòng: từng thao tác còn đi qua
 * `requireManagerOf`, và danh sách chỉ trả về những tài khoản người mở quản được.
 */
export async function requireAdminAccountManager(): Promise<CurrentAdminUser | null> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser || adminUser.status !== "active") return null;
    return canOpenAdminUsers(adminUser.role) ? adminUser : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Dynamic server usage")) throw error;
    logAdminUsersRuntime("requireAdminAccountManager failed", { message });
    return null;
  }
}

/**
 * Người này có được đụng vào tài khoản kia không — đọc vai trò đích từ DATABASE.
 *
 * Không nhận vai trò đích từ nơi gọi: một tham số "support_team" gửi kèm về một
 * dòng core_team chính là cách đi vòng qua bậc quản lý.
 */
async function requireManagerOf(
  client: any,
  targetId: string
): Promise<{ ok: true; actor: CurrentAdminUser; targetRole: AdminRole } | { ok: false; message: string }> {
  const actor = await requireAdminAccountManager();
  if (!actor) return { ok: false, message: "Bạn không có quyền quản lý tài khoản ban tổ chức." };
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };
  if (actor.id === targetId) return { ok: false, message: "Không tự thao tác trên tài khoản của chính mình." };

  const { data, error } = await client.from("admin_users").select("role").eq("id", targetId).maybeSingle();
  if (error) {
    logAdminUsersRuntime("requireManagerOf lookup failed", { message: error.message });
    return { ok: false, message: "Không đọc được tài khoản đích." };
  }
  if (!data) return { ok: false, message: "Không tìm thấy tài khoản này." };

  const targetRole = validRole((data as JsonRecord).role);
  if (!canManageAdminAccount(actor.role, targetRole)) {
    return { ok: false, message: `Bạn không có quyền thao tác trên tài khoản cấp ${targetRole}.` };
  }
  return { ok: true, actor, targetRole };
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
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
    const access = await requireAdminAccountManager();
    if (!access) return { data: [], error: "Bạn không có quyền truy cập trang quản lý người dùng." };
    // Danh sách cắt theo bậc quản lý, không cắt ở giao diện: một trang ẩn nút
    // nhưng vẫn trả về cả danh bạ là một trang đã lộ dữ liệu rồi.
    const visibleRoles = new Set(manageableAdminRoles(access.role));

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

    const users = ((data ?? []) as Omit<ManagedAdminUser, "scopes">[])
      .map((user) => ({
        ...user,
        email: user.email ?? "",
        role: validRole(user.role),
        status: validStatus(user.status)
      }))
      // Chính mình luôn hiện, để người mở trang thấy được mình đang là ai; mọi
      // thao tác trên dòng đó đã bị requireManagerOf chặn sẵn.
      .filter((user) => user.id === access.id || visibleRoles.has(user.role));
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

/**
 * Persist one scope grant.
 *
 * Two rules this function is responsible for:
 *
 *  1. CANONICAL IDENTITY OR NOTHING. It previously substituted the literals
 *     "VAM" and SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE when the caller
 *     supplied no program or season. Those are a program that exists in no
 *     catalog and a hard-coded season code — exactly the non-canonical shape
 *     WP1-A2 has to convert away. A missing or unresolvable identity is now a
 *     rejection, never a guess.
 *
 *  2. HISTORY IS NOT REVIVED. The existence probe is restricted to ACTIVE
 *     grants. An inactive grant is a retired authority; re-provisioning the
 *     same scope mints a new active grant beside it rather than silently
 *     flipping the retired one back on. Full reconciliation of overlapping
 *     grants belongs to WP1-C.
 */
export async function upsertScope(client: any, input: {
  authUserId: string;
  scopeId?: string | null;
  programId?: unknown;
  seasonId?: unknown;
  role?: unknown;
  status?: unknown;
}) {
  const canonical = await validateExplicitAdminScope(client, input.programId, input.seasonId);
  if (!canonical.ok) throw new Error(canonical.result.message);

  const payload = {
    user_id: input.authUserId,
    program_id: canonical.programId,
    season_id: canonical.seasonId,
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
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (existingError) throw new Error(`KhĂ´ng thá»ƒ kiá»ƒm tra phĂ¢n quyá»n hiá»‡n cĂ³: ${existingError.message}`);

  const existing = existingRows?.[0];

  // Nothing active to change and nothing being granted: retiring an already
  // retired scope must not insert a fresh inactive history row.
  if (!existing?.id && payload.status !== "active") return;

  const result = existing?.id
    ? await client.from("admin_scope_access").update(payload).eq("id", existing.id)
    : await client.from("admin_scope_access").insert(payload);
  if (result.error) throw new Error(`Không thể lưu phân quyền: ${result.error.message}`);
}

/**
 * Tạo tài khoản Auth cho một địa chỉ và lấy về mã đặt mật khẩu một lần.
 *
 * Thay cho `inviteUserByEmail`, vốn làm hai việc trong một lệnh: tạo tài khoản
 * VÀ tự gửi thư. Thư tự gửi đó mang đường dẫn về Site URL của Supabase — một
 * đường không nằm trong ba đường được phép dựng phiên từ mảnh `#` của sản phẩm,
 * nên người nhận bấm vào là rơi vào ngõ cụt.
 *
 * `generateLink` tạo đúng tài khoản ấy nhưng KHÔNG gửi gì, và trả về
 * `hashed_token` để mình tự dựng đường dẫn về /reset-password rồi gửi qua Brevo.
 *
 * Ba phép kiểm trước khi tin kết quả, chép khuôn đã chạy thật ở
 * `lib/enable-reviewer.ts`. Phép thứ ba là phép quan trọng: Supabase trả về
 * email của tài khoản mà mã này thuộc về, và nó phải khớp đúng người mình định
 * mời. Lệch nghĩa là mã của người khác — gửi đi là trao quyền vào nhầm tay.
 */
async function generateStaffPasswordLink(
  client: any,
  type: "invite" | "recovery",
  email: string
): Promise<{ ok: true; userId: string; tokenHash: string } | { ok: false }> {
  try {
    const { data, error } = await client.auth.admin.generateLink({ type, email });
    if (error) {
      logAdminUsersRuntime("staff generateLink failed", {
        type,
        code: error.code ?? error.status ?? null
      });
      return { ok: false };
    }
    const userId = String(data?.user?.id ?? "").trim();
    const userEmail = String(data?.user?.email ?? "").trim().toLowerCase();
    const tokenHash = String(data?.properties?.hashed_token ?? "").trim();
    if (!userId || !tokenHash || userEmail !== email) {
      logAdminUsersRuntime("staff generateLink returned a link that does not match the recipient", { type });
      return { ok: false };
    }
    return { ok: true, userId, tokenHash };
  } catch (error) {
    logAdminUsersRuntime("staff generateLink threw", { type, message: (error as Error)?.message ?? null });
    return { ok: false };
  }
}

export async function createManagedAdminUser(input: {
  operationId?: unknown;
  email: unknown;
  fullName: unknown;
  role: unknown;
  /** Bỏ qua: tài khoản mới luôn được kích hoạt ngay. Giữ để nơi gọi cũ không vỡ. */
  status?: unknown;
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
  const validatedScope = await validateExplicitAdminScope(client, input.programId, input.seasonId);
  if (!validatedScope.ok) return validatedScope.result;

  const requestedOperationId = String(input.operationId ?? "").trim();
  const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedOperationId)
    ? requestedOperationId
    : randomUUID();
  const emailHash = createHash("sha256").update(email, "utf8").digest("hex");
  const authHash = (id: string | null) => id ? createHash("sha256").update(id, "utf8").digest("hex") : null;
  // Mã đặt mật khẩu do bước `invite` lấy về. Giữ ở đây vì chuỗi cung cấp chỉ
  // trả về được id tài khoản Auth, mà thư thì cần cả mã.
  let inviteTokenHash: string | null = null;
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
    invite: async () => {
      const generated = await generateStaffPasswordLink(client, "invite", email);
      if (!generated.ok) return { id: null, error: true };
      inviteTokenHash = generated.tokenHash;
      return { id: generated.userId, error: false };
    },
    postLookup: () => findExactAuthUsers(client, email).then((lookup) => ({ ok: lookup.ok, ids: lookup.users.map((user) => user.id) })),
    // Tạo là kích hoạt luôn. Bước cũ "đã mời → chờ bấm Kích hoạt" không kiểm thêm
    // được gì về danh tính — người bấm chỉ thấy email đã xác nhận — mà chặn người
    // được mời ngay ở cửa: 13/09/2026 chị Thảo đặt mật khẩu xong, đăng nhập đúng
    // mật khẩu 6 lần và lần nào cũng bị đẩy ra. Mật khẩu vẫn chỉ có qua link trong
    // thư, nên tài khoản active mà chưa đặt mật khẩu thì cũng chưa ai vào được.
    commitApplication: async (authUserId) => {
      const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", {
        p_actor_admin_user_id: actor.id, p_operation: "upsert", p_target_admin_user_id: null,
        p_payload: { auth_user_id: authUserId, email, full_name: cleanText(input.fullName), role: validRole(input.role), status: "active", program_id: validatedScope.programId, season_id: validatedScope.seasonId, scope_role: validScopeRole(input.scopeRole), scope_status: validScopeStatus(input.scopeStatus) }
      });
      if (atomicError) { logSafe("application", "application_mutation_failed", atomicError.code); throw new Error("APPLICATION_MUTATION_FAILED"); }
    },
    compensate: async (authUserId) => { const compensation = await client.auth.admin.deleteUser(authUserId); if (compensation.error) { logSafe("compensation", "auth_compensation_failed", compensation.error.code); throw new Error("COMPENSATION_FAILED"); } },
    recordReconciliation: (failureClass, resolved) => recordAuthReconciliation(client, String(actor.id), operationId, email, "create_admin_user", failureClass, resolved ? "resolved" : "required")
  });
  const reference = `Mã tham chiếu: ${result.operationId}`;
  const base = { ...result, operationId: result.operationId };
  if (result.ok) {
    // Thư gửi SAU khi tài khoản đã ghi xong, không phải trước: thư đi rồi mà
    // ghi hỏng thì người nhận cầm một đường dẫn trỏ tới tài khoản không tồn tại.
    // Thứ tự này đổi lại thành trường hợp dễ chịu hơn — tài khoản có thật,
    // thư chưa tới, và gửi lại được.
    const created = await client.from("admin_users").select("id").eq("email", email).maybeSingle();
    const delivery = await sendStaffInvite({
      toEmail: email,
      fullName: cleanText(input.fullName) ?? email,
      roleLabel: adminRoleLabel(validRole(input.role)),
      linkType: "invite",
      tokenHash: inviteTokenHash ?? "",
      adminUserId: String(created?.data?.id ?? "").trim() || null,
      // Production không đặt VAM_OS_PUBLIC_BASE_URL, nên địa chỉ của chính request
      // là nguồn duy nhất để dựng link. Thiếu dòng này, thư mời nhân sự đầu tiên
      // trên production (13/09/2026) không dựng được link và không đi.
      requestOrigin: await getPublicOrigin()
    });

    if (delivery.ok) {
      return { ...base, message: `Đã tạo và kích hoạt tài khoản, và gửi thư mời đặt mật khẩu. Người nhận đặt mật khẩu xong là đăng nhập được. ${reference}` };
    }

    // Nói rõ là CHƯA gửi được, chứ không gộp vào một câu "đã gửi lời mời".
    // Người vận hành tin câu báo này rồi đi chờ; báo sai thì họ chờ một lá thư
    // không bao giờ tới, và người được mời thì tưởng mình bị bỏ quên.
    logAdminUsersRuntime("staff invite email not delivered", {
      operationId,
      skipped: delivery.skipped,
      reason: delivery.reason ?? null
    });
    const why = delivery.reason ? ` Lý do: ${delivery.reason}` : "";
    return {
      ...base,
      message: `Đã tạo và kích hoạt tài khoản, nhưng CHƯA gửi được thư mời.${why} Bấm "Gửi link đặt mật khẩu" ở dòng tài khoản để gửi lại. ${reference}`
    };
  }
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

/** Sửa tài khoản: theo bậc quản lý, không còn là đặc quyền của super admin. */
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
  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false, message: "Thiếu admin user id." };

  const manager = await requireManagerOf(client, id);
  if (!manager.ok) return { ok: false, message: manager.message };
  const actor = manager.actor;

  // Không nâng người khác lên cấp mình không quản được: core team sửa một tài
  // khoản support team thành admin là tự cấp cho mình một cấp trên.
  const nextRole = validRole(input.role);
  if (!canManageAdminAccount(actor.role, nextRole)) {
    return { ok: false, message: `Bạn không thể đặt tài khoản này thành cấp ${nextRole}.` };
  }

  const validatedScope = await validateExplicitAdminScope(client, input.programId, input.seasonId);
  if (!validatedScope.ok) return validatedScope.result;

  const nextStatus = validStatus(input.status);
  if (await wouldRemoveLastActiveSuperAdmin(client, id, nextRole, nextStatus)) {
    return { ok: false, message: "Không thể tạm khóa hoặc hạ quyền super_admin active cuối cùng." };
  }

  const before = await snapshotAdminUser(client, id);
  if (!before) return { ok: false, message: "Không tìm thấy admin user." };
  const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", { p_actor_admin_user_id: actor.id, p_operation: "update", p_target_admin_user_id: id, p_payload: { full_name: cleanText(input.fullName), role: nextRole, status: nextStatus, scope_id: String(input.scopeId??""), program_id: validatedScope.programId, season_id: validatedScope.seasonId, scope_role: validScopeRole(input.scopeRole), scope_status: validScopeStatus(input.scopeStatus) } });
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

/**
 * Gửi link đặt mật khẩu cho một tài khoản nhân sự đang hoạt động hoặc còn ở
 * trạng thái đã mời.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CẦN ĐƯỜNG NÀY
 * ---------------------------------------------------------------------------
 * Tạo lại tài khoản không phải là cách gửi lại thư: luồng tạo từ chối mọi địa chỉ
 * đã có tài khoản đăng nhập. Nên một lá thư mời hỏng — link hết hạn, hộp thư lọc
 * mất, hoặc máy chủ không dựng được link như thư mời nhân sự đầu tiên trên
 * production — trước đây để lại một tài khoản không ai vào được và không có đường
 * nào cứu.
 *
 * Mỗi lần gửi lại tạo một link MỚI; link cũ hết dùng được.
 *
 * Dùng được cho tài khoản đang hoạt động: người đã đặt mật khẩu mà quên nó nhận
 * link `recovery`, dẫn tới đúng trang đặt mật khẩu. Tài khoản đang khoá thì từ
 * chối — gửi link đăng nhập cho người bị khoá là mở lại cánh cửa vừa đóng.
 */
export async function resendManagedAdminInvite(id: unknown): Promise<AdminUserMutationResult> {
  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const targetId = String(id ?? "").trim();
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const manager = await requireManagerOf(client, targetId);
  if (!manager.ok) return { ok: false, message: manager.message };
  const actor = manager.actor;

  const { data: current, error: readError } = await client
    .from("admin_users")
    .select("id,email,full_name,role,status,auth_user_id")
    .eq("id", targetId)
    .maybeSingle();
  if (readError || !current) return { ok: false, message: "Không tìm thấy người dùng." };
  if (current.status !== "invited" && current.status !== "active") {
    return { ok: false, message: "Tài khoản đang tạm khóa hoặc đã ngừng quyền. Kích hoạt lại trước rồi mới gửi link đặt mật khẩu." };
  }

  const email = normalizeEmail(current.email);
  if (!isValidEmail(email)) return { ok: false, message: "Tài khoản này chưa có địa chỉ email hợp lệ." };
  if (!current.auth_user_id) {
    return { ok: false, message: "Tài khoản chưa liên kết Auth. Bấm Đồng bộ Auth trước rồi gửi lại." };
  }

  const { data: authData, error: authError } = await client.auth.admin.getUserById(current.auth_user_id);
  if (authError || !authData?.user) {
    return { ok: false, message: "Không đọc được tài khoản đăng nhập của người này." };
  }
  // Người đã xác nhận email thì đi thẳng `recovery`: họ đã có mật khẩu, chỉ cần
  // đặt lại. Người chưa thì `invite` đúng nghĩa; Supabase có thể từ chối vì địa
  // chỉ đã có tài khoản — khi đó `recovery` dẫn tới cùng một trang đặt mật khẩu,
  // và đó là đường mời reviewer đang chạy được trên production.
  let linkType: "invite" | "recovery" = authData.user.email_confirmed_at ? "recovery" : "invite";
  let generated = await generateStaffPasswordLink(client, linkType, email);
  if (!generated.ok && linkType === "invite") {
    linkType = "recovery";
    generated = await generateStaffPasswordLink(client, "recovery", email);
  }

  // Mã phải thuộc ĐÚNG tài khoản đăng nhập đang nối với dòng nhân sự này. Lệch
  // nghĩa là địa chỉ đang thuộc về một tài khoản khác — gửi đi là trao quyền vào
  // nhầm tay.
  if (!generated.ok || generated.userId !== current.auth_user_id) {
    return { ok: false, message: "Không tạo được đường dẫn đặt mật khẩu mới cho tài khoản này." };
  }

  const delivery = await sendStaffInvite({
    toEmail: email,
    fullName: cleanText(current.full_name) ?? email,
    roleLabel: adminRoleLabel(validRole(current.role)),
    linkType,
    tokenHash: generated.tokenHash,
    adminUserId: targetId,
    requestOrigin: await getPublicOrigin()
  });

  // Ghi nhật ký cả khi thư hỏng: link mới đã được tạo và link cũ đã hết dùng —
  // đó là một thay đổi có thật trên tài khoản, dù thư có tới hay không. Không ghi
  // email, không ghi mã.
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: "update_admin_user",
    targetAdminUserId: targetId,
    afterData: { staff_invite_resent: true, link_type: linkType, delivered: delivery.ok }
  });

  if (!delivery.ok) {
    const why = delivery.reason ? ` Lý do: ${delivery.reason}` : "";
    return {
      ok: false,
      message: `Đã tạo link mới nhưng CHƯA gửi được thư.${why} Xem Nhật ký gửi để biết chi tiết.`
    };
  }
  return {
    ok: true,
    message: `Đã gửi thư đặt mật khẩu tới ${email}. Link trong thư trước (nếu có) không còn dùng được.`
  };
}

/**
 * Payload kích hoạt cho `vam062_admin_mutation_atomic` (thao tác `status`).
 *
 * Hàm SQL chỉ đụng đúng một phạm vi khi payload nêu program/season/scope_role.
 * Không nêu thì nó rơi vào nhánh TẮT MỌI phạm vi đang bật — kể cả khi đang kích
 * hoạt. Gọi trần `{ status: "active" }` vì thế vừa kích hoạt tài khoản vừa tước
 * sạch quyền của chính người đó: đăng nhập được mà không thấy mùa nào.
 *
 * Nên kích hoạt luôn nêu một phạm vi đang bật: hàm bật lại đúng phạm vi ấy (vốn
 * đã bật) và để yên các phạm vi khác. Không có phạm vi nào đang bật thì nhánh
 * kia cũng không còn gì để tắt, gọi trần là an toàn.
 *
 * Trả null khi không an toàn để gọi: đọc bảng hỏng, hoặc có phạm vi đang bật mà
 * không nêu được đích danh (thiếu program/season). Thà chưa kích hoạt còn hơn
 * kích hoạt mà tắt nhầm quyền.
 */
async function activationPayload(client: any, authUserId: unknown): Promise<JsonRecord | null> {
  const authId = String(authUserId ?? "").trim();
  if (!authId) return { status: "active" };
  const { data, error } = await client
    .from("admin_scope_access")
    .select("program_id,season_id,role")
    .eq("user_id", authId)
    .eq("status", "active")
    .order("id", { ascending: true })
    .limit(50);
  if (error || !Array.isArray(data)) return null;
  if (!data.length) return { status: "active" };
  const named = data.find((scope: any) => cleanText(scope?.program_id) && cleanText(scope?.season_id) && cleanText(scope?.role));
  if (!named) return null;
  return { status: "active", program_id: named.program_id, season_id: named.season_id, scope_role: named.role };
}

export async function setManagedAdminUserStatus(id: unknown, status: unknown): Promise<AdminUserMutationResult> {
  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const targetId = String(id ?? "").trim();
  const nextStatus = validStatus(status);
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const manager = await requireManagerOf(client, targetId);
  if (!manager.ok) return { ok: false, message: manager.message };
  const actor = manager.actor;

  const { data: current } = await client.from("admin_users").select("role,status,auth_user_id").eq("id", targetId).maybeSingle();
  const nextRole = validRole(current?.role);
  // Kích hoạt người "đã mời" không còn đòi xác nhận email trước. Chờ xác nhận
  // không chứng minh thêm được gì — người bấm chỉ thấy một mốc thời gian — mà
  // chặn người vừa đặt mật khẩu ở cửa đăng nhập.
  if (current?.status === "invited" && nextStatus === "active" && !current.auth_user_id) {
    return { ok: false, message: "Tài khoản chưa liên kết Auth nên chưa thể kích hoạt." };
  }
  if (await wouldRemoveLastActiveSuperAdmin(client, targetId, nextRole, nextStatus)) {
    return { ok: false, message: "Không thể tạm khóa super_admin active cuối cùng." };
  }
  const payload = nextStatus === "active" ? await activationPayload(client, current?.auth_user_id) : { status: nextStatus };
  if (!payload) {
    return { ok: false, message: "Chưa kích hoạt: không xác định được phạm vi đang bật của người dùng, nên dừng lại để không tắt nhầm quyền." };
  }
  const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", { p_actor_admin_user_id: actor.id, p_operation: "status", p_target_admin_user_id: targetId, p_payload: payload });
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
  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const targetId = String(id ?? "").trim();
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const manager = await requireManagerOf(client, targetId);
  if (!manager.ok) return { ok: false, message: manager.message };
  const actor = manager.actor;

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

  const operationId = randomUUID();
  const rejectSync = (failureClass: string, message: string, reconciliationRequired = false): AdminUserMutationResult => ({
    ok: false, status: "rejected", failureClass, failureStage: "pre_lookup", operationId,
    reconciliationRequired, ownerAction: reconciliationRequired ? "manual_reconciliation" : "do_not_retry",
    message: `${message} Mã tham chiếu: ${operationId}`
  });

  const identityLookup = await findExactAuthUsers(client, before.user.email);
  if (!identityLookup.ok) return rejectSync("sync_identity_lookup_failed", "Không thể xác minh danh tính Auth. Không tự động thử lại.", true);
  if (identityLookup.users.length === 0) return rejectSync("sync_identity_missing", "Không có danh tính Auth hiện hữu để đồng bộ. Hãy dùng quy trình Sửa tài khoản/scope rõ ràng.");
  if (identityLookup.users.length !== 1) return rejectSync("sync_identity_ambiguous", "Có nhiều danh tính hoặc quyền sở hữu không rõ ràng. Hãy đối soát trước khi đồng bộ.", true);

  const authUserId = identityLookup.users[0].id;
  const scopeResult = await getScopesForAuthUsers(client, [authUserId]);
  if (scopeResult.error) return rejectSync("sync_scope_lookup_failed", "Không thể xác minh scope hiện hữu. Không tự động thử lại.", true);
  if (scopeResult.data.length === 0) return rejectSync("sync_scope_missing", "Tài khoản chưa có scope sử dụng được. Hãy dùng quy trình Sửa tài khoản/scope rõ ràng.");
  if (scopeResult.data.length !== 1) return rejectSync("sync_scope_ambiguous", "Tài khoản có nhiều scope; hệ thống không tự chọn. Hãy dùng quy trình Sửa tài khoản/scope rõ ràng.");

  const scope = scopeResult.data[0];
  if (scope.status !== "active") return rejectSync("sync_scope_inactive", "Scope hiện hữu không active và không thể được kích hoạt ngầm qua Đồng bộ Auth.");
  if (!SCOPE_ROLES.has(String(scope.role))) return rejectSync("sync_scope_role_invalid", "Scope hiện hữu có cấp quyền không hợp lệ.");
  const validatedScope = await validateExplicitAdminScope(client, scope.program_id, scope.season_id);
  if (!validatedScope.ok) return { ...validatedScope.result, operationId, ownerAction: "do_not_retry", message: `${validatedScope.result.message} Hãy dùng quy trình Sửa tài khoản/scope rõ ràng. Mã tham chiếu: ${operationId}` };

  const { error: atomicError } = await client.rpc("vam062_admin_mutation_atomic", {
    p_actor_admin_user_id: actor.id, p_operation: "link_auth", p_target_admin_user_id: targetId,
    p_payload: { auth_user_id: authUserId, program_id: validatedScope.programId, season_id: validatedScope.seasonId, scope_role: scope.role, scope_status: scope.status }
  });
  if (atomicError) return rejectSync("sync_atomic_link_failed", "Không thể hoàn tất liên kết Auth và audit. Không có scope mặc định nào được tạo.", true);
  return { ok: true, status: "created", operationId, reconciliationRequired: false, ownerAction: "none", message: `Đã đồng bộ danh tính Auth và giữ nguyên scope hiện hữu. Mã tham chiếu: ${operationId}` };
}

export async function deactivateManagedAdminUser(id: unknown): Promise<AdminUserMutationResult> {
  return setManagedAdminUserStatus(id, "inactive");
}

// ───────────────────────────────────────────────────────────────────────────
// Xoá hẳn một tài khoản ban tổ chức
// ───────────────────────────────────────────────────────────────────────────
//
// KHÁC "Ngừng quyền admin", và khác ở chỗ quan trọng nhất: đường kia đặt status
// về inactive và cố ý GIỮ tài khoản Auth, còn đường này xoá dòng khỏi database
// và xoá luôn danh tính đăng nhập.
//
// Nên nó chỉ nhận những tài khoản CHƯA để lại dấu vết công việc — chưa chấm bài,
// chưa ra quyết định, chưa có thao tác nào vào nhật ký. Tài khoản đã làm việc mà
// bị xoá thì mọi dòng nhật ký trỏ về một mã không còn ai mang, và câu hỏi "ai đã
// duyệt hồ sơ này" mất câu trả lời vĩnh viễn. Hàm vam097_admin_account_delete_report
// giữ đúng danh sách đó, và hàm xoá hỏi lại chính nó.

/** Nhãn tiếng Việt cho từng khoá trong bản kê tài khoản. */
export const ACCOUNT_BLOCKER_LABELS: Record<string, string> = {
  bai_cham_dang_hoac_da_lam: "bài chấm đang làm hoặc đã làm",
  da_phan_cong_bai_cham: "lượt phân công bài chấm do người này tạo",
  quyet_dinh_ket_qua: "quyết định kết quả hồ sơ",
  thao_tac_da_ghi_nhat_ky: "thao tác đã ghi nhật ký",
  dot_phan_cong: "đợt phân công đã tạo",
  loi_moi_da_tao: "lời mời mùa đã tạo",
  su_kien_phan_cong: "sự kiện phân công",
  thao_tac_tai_khoan: "thao tác tài khoản",
  sua_cong_tac_form: "lần bật/tắt form ứng tuyển",
  sua_chu_tren_form: "lần sửa chữ trên form",
  quy_tac_diem_cong: "quy tắc điểm cộng đã tạo"
};

export const ACCOUNT_REMOVE_LABELS: Record<string, string> = {
  bai_cham_da_huy: "phân công chấm đã huỷ",
  su_kien_phan_cong_cu: "dòng sự kiện phân công cũ",
  pham_vi: "phạm vi truy cập"
};

export type AccountCountEntry = { key: string; label: string; total: number };

export type AdminAccountDeleteReport = {
  found: boolean;
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
  blockers: AccountCountEntry[];
  removes: AccountCountEntry[];
  canDelete: boolean;
};

function accountEntries(source: unknown, labels: Record<string, string>): AccountCountEntry[] {
  const raw = (source ?? {}) as JsonRecord;
  return Object.keys(raw)
    .map((key) => ({ key, label: labels[key] ?? key, total: Number((raw as any)[key]) || 0 }))
    .filter((entry) => entry.total > 0)
    .sort((left, right) => right.total - left.total || left.key.localeCompare(right.key));
}

/** Bản kê: xoá tài khoản này thì mất gì, và cái gì đang chặn. */
export async function getAdminAccountDeleteReport(
  id: unknown
): Promise<{ ok: boolean; message?: string; report?: AdminAccountDeleteReport; allowed?: boolean }> {
  const targetId = String(id ?? "").trim();
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const manager = await requireManagerOf(client, targetId);
  if (!manager.ok) return { ok: false, message: manager.message, allowed: false };

  const { data, error: rpcError } = await client.rpc("vam097_admin_account_delete_report", { p_target: targetId });
  if (rpcError) {
    logAdminUsersRuntime("account delete report failed", { message: rpcError.message });
    return { ok: false, message: "Không đọc được bản kê tài khoản." };
  }

  const payload = (data ?? {}) as JsonRecord;
  if (payload.found !== true) return { ok: false, message: "Không tìm thấy tài khoản này." };
  const account = (payload.account ?? {}) as JsonRecord;

  return {
    ok: true,
    allowed: true,
    report: {
      found: true,
      id: targetId,
      fullName: String(account.full_name ?? "").trim(),
      email: String(account.email ?? "").trim(),
      role: String(account.role ?? ""),
      status: String(account.status ?? ""),
      blockers: accountEntries(payload.blockers, ACCOUNT_BLOCKER_LABELS),
      removes: accountEntries(payload.removes, ACCOUNT_REMOVE_LABELS),
      canDelete: payload.can_delete === true
    }
  };
}

/**
 * Xoá hẳn.
 *
 * Người bấm phải gõ lại ĐÚNG email của tài khoản. Danh sách tài khoản có những
 * dòng tên gần giống nhau, và một cú bấm nhầm ở đây không hoàn lại được.
 *
 * Tài khoản Auth xoá SAU, bằng API quản trị của Supabase: xoá thẳng `auth.users`
 * trong SQL bỏ qua mọi thứ Supabase dọn kèm một danh tính. Xoá dòng public thành
 * công mà xoá Auth hỏng thì báo rõ, vì lúc đó email kia vẫn chưa dùng lại được.
 */
export async function deleteManagedAdminAccount(input: {
  id: unknown;
  reason: unknown;
  confirmEmail: unknown;
}): Promise<AdminUserMutationResult> {
  const targetId = String(input.id ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  const typed = normalizeEmail(input.confirmEmail);
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };
  if (!reason) return { ok: false, message: "Vui lòng ghi lý do xoá." };

  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const loaded = await getAdminAccountDeleteReport(targetId);
  if (!loaded.ok || !loaded.report) return { ok: false, message: loaded.message ?? "Không đọc được tài khoản." };
  const report = loaded.report;

  if (!typed || typed !== normalizeEmail(report.email)) {
    return { ok: false, message: "Email gõ lại chưa khớp tài khoản này. Kiểm lại đúng người bạn định xoá." };
  }
  if (!report.canDelete) {
    return {
      ok: false,
      message: `Không xoá được: tài khoản này đã có ${report.blockers
        .map((entry) => `${entry.total} ${entry.label}`)
        .join(", ")}. Hãy dùng "Ngừng quyền admin" thay vì xoá.`
    };
  }

  const actor = await requireAdminAccountManager();
  if (!actor) return { ok: false, message: "Bạn không có quyền quản lý tài khoản ban tổ chức." };

  const { data, error: rpcError } = await client.rpc("vam097_delete_admin_account", {
    p_actor: actor.id,
    p_target: targetId,
    p_reason: reason
  });
  if (rpcError) {
    logAdminUsersRuntime("delete admin account failed", { message: rpcError.message });
    const text = String(rpcError.message ?? "");
    if (text.includes("Không xoá được") || text.includes("Bạn không có quyền") || text.includes("Không tìm thấy") || text.includes("Không tự xoá")) {
      return { ok: false, message: text };
    }
    return { ok: false, message: "Không xoá được tài khoản. Xem server logs." };
  }

  const authUserId = String(((data ?? {}) as JsonRecord).auth_user_id ?? "").trim();
  if (authUserId) {
    try {
      const removed = await client.auth.admin.deleteUser(authUserId);
      if (removed.error) {
        return {
          ok: true,
          message: `Đã xoá tài khoản ${report.email} khỏi VAM OS, NHƯNG chưa xoá được danh tính đăng nhập. Email này chưa dùng lại được cho tài khoản mới — báo super admin dọn nốt trong Supabase Auth.`
        };
      }
    } catch {
      return {
        ok: true,
        message: `Đã xoá tài khoản ${report.email} khỏi VAM OS, NHƯNG chưa xoá được danh tính đăng nhập. Email này chưa dùng lại được cho tài khoản mới — báo super admin dọn nốt trong Supabase Auth.`
      };
    }
  }

  return { ok: true, message: `Đã xoá hẳn tài khoản ${report.email} khỏi hệ thống.` };
}
