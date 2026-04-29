import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import type { AdminRole, CurrentAdminUser } from "@/lib/auth-constants";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import type { JsonRecord } from "@/lib/types";

export type AdminUserStatus = "invited" | "active" | "suspended" | "inactive";
export type ScopeRole = "full_access" | "operations" | "review" | "read";
export type ScopeStatus = "active" | "inactive";

export type AdminScopeAccessRow = {
  id: string;
  user_id: string;
  program_id: string | null;
  season_id: string | null;
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
};

const ADMIN_ROLES = new Set(["viewer", "reviewer", "admin", "super_admin"]);
const ADMIN_STATUSES = new Set(["invited", "active", "suspended", "inactive"]);
const SCOPE_ROLES = new Set(["full_access", "operations", "review", "read"]);
const SCOPE_STATUSES = new Set(["active", "inactive"]);

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return {
      client: null,
      error: "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server. Không thể quản lý người dùng an toàn từ UI."
    };
  }
  return { client, error: null };
}

export async function requireSuperAdmin(): Promise<CurrentAdminUser | null> {
  const adminUser = await getCurrentAdminUser();
  if (adminUser?.role !== "super_admin" || adminUser.status !== "active") return null;
  return adminUser;
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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

async function getScopesForAuthUsers(client: any, authUserIds: string[]) {
  if (!authUserIds.length) return [] as AdminScopeAccessRow[];
  const { data, error } = await client
    .from("admin_scope_access")
    .select("id,user_id,program_id,season_id,role,status,created_at,updated_at")
    .in("user_id", authUserIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Không thể tải phân quyền: ${error.message}`);
  return (data ?? []) as AdminScopeAccessRow[];
}

export async function listManagedAdminUsers(): Promise<{ data: ManagedAdminUser[]; error: string | null }> {
  const access = await requireSuperAdmin();
  if (!access) return { data: [], error: "Bạn không có quyền truy cập trang quản lý người dùng." };

  const { client, error } = serviceClient();
  if (!client) return { data: [], error };

  const { data, error: usersError } = await client
    .from("admin_users")
    .select("id,auth_user_id,email,full_name,role,status,created_at,updated_at")
    .order("created_at", { ascending: false });
  if (usersError) return { data: [], error: `Không thể tải admin_users: ${usersError.message}` };

  const users = (data ?? []) as Omit<ManagedAdminUser, "scopes">[];
  const scopes = await getScopesForAuthUsers(client, users.map((user) => user.auth_user_id).filter(Boolean) as string[]);
  const scopesByUserId = new Map<string, AdminScopeAccessRow[]>();
  for (const scope of scopes) {
    scopesByUserId.set(scope.user_id, [...(scopesByUserId.get(scope.user_id) ?? []), scope]);
  }

  return {
    data: users.map((user) => ({
      ...user,
      scopes: user.auth_user_id ? scopesByUserId.get(user.auth_user_id) ?? [] : []
    })) as ManagedAdminUser[],
    error: null
  };
}

export async function listAdminAuditLogs(): Promise<{ data: AdminAuditLogRow[]; error: string | null }> {
  const access = await requireSuperAdmin();
  if (!access) return { data: [], error: "Bạn không có quyền xem nhật ký thay đổi quyền." };

  const { client, error } = serviceClient();
  if (!client) return { data: [], error };

  const { data, error: logsError } = await client
    .from("admin_audit_log")
    .select("id,actor_admin_user_id,action_type,target_admin_user_id,before_data,after_data,created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (logsError) return { data: [], error: `Không thể tải admin_audit_log: ${logsError.message}` };
  return { data: (data ?? []) as AdminAuditLogRow[], error: null };
}

async function snapshotAdminUser(client: any, adminUserId: string) {
  const { data: user } = await client
    .from("admin_users")
    .select("id,auth_user_id,email,full_name,role,status,created_at,updated_at")
    .eq("id", adminUserId)
    .maybeSingle();
  const scopes = user?.auth_user_id ? await getScopesForAuthUsers(client, [user.auth_user_id]) : [];
  return user ? { user, scopes } : null;
}

async function writeAuditLog(client: any, input: {
  actorAdminUserId?: string | null;
  actionType: string;
  targetAdminUserId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
}) {
  await client.from("admin_audit_log").insert({
    actor_admin_user_id: input.actorAdminUserId ?? null,
    action_type: input.actionType,
    target_admin_user_id: input.targetAdminUserId ?? null,
    before_data: input.beforeData ?? null,
    after_data: input.afterData ?? null
  });
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

async function inviteAuthUser(client: any, email: string) {
  const { data, error } = await client.auth.admin.inviteUserByEmail(email);
  if (error) return { authUserId: null as string | null, warning: error.message };
  return { authUserId: data?.user?.id ?? null, warning: null };
}

export async function createManagedAdminUser(input: {
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
  if (!email || !email.includes("@")) return { ok: false, message: "Email không hợp lệ." };

  const invited = await inviteAuthUser(client, email);
  const { data: existing } = await client
    .from("admin_users")
    .select("id,auth_user_id,email,full_name,role,status,created_at,updated_at")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    return { ok: false, message: "Email này đã có trong admin_users. Hãy dùng form chỉnh sửa." };
  }

  const { data: created, error: insertError } = await client
    .from("admin_users")
    .insert({
      email,
      full_name: cleanText(input.fullName),
      role: validRole(input.role),
      status: validStatus(input.status),
      auth_user_id: invited.authUserId
    })
    .select("id,auth_user_id,email,full_name,role,status,created_at,updated_at")
    .maybeSingle();
  if (insertError || !created) return { ok: false, message: `Không thể tạo admin user: ${insertError?.message ?? "unknown error"}` };

  let scopeWarning = "";
  if (created.auth_user_id) {
    const scope = {
      user_id: created.auth_user_id,
      program_id: cleanText(input.programId),
      season_id: cleanText(input.seasonId),
      role: validScopeRole(input.scopeRole),
      status: validScopeStatus(input.scopeStatus)
    };
    const { error: scopeError } = await client.from("admin_scope_access").insert(scope);
    if (scopeError) scopeWarning = ` Phân quyền chưa được lưu: ${scopeError.message}`;
  } else {
    scopeWarning = " Chưa tạo được phân quyền vì Auth invite chưa trả về auth_user_id.";
  }

  const after = await snapshotAdminUser(client, created.id);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: "create_admin_user",
    targetAdminUserId: created.id,
    beforeData: null,
    afterData: after
  });

  const inviteWarning = invited.warning ? ` Invite Auth chưa hoàn tất: ${invited.warning}.` : "";
  return { ok: true, message: `Đã tạo admin user.${inviteWarning}${scopeWarning}` };
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

  const { error: updateError } = await client
    .from("admin_users")
    .update({
      full_name: cleanText(input.fullName),
      role: nextRole,
      status: nextStatus
    })
    .eq("id", id);
  if (updateError) return { ok: false, message: `Không thể cập nhật admin user: ${updateError.message}` };

  const scopeId = String(input.scopeId ?? "").trim();
  if (before.user?.auth_user_id) {
    const scopePayload = {
      user_id: before.user.auth_user_id,
      program_id: cleanText(input.programId),
      season_id: cleanText(input.seasonId),
      role: validScopeRole(input.scopeRole),
      status: validScopeStatus(input.scopeStatus)
    };
    const scopeResult = scopeId
      ? await client.from("admin_scope_access").update(scopePayload).eq("id", scopeId)
      : await client.from("admin_scope_access").insert(scopePayload);
    if (scopeResult.error) return { ok: false, message: `Không thể cập nhật phân quyền: ${scopeResult.error.message}` };
  }

  const after = await snapshotAdminUser(client, id);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: "update_admin_user_access",
    targetAdminUserId: id,
    beforeData: before,
    afterData: after
  });

  return { ok: true, message: "Đã cập nhật người dùng và phân quyền." };
}

export async function deactivateManagedAdminUser(id: unknown): Promise<AdminUserMutationResult> {
  const actor = await requireSuperAdmin();
  if (!actor) return { ok: false, message: "Chỉ super_admin mới được tạm khóa người dùng." };

  const { client, error } = serviceClient();
  if (!client) return { ok: false, message: error };

  const targetId = String(id ?? "").trim();
  if (!targetId) return { ok: false, message: "Thiếu admin user id." };

  const { data: current } = await client
    .from("admin_users")
    .select("role,status")
    .eq("id", targetId)
    .maybeSingle();
  const nextRole = validRole(current?.role);
  if (await wouldRemoveLastActiveSuperAdmin(client, targetId, nextRole, "inactive")) {
    return { ok: false, message: "Không thể tạm khóa super_admin active cuối cùng." };
  }

  const before = await snapshotAdminUser(client, targetId);
  const { error: updateError } = await client.from("admin_users").update({ status: "inactive" }).eq("id", targetId);
  if (updateError) return { ok: false, message: `Không thể tạm khóa người dùng: ${updateError.message}` };

  if (before?.user?.auth_user_id) {
    await client.from("admin_scope_access").update({ status: "inactive" }).eq("user_id", before.user.auth_user_id);
  }

  const after = await snapshotAdminUser(client, targetId);
  await writeAuditLog(client, {
    actorAdminUserId: actor.id,
    actionType: "deactivate_admin_user",
    targetAdminUserId: targetId,
    beforeData: before,
    afterData: after
  });

  return { ok: true, message: "Đã tạm khóa người dùng. Supabase Auth user không bị xóa." };
}
