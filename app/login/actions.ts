"use server";

import { redirect } from "next/navigation";
import {
  clearAuthCookies,
  findAdminUserForAuthUser,
  getSupabaseAuthClientForPasswordSignIn,
  hasAnyAdminUserRow,
  setAuthCookies
} from "@/lib/admin-auth";
import { getSafeAuthErrorType, mapAuthError, safeNext } from "@/lib/auth-error-messages";
import { getAuthCallbackUrl, getPasswordResetUrl } from "@/lib/public-url";
import { recordParticipantActivation, resolveParticipantIdentity } from "@/lib/participant-auth";

export type LoginActionState = {
  error: string | null;
};

export type MagicLinkActionState = {
  error: string | null;
  sent: boolean;
};

export type PasswordResetActionState = {
  error: string | null;
  sent: boolean;
};

/**
 * The same neutral answer whether or not the address has an account.
 *
 * A message that distinguished them would turn this form into a directory
 * lookup: type an address, learn from the wording whether that person holds an
 * account on the recruitment system.
 */
const MAGIC_LINK_NEUTRAL_REPLY =
  "Nếu email này có tài khoản, chúng tôi đã gửi một liên kết đăng nhập. Vui lòng kiểm tra hộp thư (kể cả mục Spam).";

export async function loginAction(_previousState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Vui lòng nhập email và mật khẩu." };
  }

  const client = getSupabaseAuthClientForPasswordSignIn();
  if (!client) {
    return { error: mapAuthError("network_unavailable") };
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user.email) {
    console.warn("[login] Supabase signInWithPassword failed", {
      errorName: error?.name ?? null,
      errorStatus: error?.status ?? null
    });
    await clearAuthCookies();
    return { error: mapAuthError(getSafeAuthErrorType(error)) };
  }

  let adminUser = null;
  try {
    adminUser = await findAdminUserForAuthUser(data.user);
  } catch (err: any) {
    console.warn("[login] identity linking or resolution failed", err.message);
    await client.auth.signOut();
    await clearAuthCookies();
    return { error: mapAuthError("unauthorized_admin") };
  }

  // Không phải nhân sự ban tổ chức thì thử đường participant: mentor và mentee
  // đăng nhập bằng chính hòm thư của họ.
  //
  // Thứ tự này quan trọng. Ai vừa là mentor vừa có chân trong ban tổ chức —
  // 22 mentor đang chấm hồ sơ chẳng hạn — vẫn vào đúng màn hình cũ của họ, vì
  // phép tra nhân sự chạy trước và thắng.
  if (!adminUser) {
    // Có dòng trong admin_users nhưng KHÔNG hoạt động — bị khoá, đình chỉ,
    // hoặc mới mời chưa kích hoạt — thì từ chối y như trước, KHÔNG rơi xuống
    // đường participant.
    //
    // findAdminUserForAuthUser lọc sẵn status = active nên nó trả về null
    // giống hệt nhau cho "chưa bao giờ là nhân sự" và "đã bị khoá". Gộp hai
    // trường hợp lại nghĩa là thu hồi quyền nhân sự của một người rồi lặng lẽ
    // đưa cho họ một cánh cửa khác trong cùng phiên đó — và người bấm nút đình
    // chỉ không hề biết mình vừa làm việc ấy.
    let wasStaff = true;
    try {
      wasStaff = await hasAnyAdminUserRow(data.user);
    } catch (err: any) {
      console.warn("[login] admin_users existence check failed", err.message);
      await client.auth.signOut();
      await clearAuthCookies();
      return { error: mapAuthError("network_unavailable") };
    }

    if (wasStaff) {
      console.warn("[login] admin_users row exists but is not active");
      await client.auth.signOut();
      await clearAuthCookies();
      return { error: mapAuthError("unauthorized_admin") };
    }

    const identity = await resolveParticipantIdentity({
      authUserId: data.user.id,
      authEmail: data.user.email
    });

    if (identity.error) {
      // Hạ tầng hỏng, KHÔNG phải "không nhận ra bạn". Nói đúng thứ đang xảy ra
      // thay vì đổ cho danh bạ.
      await client.auth.signOut();
      await clearAuthCookies();
      return { error: mapAuthError("network_unavailable") };
    }

    if (!identity.personId) {
      await client.auth.signOut();
      await clearAuthCookies();
      return { error: identity.refusal ?? mapAuthError("unauthorized_admin") };
    }

    // Lần đăng nhập đầu của người được mời: ghi mốc để màn hình mời thôi hiện
    // họ là "chưa vào". Hàm không bao giờ ném lỗi, nên không chặn đăng nhập.
    await recordParticipantActivation({ authUserId: data.user.id, personId: identity.personId });

    await setAuthCookies(
      data.session.access_token,
      data.session.refresh_token,
      data.session.expires_in
    );
    // Bỏ qua `next`: nó là đường của ban tổ chức mà middleware vừa chặn họ lại,
    // nên đưa họ về đó là đá qua đá lại.
    redirect("/ct");
  }

  await setAuthCookies(data.session.access_token, data.session.refresh_token, data.session.expires_in);
  redirect(next);
}

