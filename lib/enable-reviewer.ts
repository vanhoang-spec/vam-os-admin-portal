import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendReviewerInvite } from "@/lib/email";
import { hasRecentSentEmail } from "@/lib/outbound-emails";
import { canManageReviewers } from "@/lib/permissions";
import { getPublicOrigin } from "@/lib/public-url";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { seasonLabel } from "@/lib/season-labels";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SAFE_ERROR = "Không thể cấp quyền tham gia tuyển sinh. Vui lòng thử lại hoặc liên hệ admin.";

/**
 * Vì sao lệnh cấp quyền bị database từ chối, nói bằng tiếng Việt.
 *
 * Trước đây mọi lý do đều ra cùng một câu "vui lòng thử lại", còn lý do thật chỉ
 * nằm trong log máy chủ. Người bấm nút không đọc được log, nên họ bấm lại — và với
 * những lý do dưới đây thì bấm lại bao nhiêu lần cũng hỏng y như vậy (18/09/2026:
 * một mentor kẹt đúng kiểu đó cả buổi sáng).
 *
 * Chỉ người đã qua canManageReviewers và quyền vận hành mùa mới thấy các câu này,
 * và chúng nói về trạng thái tài khoản chứ không lộ dữ liệu của ai.
 */
const GRANT_FAILURE_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  [
    "Account email is linked to a different Auth identity",
    "Email này đang gắn với một tài khoản đăng nhập khác. Nhờ admin rà lại tài khoản của người này trước khi cấp quyền."
  ],
  [
    "Duplicate admin account emails",
    "Có nhiều hơn một tài khoản quản trị dùng email này. Nhờ admin gộp lại trước khi cấp quyền."
  ],
  [
    "non-qualifying active scope",
    "Tài khoản này đang giữ một phạm vi quyền khác cho mùa này. Nhờ admin chỉnh phạm vi quyền trước khi cấp quyền đánh giá."
  ],
  [
    "Existing account role cannot join recruitment",
    "Vai trò hiện tại của tài khoản này không tham gia tuyển sinh được. Nhờ admin kiểm tra lại."
  ],
  [
    "Inactive privileged accounts require super-admin reactivation",
    "Tài khoản này thuộc nhóm quản trị và đang bị khoá. Cần super admin mở lại trước."
  ],
  ["Recruitment participation grant rejected", "Bạn không có quyền vận hành mùa này."],
  [
    "identity or season is invalid",
    "Email trong hồ sơ và email của tài khoản không khớp. Nhờ admin kiểm tra lại email của người này."
  ]
];

function grantFailureMessage(error: unknown) {
  const text = String((error as { message?: string })?.message ?? "");
  for (const [needle, message] of GRANT_FAILURE_MESSAGES) {
    if (text.includes(needle)) return message;
  }
  return SAFE_ERROR;
}

/**
 * Hard cap on Auth pages walked while looking for an existing account.
 * GoTrue caps `perPage` server-side (commonly 50) regardless of what we ask
 * for, so we must never infer "no more users" from a short page — only an
 * EMPTY page ends the walk.
 */
const AUTH_PAGE_LIMIT = 200;

export class AuthLookupIncomplete extends Error {
  constructor() {
    super("Auth user directory exceeded the safe pagination limit");
    this.name = "AuthLookupIncomplete";
  }
}

/**
 * Returns the Auth user for `email`, or null when the directory was walked to
 * completion and no such user exists.
 *
 * Throws AuthLookupIncomplete if the page cap is reached while pages are still
 * non-empty. That distinction matters: returning null in that case would make
 * the caller invite an account that may already exist, creating a duplicate
 * identity. We fail closed instead.
 */
type AuthUserEntry = { id: string; email?: string | null };

/**
 * Đi qua từng trang danh bạ Auth cho tới một trang RỖNG.
 *
 * Một vòng trang duy nhất cho mọi phép tra danh bạ: hai vòng là hai chỗ có thể
 * lệch nhau về cách xử lý trang cuối, và lệch ở đó nghĩa là tạo tài khoản thứ
 * hai cho cùng một hòm thư. `visit` trả về true để dừng sớm.
 */
