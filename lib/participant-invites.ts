import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { findAuthUserByEmail, AuthLookupIncomplete } from "@/lib/enable-reviewer";
import { getAuthCallbackUrl } from "@/lib/public-url";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/participant-invites.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Mời một mentor hoặc mentee lập tài khoản đăng nhập.
 *
 * ---------------------------------------------------------------------------
 * KHÔNG NGHĨ RA MỘT CƠ CHẾ MỜI THỨ HAI
 * ---------------------------------------------------------------------------
 * Hệ thống đã có đúng đường này rồi, dùng cho 22 mentor chấm hồ sơ:
 * `inviteUserByEmail` của Supabase tạo tài khoản và gửi thư đặt mật khẩu.
 *
 * Một cơ chế token tự viết sẽ phải tự lo hạn dùng, tự lo băm khi lưu, tự lo thu
 * hồi, và tự lo một trang đổi token lấy phiên — bốn thứ đã tồn tại và đã chạy
 * thật. Thêm cái thứ hai chỉ tạo ra chỗ cho hai cái nói khác nhau.
 *
 * `redirectTo` là bắt buộc: không có nó, Supabase gửi người ta về Site URL của
 * dự án, và mã đăng nhập rơi vào một trang không biết làm gì với nó — tài khoản
 * được tạo ra mà không bao giờ vào được.
 */

const SAFE_ERROR = "Không gửi được lời mời lúc này.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[participant-invites]", scope, {
    code: err?.code,
    message: err?.message ?? String(error)
  });
}

export type InviteResult = {
  ok: boolean;
  message: string;
  /** Có thật sự gửi thư mời không, hay tài khoản đã tồn tại từ trước. */
  invited?: boolean;
};

/**
 * Mời một người trong danh bạ lập tài khoản.
 *
 * ---------------------------------------------------------------------------
 * BA ĐIỀU KHÔNG LÀM
 * ---------------------------------------------------------------------------
 * 1. KHÔNG mời người đã có chân trong ban tổ chức. Họ đã có lối vào riêng, và
 *    một lời mời thứ hai chỉ làm họ bối rối.
 * 2. KHÔNG mời khi phép tra danh bạ Auth chưa chạy hết. Mời nhầm một người đã
 *    có tài khoản sẽ tạo ra tài khoản thứ hai cho cùng một hòm thư.
 * 3. KHÔNG tạo tài khoản cho người không có trong danh bạ chương trình. Lời mời
 *    là để nối một người ĐÃ CÓ với một lối đăng nhập, không phải để thêm người.
 */
export async function inviteParticipant(input: { personId: string }): Promise<InviteResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || !canEditRecaps(actor)) {
    return { ok: false, message: "Bạn không có quyền gửi lời mời." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const personId = String(input.personId ?? "").trim();
  if (!personId) return { ok: false, message: "Chưa chọn người để mời." };

  const { data: personRow, error: personError } = await client
    .from("people")
    .select("id, full_name, email_primary")
    .eq("id", personId)
    .maybeSingle();

  if (personError) {
    log("đọc danh bạ", personError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!personRow) return { ok: false, message: "Không tìm thấy người này trong danh bạ." };

  const person = personRow as { id: string; full_name: string | null; email_primary: string | null };
  const email = String(person.email_primary ?? "").trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      message: "Người này chưa có email trong danh bạ. Bổ sung email trước khi mời."
    };
  }

  // Điều 3: phải đang tham gia một mùa nào đó.
  const { data: membership, error: membershipError } = await client
    .from("person_season_memberships")
    .select("id")
    .eq("person_id", personId)
    .in("status", ["active", "completed"])
    .limit(1);

  if (membershipError) {
    log("đọc tư cách thành viên", membershipError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!(membership ?? []).length) {
    return {
      ok: false,
      message: "Người này chưa được xếp vào mùa nào. Xếp mùa trước, rồi mời."
    };
  }

  // Điều 1: người đã có chân trong ban tổ chức thì không mời.
  const { data: staffRow, error: staffError } = await client
    .from("admin_users")
    .select("id")
    .ilike("email", email)
    .limit(1);

  if (staffError) {
    log("kiểm nhân sự", staffError);
    return { ok: false, message: SAFE_ERROR };
  }
  if ((staffRow ?? []).length) {
    return {
      ok: false,
      message: "Người này đã có tài khoản ban tổ chức. Họ đăng nhập bằng lối đó."
    };
  }

  // Điều 2: tra danh bạ Auth, và KHÔNG mời khi chưa chắc.
  let authUser: { id: string; email?: string } | null = null;
  try {
    authUser = await findAuthUserByEmail(client, email);
  } catch (lookupError) {
    if (lookupError instanceof AuthLookupIncomplete) {
      log("tra danh bạ Auth chưa xong", lookupError);
      return { ok: false, message: SAFE_ERROR };
    }
    log("tra danh bạ Auth hỏng", lookupError);
    return { ok: false, message: SAFE_ERROR };
  }

  let invited = false;
  if (!authUser) {
    const redirectTo = await getAuthCallbackUrl();
    const { data, error } = await (client as any).auth.admin.inviteUserByEmail(
      email,
      redirectTo ? { redirectTo } : undefined
    );
    if (error || !data?.user?.id) {
      log("gửi lời mời", error);
      return { ok: false, message: SAFE_ERROR };
    }
    authUser = data.user;
    invited = true;
  }

  if (!authUser?.id) return { ok: false, message: SAFE_ERROR };

  const nowIso = new Date().toISOString();
  const { error: linkError } = await client.from("account_person_auth_links").insert({
    auth_user_id: authUser.id,
    person_id: personId,
    status: "active",
    link_source: "invite",
    invited_at: nowIso,
    created_by: actor.id
  });

  // 23505 = đã có mối nối. Mời lại một người đã nối là thao tác vô hại: thư đặt
  // lại mật khẩu vẫn tới, còn mối nối thì không đổi.
  if (linkError && (linkError as { code?: string }).code !== "23505") {
    log("ghi mối nối", linkError);
    return { ok: false, message: SAFE_ERROR };
  }

  const name = String(person.full_name ?? "").trim() || email;
  return {
    ok: true,
    invited,
    message: invited
      ? `Đã gửi lời mời tới ${name}. Nhắc họ kiểm cả mục Spam.`
      : `${name} đã có tài khoản từ trước — đã nối vào danh bạ, họ đăng nhập được ngay.`
  };
}
