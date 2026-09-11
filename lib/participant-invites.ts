import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import {
  claimParticipantInviteSend,
  expireStaleParticipantInviteClaims,
  releaseOutboundEmailClaim,
  resolveEmailBaseUrl,
  sendParticipantInvite
} from "@/lib/email";
import { evaluateEmailGate } from "@/lib/email-core";
import { AuthDirectory } from "@/lib/enable-reviewer";
import { escapeIlikePattern, isValidEmail, normalizeEmail } from "@/lib/identity";
import { countOutboundEmailsSince, readParticipantInviteSends } from "@/lib/outbound-emails";
import { readBounded } from "@/lib/paged-read";
import {
  INVITE_BATCH_MAX,
  INVITE_BATCH_TIME_BUDGET_MS,
  INVITE_MAX_CONSECUTIVE_SEND_FAILURES,
  INVITE_MEMBERSHIP_STATUSES,
  PARTICIPANT_INVITE_AUDIT_ACTION,
  checkGeneratedLink,
  decideParticipantInvite,
  inviteBudgetRemaining,
  inviteOutcomeMessage,
  inviteRefusalMessage,
  isUuid,
  linkStateAfterUniqueViolation,
  type BulkStopReason,
  type InviteDecision,
  type InviteFacts,
  type InviteOutcome,
  type InviteRefusalReason,
  type LinkRow,
  type LinkType,
  type SendDecision
} from "@/lib/participant-invite-core";
import { buildPasswordLinkUrl } from "@/lib/password-link-core";
import { canInviteParticipants } from "@/lib/permissions";
import { SCOPE_RESOLUTION_ERROR, canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getPublicOrigin } from "@/lib/public-url";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/participant-invites.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Mời một mentor hoặc mentee lập tài khoản — hoặc gửi lại đường dẫn đặt mật
 * khẩu cho một tài khoản đã có.
 *
 * ---------------------------------------------------------------------------
 * THƯ ĐI QUA BREVO, LINK LÀ CỦA VAM OS
 * ---------------------------------------------------------------------------
 * `auth.admin.generateLink` tạo tài khoản (hoặc mã khôi phục) và trả về mã băm,
 * KHÔNG gửi thư. Link trỏ về `/reset-password` của chính VAM OS, và thư đi qua
 * Brevo như mọi thư khác. Ba lý do, không cái nào phụ thuộc cấu hình SMTP:
 *   * Link của Supabase bị tiêu ngay lúc được mở, và máy quét thư của công ty
 *     mở thử mọi link. Trang của VAM OS phải bấm "Tiếp tục" mới dùng tới mã.
 *   * Thư của Supabase không vào sổ `outbound_emails`: không ai trả lời được
 *     "đã mời ai, thư có đi không", và không đếm được hạn mức.
 *   * Supabase giới hạn số thư Auth mỗi giờ, kể cả khi dùng SMTP riêng.
 *
 * ---------------------------------------------------------------------------
 * THỨ TỰ GHI
 * ---------------------------------------------------------------------------
 *   1. Giữ chỗ một dòng `queued`. 23505 = một lượt khác đang gửi cho người này.
 *   2. Tạo link. Kiểm link thuộc đúng tài khoản, đúng email.
 *   3. Ghi mối nối nếu chưa có — TRƯỚC khi gửi, để lần đăng nhập đầu tìm thấy
 *      nó mà không phải dò theo email.
 *   4. Gửi, chốt kết quả lên chính dòng đã giữ.
 *   5. Ghi nhật ký quản trị.
 * Hỏng ở bước nào thì huỷ chỗ giữ và không gửi.
 *
 * Tài khoản vừa tạo ở bước 2 mà bước 3 hỏng thì KHÔNG bị xoá: nó chưa có mật
 * khẩu và mã chưa được gửi cho ai. Lần bấm sau thấy tài khoản có sẵn, gửi link
 * khôi phục và ghi nối — tự lành.
 */

const SAFE_ERROR = "Không gửi được lời mời lúc này.";
const AUTH_CHECK_ERROR = "Không xác minh được quyền của bạn lúc này. Vui lòng thử lại.";
const COUNT_ERROR =
  "Không đọc được số thư đã gửi trong 24 giờ qua, nên dừng lại để không vượt hạn mức. Vui lòng thử lại.";