async function walkAuthUserPages(client: any, visit: (users: AuthUserEntry[]) => boolean): Promise<void> {
  for (let page = 1; page <= AUTH_PAGE_LIMIT; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = (data?.users ?? []) as AuthUserEntry[];
    // Only an empty page proves the directory is exhausted.
    if (users.length === 0) return;
    if (visit(users)) return;
  }
  throw new AuthLookupIncomplete();
}

/** Tra một hòm thư trong danh bạ Auth, đọc hết mọi trang. */
export async function findAuthUserByEmail(client: any, email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  // Một hộp chứ không phải một biến: TypeScript không theo được phép gán bên
  // trong callback, và sẽ coi biến vẫn là null sau vòng lặp.
  const box: { found: { id: string; email?: string } | null } = { found: null };
  await walkAuthUserPages(client, (users) => {
    const match = users.find((user) => String(user.email ?? "").trim().toLowerCase() === normalizedEmail);
    if (!match) return false;
    box.found = match as { id: string; email?: string };
    return true;
  });
  return box.found;
}

/**
 * Toàn bộ danh bạ Auth, đọc MỘT lần cho cả một lượt mời.
 *
 * Tra từng người bằng `findAuthUserByEmail` nghĩa là đi lại cả danh bạ cho mỗi
 * người trong lượt — hai mươi người là hai mươi lần đọc toàn bộ tài khoản.
 *
 * Là một lớp chứ không phải một object thường: hàm mời chỉ nhận bản danh bạ
 * dựng bằng `AuthDirectory.load`. Một object gửi lên từ trình duyệt mất
 * prototype trên đường đi, nên không giả được thành danh bạ.
 */
export class AuthDirectory {
  private readonly byEmail: Map<string, Array<{ id: string; email: string }>>;

  private constructor(byEmail: Map<string, Array<{ id: string; email: string }>>) {
    this.byEmail = byEmail;
  }

  static async load(client: any): Promise<AuthDirectory> {
    const byEmail = new Map<string, Array<{ id: string; email: string }>>();
    await walkAuthUserPages(client, (users) => {
      for (const user of users) {
        const email = String(user.email ?? "").trim().toLowerCase();
        if (!email || !user.id) continue;
        const list = byEmail.get(email) ?? [];
        list.push({ id: String(user.id), email });
        byEmail.set(email, list);
      }
      return false;
    });
    return new AuthDirectory(byEmail);
  }

  /** Mọi tài khoản mang đúng email này. Nhiều hơn một là dữ liệu hỏng, người gọi phải từ chối. */
  usersWithEmail(email: string): Array<{ id: string; email: string }> {
    return (this.byEmail.get(String(email ?? "").trim().toLowerCase()) ?? []).slice();
  }
}

export type EnableReviewerResult = {
  ok: boolean;
  message: string;
  adminUserId?: string;
  authInvited?: boolean;
};

