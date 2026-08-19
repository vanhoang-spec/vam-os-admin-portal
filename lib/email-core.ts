/**
 * lib/email-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure, dependency-light email helpers: send-gating, address normalisation and
 * the Vietnamese templates. No network, no Supabase, no `next/headers` — so the
 * whole surface is unit-testable and safe to import from anywhere on the server.
 *
 * Sending itself lives in lib/email.ts (Resend + outbound_emails logging).
 *
 * Template rule: every template is fully server-authored. The only values
 * interpolated are ones the operator controls (a mentor's own name, a season
 * code, a link this application generated). Applicant free text is never echoed
 * into an email body, so a public form can never be used to compose a message.
 */

export type EmailKind =
  | "mentor_confirmation_link"
  | "mentee_application_confirmation"
  | "mentor_application_confirmation"
  | "review_batch_assigned"
  | "interview_scheduled"
  | "reviewer_invite"
  // The four post-matching sends (migration 069). Their bodies come from an
  // approved template rather than from a builder in this file.
  | "mentee_selected"
  | "mentee_mentor_intro"
  | "mentor_mentee_package"
  | "kickoff_invite"
  // Internal, to the organisers: time to collect the group posts (migration 070).
  // Server-authored like the two above it, not a template anybody has to approve.
  | "recap_period_reminder";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** Who actually puts the message on the wire. */
