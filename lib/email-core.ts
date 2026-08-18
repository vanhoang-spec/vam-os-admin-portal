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
  | "reviewer_invite";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type EmailGateEnv = {
  VAM_OS_EMAIL_ENABLED?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
  RESEND_API_KEY?: string;
  VAM_OS_EMAIL_FROM?: string;
};

export type EmailGateResult =
  | { canSend: true }
  | { canSend: false; reason: string };

/**
 * Decide whether this deployment may send mail at all.
 *
 * Two independent switches must both be on, so neither a stray env var nor a
 * preview deployment can mail real mentors:
 *   1. VAM_OS_EMAIL_ENABLED === "true"  (explicit opt-in, same convention as
 *      the season-config feature flags)
 *   2. the runtime is production        (VERCEL_ENV === "production", or a
 *      local NODE_ENV === "production" build when VERCEL_ENV is absent)
 * Configuration (API key + From address) must also be present.
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

  if (!env.RESEND_API_KEY?.trim()) {
    return { canSend: false, reason: "RESEND_API_KEY chưa cấu hình" };
  }
  if (!env.VAM_OS_EMAIL_FROM?.trim()) {
    return { canSend: false, reason: "VAM_OS_EMAIL_FROM chưa cấu hình" };
  }

  return { canSend: true };
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