export async function enableMentorAsReviewer(input: {
  personId: string;
  seasonId: string;
  participationRole: "reviewer" | "interviewer";
}): Promise<EnableReviewerResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageReviewers(actor.role)) return { ok: false, message: "Bạn không có quyền quản lý reviewer/interviewer." };
  if (!(await canOperateSeason(await getAdminScopeContext(), input.seasonId))) {
    return { ok: false, message: "Bạn không có quyền vận hành mùa này." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const { data: person, error: personError } = await client
    .from("people").select("id,full_name,email_primary").eq("id", input.personId).maybeSingle();
  if (personError || !person) return { ok: false, message: "Không tìm thấy người trong hệ thống." };
  const email = String(person.email_primary ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { ok: false, message: "Người này chưa có email hợp lệ." };

  let authUser: { id: string; email?: string; last_sign_in_at?: string | null } | null;
  try {
    authUser = await findAuthUserByEmail(client, email);
  } catch (lookupError) {
    // Never fall through to an invite on an inconclusive lookup.
    console.error("[enable-reviewer] auth lookup failed", lookupError);
    return { ok: false, message: SAFE_ERROR };
  }

  // Tài khoản mới: tạo bằng generateLink, KHÔNG nhờ Supabase gửi thư. Link đặt
  // mật khẩu đi qua Brevo ở cuối hàm, sau khi quyền đã được cấp.
  let link: { type: "invite" | "recovery"; tokenHash: string } | null = null;
  let createdAccount = false;
  if (!authUser) {
    const generated = await generatePasswordLink(client, "invite", email);
    if (!generated.ok) return { ok: false, message: INVITE_ERROR };
    authUser = { id: generated.userId, email };
    link = { type: "invite", tokenHash: generated.tokenHash };
    createdAccount = true;
  }
  if (!authUser?.id) return { ok: false, message: "Không thể xác định tài khoản Auth cá nhân." };

  // Hồ sơ quản trị trỏ tới một tài khoản đăng nhập đã bị xoá thì mọi lần cấp quyền
  // sau đó đều bị từ chối, và không thao tác nào trên màn hình gỡ được. Database tự
  // kiểm liên kết còn sống hay không — service_role không đọc được auth.users — và
  // không làm gì nếu nó còn sống. Đặt ngay trước lệnh cấp quyền, sau khi đã có tài
  // khoản Auth: mọi đường hỏng trước đó vẫn không chạm tới database. Phép kiểm này
  // hỏng cũng không được chặn lượt cấp quyền; lệnh bên dưới mới là nơi quyết định.
  const staleLink = await client.rpc("vam084_clear_stale_recruitment_auth_link", {
    p_actor: actor.id,
    p_person_id: input.personId,
    p_season_id: input.seasonId
  });
  if (staleLink.error) {
    console.error("[enable-reviewer] stale auth link check failed", staleLink.error);
  }

  const { data, error } = await client.rpc("vam084_grant_recruitment_participation", {
    p_actor: actor.id,
    p_person_id: input.personId,
    p_season_id: input.seasonId,
    p_participation_role: input.participationRole,
    p_auth_user_id: authUser.id,
    p_email: email
  });
  if (error || !data) {
    if (createdAccount) await (client as any).auth.admin.deleteUser(authUser.id);
    console.error("[enable-reviewer] atomic grant failed", error);
    return { ok: false, message: grantFailureMessage(error) };
  }

  const adminUserId = String(data);
  const label = input.participationRole === "reviewer" ? "Reviewer hồ sơ" : "Interviewer";
  const granted = { ok: true, message: `Đã cấp quyền ${label} cho đúng mùa.`, adminUserId, authInvited: createdAccount };
  const notSent = (why: string) => ({
    ...granted,
    message: `Đã cấp quyền ${label} nhưng CHƯA gửi được thư đặt mật khẩu${why}. Gửi lại: bấm Thu hồi rồi Cấp lại.`
  });

  if (!link) {
    // Đã từng đăng nhập: họ có cách vào rồi, một thư đặt mật khẩu chỉ gây bối rối.
    if (authUser.last_sign_in_at) return granted;

    // Có tài khoản mà CHƯA đăng nhập lần nào — thư mời trước có thể chưa từng tới.
    // Nhưng hai nút cấp quyền cho cùng một người thường được bấm liền nhau, và
    // thư thứ hai làm link trong thư thứ nhất hết hiệu lực. Chỉ tính thư ĐÃ ĐI:
    // một lần gửi hỏng không được chặn lần gửi lại.
    const recent = await hasRecentSentEmail({
      kind: "reviewer_invite",
      toEmail: email,
      sinceIso: new Date(Date.now() - RESEND_SUPPRESS_MINUTES * 60_000).toISOString()
    });
    if (recent.ok && recent.found) return granted;

    const generated = await generatePasswordLink(client, "recovery", email, authUser.id);
    if (!generated.ok) return notSent("");
    link = { type: "recovery", tokenHash: generated.tokenHash };
  }

  const { data: season } = await client.from("seasons").select("code,name").eq("id", input.seasonId).maybeSingle();
  const sent = await sendReviewerInvite({
    toEmail: email,
    mentorName: String(person.full_name ?? "").trim() || email,
    seasonLabel: season ? seasonLabel(String(season.code ?? ""), season.name ?? null) : "",
    linkType: link.type,
    tokenHash: link.tokenHash,
    adminUserId,
    requestOrigin: await getPublicOrigin()
  });

  // `skipped` là cổng thư tắt: không có lá thư nào đi, nên không được báo là đã gửi.
  if (sent.skipped) return notSent(" (môi trường này đang tắt gửi thư)");
  if (!sent.ok) return notSent("");
  return { ...granted, message: `${granted.message} Đã gửi thư đặt mật khẩu tới ${email} — nhắc họ xem cả mục Spam.` };
}

const INVITE_ERROR = "Không thể tạo lời mời đăng nhập cá nhân.";

/**
 * Hai lần gửi thư cho cùng một người phải cách nhau chừng này. Thư sau làm link
 * trong thư trước hết hiệu lực.
 */
const RESEND_SUPPRESS_MINUTES = 60;

/**
 * Tạo link đặt mật khẩu — và với `invite`, tạo luôn tài khoản — mà KHÔNG gửi thư.
 *
 * Bản cũ gọi `inviteUserByEmail`, để Supabase tự gửi thư. Supabase từ chối thì
 * màn hình chỉ hiện một câu chung chung và không có dòng log nào, nên không ai
 * biết lý do. Ở đây lý do được ghi lại.
 *
 * Link trả về phải thuộc đúng email này (và đúng tài khoản đã biết, nếu có):
 * một link của tài khoản khác nằm trong hộp thư người này là trao tài khoản của
 * người kia cho họ.
 */
async function generatePasswordLink(
  client: any,
  type: "invite" | "recovery",
  email: string,
  expectedUserId?: string
): Promise<{ ok: true; userId: string; tokenHash: string } | { ok: false }> {
  try {
    const { data, error } = await client.auth.admin.generateLink({ type, email });
    if (error) {
      console.error("[enable-reviewer] generateLink failed", {
        type,
        code: error.code ?? error.status ?? null,
        message: error.message ?? null
      });
      return { ok: false };
    }
    const userId = String(data?.user?.id ?? "").trim();
    const userEmail = String(data?.user?.email ?? "").trim().toLowerCase();
    const tokenHash = String(data?.properties?.hashed_token ?? "").trim();
    if (!userId || !tokenHash || userEmail !== email || (expectedUserId && userId !== expectedUserId)) {
      console.error("[enable-reviewer] generateLink returned a link that does not match the recipient", { type });
      return { ok: false };
    }
    return { ok: true, userId, tokenHash };
  } catch (error) {
    console.error("[enable-reviewer] generateLink threw", { type, message: (error as Error)?.message ?? String(error) });
    return { ok: false };
  }
}

export async function revokeMentorRecruitmentParticipation(input: {
  personId: string;
  seasonId: string;
  participationRole: "reviewer" | "interviewer";
}): Promise<EnableReviewerResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageReviewers(actor.role)) {
    return { ok: false, message: "Bạn không có quyền quản lý reviewer/interviewer." };
  }
  if (!(await canOperateSeason(await getAdminScopeContext(), input.seasonId))) {
    return { ok: false, message: "Bạn không có quyền vận hành mùa này." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const { data, error } = await client.rpc("vam084_revoke_recruitment_participation", {
    p_actor: actor.id,
    p_person_id: input.personId,
    p_season_id: input.seasonId,
    p_participation_role: input.participationRole
  });
  if (error || !data) {
    console.error("[enable-reviewer] atomic revoke failed", error);
    return { ok: false, message: "Không thể thu hồi quyền tham gia tuyển sinh. Vui lòng thử lại hoặc liên hệ admin." };
  }
  const label = input.participationRole === "reviewer" ? "Reviewer hồ sơ" : "Interviewer";
  return { ok: true, message: `Đã thu hồi quyền ${label} trong đúng mùa.`, adminUserId: String(data) };
}