const NO_BASE_URL =
  "Chưa xác định được địa chỉ công khai của hệ thống (VAM_OS_PUBLIC_BASE_URL), nên không dựng được đường dẫn. Chưa gửi gì.";
const ACCOUNT_RACE =
  "Tài khoản của người này vừa thay đổi ở một lượt khác. Tải lại danh sách rồi thử lại.";
const DAY_MS = 24 * 60 * 60 * 1000;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; status?: number; message?: string };
  console.error("[participant-invites]", scope, {
    code: err?.code ?? err?.status,
    message: err?.message ?? String(error)
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cổng quyền
// ─────────────────────────────────────────────────────────────────────────────

export type InviteAccess =
  | { ok: true; actor: CurrentAdminUser & { id: string } }
  | {
      ok: false;
      code: "unauthenticated" | "forbidden" | "invalid_season" | "scope_error" | "season_forbidden" | "check_failed";
      message: string;
    };

/**
 * Người đang đăng nhập có được mời tài khoản cho mùa này không.
 *
 * Vai trò (canInviteParticipants) VÀ quyền vận hành đúng mùa (canOperateSeason).
 * Fail-closed ở mọi bước: không đọc được phạm vi thì từ chối, không đoán.
 *
 * Trang, hai hành động, và hai hàm mời bên dưới đều đi qua đúng hàm này.
 */
export async function authorizeParticipantInvites(seasonId: string): Promise<InviteAccess> {
  let actor: CurrentAdminUser | null;
  try {
    actor = await getCurrentAdminUser();
  } catch (error) {
    log("đọc người đang đăng nhập", error);
    return { ok: false, code: "check_failed", message: AUTH_CHECK_ERROR };
  }

  if (!actor?.id) return { ok: false, code: "unauthenticated", message: "Bạn chưa đăng nhập." };
  if (!canInviteParticipants(actor.role)) {
    return { ok: false, code: "forbidden", message: "Bạn không có quyền gửi lời mời tài khoản." };
  }
  if (!isUuid(String(seasonId ?? ""))) return { ok: false, code: "invalid_season", message: "Chưa chọn mùa." };

  try {
    const ctx = await getAdminScopeContext();
    if (ctx.scopeError) return { ok: false, code: "scope_error", message: SCOPE_RESOLUTION_ERROR };
    if (!(await canOperateSeason(ctx, seasonId))) {
      return { ok: false, code: "season_forbidden", message: "Bạn không có quyền vận hành mùa này." };
    }
  } catch (error) {
    log("kiểm phạm vi mùa", error);
    return { ok: false, code: "check_failed", message: AUTH_CHECK_ERROR };
  }

  return { ok: true, actor: actor as CurrentAdminUser & { id: string } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Kết quả
// ─────────────────────────────────────────────────────────────────────────────

export type ParticipantInviteResult = {
  personId: string;
  outcome: InviteOutcome;
  /** Thư đã đi, hoặc người này đã đăng nhập từ trước. */
  ok: boolean;
  emailSent: boolean;
  reason: InviteRefusalReason | null;
  linkType: LinkType | null;
  /** Nhà cung cấp từ chối vì hết hạn mức ngày. */
  quota: boolean;
  message: string;
};

export type ParticipantInviteBatchResult =
  | { ok: false; message: string }
  | {
      ok: true;
      results: ParticipantInviteResult[];
      remainingPersonIds: string[];
      stoppedBy: BulkStopReason | null;
    };

function bare(personId: string, outcome: InviteOutcome, message: string): ParticipantInviteResult {
  return { personId, outcome, ok: false, emailSent: false, reason: null, linkType: null, quota: false, message };
}

function refused(personId: string, reason: InviteRefusalReason, lastSentAt?: string | null): ParticipantInviteResult {
  return {
    personId,
    outcome: "refused",
    ok: false,
    emailSent: false,
    reason,
    linkType: null,
    quota: false,
    message: inviteRefusalMessage(reason, { lastSentAt })
  };
}

function failedBeforeSend(personId: string, message = inviteOutcomeMessage("failed", { name: "" })): ParticipantInviteResult {
  return bare(personId, "failed", message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Chuẩn bị một lượt
// ─────────────────────────────────────────────────────────────────────────────

type RunContext = {
  client: any;
  actor: CurrentAdminUser & { id: string };
  seasonId: string;
  gateOpen: boolean;
  requestOrigin: string | null;
  directory: AuthDirectory;
  staffRows: Array<{ email: string | null; authUserId: string | null }>;
  /** Còn gửi được bao nhiêu thư mời trong lượt này. Chỉ có nghĩa khi cổng thư mở. */
  budgetLeft: number;
};

async function prepareRun(
  client: any,
  actor: CurrentAdminUser & { id: string },
  seasonId: string,
  nowMs: number
): Promise<{ ok: true; run: RunContext } | { ok: false; message: string }> {
  const gateOpen = evaluateEmailGate(process.env).canSend;
  const requestOrigin = await getPublicOrigin();
  if (!buildPasswordLinkUrl(resolveEmailBaseUrl(requestOrigin), { tokenHash: "probe", type: "invite" })) {
    return { ok: false, message: NO_BASE_URL };
  }

  let directory: AuthDirectory;
  try {
    directory = await AuthDirectory.load(client);
  } catch (error) {
    // Kể cả AuthLookupIncomplete: chưa đọc hết danh bạ mà vẫn mời là có thể tạo
    // tài khoản thứ hai cho một hòm thư đã có tài khoản.
    log("đọc danh bạ Auth", error);
    return { ok: false, message: SAFE_ERROR };
  }

  // Mọi dòng nhân sự, bất kể trạng thái. Hạng A: vài chục dòng, có trần.
  const staff = await readBounded<{ email: string | null; auth_user_id: string | null }>(
    "admin_users",
    client.from("admin_users").select("email, auth_user_id")
  );
  if (staff.error) {
    log("đọc nhân sự", staff.error);
    return { ok: false, message: SAFE_ERROR };
  }

  let budgetLeft = 0;
  if (gateOpen) {
    await expireStaleParticipantInviteClaims(nowMs);
    const counted = await countOutboundEmailsSince(new Date(nowMs - DAY_MS).toISOString());
    if (!counted.ok) return { ok: false, message: COUNT_ERROR };
    budgetLeft = inviteBudgetRemaining(counted.count);
  }

  return {
    ok: true,
    run: {
      client,
      actor,
      seasonId,
      gateOpen,
      requestOrigin,
      directory,
      staffRows: staff.data.map((row) => ({ email: row.email ?? null, authUserId: row.auth_user_id ?? null })),
      budgetLeft
    }
  };
}

function toLinkRow(row: Record<string, unknown>): LinkRow {
  return {
    authUserId: String(row.auth_user_id ?? ""),
    personId: String(row.person_id ?? ""),
    status: String(row.status ?? ""),
    activatedAt: row.activated_at ? String(row.activated_at) : null
  };
}

/**
 * Mọi thứ phần thuần cần để quyết định cho những người này.
 *
 * Tối đa INVITE_BATCH_MAX người mỗi lần, nên mọi phép đọc ở đây là hạng A: có
 * trần theo số id truyền vào.
 */
async function loadFacts(
  run: RunContext,
  personIds: string[]
): Promise<{ ok: true; facts: Map<string, InviteFacts> } | { ok: false }> {
  const { client, seasonId } = run;

  const [peopleResult, membershipResult, linksByPersonResult, sendsResult] = await Promise.all([
    client.from("people").select("id, full_name, email_primary").in("id", personIds),
    client
      .from("person_season_memberships")
      .select("person_id, season_id, role, status")
      .in("person_id", personIds)
      .eq("season_id", seasonId)
      .in("status", [...INVITE_MEMBERSHIP_STATUSES]),
    client.from("account_person_auth_links").select("auth_user_id, person_id, status, activated_at").in("person_id", personIds),
    readParticipantInviteSends(personIds)
  ]);

  for (const [scope, result] of [
    ["đọc danh bạ", peopleResult],
    ["đọc tư cách thành viên", membershipResult],
    ["đọc mối nối", linksByPersonResult]
  ] as const) {
    if (result.error) {
      log(scope, result.error);
      return { ok: false };
    }
  }
  if (!sendsResult.ok) return { ok: false };

  const people = new Map<string, { fullName: string | null; emailPrimary: string | null }>();
  for (const row of (peopleResult.data ?? []) as Array<Record<string, unknown>>) {
    people.set(String(row.id), {
      fullName: row.full_name === null || row.full_name === undefined ? null : String(row.full_name),
      emailPrimary: row.email_primary === null || row.email_primary === undefined ? null : String(row.email_primary)
    });
  }

  const membershipsByPerson = new Map<string, InviteFacts["memberships"]>();
  for (const row of (membershipResult.data ?? []) as Array<Record<string, unknown>>) {
    const personId = String(row.person_id ?? "");
    const list = membershipsByPerson.get(personId) ?? [];
    list.push({ seasonId: String(row.season_id ?? ""), role: String(row.role ?? ""), status: String(row.status ?? "") });
    membershipsByPerson.set(personId, list);
  }

  const linksByPerson = new Map<string, LinkRow>();
  for (const row of (linksByPersonResult.data ?? []) as Array<Record<string, unknown>>) {
    linksByPerson.set(String(row.person_id ?? ""), toLinkRow(row));
  }

  const emails = Array.from(
    new Set(
      personIds
        .map((personId) => normalizeEmail(people.get(personId)?.emailPrimary))
        .filter((email) => email && isValidEmail(email))
    )
  );

  // Ai khác trong danh bạ mang email này. `ilike` đã thoát ký tự đại diện, và
  // phần thuần còn so chính xác lại một lần nữa.
  const sameEmailResults = await Promise.all(
    emails.map((email) =>
      client.from("people").select("id, email_primary").ilike("email_primary", escapeIlikePattern(email)).limit(5)
    )
  );
  const sameEmail = new Map<string, InviteFacts["sameEmailPeople"]>();
  for (let index = 0; index < emails.length; index += 1) {
    const result = sameEmailResults[index];
    if (result.error) {
      log("dò email trùng", result.error);
      return { ok: false };
    }
    sameEmail.set(
      emails[index],
      ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        emailPrimary: row.email_primary === null || row.email_primary === undefined ? null : String(row.email_primary)
      }))
    );
  }

  const authIds = Array.from(
    new Set(emails.flatMap((email) => run.directory.usersWithEmail(email).map((user) => user.id)))
  );
  const linksByAuthUser = new Map<string, LinkRow>();
  if (authIds.length) {
    const { data, error } = await client
      .from("account_person_auth_links")
      .select("auth_user_id, person_id, status, activated_at")
      .in("auth_user_id", authIds);
    if (error) {
      log("đọc mối nối theo tài khoản", error);
      return { ok: false };
    }
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      linksByAuthUser.set(String(row.auth_user_id ?? ""), toLinkRow(row));
    }
  }

  const facts = new Map<string, InviteFacts>();
  for (const personId of personIds) {
    const person = people.get(personId) ?? null;
    const email = person ? normalizeEmail(person.emailPrimary) : "";
    const authUsers = email ? run.directory.usersWithEmail(email) : [];
    facts.set(personId, {
      personId,
      seasonId,
      person,
      memberships: membershipsByPerson.get(personId) ?? [],
      sameEmailPeople: email ? sameEmail.get(email) ?? [] : [],
      staffRows: run.staffRows,
      authUsers,
      linkByPerson: linksByPerson.get(personId) ?? null,
      linkByAuthUser: authUsers.length === 1 ? linksByAuthUser.get(authUsers[0].id) ?? null : null,
      sends: sendsResult.byPersonId.get(personId) ?? []
    });
  }
  return { ok: true, facts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Thực thi
// ─────────────────────────────────────────────────────────────────────────────

async function executeDecision(
  run: RunContext,
  personId: string,
  decision: InviteDecision,
  nowMs: number
): Promise<ParticipantInviteResult> {
  if (decision.kind === "refuse") return refused(personId, decision.reason, decision.lastSentAt);

  if (decision.kind === "already_active") {
    return {
      personId,
      outcome: "already_active",
      ok: true,
      emailSent: false,
      reason: null,
      linkType: null,
      quota: false,
      message: inviteOutcomeMessage("already_active", { name: decision.recipientName, activatedAt: decision.activatedAt })
    };
  }

  // Cổng thư tắt thì không giữ chỗ, không tạo link, không ghi gì: trên bản xem
  // thử, bấm Mời không được để lại một tài khoản không ai nhận được thư.
  if (!run.gateOpen) {
    return bare(personId, "not_sent_gate_closed", inviteOutcomeMessage("not_sent_gate_closed", { name: decision.recipientName }));
  }
  if (run.budgetLeft <= 0) return refused(personId, "daily_budget");

  return sendInvite(run, personId, decision, nowMs);
}

async function rereadLinks(
  client: any,
  personId: string,
  authUserId: string
): Promise<{ ok: true; byPerson: LinkRow | null; byAuthUser: LinkRow | null } | { ok: false }> {
  const [byPerson, byAuthUser] = await Promise.all([
    client.from("account_person_auth_links").select("auth_user_id, person_id, status, activated_at").eq("person_id", personId).maybeSingle(),
    client.from("account_person_auth_links").select("auth_user_id, person_id, status, activated_at").eq("auth_user_id", authUserId).maybeSingle()
  ]);
  if (byPerson.error || byAuthUser.error) {
    log("đọc lại mối nối", byPerson.error ?? byAuthUser.error);
    return { ok: false };
  }
  return {
    ok: true,
    byPerson: byPerson.data ? toLinkRow(byPerson.data) : null,
    byAuthUser: byAuthUser.data ? toLinkRow(byAuthUser.data) : null
  };
}

async function sendInvite(
  run: RunContext,
  personId: string,
  decision: SendDecision,
  nowMs: number
): Promise<ParticipantInviteResult> {
  // 1. Giữ chỗ.
  const claim = await claimParticipantInviteSend({ personId, toEmail: decision.email });
  if (!claim.ok) {
    return claim.reason === "in_flight" ? refused(personId, "in_flight") : failedBeforeSend(personId);
  }

  // 2. Tạo link. Không `redirectTo`: link trong thư là link của VAM OS, không
  //    phải `action_link` của Supabase.
  let generated: any;
  try {
    const { data, error } = await run.client.auth.admin.generateLink({ type: decision.linkType, email: decision.email });
    if (error) {
      const code = String(error.code ?? error.status ?? "error");
      log("tạo đường dẫn", error);
      await releaseOutboundEmailClaim(claim.claimId, `generateLink: ${code}`);
      return failedBeforeSend(personId, code === "email_exists" || code === "user_not_found" ? ACCOUNT_RACE : undefined);
    }
    generated = data;
  } catch (error) {
    log("tạo đường dẫn", error);
    await releaseOutboundEmailClaim(claim.claimId, "generateLink: exception");
    return failedBeforeSend(personId);
  }

  const checked = checkGeneratedLink(decision, {
    userId: generated?.user?.id,
    userEmail: generated?.user?.email,
    hashedToken: generated?.properties?.hashed_token,
    verificationType: generated?.properties?.verification_type
  });
  if (!checked.ok) {
    // Ghi mã vấn đề, không bao giờ ghi mã băm.
    log("đường dẫn không khớp người nhận", { code: checked.problem });
    await releaseOutboundEmailClaim(claim.claimId, `generateLink check: ${checked.problem}`);
    return failedBeforeSend(personId);
  }

  // 3. Mối nối.
  let linkWritten = false;
  if (decision.writeLink) {
    const { error: linkError } = await run.client.from("account_person_auth_links").insert({
      auth_user_id: checked.authUserId,
      person_id: personId,
      status: "active",
      link_source: "invite",
      invited_at: new Date(nowMs).toISOString(),
      created_by: run.actor.id
    });

    if (linkError) {
      if ((linkError as { code?: string }).code !== "23505") {
        log("ghi mối nối", linkError);
        await releaseOutboundEmailClaim(claim.claimId, "Không ghi được mối nối");
        return failedBeforeSend(personId);
      }
      const reread = await rereadLinks(run.client, personId, checked.authUserId);
      if (!reread.ok) {
        await releaseOutboundEmailClaim(claim.claimId, "Không đọc lại được mối nối");
        return failedBeforeSend(personId);
      }
      const state = linkStateAfterUniqueViolation(reread, { personId, authUserId: checked.authUserId });
      if (!state.ok) {
        await releaseOutboundEmailClaim(claim.claimId, "Mối nối xung đột");
        return state.reason ? refused(personId, state.reason) : failedBeforeSend(personId);
      }
    } else {
      linkWritten = true;
    }
  }

  // 4. Gửi.
  const sent = await sendParticipantInvite({
    toEmail: decision.email,
    recipientName: decision.recipientName,
    linkType: decision.linkType,
    tokenHash: checked.tokenHash,
    personId,
    claimedRowId: claim.claimId,
    requestOrigin: run.requestOrigin
  });

  let result: ParticipantInviteResult;
  if (sent.skipped) {
    // `skipped` là cổng thư tắt: không có lá thư nào đi, nên không được báo là đã gửi.
    result = bare(personId, "not_sent_gate_closed", inviteOutcomeMessage("not_sent_gate_closed", { name: decision.recipientName }));
  } else if (!sent.ok) {
    const quota = sent.providerStatus === 429;
    result = {
      ...bare(personId, "send_failed", inviteOutcomeMessage("send_failed", { name: decision.recipientName, quota })),
      quota,
      linkType: decision.linkType
    };
  } else {
    result = {
      personId,
      outcome: "sent",
      ok: true,
      emailSent: true,
      reason: null,
      linkType: decision.linkType,
      quota: false,
      message: inviteOutcomeMessage("sent", { name: decision.recipientName, linkType: decision.linkType })
    };
  }

  // 5. Nhật ký.
  await writeAudit(run, {
    personId,
    linkType: decision.linkType,
    linkWritten,
    outcome: result.outcome,
    claimId: claim.claimId
  });

  return result;
}

/**
 * Ai đã mời người này, lúc nào. `outbound_emails` ghi được thư đi, nhưng không
 * ghi được người bấm — nhất là khi Support team cũng bấm được.
 *
 * Không email, không tên, không mã băm trong `details`. Nuốt lỗi: ghi nhật ký
 * hỏng không được biến một lá thư đã đi thành một lần mời "thất bại".
 */
async function writeAudit(
  run: RunContext,
  input: { personId: string; linkType: LinkType; linkWritten: boolean; outcome: InviteOutcome; claimId: string }
) {
  try {
    const { error } = await run.client.from("admin_audit_log").insert({
      actor_admin_user_id: run.actor.id,
      action_type: PARTICIPANT_INVITE_AUDIT_ACTION,
      target_admin_user_id: null,
      before_data: null,
      after_data: null,
      details: {
        person_id: input.personId,
        season_id: run.seasonId,
        link_type: input.linkType,
        link_written: input.linkWritten,
        outcome: input.outcome,
        outbound_email_id: input.claimId
      }
    });
    if (error) log("ghi nhật ký quản trị", error);
  } catch (error) {
    log("ghi nhật ký quản trị", error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hai cửa vào
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nút trên một dòng: Mời / Gửi lại (`invite`) hoặc gửi link đặt lại mật khẩu
 * cho người đã vào (`reset`).
 */
export async function inviteParticipantAccount(input: {
  personId: string;
  seasonId: string;
  mode: "invite" | "reset";
}): Promise<ParticipantInviteResult> {
  const personId = String(input.personId ?? "").trim();
  const seasonId = String(input.seasonId ?? "").trim();
  // Thứ đến từ biểu mẫu là thứ người gửi tự đặt được: chỉ hai giá trị này.
  const mode = input.mode === "reset" ? "reset" : "invite";

  const access = await authorizeParticipantInvites(seasonId);
  if (!access.ok) return bare(personId, "refused", access.message);
  if (!isUuid(personId)) return bare(personId, "refused", "Chưa chọn người để mời.");

  const client = getSupabaseServiceRoleClient();
  if (!client) return failedBeforeSend(personId);

  const nowMs = Date.now();
  const prepared = await prepareRun(client, access.actor, seasonId, nowMs);
  if (!prepared.ok) return failedBeforeSend(personId, prepared.message);

  const loaded = await loadFacts(prepared.run, [personId]);
  if (!loaded.ok) return failedBeforeSend(personId);

  const facts = loaded.facts.get(personId);
  if (!facts) return failedBeforeSend(personId);

  return executeDecision(prepared.run, personId, decideParticipantInvite(facts, { mode, nowMs }), nowMs);
}

/**
 * Một lượt mời hàng loạt: tối đa INVITE_BATCH_MAX người.
 *
 * Danh sách người do hành động tính trên máy chủ, từ roster — không nhận từ
 * trình duyệt. Dù vậy, từng người vẫn đi qua đủ các phép kiểm: người không
 * thuộc mùa này, hay đã nhận thư, bị từ chối ngay trong vòng lặp.
 */
export async function inviteParticipantsInSeason(input: {
  seasonId: string;
  personIds: string[];
  now?: () => number;
}): Promise<ParticipantInviteBatchResult> {
  const now = input.now ?? Date.now;
  const seasonId = String(input.seasonId ?? "").trim();

  const access = await authorizeParticipantInvites(seasonId);
  if (!access.ok) return { ok: false, message: access.message };

  const ids = Array.isArray(input.personIds)
    ? Array.from(new Set(input.personIds.map((value) => String(value ?? "").trim()).filter((value) => isUuid(value))))
    : [];
  const chunk = ids.slice(0, INVITE_BATCH_MAX);
  const overflow = ids.slice(INVITE_BATCH_MAX);
  if (!chunk.length) return { ok: true, results: [], remainingPersonIds: [], stoppedBy: null };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const startedAt = now();
  const prepared = await prepareRun(client, access.actor, seasonId, startedAt);
  if (!prepared.ok) return { ok: false, message: prepared.message };
  const run = prepared.run;

  if (!run.gateOpen) return { ok: true, results: [], remainingPersonIds: ids, stoppedBy: "gate_closed" };

  const loaded = await loadFacts(run, chunk);
  if (!loaded.ok) return { ok: false, message: SAFE_ERROR };

  const results: ParticipantInviteResult[] = [];
  let stoppedBy: BulkStopReason | null = null;
  let stopIndex = chunk.length;
  let consecutiveFailures = 0;

  for (let index = 0; index < chunk.length; index += 1) {
    if (now() - startedAt >= INVITE_BATCH_TIME_BUDGET_MS) {
      stoppedBy = "time_budget";
      stopIndex = index;
      break;
    }
    if (run.budgetLeft <= 0) {
      stoppedBy = "daily_budget";
      stopIndex = index;
      break;
    }

    const personId = chunk[index];
    let result: ParticipantInviteResult;
    try {
      const facts = loaded.facts.get(personId);
      result = facts
        ? await executeDecision(run, personId, decideParticipantInvite(facts, { mode: "bulk", nowMs: now() }), now())
        : failedBeforeSend(personId);
    } catch (error) {
      log("mời một người trong lượt", error);
      result = failedBeforeSend(personId);
    }
    results.push(result);

    if (result.outcome === "sent") {
      run.budgetLeft -= 1;
      consecutiveFailures = 0;
      continue;
    }
    if (result.outcome === "not_sent_gate_closed") {
      stoppedBy = "gate_closed";
      stopIndex = index + 1;
      break;
    }
    if (result.outcome === "send_failed" || result.outcome === "failed") {
      if (result.quota) {
        stoppedBy = "daily_budget";
        stopIndex = index + 1;
        break;
      }
      consecutiveFailures += 1;
      if (consecutiveFailures >= INVITE_MAX_CONSECUTIVE_SEND_FAILURES) {
        stoppedBy = "send_failures";
        stopIndex = index + 1;
        break;
      }
    }
  }

  return {
    ok: true,
    results,
    remainingPersonIds: chunk.slice(stopIndex).concat(overflow),
    stoppedBy
  };
}