export const EMAIL_PROVIDERS = ["brevo", "resend"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/** Brevo unless told otherwise: 300 emails a day on the free plan, against 100. */
export const DEFAULT_EMAIL_PROVIDER: EmailProvider = "brevo";

export type EmailGateEnv = {
  VAM_OS_EMAIL_ENABLED?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  VAM_OS_EMAIL_PROVIDER?: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  VAM_OS_EMAIL_FROM?: string;
};

export type EmailGateResult =
  | { canSend: true; provider: EmailProvider; apiKey: string; from: string }
  | { canSend: false; reason: string };

/** Which provider this deployment is configured to use. */
export function resolveEmailProvider(value: unknown): EmailProvider {
  const text = String(value ?? "").trim().toLowerCase();
  return (EMAIL_PROVIDERS as readonly string[]).includes(text)
    ? (text as EmailProvider)
    : DEFAULT_EMAIL_PROVIDER;
}

export type SenderAddress = { name: string | null; email: string };

/**
 * Split the configured From value.
 *
 * The env var is written the way a mail client shows it —
 * "VAM Mentoring <no-reply@vam.vn>" — because that is what an operator copies
 * from a provider's dashboard. Brevo wants the two halves separately, so the
 * parsing lives here where it can be tested rather than inline at the call.
 */
export function parseSenderAddress(value: unknown): SenderAddress | null {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!text) return null;

  const angled = text.match(/^(.*)<([^<>]+)>$/);
  if (angled) {
    const email = normalizeEmailAddress(angled[2]);
    if (!email) return null;
    const name = angled[1].trim().replace(/^["']|["']$/g, "").trim();
    return { name: name || null, email };
  }

  const email = normalizeEmailAddress(text);
  return email ? { name: null, email } : null;
}

/**
 * Decide whether this deployment may send mail at all.
 *
 * Two independent switches must both be on, so neither a stray env var nor a
 * preview deployment can mail real mentors:
 *   1. VAM_OS_EMAIL_ENABLED === "true"  (explicit opt-in, same convention as
 *      the season-config feature flags)
 *   2. the runtime is production        (VERCEL_ENV === "production", or a
 *      local NODE_ENV === "production" build when VERCEL_ENV is absent)
 * Configuration must also be present: a From address, and the API key of the
 * provider this deployment uses. The resolved provider and key are returned, so
 * the sender never reads the environment a second time and cannot end up
 * calling one provider with another provider's key.
 */
export function evaluateEmailGate(env: EmailGateEnv): EmailGateResult {
  if (env.VAM_OS_EMAIL_ENABLED !== "true") {
    return { canSend: false, reason: "VAM_OS_EMAIL_ENABLED chưa bật" };
  }

  const isProductionRuntime = env.VERCEL_ENV
    ? env.VERCEL_ENV === "production"
    : env.NODE_ENV === "production";
  if (!isProductionRuntime) {
    return { canSend: false, reason: "Môi trường không phải production" };
  }

  const provider = resolveEmailProvider(env.VAM_OS_EMAIL_PROVIDER);
  const apiKey = (provider === "brevo" ? env.BREVO_API_KEY : env.RESEND_API_KEY)?.trim() ?? "";
  if (!apiKey) {
    return {
      canSend: false,
      reason: provider === "brevo" ? "BREVO_API_KEY chưa cấu hình" : "RESEND_API_KEY chưa cấu hình"
    };
  }
  const from = env.VAM_OS_EMAIL_FROM?.trim() ?? "";
  if (!from) {
    return { canSend: false, reason: "VAM_OS_EMAIL_FROM chưa cấu hình" };
  }
  if (!parseSenderAddress(from)) {
    return { canSend: false, reason: "VAM_OS_EMAIL_FROM không phải địa chỉ hợp lệ" };
  }

  return { canSend: true, provider, apiKey, from };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailAddress(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text || !EMAIL_PATTERN.test(text)) return null;
  // A newline in a recipient is a header-injection attempt; reject rather than strip.
  if (/[\r\n]/.test(text)) return null;
  return text;
}

/** Escape text before it is placed in an HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A person's display name, trimmed and bounded; falls back to a neutral greeting. */
export function safeDisplayName(value: unknown, fallback = "anh/chị"): string {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/**
 * Only ever accept a link this application generated. A confirmation email must
 * not be able to carry an arbitrary URL supplied by a caller.
 */
export function isSafeAppLink(url: string, baseUrl: string): boolean {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base.startsWith("https://") && !base.startsWith("http://localhost")) return false;
  if (!url.startsWith(`${base}/`)) return false;
  if (/[\r\n\s]/.test(url)) return false;
  return true;
}

const SIGNATURE_TEXT = "Ban tổ chức VAM Mentoring\nVietnam Alumni Mentoring";
const SIGNATURE_HTML =
  '<p style="margin:24px 0 0;color:#4f6b60;font-size:13px;line-height:20px">Ban tổ chức VAM Mentoring<br />Vietnam Alumni Mentoring</p>';

function wrapHtml(bodyHtml: string): string {
  return [
    '<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#14352a">',
    bodyHtml,
    SIGNATURE_HTML,
    "</div>"
  ].join("");
}

/** Invitation asking a Season 11 mentor to confirm participation in the new season. */
export function buildMentorConfirmationLinkEmail(input: {
  mentorName: string;
  seasonLabel: string;
  confirmUrl: string;
  deadlineLabel?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.mentorName);
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const deadline = input.deadlineLabel ? safeDisplayName(input.deadlineLabel) : null;

  const subject = `[VAM Mentoring] Xác nhận đồng hành ${season}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Ban tổ chức VAM Mentoring đang chuẩn bị cho ${season} và rất mong tiếp tục đồng hành cùng anh/chị.`,
    "",
    "Anh/chị vui lòng xác nhận qua đường dẫn dành riêng dưới đây (khoảng 1 phút):",
    input.confirmUrl,
    "",
    "Trong biểu mẫu, anh/chị cho biết:",
    "- Có tiếp tục tham gia mùa này hay không",
    "- Số mentee tối đa có thể nhận (1 đến 3)",
    "- Có sẵn sàng tham gia chấm hồ sơ và phỏng vấn mentee hay không",
    ""
  ];
  if (deadline) {
    lines.push(`Đường dẫn có hiệu lực đến ${deadline}.`, "");
  }
  lines.push(
    "Đường dẫn là riêng cho anh/chị, vui lòng không chuyển tiếp cho người khác.",
    "Nếu cần hỗ trợ, anh/chị chỉ cần trả lời email này.",
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức VAM Mentoring đang chuẩn bị cho <strong>${escapeHtml(season)}</strong> và rất mong tiếp tục đồng hành cùng anh/chị.</p>`,
      `<p style="margin:20px 0"><a href="${escapeHtml(input.confirmUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Xác nhận đồng hành ${escapeHtml(season)}</a></p>`,
      "<p>Trong biểu mẫu, anh/chị cho biết:</p>",
      "<ul><li>Có tiếp tục tham gia mùa này hay không</li><li>Số mentee tối đa có thể nhận (1 đến 3)</li><li>Có sẵn sàng tham gia chấm hồ sơ và phỏng vấn mentee hay không</li></ul>",
      deadline ? `<p>Đường dẫn có hiệu lực đến <strong>${escapeHtml(deadline)}</strong>.</p>` : "",
      "<p>Đường dẫn là riêng cho anh/chị, vui lòng không chuyển tiếp cho người khác. Nếu cần hỗ trợ, anh/chị chỉ cần trả lời email này.</p>",
      `<p style="color:#4f6b60;font-size:13px">Nếu nút trên không hoạt động, anh/chị mở đường dẫn sau: ${escapeHtml(input.confirmUrl)}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** Receipt sent to an applicant right after a public application is stored. */
export function buildApplicationConfirmationEmail(input: {
  applicantName: string;
  role: "mentor" | "mentee";
  seasonLabel: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.applicantName, input.role === "mentor" ? "anh/chị" : "bạn");
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const roleLabel = input.role === "mentor" ? "mentor" : "mentee";
  const you = input.role === "mentor" ? "anh/chị" : "bạn";

  const subject = `[VAM Mentoring] Đã nhận đơn đăng ký ${roleLabel} — ${season}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Ban tổ chức VAM Mentoring đã nhận được đơn đăng ký ${roleLabel} của ${you} cho ${season}.`,
    "",
    "Các bước tiếp theo:",
    "1. Ban tổ chức rà soát và chấm hồ sơ",
    "2. Nếu hồ sơ phù hợp, ban tổ chức sẽ mời phỏng vấn qua email",
    "3. Kết quả và thông tin ghép cặp sẽ được thông báo sau vòng phỏng vấn",
    "",
    `Đây là email xác nhận tự động, ${you} không cần trả lời.`,
    `Nếu ${you} cần chỉnh sửa thông tin đã gửi, vui lòng trả lời email này để ban tổ chức hỗ trợ.`,
    "",
    `Cảm ơn ${you} đã quan tâm đến chương trình.`,
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức VAM Mentoring đã nhận được đơn đăng ký <strong>${escapeHtml(roleLabel)}</strong> của ${escapeHtml(you)} cho <strong>${escapeHtml(season)}</strong>.</p>`,
      "<p>Các bước tiếp theo:</p>",
      "<ol><li>Ban tổ chức rà soát và chấm hồ sơ</li><li>Nếu hồ sơ phù hợp, ban tổ chức sẽ mời phỏng vấn qua email</li><li>Kết quả và thông tin ghép cặp sẽ được thông báo sau vòng phỏng vấn</li></ol>",
      `<p>Đây là email xác nhận tự động, ${escapeHtml(you)} không cần trả lời. Nếu cần chỉnh sửa thông tin đã gửi, vui lòng trả lời email này để ban tổ chức hỗ trợ.</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** Invitation for a mentor who agreed to score applications this season. */
export function buildReviewerInviteEmail(input: {
  mentorName: string;
  seasonLabel: string;
  inviteUrl: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.mentorName);
  const season = safeDisplayName(input.seasonLabel, "mùa mới");

  const subject = `[VAM Mentoring] Tài khoản chấm hồ sơ ${season}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Cảm ơn anh/chị đã nhận lời tham gia chấm hồ sơ mentee ${season}.`,
    "",
    "Ban tổ chức đã tạo tài khoản trên VAM OS cho anh/chị. Vui lòng đặt mật khẩu qua đường dẫn dưới đây:",
    input.inviteUrl,
    "",
    "Sau khi đăng nhập, anh/chị vào mục “Đánh giá” để xem các hồ sơ được phân công.",
    "Đường dẫn đặt mật khẩu là riêng cho anh/chị, vui lòng không chuyển tiếp.",
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Cảm ơn anh/chị đã nhận lời tham gia chấm hồ sơ mentee <strong>${escapeHtml(season)}</strong>.</p>`,
      `<p style="margin:20px 0"><a href="${escapeHtml(input.inviteUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Đặt mật khẩu và đăng nhập</a></p>`,
      "<p>Sau khi đăng nhập, anh/chị vào mục <strong>Đánh giá</strong> để xem các hồ sơ được phân công.</p>",
      "<p>Đường dẫn đặt mật khẩu là riêng cho anh/chị, vui lòng không chuyển tiếp.</p>",
      `<p style="color:#4f6b60;font-size:13px">Nếu nút trên không hoạt động, anh/chị mở đường dẫn sau: ${escapeHtml(input.inviteUrl)}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** Notice that a batch of applications is waiting for this reviewer. */
export function buildReviewBatchAssignedEmail(input: {
  reviewerName: string;
  seasonLabel: string;
  assignmentCount: number;
  reviewsUrl: string;
  dueLabel?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.reviewerName);
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const count = Math.max(0, Math.floor(Number(input.assignmentCount) || 0));
  const due = input.dueLabel ? safeDisplayName(input.dueLabel) : null;

  const subject = `[VAM Mentoring] ${count} hồ sơ mentee chờ anh/chị chấm — ${season}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Ban tổ chức vừa phân công ${count} hồ sơ mentee ${season} cho anh/chị chấm.`,
    "",
    "Anh/chị đăng nhập VAM OS và vào mục “Đánh giá” để bắt đầu:",
    input.reviewsUrl,
    "",
    "Mỗi hồ sơ được chấm theo 5 tiêu chí (thang điểm 1–5) kèm một đề xuất.",
    ""
  ];
  if (due) lines.push(`Ban tổ chức mong nhận kết quả trước ${due}.`, "");
  lines.push(
    "Nếu anh/chị cần hỗ trợ hoặc muốn điều chỉnh số lượng hồ sơ, vui lòng trả lời email này.",
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức vừa phân công <strong>${count} hồ sơ mentee</strong> ${escapeHtml(season)} cho anh/chị chấm.</p>`,
      `<p style="margin:20px 0"><a href="${escapeHtml(input.reviewsUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Mở danh sách hồ sơ</a></p>`,
      "<p>Mỗi hồ sơ được chấm theo 5 tiêu chí (thang điểm 1–5) kèm một đề xuất.</p>",
      due ? `<p>Ban tổ chức mong nhận kết quả trước <strong>${escapeHtml(due)}</strong>.</p>` : "",
      "<p>Nếu anh/chị cần hỗ trợ hoặc muốn điều chỉnh số lượng hồ sơ, vui lòng trả lời email này.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** The interview appointments one interviewer has just been given. */
export function buildInterviewScheduleEmail(input: {
  interviewerName: string;
  seasonLabel: string;
  interviewCount: number;
  firstSlotLabel?: string | null;
  modeLabel?: string | null;
  location?: string | null;
  interviewsUrl: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.interviewerName);
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const count = Math.max(0, Math.floor(Number(input.interviewCount) || 0));
  const first = input.firstSlotLabel ? safeDisplayName(input.firstSlotLabel) : null;
  const modeLabel = input.modeLabel ? safeDisplayName(input.modeLabel) : null;
  const location = input.location ? safeDisplayName(input.location, "") : null;

  const subject = `[VAM Mentoring] Lịch phỏng vấn ${count} ứng viên — ${season}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Ban tổ chức đã xếp lịch cho anh/chị phỏng vấn ${count} ứng viên mentee ${season}.`,
    ""
  ];
  if (first) lines.push(`Ca đầu tiên: ${first}`);
  if (modeLabel) lines.push(`Hình thức: ${modeLabel}`);
  if (location) lines.push(`Địa điểm / đường dẫn: ${location}`);
  if (first || modeLabel || location) lines.push("");
  lines.push(
    "Danh sách đầy đủ kèm giờ từng ca có trong mục “Phỏng vấn” sau khi anh/chị đăng nhập:",
    input.interviewsUrl,
    "",
    "Khi mở hồ sơ, anh/chị sẽ thấy điểm vòng hồ sơ ngay cạnh phiếu chấm phỏng vấn.",
    "Sau khi nộp điểm, nếu muốn nhận bạn này làm mentee, anh/chị bấm “Chọn làm mentee của tôi” ngay trên màn hình đó.",
    "",
    "Nếu lịch chưa phù hợp, anh/chị vui lòng trả lời email này để ban tổ chức sắp xếp lại.",
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const detailRows = [
    first ? `<li>Ca đầu tiên: <strong>${escapeHtml(first)}</strong></li>` : "",
    modeLabel ? `<li>Hình thức: <strong>${escapeHtml(modeLabel)}</strong></li>` : "",
    location ? `<li>Địa điểm / đường dẫn: ${escapeHtml(location)}</li>` : ""
  ].join("");

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức đã xếp lịch cho anh/chị phỏng vấn <strong>${count} ứng viên mentee</strong> ${escapeHtml(season)}.</p>`,
      detailRows ? `<ul>${detailRows}</ul>` : "",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.interviewsUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Xem lịch phỏng vấn của tôi</a></p>`,
      "<p>Khi mở hồ sơ, anh/chị sẽ thấy điểm vòng hồ sơ ngay cạnh phiếu chấm phỏng vấn. Sau khi nộp điểm, nếu muốn nhận bạn này làm mentee, anh/chị bấm <strong>“Chọn làm mentee của tôi”</strong> ngay trên màn hình đó.</p>",
      "<p>Nếu lịch chưa phù hợp, anh/chị vui lòng trả lời email này để ban tổ chức sắp xếp lại.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** The appointment itself, sent to the candidate being interviewed. */
export function buildInterviewInviteEmail(input: {
  candidateName: string;
  seasonLabel: string;
  timeLabel: string;
  modeLabel?: string | null;
  location?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.candidateName, "bạn");
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const time = safeDisplayName(input.timeLabel, "");
  const modeLabel = input.modeLabel ? safeDisplayName(input.modeLabel) : null;
  const location = input.location ? safeDisplayName(input.location, "") : null;

  const subject = `[VAM Mentoring] Lịch phỏng vấn mentee ${season}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Chúc mừng bạn đã vào vòng phỏng vấn chương trình mentoring ${season}.`,
    "",
    "Thông tin buổi phỏng vấn:"
  ];
  if (time) lines.push(`- Thời gian: ${time}`);
  if (modeLabel) lines.push(`- Hình thức: ${modeLabel}`);
  if (location) lines.push(`- Địa điểm / đường dẫn: ${location}`);
  lines.push(
    "",
    "Bạn vui lòng có mặt trước 5 phút. Buổi phỏng vấn kéo dài khoảng 20–30 phút, xoay quanh mục tiêu và mong đợi của bạn với chương trình.",
    "",
    "Nếu thời gian trên không phù hợp, bạn vui lòng trả lời email này sớm nhất có thể để ban tổ chức sắp xếp lại.",
    "",
    "Hẹn gặp bạn.",
    "",
    SIGNATURE_TEXT
  );

  const detailRows = [
    time ? `<li>Thời gian: <strong>${escapeHtml(time)}</strong></li>` : "",
    modeLabel ? `<li>Hình thức: <strong>${escapeHtml(modeLabel)}</strong></li>` : "",
    location ? `<li>Địa điểm / đường dẫn: ${escapeHtml(location)}</li>` : ""
  ].join("");

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Chúc mừng bạn đã vào vòng phỏng vấn chương trình mentoring <strong>${escapeHtml(season)}</strong>.</p>`,
      detailRows ? `<p>Thông tin buổi phỏng vấn:</p><ul>${detailRows}</ul>` : "",
      "<p>Bạn vui lòng có mặt trước 5 phút. Buổi phỏng vấn kéo dài khoảng 20–30 phút, xoay quanh mục tiêu và mong đợi của bạn với chương trình.</p>",
      "<p>Nếu thời gian trên không phù hợp, bạn vui lòng trả lời email này sớm nhất có thể để ban tổ chức sắp xếp lại.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Turn the plain text of an approved template into the HTML half of the email.
 *
 * The text was typed by an organiser, so it is escaped first and only then
 * given paragraphs, line breaks and links — the same rule as the public
 * document pages. Only http(s) links are made clickable, and only the ones the
 * template itself contains.
 */
export function textToHtmlEmail(text: string): string {
  const escaped = escapeHtml(String(text ?? "").replace(/\r\n/g, "\n").trim());
  if (!escaped) return "";

  const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    // Trailing punctuation belongs to the sentence, not to the address.
    const trimmed = url.replace(/[.,;:)\]]+$/, "");
    const tail = url.slice(trimmed.length);
    return `<a href="${trimmed}" style="color:#16834c">${trimmed}</a>${tail}`;
  });

  const paragraphs = linked
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.replace(/\n/g, "<br />")}</p>`);

  return wrapHtml(paragraphs.join(""));
}

/**
 * The twice-monthly nudge to collect what the group has posted.
 *
 * Internal mail, to the organisers, written here rather than in the approval
 * queue: a reminder that only works after somebody approves a template is a
 * reminder that will not go out the first time it matters.
 */
export function buildRecapPeriodReminderEmail(input: {
  recipientName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  importUrl: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.recipientName);
  const period = safeDisplayName(input.periodLabel, "kỳ này");
  const range = `${input.periodStart} → ${input.periodEnd}`;

  const subject = `[VAM OS] Đến kỳ thu recap từ group Facebook (${period})`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Hôm nay là mốc thu recap ${period} (${range}).`,
    "",
    "Các bước:",
    "1. Mở group Facebook của chương trình, chọn xem bài theo thứ tự mới nhất.",
    "2. Bấm biểu tượng VAM Recap Collector trên thanh Chrome, chọn kỳ, bấm “Quét bài trong kỳ”.",
    "3. Bấm “Gửi vào VAM OS”, rồi vào màn hình dưới đây để duyệt:",
    input.importUrl,
    "",
    "Quét trùng ngày không sao cả: bài nào đã thu rồi thì hệ thống tự bỏ qua,",
    "nên nếu lỡ kỳ trước thì cứ quét rộng ra để lấy lại phần đã sót.",
    "",
    "Trân trọng,",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Hôm nay là mốc thu recap <strong>${escapeHtml(period)}</strong> (${escapeHtml(range)}).</p>`,
      "<ol>",
      "<li>Mở group Facebook của chương trình, chọn xem bài theo thứ tự mới nhất.</li>",
      "<li>Bấm biểu tượng <strong>VAM Recap Collector</strong> trên thanh Chrome, chọn kỳ, bấm “Quét bài trong kỳ”.</li>",
      "<li>Bấm “Gửi vào VAM OS”, rồi duyệt các bài đã thu.</li>",
      "</ol>",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.importUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Mở màn hình duyệt recap</a></p>`,
      "<p>Quét trùng ngày không sao cả: bài nào đã thu rồi thì hệ thống tự bỏ qua, nên nếu lỡ kỳ trước thì cứ quét rộng ra để lấy lại phần đã sót.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}
