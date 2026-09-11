/**
 * lib/participant-invite-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của lời mời lập tài khoản cho mentor/mentee: quyết định gửi hay
 * không, trạng thái tài khoản hiện trên màn hình, và mọi lời báo tiếng Việt.
 *
 * ---------------------------------------------------------------------------
 * MỘT CỬA CHO CẢ MÀN HÌNH LẪN MÁY CHỦ
 * ---------------------------------------------------------------------------
 * Màn hình chào nút "Mời" cho ai và máy chủ nhận mời ai đều đọc các hàm ở đây.
 * Hai bản quyết định là hai chỗ để một người thấy nút rồi bấm thì bị từ chối —
 * hoặc tệ hơn, không thấy nút mà vẫn gửi được.
 *
 * Không có I/O, nên dùng được trong client component và thử được mà không phải
 * dựng database giả.
 */
import { isValidEmail, normalizeEmail } from "@/lib/identity";
import { formatDateTime } from "@/lib/utils";

export const INVITE_MEMBERSHIP_STATUSES = ["active", "completed"] as const;
export const INVITABLE_ROLES = ["mentor", "mentee"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * Hai lần gửi cho cùng một người phải cách nhau chừng này. Mỗi lần gửi làm link
 * trong thư trước hết hiệu lực, nên bấm liền hai lần là tự tay làm hỏng lá thư
 * người ta có thể đang mở.
 */
export const INVITE_RESEND_COOLDOWN_MINUTES = 10;
/** Chỗ giữ `queued` cũ hơn chừng này là một lượt gửi bị cắt ngang giữa chừng. */
export const INVITE_CLAIM_STALE_MINUTES = 15;
/**
 * Thư lỗi thì lượt mời hàng loạt đợi chừng này mới thử lại người đó — nếu
 * không, cùng những người gửi hỏng mãi sẽ chiếm chỗ đầu của mọi lượt.
 */
export const INVITE_BULK_RETRY_AFTER_MINUTES = 30;
export const INVITE_BATCH_MAX = 20;
/**
 * Ngắn hơn `maxDuration = 60` của trang một quãng rộng: một lời gọi Brevo có
 * thể treo tới 20 giây, và bị cắt giữa chừng nghĩa là dòng ghi sổ của lá thư
 * cuối không kịp chốt.
 */
export const INVITE_BATCH_TIME_BUDGET_MS = 35_000;
/** Gói miễn phí của Brevo, dùng chung cho MỌI thư của hệ thống. */
export const BREVO_DAILY_LIMIT = 300;
/** Chừa lại cho thư xác nhận đơn và thư sự kiện trong cùng 24 giờ. */
export const INVITE_DAILY_RESERVE = 60;
export const INVITE_MAX_CONSECUTIVE_SEND_FAILURES = 3;
export const PARTICIPANT_INVITE_AUDIT_ACTION = "participant_account_invite";
export const PARTICIPANT_INVITE_EMAIL_KIND = "participant_invite";

const MINUTE_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function lower(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function timeOf(value: unknown): number | null {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kiểu dữ liệu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * - `invite`: nút Mời / Gửi lại trên một dòng.
 * - `reset`: nút "Gửi link đặt lại mật khẩu" cho người đã vào mà quên mật khẩu.
 * - `bulk`: lượt mời hàng loạt — không bao giờ gửi lại cho người đã nhận thư.
 */
export type InviteMode = "invite" | "reset" | "bulk";
export type LinkType = "invite" | "recovery";

export type LinkRow = {
  authUserId: string;
  personId: string;
  status: string;
  activatedAt: string | null;
};

export type InviteSend = { status: string; createdAt: string; error?: string | null };

export type InviteRefusalReason =
  | "person_not_found"
  | "no_email"
  | "invalid_email"
  | "not_in_season"
  | "role_not_invitable"
  | "email_shared"
  | "auth_ambiguous"
  | "is_staff"
  | "person_linked_to_other_account"
  | "auth_linked_to_other_person"
  | "link_inactive"
  | "in_flight"
  | "bulk_already_invited"
  | "recently_sent"
  | "daily_budget";

export type InviteFacts = {
  personId: string;
  seasonId: string;
  person: { fullName: string | null; emailPrimary: string | null } | null;
  /** Tư cách thành viên của người này. Hàm tự lọc lại đúng mùa và trạng thái. */
  memberships: Array<{ seasonId: string; role: string; status: string }>;
  /** Những người trong danh bạ có email gần giống — hàm tự so chính xác. */
  sameEmailPeople: Array<{ id: string; emailPrimary: string | null }>;
  /** Mọi dòng admin_users, BẤT KỂ trạng thái. */
  staffRows: Array<{ email: string | null; authUserId: string | null }>;
  /** Tài khoản đăng nhập tìm thấy theo email này. */
  authUsers: Array<{ id: string; email: string | null }>;
  linkByPerson: LinkRow | null;
  linkByAuthUser: LinkRow | null;
  sends: InviteSend[];
};

export type SendDecision = {
  kind: "send";
  linkType: LinkType;
  /** Chưa có mối nối thì ghi; đã có thì để nguyên. */
  writeLink: boolean;
  /** Tài khoản đã có sẵn mà link phải thuộc về. Null khi lời mời tạo tài khoản mới. */
  expectedAuthUserId: string | null;
  email: string;
  recipientName: string;
};

export type InviteDecision =
  | { kind: "refuse"; reason: InviteRefusalReason; lastSentAt?: string | null }
  | { kind: "already_active"; activatedAt: string; recipientName: string }
  | SendDecision;

// ─────────────────────────────────────────────────────────────────────────────
// Sổ thư của một người
// ─────────────────────────────────────────────────────────────────────────────

export type SendSummary = {
  /** Đang có một lượt gửi giữ chỗ, chưa quá hạn. */
  inFlight: boolean;
  /** Đã từng có một lá thư đi thật. */
  everSent: boolean;
  lastSentAt: string | null;
  /** Lá thư gần nhất CÓ KẾT QUẢ. Bỏ qua `skipped` (không có thư nào đi) và chỗ giữ còn mới. */
  latest: { outcome: "sent" | "failed"; at: string; error: string | null } | null;
  /** Có một lá thư đã gửi mà không đọc được lúc gửi. */
  unreadableSentAt: boolean;
};

export function summarizeSends(sends: InviteSend[], nowMs: number): SendSummary {
  let inFlight = false;
  let everSent = false;
  let unreadableSentAt = false;
  let lastSentAt: string | null = null;
  let lastSentMs = -Infinity;
  let latest: SendSummary["latest"] = null;
  let latestMs = -Infinity;

  for (const send of sends) {
    const status = lower(send.status);
    const at = timeOf(send.createdAt);

    let outcome: "sent" | "failed" | null = null;
    if (status === "queued") {
      // Không đọc được mốc thời gian thì coi như còn mới: đoán là cũ nghĩa là có
      // thể gửi chồng lên một lượt đang chạy thật.
      if (at === null || nowMs - at < INVITE_CLAIM_STALE_MINUTES * MINUTE_MS) {
        inFlight = true;
        continue;
      }
      outcome = "failed";
    } else if (status === "sent") {
      outcome = "sent";
      everSent = true;
      if (at === null) unreadableSentAt = true;
      else if (at > lastSentMs) {
        lastSentMs = at;
        lastSentAt = send.createdAt;
      }
    } else if (status === "failed") {
      outcome = "failed";
    }

    if (!outcome) continue;
    const order = at ?? -Infinity;
    if (!latest || order >= latestMs) {
      latestMs = order;
      latest = {
        outcome,
        at: send.createdAt,
        error: status === "queued" ? "Lượt gửi bị gián đoạn" : send.error ?? null
      };
    }
  }

  return { inFlight, everSent, lastSentAt, latest, unreadableSentAt };
}

function sentRecently(summary: SendSummary, nowMs: number) {
  if (summary.unreadableSentAt) return true;
  if (!summary.lastSentAt) return false;
  const at = timeOf(summary.lastSentAt);
  return at === null || nowMs - at < INVITE_RESEND_COOLDOWN_MINUTES * MINUTE_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Quyết định cho một người
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gửi hay không, và gửi loại link nào.
 *
 * Luật đầu tiên khớp sẽ thắng. Thứ tự là có chủ ý: mọi phép từ chối về DANH
 * TÍNH đứng trước mọi phép kiểm về THƯ, vì một lời mời gửi nhầm người thì không
 * thu hồi được, còn một lời mời bị hoãn chỉ tốn một lần bấm lại.
 */
export function decideParticipantInvite(
  facts: InviteFacts,
  ctx: { mode: InviteMode; nowMs: number }
): InviteDecision {
  if (!facts.person) return { kind: "refuse", reason: "person_not_found" };

  const email = normalizeEmail(facts.person.emailPrimary);
  if (!email) return { kind: "refuse", reason: "no_email" };
  if (!isValidEmail(email)) return { kind: "refuse", reason: "invalid_email" };

  // Lọc lại ở đây dù câu truy vấn đã lọc: một câu truy vấn quên `.eq("season_id")`
  // không được biến thành quyền mời người của mùa khác.
  const inSeason = facts.memberships.filter(
    (membership) =>
      membership.seasonId === facts.seasonId &&
      (INVITE_MEMBERSHIP_STATUSES as readonly string[]).includes(lower(membership.status))
  );
  if (!inSeason.length) return { kind: "refuse", reason: "not_in_season" };
  if (!inSeason.some((membership) => (INVITABLE_ROLES as readonly string[]).includes(lower(membership.role)))) {
    return { kind: "refuse", reason: "role_not_invitable" };
  }

  // So chính xác sau khi chuẩn hoá. Danh sách đến từ một phép `ilike`, và một
  // ký tự đại diện lọt qua ở đó không được thành "email trùng".
  if (facts.sameEmailPeople.some((other) => other.id !== facts.personId && normalizeEmail(other.emailPrimary) === email)) {
    return { kind: "refuse", reason: "email_shared" };
  }

  const authMatches = facts.authUsers.filter((user) => normalizeEmail(user.email) === email);
  if (authMatches.length > 1) return { kind: "refuse", reason: "auth_ambiguous" };
  const authUser = authMatches[0] ?? null;

  // Mọi dòng admin_users, kể cả đã khoá: đăng nhập từ chối người có dòng nhân sự
  // không hoạt động (app/login/actions.ts), nên mời họ là tạo một tài khoản
  // không bao giờ vào được.
  const isStaff = facts.staffRows.some(
    (staff) => normalizeEmail(staff.email) === email || Boolean(authUser && staff.authUserId === authUser.id)
  );
  if (isStaff) return { kind: "refuse", reason: "is_staff" };

  if (facts.linkByPerson && (!authUser || facts.linkByPerson.authUserId !== authUser.id)) {
    return { kind: "refuse", reason: "person_linked_to_other_account" };
  }
  if (facts.linkByAuthUser && facts.linkByAuthUser.personId !== facts.personId) {
    return { kind: "refuse", reason: "auth_linked_to_other_person" };
  }

  const link = facts.linkByPerson ?? facts.linkByAuthUser;
  if (link && link.status !== "active") return { kind: "refuse", reason: "link_inactive" };

  const recipientName = String(facts.person.fullName ?? "").trim() || email;

  if (link?.activatedAt && ctx.mode !== "reset") {
    return { kind: "already_active", activatedAt: link.activatedAt, recipientName };
  }

  const summary = summarizeSends(facts.sends, ctx.nowMs);
  if (summary.inFlight) return { kind: "refuse", reason: "in_flight" };
  if (ctx.mode === "bulk" && summary.everSent) return { kind: "refuse", reason: "bulk_already_invited" };
  if (sentRecently(summary, ctx.nowMs)) {
    return { kind: "refuse", reason: "recently_sent", lastSentAt: summary.lastSentAt };
  }

  return {
    kind: "send",
    linkType: authUser ? "recovery" : "invite",
    writeLink: !link,
    expectedAuthUserId: authUser?.id ?? null,
    email,
    recipientName
  };
}

export type GeneratedLinkProblem = "missing_token" | "email_mismatch" | "account_mismatch" | "type_mismatch";

/**
 * Link Supabase vừa tạo có đúng là của người sắp nhận thư không.
 *
 * Kiểm trước khi gửi, vì một link thuộc tài khoản khác nằm trong hộp thư của
 * người này là trao tài khoản của người kia cho họ.
 */
export function checkGeneratedLink(
  decision: SendDecision,
  generated: {
    userId?: string | null;
    userEmail?: string | null;
    hashedToken?: string | null;
    verificationType?: string | null;
  }
): { ok: true; authUserId: string; tokenHash: string } | { ok: false; problem: GeneratedLinkProblem } {
  const tokenHash = String(generated.hashedToken ?? "").trim();
  if (!tokenHash) return { ok: false, problem: "missing_token" };

  const userId = String(generated.userId ?? "").trim();
  if (!userId) return { ok: false, problem: "account_mismatch" };
  if (normalizeEmail(generated.userEmail) !== decision.email) return { ok: false, problem: "email_mismatch" };
  if (decision.expectedAuthUserId && userId !== decision.expectedAuthUserId) {
    return { ok: false, problem: "account_mismatch" };
  }

  const verificationType = String(generated.verificationType ?? "").trim();
  if (verificationType && verificationType !== decision.linkType) return { ok: false, problem: "type_mismatch" };

  return { ok: true, authUserId: userId, tokenHash };
}

/**
 * Ghi mối nối gặp 23505: đọc lại rồi mới biết đó là "đã nối đúng rồi" hay
 * "đang nối với người khác".
 *
 * Bản cũ coi mọi 23505 là thành công, nên một tài khoản đang nối với NGƯỜI KHÁC
 * vẫn được báo "đã mời xong" — và thư vẫn đi.
 */
export function linkStateAfterUniqueViolation(
  reread: { byPerson: LinkRow | null; byAuthUser: LinkRow | null },
  expected: { personId: string; authUserId: string }
): { ok: true } | { ok: false; reason: InviteRefusalReason | null } {
  if (reread.byPerson && reread.byPerson.authUserId !== expected.authUserId) {
    return { ok: false, reason: "person_linked_to_other_account" };
  }
  if (reread.byAuthUser && reread.byAuthUser.personId !== expected.personId) {
    return { ok: false, reason: "auth_linked_to_other_person" };
  }
  const link = reread.byPerson ?? reread.byAuthUser;
  if (!link) return { ok: false, reason: null };
  if (link.status !== "active") return { ok: false, reason: "link_inactive" };
  return { ok: true };
}

/** Số thư lời mời còn được gửi, sau khi đã chừa chỗ cho các thư khác. */
export function inviteBudgetRemaining(sentOrQueuedLast24h: number): number {
  const used = Number.isFinite(sentOrQueuedLast24h) ? Math.max(0, sentOrQueuedLast24h) : BREVO_DAILY_LIMIT;
  return Math.max(0, BREVO_DAILY_LIMIT - INVITE_DAILY_RESERVE - used);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lời báo
// ─────────────────────────────────────────────────────────────────────────────

export function inviteRefusalMessage(reason: InviteRefusalReason, extra?: { lastSentAt?: string | null }): string {
  switch (reason) {
    case "person_not_found":
      return "Không tìm thấy người này trong danh bạ.";
    case "no_email":
      return "Người này chưa có email trong danh bạ. Bổ sung email trước khi mời.";
    case "invalid_email":
      return "Email của người này không hợp lệ. Sửa email trong danh bạ trước khi mời.";
    case "not_in_season":
      return "Người này không thuộc mùa đang chọn, hoặc đã rút khỏi mùa. Không gửi lời mời.";
    case "role_not_invitable":
      return "Lời mời tài khoản chỉ dành cho mentor và mentee của mùa này.";
    case "email_shared":
      return "Email này đang dùng cho nhiều người trong danh bạ. Sửa hoặc gộp hồ sơ trước khi mời, để tài khoản không nối nhầm người.";
    case "auth_ambiguous":
      return "Hệ thống đăng nhập có nhiều tài khoản cùng email này. Liên hệ quản trị viên kiểm tra trước khi mời.";
    case "is_staff":
      return "Email này đã gắn với một tài khoản ban tổ chức (kể cả tài khoản đã khoá). Người này không được mời theo đường mentor/mentee.";
    case "person_linked_to_other_account":
      return "Người này đã nối với một tài khoản đăng nhập khác (có thể email trong danh bạ đã đổi). Liên hệ quản trị viên kiểm tra trước khi mời.";
    case "auth_linked_to_other_person":
      return "Tài khoản đăng nhập của email này đang nối với một người khác trong danh bạ. Liên hệ quản trị viên kiểm tra trước khi mời.";
    case "link_inactive":
      return "Tài khoản của người này đã bị ngắt. Không gửi lời mời; liên hệ quản trị viên nếu cần mở lại.";
    case "in_flight":
      return "Đang có một lượt gửi lời mời cho người này. Chờ vài phút rồi tải lại trang.";
    case "bulk_already_invited":
      return "Đã từng gửi lời mời nên lượt mời hàng loạt bỏ qua. Muốn gửi lại, bấm Gửi lại trên dòng của người này.";
    case "recently_sent":
      return extra?.lastSentAt
        ? `Vừa gửi lời mời lúc ${formatDateTime(extra.lastSentAt)}. Chờ ít nhất ${INVITE_RESEND_COOLDOWN_MINUTES} phút rồi hãy gửi lại: mỗi lần gửi làm đường dẫn trong thư trước hết hiệu lực.`
        : `Vừa gửi lời mời. Chờ ít nhất ${INVITE_RESEND_COOLDOWN_MINUTES} phút rồi hãy gửi lại: mỗi lần gửi làm đường dẫn trong thư trước hết hiệu lực.`;
    case "daily_budget":
      return `Đã chạm hạn mức thư trong 24 giờ qua (chừa ${INVITE_DAILY_RESERVE} trên ${BREVO_DAILY_LIMIT} thư cho các thư khác). Tiếp tục vào ngày mai.`;
  }
}

export type InviteOutcome = "sent" | "already_active" | "refused" | "not_sent_gate_closed" | "send_failed" | "failed";

export function inviteOutcomeMessage(
  outcome: Exclude<InviteOutcome, "refused">,
  input: { name: string; linkType?: LinkType | null; activatedAt?: string | null; quota?: boolean }
): string {
  switch (outcome) {
    case "sent":
      return input.linkType === "recovery"
        ? `Đã gửi đường dẫn đặt mật khẩu mới tới ${input.name}. Đường dẫn trong thư trước không còn dùng được.`
        : `Đã gửi thư mời tới ${input.name}. Nhắc họ kiểm cả mục Spam.`;
    case "already_active":
      return `${input.name} đã đăng nhập lần đầu lúc ${formatDateTime(input.activatedAt)}. Không gửi thêm thư.`;
    case "not_sent_gate_closed":
      return "Chưa gửi thư nào: môi trường này đang tắt gửi thư.";
    case "send_failed":
      return input.quota
        ? `Chưa gửi được thư cho ${input.name}: hết hạn mức gửi thư trong ngày. Thử lại vào ngày mai.`
        : `Chưa gửi được thư cho ${input.name}. Thử Gửi lại sau ít phút.`;
    case "failed":
      return "Không gửi được lời mời lúc này. Chưa có thư nào được gửi.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trạng thái trên màn hình
// ─────────────────────────────────────────────────────────────────────────────

export type AccountStatus = "not_invited" | "send_failed" | "invited_pending" | "active" | "blocked";

export type RosterBlockReason =
  | "person_not_found"
  | "no_email"
  | "invalid_email"
  | "is_staff"
  | "email_shared"
  | "link_inactive";

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  not_invited: "Chưa mời",
  send_failed: "Thư lỗi",
  invited_pending: "Đã gửi thư, chưa vào",
  active: "Đã vào",
  blocked: "Không mời được"
};

export const ROSTER_BLOCK_LABELS: Record<RosterBlockReason, string> = {
  person_not_found: "Không có trong danh bạ",
  no_email: "Chưa có email",
  invalid_email: "Email không hợp lệ",
  is_staff: "Là tài khoản ban tổ chức",
  email_shared: "Email trùng với người khác",
  link_inactive: "Tài khoản đã bị ngắt"
};

export type RosterRow = {
  personId: string;
  fullName: string;
  email: string | null;
  roles: InvitableRole[];
  status: AccountStatus;
  blockReason: RosterBlockReason | null;
  inFlight: boolean;
  everSent: boolean;
  lastSentAt: string | null;
  latest: SendSummary["latest"];
  activatedAt: string | null;
};

/**
 * Trạng thái tài khoản của một người.
 *
 * "Đã vào" CHỈ khi mối nối có `activated_at`. Có mối nối mà chưa có mốc đó là
 * người đã được tạo tài khoản nhưng chưa từng đăng nhập — gọi họ là "đã vào"
 * thì không ai đi nhắc họ nữa.
 */
export function deriveRosterRow(input: {
  personId: string;
  roles: InvitableRole[];
  person: { fullName: string | null; emailPrimary: string | null } | null;
  link: LinkRow | null;
  sends: InviteSend[];
  staffEmails: ReadonlySet<string>;
  cohortEmailCounts: ReadonlyMap<string, number>;
  nowMs: number;
}): RosterRow {
  const summary = summarizeSends(input.sends, input.nowMs);
  const email = input.person ? normalizeEmail(input.person.emailPrimary) || null : null;
  const base = {
    personId: input.personId,
    fullName: String(input.person?.fullName ?? "").trim() || email || "(Chưa có tên)",
    email,
    roles: input.roles,
    inFlight: summary.inFlight,
    everSent: summary.everSent,
    lastSentAt: summary.lastSentAt,
    latest: summary.latest,
    activatedAt: input.link?.activatedAt ?? null
  };
  const blocked = (reason: RosterBlockReason): RosterRow => ({ ...base, status: "blocked", blockReason: reason });

  if (!input.person) return blocked("person_not_found");
  if (input.link && input.link.status !== "active") return blocked("link_inactive");
  if (input.link?.activatedAt) return { ...base, status: "active", blockReason: null };
  if (!email) return blocked("no_email");
  if (!isValidEmail(email)) return blocked("invalid_email");
  if (input.staffEmails.has(email)) return blocked("is_staff");
  if ((input.cohortEmailCounts.get(email) ?? 0) > 1) return blocked("email_shared");

  const status: AccountStatus =
    summary.latest?.outcome === "sent" ? "invited_pending" : summary.latest?.outcome === "failed" ? "send_failed" : "not_invited";
  return { ...base, status, blockReason: null };
}

export type RosterRowAction = "invite" | "resend" | "reset";

/** Nút nào hiện trên một dòng, và khoá tới lúc nào nếu vừa gửi. */
export function rosterRowAction(row: RosterRow, nowMs: number): { action: RosterRowAction | null; lockedUntil: string | null } {
  if (row.status === "blocked" || row.inFlight) return { action: null, lockedUntil: null };
  const action: RosterRowAction = row.status === "active" ? "reset" : row.everSent ? "resend" : "invite";
  const sentAt = timeOf(row.lastSentAt);
  const until = sentAt === null ? null : sentAt + INVITE_RESEND_COOLDOWN_MINUTES * MINUTE_MS;
  return { action, lockedUntil: until !== null && until > nowMs ? new Date(until).toISOString() : null };
}

/**
 * Ai được đưa vào lượt mời hàng loạt.
 *
 * Không bao giờ là người ĐÃ TỪNG nhận thư: gửi lại là việc có chủ ý của một
 * người vận hành trên đúng dòng đó, không phải việc một lượt hàng loạt tự làm.
 */
export function isBulkEligible(row: RosterRow, nowMs: number): boolean {
  if (row.inFlight || row.everSent) return false;
  if (row.status === "not_invited") return true;
  if (row.status !== "send_failed") return false;
  const at = timeOf(row.latest?.at);
  return at !== null && nowMs - at >= INVITE_BULK_RETRY_AFTER_MINUTES * MINUTE_MS;
}

/** Người chưa mời trước, thư lỗi sau; trong mỗi nhóm theo tên. */
export function selectBulkCandidates(rows: RosterRow[], nowMs: number): RosterRow[] {
  return rows
    .filter((row) => isBulkEligible(row, nowMs))
    .sort((a, b) => {
      const rank = (row: RosterRow) => (row.status === "not_invited" ? 0 : 1);
      return (
        rank(a) - rank(b) ||
        a.fullName.localeCompare(b.fullName, "vi") ||
        String(a.email ?? "").localeCompare(String(b.email ?? ""))
      );
    });
}

export type RosterSummary = {
  total: number;
  notInvited: number;
  sendFailed: number;
  pending: number;
  active: number;
  blocked: number;
};

export function summarizeRoster(rows: RosterRow[]): RosterSummary {
  const summary: RosterSummary = { total: rows.length, notInvited: 0, sendFailed: 0, pending: 0, active: 0, blocked: 0 };
  for (const row of rows) {
    if (row.status === "not_invited") summary.notInvited += 1;
    else if (row.status === "send_failed") summary.sendFailed += 1;
    else if (row.status === "invited_pending") summary.pending += 1;
    else if (row.status === "active") summary.active += 1;
    else summary.blocked += 1;
  }
  return summary;
}

export function rosterRoleLabel(roles: InvitableRole[]): string {
  return INVITABLE_ROLES.filter((role) => roles.includes(role))
    .map((role) => (role === "mentor" ? "Mentor" : "Mentee"))
    .join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Lượt mời hàng loạt
// ─────────────────────────────────────────────────────────────────────────────

export type BulkStopReason = "time_budget" | "daily_budget" | "send_failures" | "gate_closed";

export type BulkRunTally = {
  sent: number;
  alreadyActive: number;
  refused: number;
  notSent: number;
};

export function describeBulkRun(input: {
  tally: BulkRunTally;
  stoppedBy: BulkStopReason | null;
  remaining: number | null;
}): string {
  const parts = [`Đã gửi ${input.tally.sent} thư mời.`];
  if (input.tally.alreadyActive > 0) {
    parts.push(`${input.tally.alreadyActive} người đã đăng nhập từ trước — không gửi thư.`);
  }
  if (input.tally.notSent > 0) {
    parts.push(
      `${input.tally.notSent} thư chưa gửi được — những người này vẫn là "chưa mời", và lượt mời hàng loạt thử lại họ sau ${INVITE_BULK_RETRY_AFTER_MINUTES} phút.`
    );
  }
  if (input.tally.refused > 0) {
    parts.push(`${input.tally.refused} người không mời được (xem lý do bên dưới).`);
  }

  if (input.stoppedBy === "gate_closed") {
    parts.push("Hệ thống đang tắt gửi thư trên môi trường này, nên dừng lại.");
  } else if (input.stoppedBy === "daily_budget") {
    parts.push("Dừng vì đã chạm hạn mức thư trong 24 giờ qua — tiếp tục vào ngày mai.");
  } else if (input.stoppedBy === "send_failures") {
    parts.push(
      `Dừng vì ${INVITE_MAX_CONSECUTIVE_SEND_FAILURES} thư liên tiếp không gửi được — kiểm tra cấu hình gửi thư trước khi thử tiếp.`
    );
  } else if (input.stoppedBy === "time_budget") {
    parts.push("Dừng vì hết thời gian cho một lượt.");
  }

  if (input.remaining === null) {
    parts.push("Chưa đếm lại được số người còn lại — tải lại trang để xem.");
  } else if (input.remaining === 0) {
    parts.push("Đã mời hết những người đủ điều kiện trong mùa này.");
  } else if (input.stoppedBy !== "daily_budget" && input.stoppedBy !== "send_failures" && input.stoppedBy !== "gate_closed") {
    parts.push(`Còn ${input.remaining} người chưa mời — bấm "Gửi tiếp".`);
  } else {
    parts.push(`Còn ${input.remaining} người chưa mời.`);
  }

  return parts.join(" ");
}