/**
 * Send a one-click sign-in link instead of asking for a password.
 *
 * Built for the mentors invited to score applications: they hold an account for
 * one season, use it a handful of times, and a password they must invent and
 * remember is the largest piece of friction in the whole flow. Clicking a link
 * in their own mailbox proves the same thing the password does.
 *
 * `shouldCreateUser: false` is load-bearing. Left at its default, this form
 * would provision a Supabase identity for any address anyone typed into it.
 */
export async function requestMagicLinkAction(
  _previousState: MagicLinkActionState,
  formData: FormData
): Promise<MagicLinkActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { error: "Vui lòng nhập email.", sent: false };
  }

  const client = getSupabaseAuthClientForPasswordSignIn();
  if (!client) return { error: mapAuthError("network_unavailable"), sent: false };

  const emailRedirectTo = await getAuthCallbackUrl();

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      ...(emailRedirectTo ? { emailRedirectTo } : {})
    }
  });

  if (error) {
    // An unknown address and a rate limit both land here. Neither is reported
    // back in a way that would let the sender tell them apart.
    console.warn("[login] magic link request failed", {
      errorName: error.name ?? null,
      errorStatus: error.status ?? null
    });
  }

  return { error: null, sent: true };
}

/**
 * Tự xin link đặt lại mật khẩu — không phải nhờ ban tổ chức bấm hộ.
 *
 * Trước 24/09/2026, người quên mật khẩu chỉ có hai đường: xin một liên kết đăng
 * nhập một lần (vào được, nhưng vẫn không đặt được mật khẩu nên lần sau lại
 * quên), hoặc nhắn ban tổ chức vào /admin/users bấm hộ. Với hơn trăm người
 * phỏng vấn dùng tài khoản vài lần một mùa, đường thứ hai biến ban tổ chức
 * thành quầy trực mật khẩu.
 *
 * VÌ SAO NHỜ SUPABASE GỬI, KHÔNG TỰ DỰNG LINK RỒI GỬI QUA BREVO
 * ---------------------------------------------------------------------------
 * Mọi thư mật khẩu khác của VAM OS đi theo lối tự dựng link rồi gửi Brevo,
 * nhưng những lối đó đều nằm sau một cánh cửa đã xác thực: người bấm là quản
 * trị viên. Ô này thì công khai, ai gõ địa chỉ nào vào cũng được. Đặt một lời
 * gọi mang khoá service_role sau một cánh cửa mở là biến nó thành máy phát thư
 * cho bất kỳ địa chỉ nào, và đốt hạn mức Brevo 300 thư/ngày mà cả hệ thống đang
 * dùng chung.
 *
 * Hàm này chạy bằng khoá công khai, và Supabase tự lo giới hạn tần suất — đúng
 * thứ một ô công khai cần. Nút "gửi liên kết đăng nhập" ngay bên cạnh đã chọn
 * lối này từ trước; hai nút cùng một ô phải cùng một lối.
 */
export async function requestPasswordResetAction(
  _previousState: PasswordResetActionState,
  formData: FormData
): Promise<PasswordResetActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { error: "Vui lòng nhập email.", sent: false };
  }

  const client = getSupabaseAuthClientForPasswordSignIn();
  if (!client) return { error: mapAuthError("network_unavailable"), sent: false };

  const redirectTo = await getPasswordResetUrl();

  const { error } = await client.auth.resetPasswordForEmail(
    email,
    redirectTo ? { redirectTo } : {}
  );

  if (error) {
    // Địa chỉ không có tài khoản và chạm trần tần suất cùng rơi vào đây. Không
    // cái nào được báo ra theo cách phân biệt được hai thứ đó.
    console.warn("[login] password reset request failed", {
      errorName: error.name ?? null,
      errorStatus: error.status ?? null
    });
  }

  return { error: null, sent: true };
}

export async function logoutAction() {
  const client = getSupabaseAuthClientForPasswordSignIn();
  if (client) await client.auth.signOut();
  await clearAuthCookies();
  redirect("/login");
}
