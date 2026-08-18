import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageReviewers } from "@/lib/permissions";
import { canReviewSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendReviewerInvite } from "@/lib/email";
import { SEASON_CONFIG } from "@/lib/season-config";

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

  const { data: mentorProfiles, error: mentorProfileErr } = await client
    .from("mentor_profiles")
    .select("id,intake_batch_id")
    .eq("person_id", input.personId.trim());
  if (mentorProfileErr) {
    log("mentor profile scope lookup", mentorProfileErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const batchIds = (mentorProfiles ?? [])
    .map((profile: { intake_batch_id?: string | null }) => profile.intake_batch_id)
    .filter((id: string | null | undefined): id is string => Boolean(id));
  if (!batchIds.length) return { ok: false, message: "KhĂ´ng tĂ¬m tháº¥y mentor profile trong scope review." };
  const { data: batches, error: batchErr } = await client.from("intake_batches").select("id,season_id").in("id", batchIds);
  if (batchErr) {
    log("mentor batch scope lookup", batchErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const scopeContext = await getAdminScopeContext();
  const canManageThisMentor = await Promise.all(
    (batches ?? []).map((batch: { season_id?: string | null }) => canReviewSeason(scopeContext, batch.season_id ?? null))
  );
  if (!canManageThisMentor.some(Boolean)) {
    return { ok: false, message: "Ban khong co quyen review trong mua cua mentor nay." };
  }

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

    // A1: Higher privilege — never downgrade, and never reactivate from here.
    //
    // Reactivating would make this button an indirect privilege-restoration
    // path: any staff member who can edit people.email_primary could point a
    // mentor row at a suspended super_admin's address and press "cấp quyền".
    // Re-enabling a staff account is a decision for /admin/users, where it is
    // audited as such.
    if (PRESERVE_ROLES.has(currentRole)) {
      if (currentStatus !== "active") {
        return {
          ok: false,
          message: `Email này thuộc tài khoản ${currentRole} đang bị khoá. Việc mở lại tài khoản quản trị phải thực hiện ở mục Quản lý người dùng, không qua danh sách reviewer.`,
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

  // The Auth user is created with generateLink rather than inviteUserByEmail:
  // generateLink creates the user and returns the link WITHOUT sending mail, so
  // the invitation goes out through our own provider. Supabase's built-in SMTP
  // allows only a handful of messages an hour, which is unusable for a round of
  // reviewer invitations.
  let inviteUrl: string | null = null;

  try {
    const foundAuth = await findAuthUserByEmail(client, email);
    if (foundAuth?.id) {
      authUserId = foundAuth.id;
    } else {
      const { data: linkData, error: linkErr } = await (client as any).auth.admin.generateLink({
        type: "invite",
        email
      });
      if (!linkErr && linkData?.user?.id) {
        authUserId = linkData.user.id;
        inviteUrl = String(linkData?.properties?.action_link ?? "") || null;
      } else {
        // Race: another request may have created the user in between.
        const recheck = await findAuthUserByEmail(client, email);
        if (recheck?.id) authUserId = recheck.id;
        // Still nothing: proceed without auth_user_id. admin-auth.ts links the
        // row by email on first login.
      }
    }
  } catch (authErr) {
    // Auth failure is non-fatal: the admin_users row is still created.
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

  // Send the invitation ourselves. Non-fatal: the account exists either way, and
  // an operator can re-send from /admin/users.
  let sendNote = "";
  if (inviteUrl) {
    try {
      const sent = await sendReviewerInvite({
        toEmail: email,
        mentorName: fullName ?? "",
        seasonLabel: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
        inviteUrl,
        adminUserId: newRow.id
      });
      authInvited = sent.ok && !sent.skipped;
      if (sent.skipped) sendNote = " Email chưa gửi vì cấu hình gửi email đang tắt.";
      else if (!sent.ok) sendNote = " Chưa gửi được email mời — vui lòng gửi lại từ mục Quản lý người dùng.";
    } catch (sendErr) {
      log("reviewer invite email (non-fatal)", sendErr);
      sendNote = " Chưa gửi được email mời — vui lòng gửi lại từ mục Quản lý người dùng.";
    }
  }

  const message = authInvited
    ? "Đã tạo tài khoản reviewer và gửi email mời đặt mật khẩu."
    : authUserId
      ? `Đã tạo tài khoản reviewer và liên kết tài khoản đăng nhập sẵn có.${sendNote}`
      : `Đã tạo tài khoản reviewer. Chưa tạo được liên kết đăng nhập — vui lòng gửi lời mời từ mục Quản lý người dùng.${sendNote}`;

  return { ok: true, message, adminUserId: newRow.id, authInvited };
}
