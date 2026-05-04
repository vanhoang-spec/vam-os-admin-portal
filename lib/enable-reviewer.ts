import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageReviewers } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// ---------------------------------------------------------------------------
// Phase 044A-2 — Enable mentor as reviewer
//
// Behaviour:
//   - Looks up the mentor's email in public.admin_users (case-insensitive).
//   - If the row already exists:
//       · super_admin / admin / core_team → preserve role, optionally re-activate
//       · reviewer (active) → no-op, friendly message
//       · reviewer (inactive / suspended) → set status = active
//       · viewer / support_team (any status) → upgrade role to reviewer, status = active
//   - If no row exists:
//       · Invite or find the Supabase Auth user for that email.
//       · Insert admin_users row: role = reviewer, status = active.
//       · auth_user_id backfill is handled automatically by admin-auth.ts
//         on the reviewer's first login if the Auth invite is not available.
// ---------------------------------------------------------------------------

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

/** Roles that must never be downgraded to reviewer. */
const PRESERVE_ROLES = new Set(["super_admin", "admin", "core_team"]);

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[enable-reviewer]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

async function findAuthUserByEmail(client: ReturnType<typeof getSupabaseServiceRoleClient>, email: string) {
  if (!client) return null;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await (client as any).auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const users = (data?.users ?? []) as Array<{ id: string; email?: string }>;
    const found = users.find((u) => String(u.email ?? "").toLowerCase() === email);
    if (found) return found;
    if (!users.length || users.length < 1000) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export type EnableReviewerResult = {
  ok: boolean;
  message: string;
  adminUserId?: string;
  /** true when a Supabase Auth invitation email was sent to the reviewer. */
  authInvited?: boolean;
};

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

export async function enableMentorAsReviewer(input: {
  personId: string;
}): Promise<EnableReviewerResult> {
  // --- Permission check
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageReviewers(actor.role)) {
    return { ok: false, message: "Bạn không có quyền cấp/quản lý reviewer." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // --- Load person row
  const { data: person, error: personErr } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .eq("id", input.personId.trim())
    .maybeSingle();

  if (personErr) {
    log("people lookup", personErr);
    return { ok: false, message: `Không thể tải thông tin người: ${personErr.message}` };
  }
  if (!person) return { ok: false, message: "Không tìm thấy người trong hệ thống." };

  const email = String(person.email_primary ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Người này chưa có email hợp lệ trong hệ thống." };
  }

  const fullName = String(person.full_name ?? "").trim() || null;

  // --- Look up existing admin_user by email
  const { data: existing, error: lookupErr } = await client
    .from("admin_users")
    .select("id,role,status,auth_user_id")
    .eq("email", email)
    .maybeSingle();

  if (lookupErr) {
    log("admin_users lookup", lookupErr);
    return { ok: false, message: `Không thể kiểm tra tài khoản admin: ${lookupErr.message}` };
  }

  // ---------------------------------------------------------------------------
  // Case A: admin_users row exists
  // ---------------------------------------------------------------------------
  if (existing) {
    const currentRole = String(existing.role ?? "viewer");
    const currentStatus = String(existing.status ?? "inactive");
    const adminUserId = String(existing.id);

    // A1: Higher privilege — never downgrade, just reactivate if needed
    if (PRESERVE_ROLES.has(currentRole)) {
      if (currentStatus !== "active") {
        const { error: activateErr } = await client
          .from("admin_users")
          .update({ status: "active" })
          .eq("id", adminUserId);
        if (activateErr) {
          log("reactivate higher-role user", activateErr);
          return { ok: false, message: `Không thể kích hoạt tài khoản: ${activateErr.message}` };
        }
        return {
          ok: true,
          message: `Người này đã có quyền ${currentRole} — đã kích hoạt lại tài khoản.`,
          adminUserId
        };
      }
      return {
        ok: true,
        message: `Người này đã có quyền ${currentRole} (cao hơn reviewer) — không cần đổi role.`,
        adminUserId
      };
    }

    // A2: Already reviewer
    if (currentRole === "reviewer") {
      if (currentStatus !== "active") {
        const { error: activateErr } = await client
          .from("admin_users")
          .update({ status: "active" })
          .eq("id", adminUserId);
        if (activateErr) {
          log("reactivate reviewer", activateErr);
          return { ok: false, message: `Không thể kích hoạt tài khoản reviewer: ${activateErr.message}` };
        }
        return { ok: true, message: "Đã kích hoạt lại tài khoản reviewer.", adminUserId };
      }
      return { ok: true, message: "Người này đã là reviewer active.", adminUserId };
    }

    // A3: viewer / support_team → upgrade to reviewer
    const { error: upgradeErr } = await client
      .from("admin_users")
      .update({ role: "reviewer", status: "active" })
      .eq("id", adminUserId);
    if (upgradeErr) {
      log("upgrade to reviewer", upgradeErr);
      return { ok: false, message: `Không thể cấp quyền reviewer: ${upgradeErr.message}` };
    }
    return {
      ok: true,
      message: `Đã cấp quyền reviewer (nâng cấp từ ${currentRole}).`,
      adminUserId
    };
  }

  // ---------------------------------------------------------------------------
  // Case B: no admin_users row — create one and attempt Auth invite/link
  // ---------------------------------------------------------------------------
  let authUserId: string | null = null;
  let authInvited = false;

  try {
    // Try to find existing Supabase Auth user first
    const foundAuth = await findAuthUserByEmail(client, email);
    if (foundAuth?.id) {
      authUserId = foundAuth.id;
    } else {
      // Invite the user — this sends an email and creates a Supabase Auth user
      const { data: inviteData, error: inviteErr } = await (client as any).auth.admin.inviteUserByEmail(email);
      if (!inviteErr && inviteData?.user?.id) {
        authUserId = inviteData.user.id;
        authInvited = true;
      } else {
        // Race condition: check again after invite failure
        const recheck = await findAuthUserByEmail(client, email);
        if (recheck?.id) authUserId = recheck.id;
        // If still not found, proceed without auth_user_id:
        // admin-auth.ts will auto-link on first login via email backfill.
      }
    }
  } catch (authErr) {
    // Auth failure is non-fatal: admin_users row still created.
    log("Auth invite (non-fatal)", authErr);
  }

  const insertPayload: Record<string, unknown> = {
    email,
    full_name: fullName,
    role: "reviewer",
    status: "active"
  };
  if (authUserId) insertPayload.auth_user_id = authUserId;

  const { data: newRow, error: insertErr } = await client
    .from("admin_users")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (insertErr || !newRow?.id) {
    log("insert admin_users", insertErr ?? "no row returned");
    return { ok: false, message: `Không thể tạo tài khoản reviewer: ${insertErr?.message ?? "unknown error"}` };
  }

  const message = authInvited
    ? "Đã tạo tài khoản reviewer và gửi email mời đăng nhập qua Supabase Auth."
    : authUserId
    ? "Đã tạo tài khoản reviewer và liên kết Auth user hiện có."
    : "Đã tạo tài khoản reviewer. Auth invitation chưa được gửi — cần gửi reset password riêng qua Supabase dashboard hoặc /admin/users.";

  return { ok: true, message, adminUserId: newRow.id, authInvited };
}
