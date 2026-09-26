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
  // Thư báo một buổi đã đổi giờ, gửi cho những người đang giữ vé của buổi đó.
  | "event_schedule_change"
  // The four post-matching sends (migration 069). Their bodies come from an
  // approved template rather than from a builder in this file.
  | "mentee_selected"
  | "mentee_mentor_intro"
  | "mentor_mentee_package"
  | "kickoff_invite"
  // Internal, to the organisers: time to collect the group posts (migration 070).
  // Server-authored like the two above it, not a template anybody has to approve.
  | "recap_period_reminder"
  // The letter that gives a mentor or a mentee their account
  // (supabase/migrations/20260911140000_participant_account_invites.sql).
  | "participant_invite"
  // Thư mời một người vào ban tổ chức, gửi khi /admin/users tạo tài khoản
  // (supabase/migrations/20260913100000_outbound_emails_staff_invite.sql).
  //
  // Cố ý KHÔNG dùng lại 'reviewer_invite': `lib/enable-reviewer.ts` chống gửi
  // trùng bằng cách tra thư loại đó đã gửi cho địa chỉ này trong 60 phút gần
  // nhất, nên mời ai vào ban tổ chức sẽ chặn im lặng thư mời reviewer của chính
  // họ trong một tiếng.
  | "staff_invite"
  // Cross-mentoring (migration 072). The first carries a token a mentor answers
  // through; the other three simply tell somebody what was decided.
  | "cross_invite"
  | "cross_selected"
  | "cross_not_selected"
  | "cross_scheduled"
  // ── main-only. Giữ giá trị này khi merge stack. ────────────────────────────
  // Thư báo ứng viên đã qua vòng hồ sơ và được mời vào vòng phỏng vấn — KHÁC
  // với `interview_scheduled`, vốn báo một buổi đã có giờ. Trên main chưa có
  // chỗ nào lưu giờ phỏng vấn, nên hai thời điểm này là hai lá thư khác nhau.
  | "interview_round_invite"
  // ── main-only. Giữ giá trị này khi merge stack. ────────────────────────────
  // Thư thông báo do Core Team tự soạn trên /operations/mail. Khác mọi giá trị
  // trên ở một điểm: thân thư KHÔNG do builder trong file này dựng, mà đến từ
  // một mẫu thư đã được duyệt. Xem lib/email-templates-core.ts.
  | "general_announcement"
  // Thư xác nhận đăng ký sự kiện, mang theo đường dẫn vé cá nhân và mã QR.
  | "event_registration_confirmation"
  // Thư nhắc lịch một buổi, do ban tổ chức bấm "Gửi remind" trên trang sự kiện
  // (supabase/migrations/20260914090000_event_reminders.sql).
  | "event_reminder"
  // Thư khảo sát sau sự kiện, gửi cho người đã check in. Nộp phiếu chính là thao
  // tác check out (supabase/migrations/20260919043000_event_survey_checkout.sql).
  | "event_survey"
  // Thư mời mentor mới tự đặt lịch phỏng vấn qua link riêng, và các thư nhắc
  // 3-6-9 ngày của nó (supabase/migrations/20260922100000_interview_slot_booking.sql).
  // KHÁC 'interview_round_invite': thư này mang link chọn giờ; thư kia chỉ báo
  // đã qua vòng hồ sơ. Và KHÁC 'interview_scheduled': lịch chưa chốt.
  | "interview_slot_invite"
  // Thư báo một buổi phỏng vấn đã bị huỷ (mentor tự huỷ khi còn >24h, hoặc ban
  // tổ chức huỷ), gửi cho cả interviewer lẫn mentor.
  | "interview_slot_cancelled"
  // Vòng phỏng vấn MENTEE (supabase/migrations/20260926100000_giai_doan_1_pv_mentee.sql).
  // KHÁC 'interview_round_invite': thư này mang link chọn ca; thư kia không có
  // link nào, và từ giai đoạn 1 mentee không còn nhận thư kia nữa.
  | "mentee_session_invite"
  // Xác nhận ca đã đặt — gửi cả khi đặt lần đầu lẫn khi đổi ca.
  | "mentee_session_confirmed";

/**
 * Một tệp đi kèm thư.
 *
 * `contentBase64` chứ không phải Buffer: cả hai nhà cung cấp đều nhận base64
 * qua JSON, và giữ nguyên dạng đó tránh một vòng chuyển đổi ở mỗi transport.
 */
export type EmailAttachment = {
  filename: string;
  contentBase64: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Tệp đính kèm.
   *
   * Dùng cho tấm vé: ảnh QR đi kèm thư thì người nhận LƯU được vào máy, và ở
   * cửa sự kiện họ mở ảnh trong thư viện thay vì phải có mạng để mở trang vé.
   * Ảnh nhúng trong thân thư không làm được điều đó — nhiều hộp thư chặn ảnh
   * cho tới khi người đọc bấm "hiện ảnh", và không lưu riêng ra được.
   */
  attachments?: EmailAttachment[];
  /**
   * Địa chỉ nhận bản sao (CC).
   *
   * Dùng cho thư nhắc đặt lịch phỏng vấn lần thứ ba: ban tổ chức được CC để
   * biết mentor nào im lặng suốt chín ngày. CC chứ không phải gửi hai thư
   * riêng, vì hai bên cần THẤY nhau trong cùng một lá — đó chính là tín hiệu
   * "ban tổ chức đã biết chuyện này".
   */
  cc?: string[];
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
 * "UEH Mentoring <no-reply@vam.vn>" — because that is what an operator copies
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

const SIGNATURE_TEXT = "Ban tổ chức UEH Mentoring\nVietnam Alumni Mentoring";
const SIGNATURE_HTML =
  '<p style="margin:24px 0 0;color:#4f6b60;font-size:13px;line-height:20px">Ban tổ chức UEH Mentoring<br />Vietnam Alumni Mentoring</p>';

/**
 * Câu nhắc đường dây hỗ trợ trong lúc bộ lịch còn đang hoàn thiện (23/09/2026).
 *
 * KHÁC hotline Zalo của ban tổ chức: số này là người trực kỹ thuật, dành cho
 * ứng viên gặp trục trặc trên trang đặt lịch. Là một HẰNG chứ không phải một
 * câu chép vào bốn lá thư, để hết đợt hoàn thiện thì xoá một chỗ là cả bốn lá
 * cùng sạch — chép tay thì sẽ sót lá thứ tư.
 */
const SUPPORT_NOTE_TEXT =
  "Do hệ thống trong quá trình hoàn thiện nên có thể có trục trặc, xin anh chị liên lạc số 0777885674 (Bảo Châu) nếu cần trợ giúp. Xin cảm ơn.";
const SUPPORT_NOTE_HTML = `<p style="color:#4f6b60;font-size:13px">${SUPPORT_NOTE_TEXT}</p>`;

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

  const subject = `[UEH Mentoring] Xác nhận đồng hành ${season}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Ban tổ chức UEH Mentoring đang chuẩn bị cho ${season} và rất mong tiếp tục đồng hành cùng anh/chị.`,
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
      `<p>Ban tổ chức UEH Mentoring đang chuẩn bị cho <strong>${escapeHtml(season)}</strong> và rất mong tiếp tục đồng hành cùng anh/chị.</p>`,
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
  /**
   * Link đặt lịch phỏng vấn riêng của đơn — chỉ đơn MENTOR mới có, trong đợt
   * phỏng vấn 1:1. Có link thì thư gộp luôn hai việc: "đã nhận đơn" và "chọn
   * giờ phỏng vấn ngay tại đây" — mentor vừa nộp xong khỏi phải chờ lá thư
   * mời thứ hai. Mentee truyền gì vào đây cũng bị bỏ qua.
   */
  bookingUrl?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.applicantName, input.role === "mentor" ? "anh/chị" : "bạn");
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const roleLabel = input.role === "mentor" ? "mentor" : "mentee";
  const you = input.role === "mentor" ? "anh/chị" : "bạn";
  const bookingUrl = input.role === "mentor" ? (input.bookingUrl ?? null) : null;

  const subject = `[UEH Mentoring] Đã nhận đơn đăng ký ${roleLabel} — ${season}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Ban tổ chức UEH Mentoring đã nhận được đơn đăng ký ${roleLabel} của ${you} cho ${season}.`,
    ""
  ];
  if (bookingUrl) {
    lines.push(
      "Các bước tiếp theo:",
      "1. Ban tổ chức rà soát hồ sơ",
      `2. ${you === "anh/chị" ? "Anh/chị" : "Bạn"} chọn giờ trao đổi 1:1 với core team ngay tại đường dẫn riêng dưới đây`,
      "3. Kết quả và thông tin ghép cặp sẽ được thông báo sau buổi trao đổi",
      "",
      `Đặt lịch trao đổi của ${you} (đường dẫn riêng, vui lòng không chuyển tiếp):`,
      bookingUrl,
      "",
      SUPPORT_NOTE_TEXT,
      ""
    );
  } else {
    lines.push(
      "Các bước tiếp theo:",
      "1. Ban tổ chức rà soát và chấm hồ sơ",
      "2. Nếu hồ sơ phù hợp, ban tổ chức sẽ mời phỏng vấn qua email",
      "3. Kết quả và thông tin ghép cặp sẽ được thông báo sau vòng phỏng vấn",
      ""
    );
  }
  lines.push(
    `Đây là email xác nhận tự động, ${you} không cần trả lời.`,
    `Nếu ${you} cần chỉnh sửa thông tin đã gửi, vui lòng trả lời email này để ban tổ chức hỗ trợ.`,
    "",
    `Cảm ơn ${you} đã quan tâm đến chương trình.`,
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức UEH Mentoring đã nhận được đơn đăng ký <strong>${escapeHtml(roleLabel)}</strong> của ${escapeHtml(you)} cho <strong>${escapeHtml(season)}</strong>.</p>`,
      "<p>Các bước tiếp theo:</p>",
      bookingUrl
        ? `<ol><li>Ban tổ chức rà soát hồ sơ</li><li>${escapeHtml(you === "anh/chị" ? "Anh/chị" : "Bạn")} chọn giờ trao đổi 1:1 với core team ngay tại đường dẫn riêng dưới đây</li><li>Kết quả và thông tin ghép cặp sẽ được thông báo sau buổi trao đổi</li></ol>`
        : "<ol><li>Ban tổ chức rà soát và chấm hồ sơ</li><li>Nếu hồ sơ phù hợp, ban tổ chức sẽ mời phỏng vấn qua email</li><li>Kết quả và thông tin ghép cặp sẽ được thông báo sau vòng phỏng vấn</li></ol>",
      bookingUrl
        ? `<p style="margin:20px 0"><a href="${escapeHtml(bookingUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Chọn giờ trao đổi</a></p><p style="color:#4f6b60;font-size:13px">Đường dẫn là riêng cho ${escapeHtml(you)}, vui lòng không chuyển tiếp. Nếu nút trên không bấm được, mở đường dẫn này: ${escapeHtml(bookingUrl)}</p>${SUPPORT_NOTE_HTML}`
        : "",
      `<p>Đây là email xác nhận tự động, ${escapeHtml(you)} không cần trả lời. Nếu cần chỉnh sửa thông tin đã gửi, vui lòng trả lời email này để ban tổ chức hỗ trợ.</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** Subject of the reviewer letter; separate so a failed send can still be logged under it. */
export function reviewerInviteSubject(seasonLabel: string): string {
  return `[UEH Mentoring] Tài khoản chấm hồ sơ ${safeDisplayName(seasonLabel, "mùa mới")}`;
}

/**
 * Letter for a mentor who agreed to score applications or interview this
 * season — or, with `linkType: "recovery"`, a fresh password link for an
 * account that has never been signed into.
 *
 * The link only sets a password; it does not sign anyone in. So the letter
 * spells the login out as a second step, the same shape as the participant
 * letter.
 */
export function buildReviewerInviteEmail(input: {
  mentorName: string;
  seasonLabel: string;
  linkUrl: string;
  linkType: "invite" | "recovery";
  loginUrl: string;
  loginEmail: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.mentorName);
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const loginEmail = normalizeEmailAddress(input.loginEmail) ?? safeDisplayName(input.loginEmail, "");
  const subject = reviewerInviteSubject(input.seasonLabel);

  const intro =
    input.linkType === "recovery"
      ? `Ban tổ chức gửi lại đường dẫn đặt mật khẩu cho tài khoản VAM OS mà anh/chị dùng để tham gia tuyển sinh ${season}. Đường dẫn trong các thư trước (nếu có) không còn dùng được.`
      : `Cảm ơn anh/chị đã nhận lời tham gia tuyển sinh ${season}. Ban tổ chức đã tạo tài khoản trên VAM OS cho anh/chị.`;
  const step2 = `Bước 2 — Đăng nhập tại ${input.loginUrl} bằng email ${loginEmail} và mật khẩu vừa đặt, rồi vào mục “Đánh giá” để xem các hồ sơ được phân công.`;
  const expiry =
    "Đường dẫn là riêng cho anh/chị, chỉ dùng được một lần và có hạn sử dụng — vui lòng không chuyển tiếp. Nếu đã hết hạn, vui lòng liên hệ ban tổ chức để nhận đường dẫn mới.";

  const lines = [
    `Kính gửi ${name},`,
    "",
    intro,
    "",
    "Bước 1 — Bấm vào đường dẫn dưới đây để đặt mật khẩu:",
    input.linkUrl,
    "",
    step2,
    "",
    expiry,
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>${escapeHtml(intro)}</p>`,
      "<p><strong>Bước 1</strong> — Bấm nút dưới đây để đặt mật khẩu:</p>",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.linkUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Đặt mật khẩu</a></p>`,
      `<p><strong>Bước 2</strong> — Đăng nhập tại <a href="${escapeHtml(input.loginUrl)}">${escapeHtml(input.loginUrl)}</a> bằng email <strong>${escapeHtml(loginEmail)}</strong> và mật khẩu vừa đặt, rồi vào mục <strong>Đánh giá</strong> để xem các hồ sơ được phân công.</p>`,
      `<p>${escapeHtml(expiry)}</p>`,
      `<p style="color:#4f6b60;font-size:13px">Nếu nút trên không hoạt động, anh/chị mở đường dẫn sau: ${escapeHtml(input.linkUrl)}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** Tiêu đề thư mời nhân sự; tách riêng để một lần gửi hỏng vẫn ghi sổ được đúng tiêu đề. */
export function staffInviteSubject(): string {
  return "[UEH Mentoring] Tài khoản VAM OS của anh/chị";
}

/**
 * Thư mời một người vào ban tổ chức.
 *
 * Tài khoản được kích hoạt ngay lúc tạo, nên thư chỉ có hai bước: đặt mật khẩu,
 * rồi đăng nhập. Đừng thêm lại câu "chờ ban tổ chức bật tài khoản" — bước đó đã
 * bỏ, và một lời dặn chờ đợi không có thật khiến người nhận ngồi chờ thay vì
 * đăng nhập.
 */
export function buildStaffInviteEmail(input: {
  fullName: string;
  roleLabel: string;
  linkUrl: string;
  linkType: "invite" | "recovery";
  loginUrl: string;
  loginEmail: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.fullName);
  const role = safeDisplayName(input.roleLabel, "thành viên ban tổ chức");
  const loginEmail = normalizeEmailAddress(input.loginEmail) ?? safeDisplayName(input.loginEmail, "");
  const subject = staffInviteSubject();

  const intro =
    input.linkType === "recovery"
      ? `Ban tổ chức gửi lại đường dẫn đặt mật khẩu cho tài khoản VAM OS của anh/chị. Đường dẫn trong các thư trước (nếu có) không còn dùng được.`
      : `Ban tổ chức UEH Mentoring đã tạo cho anh/chị một tài khoản trên VAM OS với vai trò ${role}.`;
  const step2 = `Bước 2 — Đăng nhập tại ${input.loginUrl} bằng email ${loginEmail} và mật khẩu vừa đặt.`;
  const expiry =
    "Đường dẫn là riêng cho anh/chị, chỉ dùng được một lần và có hạn sử dụng — vui lòng không chuyển tiếp. Nếu đã hết hạn, vui lòng liên hệ ban tổ chức để nhận đường dẫn mới.";

  const lines = [
    `Kính gửi ${name},`,
    "",
    intro,
    "",
    "Bước 1 — Bấm vào đường dẫn dưới đây để đặt mật khẩu:",
    input.linkUrl,
    "",
    step2,
    "",
    expiry,
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>${escapeHtml(intro)}</p>`,
      "<p><strong>Bước 1</strong> — Bấm nút dưới đây để đặt mật khẩu:</p>",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.linkUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Đặt mật khẩu</a></p>`,
      `<p><strong>Bước 2</strong> — Đăng nhập tại <a href="${escapeHtml(input.loginUrl)}">${escapeHtml(input.loginUrl)}</a> bằng email <strong>${escapeHtml(loginEmail)}</strong> và mật khẩu vừa đặt.</p>`,
      `<p>${escapeHtml(expiry)}</p>`,
      `<p style="color:#4f6b60;font-size:13px">Nếu nút trên không hoạt động, anh/chị mở đường dẫn sau: ${escapeHtml(input.linkUrl)}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Notice that a lot of applications is waiting for this reviewer.
 *
 * `dueLabel` is a date (DD/MM/YYYY) meaning the END of that day in Vietnam —
 * the reading `lib/review-due.ts` stores. The mail says "hết ngày": the old
 * "trước 20/09" reads as "before the 20th begins", so a careful reviewer
 * finishes a day early and a relaxed one is flagged late.
 */
export function buildReviewBatchAssignedEmail(input: {
  reviewerName: string;
  seasonLabel: string;
  assignmentCount: number;
  reviewsUrl: string;
  dueLabel?: string | null;
  /** `mentor` / `mentee` — what the applications in this lot applied for. */
  roleApplied?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.reviewerName);
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const count = Math.max(0, Math.floor(Number(input.assignmentCount) || 0));
  const due = input.dueLabel ? safeDisplayName(input.dueLabel) : null;
  // A lot holds one role only — the assign RPC refuses a mixed lot. When the
  // role is unknown say "hồ sơ" rather than guess: calling mentor applications
  // "hồ sơ mentee" is wrong to the very person holding them.
  const role = String(input.roleApplied ?? "").trim().toLowerCase();
  const unit = role === "mentor" || role === "mentee" ? `hồ sơ ${role}` : "hồ sơ";

  const subject = due
    ? `[UEH Mentoring] ${count} ${unit} chờ anh/chị chấm — ${season}, hạn ${due}`
    : `[UEH Mentoring] ${count} ${unit} chờ anh/chị chấm — ${season}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Ban tổ chức vừa phân công ${count} ${unit} ${season} cho anh/chị chấm.`,
    ""
  ];
  if (due) lines.push(`Hạn hoàn tất: hết ngày ${due} (giờ Việt Nam).`, "");
  lines.push(
    "Anh/chị đăng nhập VAM OS và vào mục “Đánh giá” để bắt đầu:",
    input.reviewsUrl,
    "",
    "Mỗi hồ sơ được chấm theo 5 tiêu chí (thang điểm 1–5) kèm một đề xuất.",
    "",
    "Nếu anh/chị cần hỗ trợ hoặc muốn điều chỉnh số lượng hồ sơ, vui lòng trả lời email này.",
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức vừa phân công <strong>${count} ${escapeHtml(unit)}</strong> ${escapeHtml(season)} cho anh/chị chấm.</p>`,
      due ? `<p>Hạn hoàn tất: <strong>hết ngày ${escapeHtml(due)}</strong> (giờ Việt Nam).</p>` : "",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.reviewsUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Mở danh sách hồ sơ</a></p>`,
      "<p>Mỗi hồ sơ được chấm theo 5 tiêu chí (thang điểm 1–5) kèm một đề xuất.</p>",
      "<p>Nếu anh/chị cần hỗ trợ hoặc muốn điều chỉnh số lượng hồ sơ, vui lòng trả lời email này.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Một mentor mới vừa đặt lịch phỏng vấn với interviewer này — thư xác nhận
 * gửi interviewer, và cũng chính là bản CC về hộp thư ban tổ chức.
 *
 * Viết lại 22/09/2026 cho bộ lịch tự đặt (trước đó hàm nhận "N ứng viên
 * mentee" và chưa từng có người gọi, vì hệ thống chưa có chỗ lưu giờ).
 */
export function buildInterviewScheduleEmail(input: {
  interviewerName: string;
  seasonLabel: string;
  slotLabel: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone?: string | null;
  /**
   * Mở THẲNG vào hồ sơ ứng viên của buổi hẹn này — `/reviews/<id của phiếu
   * phỏng vấn>` khi có, hoặc `/applications/<id>` cho bản CC ban tổ chức.
   * Không phải đường dẫn tới một trang danh sách: người phỏng vấn bấm một
   * cái là vào thẳng đúng người, không phải tự tìm giữa nhiều hồ sơ khác.
   */
  applicationLink: string;
  hotlineZalo: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.interviewerName);
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const slot = safeDisplayName(input.slotLabel, "");
  const candidate = safeDisplayName(input.candidateName, "ứng viên");
  const candidatePhone = input.candidatePhone ? safeDisplayName(input.candidatePhone, "") : null;

  const subject = `[UEH Mentoring] Lịch phỏng vấn mentor ${candidate} — ${slot}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Một ứng viên mentor ${season} vừa đặt lịch phỏng vấn online 1:1 với anh/chị theo giờ anh/chị đã đăng ký rảnh:`,
    "",
    `- Thời gian: ${slot}`,
    `- Ứng viên: ${candidate}`,
    `- Email: ${input.candidateEmail}`
  ];
  if (candidatePhone) lines.push(`- Số điện thoại: ${candidatePhone}`);
  lines.push(
    "",
    "Anh/chị chủ động liên hệ ứng viên trước buổi để thống nhất kênh gọi online (Google Meet/Zoom/Zalo).",
    "Anh/chị mở đường dẫn dưới đây để xem hồ sơ ứng viên; sau buổi phỏng vấn dùng đúng trang này để chấm điểm và ghi đề xuất:",
    input.applicationLink,
    "",
    `Nếu giờ này không còn phù hợp, anh/chị báo ban tổ chức qua Zalo ${input.hotlineZalo} hoặc trả lời email này để sắp xếp lại.`,
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const detailRows = [
    `<li>Thời gian: <strong>${escapeHtml(slot)}</strong></li>`,
    `<li>Ứng viên: <strong>${escapeHtml(candidate)}</strong></li>`,
    `<li>Email: ${escapeHtml(input.candidateEmail)}</li>`,
    candidatePhone ? `<li>Số điện thoại: ${escapeHtml(candidatePhone)}</li>` : ""
  ].join("");

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Một ứng viên mentor ${escapeHtml(season)} vừa đặt lịch phỏng vấn online 1:1 với anh/chị theo giờ anh/chị đã đăng ký rảnh:</p>`,
      `<ul>${detailRows}</ul>`,
      "<p>Anh/chị chủ động liên hệ ứng viên trước buổi để thống nhất kênh gọi online (Google Meet/Zoom/Zalo).</p>",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.applicationLink)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Xem hồ sơ ứng viên & chấm điểm</a></p>`,
      `<p>Nếu giờ này không còn phù hợp, anh/chị báo ban tổ chức qua Zalo <strong>${escapeHtml(input.hotlineZalo)}</strong> hoặc trả lời email này để sắp xếp lại.</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Thư xác nhận buổi hẹn, gửi cho chính mentor vừa đặt lịch.
 *
 * Viết lại 22/09/2026 cho bộ lịch tự đặt: mang đủ thông tin liên hệ của
 * interviewer và đường dẫn quản lý lịch riêng (tự huỷ được khi còn hơn 24
 * giờ; sát giờ hơn thì hotline).
 */
export function buildInterviewInviteEmail(input: {
  candidateName: string;
  seasonLabel: string;
  slotLabel: string;
  interviewerName: string;
  interviewerEmail: string;
  interviewerPhone?: string | null;
  manageUrl: string;
  hotlineZalo: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.candidateName, "anh/chị");
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const slot = safeDisplayName(input.slotLabel, "");
  const interviewer = safeDisplayName(input.interviewerName, "người của core team");
  const interviewerPhone = input.interviewerPhone ? safeDisplayName(input.interviewerPhone, "") : null;

  const subject = `[UEH Mentoring] Xác nhận lịch trao đổi với core team — ${slot}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Anh/chị đã đặt thành công buổi trao đổi 1:1 với core team cho đơn đăng ký mentor ${season}:`,
    "",
    `- Thời gian: ${slot}`,
    `- Người trao đổi: ${interviewer}`,
    `- Email: ${input.interviewerEmail}`
  ];
  if (interviewerPhone) lines.push(`- Số điện thoại: ${interviewerPhone}`);
  lines.push(
    "",
    "Buổi trao đổi diễn ra online, kéo dài khoảng 30–60 phút. Người trao đổi sẽ liên hệ anh/chị để thống nhất kênh gọi (Google Meet/Zoom/Zalo) — anh/chị vui lòng để ý email và điện thoại.",
    "",
    "Cần đổi lịch? Khi còn NHIỀU HƠN 24 giờ trước buổi hẹn, anh/chị tự huỷ và chọn giờ khác tại đường dẫn riêng của mình:",
    input.manageUrl,
    `Sát giờ hơn, anh/chị liên hệ ban tổ chức qua Zalo ${input.hotlineZalo}.`,
    "",
    SUPPORT_NOTE_TEXT,
    "",
    "Hẹn gặp anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const detailRows = [
    `<li>Thời gian: <strong>${escapeHtml(slot)}</strong></li>`,
    `<li>Người trao đổi: <strong>${escapeHtml(interviewer)}</strong></li>`,
    `<li>Email: ${escapeHtml(input.interviewerEmail)}</li>`,
    interviewerPhone ? `<li>Số điện thoại: ${escapeHtml(interviewerPhone)}</li>` : ""
  ].join("");

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Anh/chị đã đặt thành công buổi trao đổi 1:1 với core team cho đơn đăng ký mentor <strong>${escapeHtml(season)}</strong>:</p>`,
      `<ul>${detailRows}</ul>`,
      "<p>Buổi trao đổi diễn ra online, kéo dài khoảng 30–60 phút. Người trao đổi sẽ liên hệ anh/chị để thống nhất kênh gọi (Google Meet/Zoom/Zalo) — anh/chị vui lòng để ý email và điện thoại.</p>",
      `<p>Cần đổi lịch? Khi còn <strong>nhiều hơn 24 giờ</strong> trước buổi hẹn, anh/chị tự huỷ và chọn giờ khác tại <a href="${escapeHtml(input.manageUrl)}">đường dẫn riêng của mình</a>. Sát giờ hơn, anh/chị liên hệ ban tổ chức qua Zalo <strong>${escapeHtml(input.hotlineZalo)}</strong>.</p>`,
      `<p style="color:#4f6b60;font-size:13px">Nếu đường dẫn trên không mở được: ${escapeHtml(input.manageUrl)}</p>`,
      SUPPORT_NOTE_HTML
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Thư mời mentor mới tự chọn giờ phỏng vấn — và các thư nhắc của nó.
 *
 * `reminderNumber` 0 là thư mời đầu; 1..3 là ba lượt nhắc cách nhau 3 ngày.
 * Nội dung nhắc nói thẳng đây là lần thứ mấy, để người nhận hiểu chuỗi thư
 * không phải máy gửi trùng.
 */
export function buildInterviewSlotInviteEmail(input: {
  candidateName: string;
  seasonLabel: string;
  bookingUrl: string;
  reminderNumber: number;
  windowEndLabel: string;
  hotlineZalo: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.candidateName, "anh/chị");
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const reminder = Math.max(0, Math.floor(Number(input.reminderNumber) || 0));
  const deadline = safeDisplayName(input.windowEndLabel, "");

  const subject =
    reminder > 0
      ? `[UEH Mentoring] Nhắc lần ${reminder}: chọn giờ trao đổi với core team — ${season}`
      : `[UEH Mentoring] Mời chọn giờ trao đổi với core team — ${season}`;

  const lines = [`Chào ${name},`, ""];
  if (reminder > 0) {
    lines.push(
      `Ban tổ chức nhắc lần ${reminder}: anh/chị chưa chọn giờ trao đổi với core team cho đơn đăng ký mentor ${season}.`,
      ""
    );
  } else {
    lines.push(
      `Đơn đăng ký mentor ${season} của anh/chị đã sẵn sàng cho buổi trao đổi 1:1 với core team.`,
      ""
    );
  }
  lines.push(
    "Anh/chị mở đường dẫn riêng dưới đây, xem các khung giờ đang trống (07:00–22:00 hằng ngày, mỗi buổi 60 phút) và chọn giờ phù hợp. Lịch cập nhật liên tục — chỗ trống có thể được người khác giữ trước, nên anh/chị nên chọn sớm:",
    input.bookingUrl,
    "",
    `Đợt trao đổi kéo dài đến hết ngày ${deadline}.`,
    `Cần hỗ trợ, anh/chị liên hệ ban tổ chức qua Zalo ${input.hotlineZalo} hoặc trả lời email này.`,
    "",
    SUPPORT_NOTE_TEXT,
    "",
    "Trân trọng,",
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      reminder > 0
        ? `<p>Ban tổ chức nhắc lần <strong>${reminder}</strong>: anh/chị chưa chọn giờ trao đổi với core team cho đơn đăng ký mentor <strong>${escapeHtml(season)}</strong>.</p>`
        : `<p>Đơn đăng ký mentor <strong>${escapeHtml(season)}</strong> của anh/chị đã sẵn sàng cho buổi trao đổi 1:1 với core team.</p>`,
      "<p>Anh/chị mở đường dẫn riêng dưới đây, xem các khung giờ đang trống (07:00–22:00 hằng ngày, mỗi buổi 60 phút) và chọn giờ phù hợp. Lịch cập nhật liên tục — chỗ trống có thể được người khác giữ trước, nên anh/chị nên chọn sớm.</p>",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.bookingUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Chọn giờ trao đổi</a></p>`,
      `<p>Đợt trao đổi kéo dài đến hết ngày <strong>${escapeHtml(deadline)}</strong>.</p>`,
      `<p>Cần hỗ trợ, anh/chị liên hệ ban tổ chức qua Zalo <strong>${escapeHtml(input.hotlineZalo)}</strong> hoặc trả lời email này.</p>`,
      `<p style="color:#4f6b60;font-size:13px">Đường dẫn là riêng cho anh/chị, vui lòng không chuyển tiếp. Nếu nút trên không bấm được, mở đường dẫn này: ${escapeHtml(input.bookingUrl)}</p>`,
      SUPPORT_NOTE_HTML
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Thư báo một buổi phỏng vấn đã bị huỷ — cùng một hàm dựng cho cả hai người
 * nhận, vì hai lá thư phải kể CÙNG một câu chuyện (ai huỷ, buổi nào); chỉ
 * xưng hô và câu hành-động-tiếp-theo là khác.
 */
export function buildInterviewSlotCancelledEmail(input: {
  audience: "candidate" | "interviewer";
  recipientName: string;
  otherPartyName: string;
  slotLabel: string;
  cancelledByLabel: string;
  /** Link đặt lại — chỉ bản gửi mentor mới có. */
  rebookUrl?: string | null;
  hotlineZalo: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.recipientName, "anh/chị");
  const other = safeDisplayName(input.otherPartyName, input.audience === "candidate" ? "người của core team" : "ứng viên");
  // Bản gửi ứng viên nói "trao đổi với core team"; bản gửi người phỏng vấn giữ
  // chữ nội bộ "phỏng vấn" — nói "trao đổi với core team" với chính core team
  // thì thành ra vòng vo.
  const meeting = input.audience === "candidate" ? "trao đổi với core team" : "phỏng vấn";
  const meetingShort = input.audience === "candidate" ? "trao đổi" : "phỏng vấn";
  const slot = safeDisplayName(input.slotLabel, "");
  const by = safeDisplayName(input.cancelledByLabel, "");
  const rebookUrl = input.audience === "candidate" ? (input.rebookUrl ?? null) : null;

  const subject = `[UEH Mentoring] Đã huỷ lịch ${meeting} — ${slot}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Buổi ${meetingShort} ${slot} ${input.audience === "candidate" ? `với ${other}` : `với ứng viên ${other}`} đã được huỷ (${by}).`,
    ""
  ];
  if (rebookUrl) {
    lines.push("Anh/chị chọn lại giờ khác tại đường dẫn riêng của mình:", rebookUrl, "");
  } else if (input.audience === "interviewer") {
    lines.push("Khung giờ này đã mở lại cho ứng viên khác đặt; anh/chị không cần làm gì thêm.", "");
  }
  lines.push(`Cần hỗ trợ, liên hệ ban tổ chức qua Zalo ${input.hotlineZalo} hoặc trả lời email này.`, "");
  if (input.audience === "candidate") lines.push(SUPPORT_NOTE_TEXT, "");
  lines.push(SIGNATURE_TEXT);

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Buổi ${meetingShort} <strong>${escapeHtml(slot)}</strong> ${
        input.audience === "candidate"
          ? `với <strong>${escapeHtml(other)}</strong>`
          : `với ứng viên <strong>${escapeHtml(other)}</strong>`
      } đã được huỷ (${escapeHtml(by)}).</p>`,
      rebookUrl
        ? `<p style="margin:20px 0"><a href="${escapeHtml(rebookUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Chọn lại giờ trao đổi</a></p><p style="color:#4f6b60;font-size:13px">Nếu nút trên không bấm được, mở đường dẫn này: ${escapeHtml(rebookUrl)}</p>`
        : input.audience === "interviewer"
          ? "<p>Khung giờ này đã mở lại cho ứng viên khác đặt; anh/chị không cần làm gì thêm.</p>"
          : "",
      `<p>Cần hỗ trợ, liên hệ ban tổ chức qua Zalo <strong>${escapeHtml(input.hotlineZalo)}</strong> hoặc trả lời email này.</p>`,
      input.audience === "candidate" ? SUPPORT_NOTE_HTML : ""
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

// ── main-only. Giữ hàm này khi merge stack. ──────────────────────────────────
/**
 * Thư báo ứng viên đã qua vòng hồ sơ và được mời vào vòng phỏng vấn.
 *
 * KHÔNG phải `buildInterviewInviteEmail` ở trên: hàm đó đòi giờ, hình thức và
 * địa điểm, tức là thư của một buổi ĐÃ có lịch. Trên main chưa có bảng hay cột
 * nào lưu giờ phỏng vấn — việc hẹn giờ diễn ra ngoài hệ thống — nên tại thời
 * điểm ứng viên chuyển sang `invited_to_interview` thì thứ duy nhất nói được
 * một cách trung thực là: bạn đã qua vòng hồ sơ, ban tổ chức sẽ liên hệ hẹn giờ.
 *
 * Thư cố ý KHÔNG mang đường dẫn nào, giống thư xác nhận đơn: ứng viên không có
 * màn hình nào để tự chọn lịch, nên một cái link chỉ tạo kỳ vọng sai.
 */
export function buildInterviewRoundInviteEmail(input: {
  candidateName: string;
  seasonLabel: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.candidateName, "bạn");
  const season = safeDisplayName(input.seasonLabel, "mùa mới");

  const subject = `[UEH Mentoring] Mời phỏng vấn — ${season}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Đơn đăng ký mentee của bạn đã qua vòng xét hồ sơ ${season}. Ban tổ chức trân trọng mời bạn tham gia vòng phỏng vấn.`,
    "",
    "Các bước tiếp theo:",
    "1. Ban tổ chức sẽ liên hệ với bạn qua email hoặc điện thoại để thống nhất thời gian phỏng vấn",
    "2. Buổi phỏng vấn kéo dài khoảng 20–30 phút, xoay quanh mục tiêu và mong đợi của bạn với chương trình",
    "3. Kết quả sẽ được thông báo sau khi vòng phỏng vấn kết thúc",
    "",
    "Bạn nên chuẩn bị:",
    "- Xem lại những gì đã viết trong đơn đăng ký",
    "- Sẵn sàng nói cụ thể về mục tiêu và khó khăn bạn đang gặp",
    "",
    "Bạn vui lòng theo dõi hộp thư (kể cả thư mục Spam) trong những ngày tới.",
    `Nếu số điện thoại hoặc email của bạn đã thay đổi, hoặc bạn không còn tham gia được, vui lòng trả lời email này để ban tổ chức nắm.`,
    "",
    "Chúc mừng bạn và hẹn gặp sớm.",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Đơn đăng ký mentee của bạn đã qua vòng xét hồ sơ <strong>${escapeHtml(season)}</strong>. Ban tổ chức trân trọng mời bạn tham gia vòng phỏng vấn.</p>`,
      "<p>Các bước tiếp theo:</p>",
      "<ol><li>Ban tổ chức sẽ liên hệ với bạn qua email hoặc điện thoại để thống nhất thời gian phỏng vấn</li><li>Buổi phỏng vấn kéo dài khoảng 20–30 phút, xoay quanh mục tiêu và mong đợi của bạn với chương trình</li><li>Kết quả sẽ được thông báo sau khi vòng phỏng vấn kết thúc</li></ol>",
      "<p>Bạn nên chuẩn bị: xem lại những gì đã viết trong đơn đăng ký, và sẵn sàng nói cụ thể về mục tiêu cũng như khó khăn bạn đang gặp.</p>",
      "<p>Bạn vui lòng theo dõi hộp thư (kể cả thư mục Spam) trong những ngày tới. Nếu số điện thoại hoặc email của bạn đã thay đổi, hoặc bạn không còn tham gia được, vui lòng trả lời email này để ban tổ chức nắm.</p>"
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

/** Subject of the account letter; separate so a failed send can still be logged under it. */
export function participantInviteSubject(linkType: "invite" | "recovery"): string {
  return linkType === "recovery"
    ? "[UEH Mentoring] Đường dẫn đặt mật khẩu VAM OS"
    : "[UEH Mentoring] Tài khoản VAM OS của anh/chị đã sẵn sàng";
}

/**
 * The letter that gives a mentor or a mentee an account — or, with
 * `linkType: "recovery"`, a fresh password link for an account they already
 * hold.
 *
 * It promises only what /ct shows today: the programmes and seasons the person
 * belongs to, and the events they registered for. An earlier draft promised a
 * matched pair, a code of conduct and a handbook, none of which the screen has —
 * the first thing a mentor would notice after signing in.
 *
 * The login address is spelled out as a second step because the link only sets
 * a password. It does not sign anyone in.
 */
export function buildParticipantInviteEmail(input: {
  recipientName: string;
  linkUrl: string;
  linkType: "invite" | "recovery";
  loginUrl: string;
  loginEmail: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.recipientName);
  const loginEmail = normalizeEmailAddress(input.loginEmail) ?? safeDisplayName(input.loginEmail, "");
  const subject = participantInviteSubject(input.linkType);

  const intro =
    input.linkType === "recovery"
      ? "Đây là đường dẫn mới để đặt mật khẩu cho tài khoản VAM OS của anh/chị. Đường dẫn trong các thư trước (nếu có) không còn dùng được."
      : "UEH Mentoring đã mở cho anh/chị một tài khoản trên VAM OS. Sau khi đăng nhập, anh/chị xem được các chương trình và mùa mình đang tham gia hoặc đã hoàn thành, cùng các sự kiện đã đăng ký.";
  const expiry =
    "Đường dẫn chỉ dùng được một lần và có hạn sử dụng. Nếu đã hết hạn, vui lòng liên hệ ban tổ chức để nhận đường dẫn mới.";

  const lines = [
    `Kính gửi ${name},`,
    "",
    intro,
    "",
    "Bước 1 — Bấm vào đường dẫn dưới đây để đặt mật khẩu:",
    input.linkUrl,
    "",
    `Bước 2 — Đăng nhập tại ${input.loginUrl} bằng email ${loginEmail} và mật khẩu vừa đặt.`,
    "",
    expiry,
    "",
    "Trân trọng,",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>${escapeHtml(intro)}</p>`,
      "<p><strong>Bước 1</strong> — Bấm nút dưới đây để đặt mật khẩu:</p>",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.linkUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Đặt mật khẩu</a></p>`,
      `<p><strong>Bước 2</strong> — Đăng nhập tại <a href="${escapeHtml(input.loginUrl)}">${escapeHtml(input.loginUrl)}</a> bằng email <strong>${escapeHtml(loginEmail)}</strong> và mật khẩu vừa đặt.</p>`,
      `<p>${escapeHtml(expiry)}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Ask a mentor whether they can take a cross-mentoring session.
 *
 * Carries the field and the topic and nothing about who asked. A mentee wanting
 * to talk about their career is theirs to disclose in the room, not ours to put
 * in a letter to twenty mentors.
 */
export function buildCrossInviteEmail(input: {
  mentorName: string;
  fieldLabel: string;
  topic?: string | null;
  seasonLabel: string;
  respondUrl: string;
  deadlineLabel?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.mentorName);
  const field = safeDisplayName(input.fieldLabel, "một lĩnh vực");
  const season = safeDisplayName(input.seasonLabel, "mùa này");
  const topic = input.topic ? safeDisplayName(input.topic, "") : "";
  const deadline = input.deadlineLabel ? safeDisplayName(input.deadlineLabel) : null;

  const subject = `[UEH Mentoring] Mời anh/chị nhận một buổi cross-mentoring — ${field}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Có một bạn mentee ${season} mong được nghe chia sẻ về ${field}.`,
    ""
  ];
  if (topic) lines.push(`Bạn ấy quan tâm tới: ${topic}`, "");
  lines.push(
    "Nếu anh/chị nhận lời, vui lòng bấm vào đường dẫn dưới đây. Ở đó anh/chị có thể",
    "điền vài khung giờ rảnh — không bắt buộc, nhưng có thì ban tổ chức xếp lịch dễ hơn:",
    input.respondUrl,
    ""
  );
  if (deadline) lines.push(`Ban tổ chức mong nhận phản hồi trước ${deadline}.`, "");
  lines.push(
    "Có thể nhiều mentor cùng nhận lời cho buổi này, nên ban tổ chức sẽ chọn một",
    "người và báo lại anh/chị sau. Nhận lời mà chưa được xếp lần này thì lần sau",
    "anh/chị vẫn nằm trong danh sách mời.",
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Có một bạn mentee ${escapeHtml(season)} mong được nghe chia sẻ về <strong>${escapeHtml(field)}</strong>.</p>`,
      topic ? `<p>Bạn ấy quan tâm tới: ${escapeHtml(topic)}</p>` : "",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.respondUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Trả lời lời mời</a></p>`,
      "<p>Ở đó anh/chị có thể điền vài khung giờ rảnh — không bắt buộc, nhưng có thì ban tổ chức xếp lịch dễ hơn.</p>",
      deadline ? `<p>Ban tổ chức mong nhận phản hồi trước <strong>${escapeHtml(deadline)}</strong>.</p>` : "",
      "<p>Có thể nhiều mentor cùng nhận lời cho buổi này, nên ban tổ chức sẽ chọn một người và báo lại anh/chị sau. Nhận lời mà chưa được xếp lần này thì lần sau anh/chị vẫn nằm trong danh sách mời.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/** Tell a mentor the session is theirs. */
export function buildCrossSelectedEmail(input: {
  mentorName: string;
  fieldLabel: string;
  seasonLabel: string;
  timeLabel?: string | null;
  location?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.mentorName);
  const field = safeDisplayName(input.fieldLabel, "một lĩnh vực");
  const time = input.timeLabel ? safeDisplayName(input.timeLabel) : null;
  const place = input.location ? safeDisplayName(input.location, "") : null;

  const subject = `[UEH Mentoring] Anh/chị nhận buổi cross-mentoring — ${field}`;

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Cảm ơn anh/chị đã nhận lời. Ban tổ chức xin mời anh/chị phụ trách buổi cross-mentoring về ${field}.`,
    ""
  ];
  if (time) lines.push(`Thời gian dự kiến: ${time}`);
  if (place) lines.push(`Địa điểm: ${place}`);
  if (time || place) lines.push("");
  if (!time && !place) {
    lines.push("Thời gian và địa điểm ban tổ chức sẽ báo lại anh/chị trong ít ngày tới.", "");
  }
  lines.push(
    "Ban tổ chức sẽ mở đăng ký cho các bạn mentee và gửi anh/chị danh sách trước buổi gặp.",
    "",
    "Trân trọng cảm ơn anh/chị.",
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Cảm ơn anh/chị đã nhận lời. Ban tổ chức xin mời anh/chị phụ trách buổi cross-mentoring về <strong>${escapeHtml(field)}</strong>.</p>`,
      time ? `<p>Thời gian dự kiến: <strong>${escapeHtml(time)}</strong></p>` : "",
      place ? `<p>Địa điểm: <strong>${escapeHtml(place)}</strong></p>` : "",
      !time && !place
        ? "<p>Thời gian và địa điểm ban tổ chức sẽ báo lại anh/chị trong ít ngày tới.</p>"
        : "",
      "<p>Ban tổ chức sẽ mở đăng ký cho các bạn mentee và gửi anh/chị danh sách trước buổi gặp.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Tell a mentor the session went to somebody else.
 *
 * The hardest of the four to write, and the one most worth writing carefully: a
 * mentor who volunteered and was passed over has done nothing wrong, and the
 * letter should not read as though they had. It also says plainly that they
 * stay on the list, because the alternative reading — "we are done asking you"
 * — is the one that loses a mentor.
 */
export function buildCrossNotSelectedEmail(input: {
  mentorName: string;
  fieldLabel: string;
  seasonLabel: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.mentorName);
  const field = safeDisplayName(input.fieldLabel, "lĩnh vực này");

  const subject = "[UEH Mentoring] Buổi cross-mentoring lần này đã có người phụ trách";

  const lines = [
    `Kính gửi ${name},`,
    "",
    `Cảm ơn anh/chị đã nhận lời cho buổi cross-mentoring về ${field}.`,
    "",
    "Lần này ban tổ chức đã xếp được một mentor khác, chủ yếu vì lý do lịch và",
    "để chia đều cơ hội giữa các anh/chị mentor — không phải vì hồ sơ hay chuyên môn.",
    "",
    "Anh/chị vẫn nằm trong danh sách mời cho những buổi tiếp theo cùng lĩnh vực.",
    "",
    "Trân trọng cảm ơn anh/chị đã sẵn lòng.",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Kính gửi <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Cảm ơn anh/chị đã nhận lời cho buổi cross-mentoring về <strong>${escapeHtml(field)}</strong>.</p>`,
      "<p>Lần này ban tổ chức đã xếp được một mentor khác, chủ yếu vì lý do lịch và để chia đều cơ hội giữa các anh/chị mentor — không phải vì hồ sơ hay chuyên môn.</p>",
      "<p>Anh/chị vẫn nằm trong danh sách mời cho những buổi tiếp theo cùng lĩnh vực.</p>",
      "<p>Trân trọng cảm ơn anh/chị đã sẵn lòng.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Tell the mentee their wish became a session.
 *
 * Without this letter a mentee submits a request and hears nothing until an
 * event appears out of nowhere.
 */
export function buildCrossScheduledEmail(input: {
  menteeName: string;
  fieldLabel: string;
  timeLabel?: string | null;
  location?: string | null;
  registerUrl?: string | null;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.menteeName, "bạn");
  const field = safeDisplayName(input.fieldLabel, "lĩnh vực bạn đề xuất");
  const time = input.timeLabel ? safeDisplayName(input.timeLabel) : null;
  const place = input.location ? safeDisplayName(input.location, "") : null;

  const subject = `[UEH Mentoring] Buổi cross-mentoring bạn đề xuất đã có lịch — ${field}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Đề xuất cross-mentoring của bạn về ${field} đã được ban tổ chức xếp lịch.`,
    ""
  ];
  if (time) lines.push(`Thời gian: ${time}`);
  if (place) lines.push(`Địa điểm: ${place}`);
  if (time || place) lines.push("");
  if (input.registerUrl) {
    lines.push("Bạn đăng ký tham dự tại đây:", input.registerUrl, "");
  }
  lines.push(
    "Buổi này mở cho các bạn mentee khác cùng tham dự, nên nhớ đăng ký sớm nhé.",
    "",
    "Hẹn gặp bạn,",
    "",
    SIGNATURE_TEXT
  );

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Đề xuất cross-mentoring của bạn về <strong>${escapeHtml(field)}</strong> đã được ban tổ chức xếp lịch.</p>`,
      time ? `<p>Thời gian: <strong>${escapeHtml(time)}</strong></p>` : "",
      place ? `<p>Địa điểm: <strong>${escapeHtml(place)}</strong></p>` : "",
      input.registerUrl
        ? `<p style="margin:20px 0"><a href="${escapeHtml(input.registerUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Đăng ký tham dự</a></p>`
        : "",
      "<p>Buổi này mở cho các bạn mentee khác cùng tham dự, nên nhớ đăng ký sớm nhé.</p>"
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Thư xác nhận đăng ký sự kiện, mang theo vé cá nhân.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐƯỜNG DẪN VÉ CHỨ KHÔNG PHẢI ẢNH QR ĐÍNH KÈM
 * ---------------------------------------------------------------------------
 * Ảnh nhúng trong thư bị nhiều hộp thư chặn cho tới khi người đọc bấm "hiện
 * ảnh", và một tấm vé không hiện ra là một người đứng ở cửa không có gì để
 * giơ. Đường dẫn thì luôn bấm được, mở ra trang vé với mã QR to bằng cả màn
 * hình, và mã đó vẫn còn nguyên ở đó nếu họ mở lại vào sáng hôm sự kiện.
 *
 * Mã dạng chữ được in ngay trong thư bên cạnh đường dẫn: khi mạng ở hội trường
 * không vào được, người ta vẫn đọc được mười ký tự cho người quét gõ tay.
 */
export function buildEventRegistrationConfirmationEmail(input: {
  recipientName: string;
  eventName: string;
  whenLabel: string;
  placeLabel?: string | null;
  mapUrl?: string | null;
  joinUrl?: string | null;
  /**
   * Đường dẫn vé. Null khi sự kiện KHÔNG dùng mã QR check-in: thư khi đó không
   * mang phần vé nào, mà nói rõ ban tổ chức điểm danh theo danh sách.
   */
  ticketUrl?: string | null;
  ticketCode?: string | null;
  /** Mã 4 ký tự gõ tay khi máy quét chịu thua. Null khi không cấp được. */
  shortCode?: string | null;
  /** Ảnh QR đính kèm, để người nhận LƯU được vào máy. */
  qrPngBase64?: string | null;
  pendingApproval?: boolean;
}): EmailMessage {
  const name = safeDisplayName(input.recipientName);
  const eventName = String(input.eventName ?? "").trim() || "sự kiện";
  const pending = Boolean(input.pendingApproval);
  const ticketUrl = String(input.ticketUrl ?? "").trim();
  const hasTicket = ticketUrl !== "";
  const noQrNote =
    "Sự kiện này không dùng mã QR check-in. Bạn không cần mang theo mã nào — ban tổ chức sẽ điểm danh theo danh sách đăng ký.";

  // "Vé tham dự" chỉ khi thật có vé. Tiêu đề hứa một tấm vé mà thân thư không có
  // là người nhận lục cả hộp thư đi tìm một thứ không tồn tại.
  const subject = pending
    ? `Đã nhận đăng ký ${eventName}`
    : hasTicket
      ? `Vé tham dự ${eventName}`
      : `Xác nhận đăng ký ${eventName}`;

  const lines = [
    `Chào ${name},`,
    "",
    pending
      ? `Ban tổ chức đã nhận đăng ký của bạn cho ${eventName}. Ban tổ chức sẽ xét duyệt và báo lại.`
      : `Bạn đã đăng ký thành công ${eventName}.`,
    "",
    `Thời gian: ${input.whenLabel}`
  ];

  if (input.placeLabel) lines.push(`Địa điểm: ${input.placeLabel}`);
  if (input.mapUrl) lines.push(`Xem trên bản đồ: ${input.mapUrl}`);
  if (input.joinUrl) lines.push(`Đường dẫn tham gia: ${input.joinUrl}`);

  if (hasTicket) {
    lines.push(
      "",
      "MÃ QR THAM DỰ",
      "Ảnh mã QR được đính kèm thư này. Vui lòng LƯU ẢNH VÀO MÁY ngay bây giờ và mở ra cho ban tổ chức quét khi tới sự kiện — như vậy bạn không cần mạng ở hội trường.",
      "",
      `Vé của bạn (mở được trên trình duyệt): ${ticketUrl}`
    );

    if (input.shortCode) {
      lines.push(
        "",
        `MÃ DỰ PHÒNG: ${input.shortCode}`,
        "Nếu máy quét không đọc được mã QR — màn hình vỡ, thiếu sáng, hết pin — chỉ cần đọc 4 ký tự này cho ban tổ chức là check-in được."
      );
    }
  } else {
    lines.push("", "ĐIỂM DANH", noQrNote);
  }

  const ticketHtml = hasTicket
    ? [
        `<p style="margin:20px 0 8px"><strong>Mã QR tham dự</strong></p>`,
        `<p style="margin:0 0 16px">Ảnh mã QR được <strong>đính kèm thư này</strong>. Vui lòng <strong>lưu ảnh vào máy</strong> ngay bây giờ và mở ra cho ban tổ chức quét khi tới sự kiện — như vậy bạn không cần mạng ở hội trường.</p>`,
        input.shortCode
          ? `<p style="margin:0 0 16px;padding:12px 16px;background:#fbf4ea;border-radius:6px">Mã dự phòng: <strong style="font-family:monospace;font-size:20px;letter-spacing:4px">${escapeHtml(input.shortCode)}</strong><br /><span style="color:#4f6b60;font-size:13px">Nếu máy quét không đọc được mã QR, chỉ cần đọc 4 ký tự này cho ban tổ chức.</span></p>`
          : "",
        `<p style="margin:16px 0"><a href="${escapeHtml(ticketUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Mở vé trên trình duyệt</a></p>`
      ]
    : [
        `<p style="margin:20px 0 8px"><strong>Điểm danh</strong></p>`,
        `<p style="margin:0 0 16px">${escapeHtml(noQrNote)}</p>`
      ];

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      pending
        ? `<p>Ban tổ chức đã nhận đăng ký của bạn cho <strong>${escapeHtml(eventName)}</strong>. Ban tổ chức sẽ xét duyệt và báo lại.</p>`
        : `<p>Bạn đã đăng ký thành công <strong>${escapeHtml(eventName)}</strong>.</p>`,
      `<p><strong>Thời gian:</strong> ${escapeHtml(input.whenLabel)}</p>`,
      input.placeLabel ? `<p><strong>Địa điểm:</strong> ${escapeHtml(input.placeLabel)}</p>` : "",
      input.mapUrl
        ? `<p><a href="${escapeHtml(input.mapUrl)}" style="color:#16834c">Xem trên bản đồ</a></p>`
        : "",
      input.joinUrl
        ? `<p><a href="${escapeHtml(input.joinUrl)}" style="color:#16834c">Đường dẫn tham gia trực tuyến</a></p>`
        : ""
    ]
      .concat(ticketHtml)
      .join("")
  );

  return {
    to: "",
    subject,
    text: lines.join("\n"),
    html,
    // Đính ảnh chứ không nhúng vào thân thư: nhiều hộp thư chặn ảnh cho tới khi
    // người đọc bấm "hiện ảnh", và ảnh nhúng thì không lưu riêng ra được. Người
    // nhận cần LƯU được tấm vé vào máy để mở ở cửa mà không cần mạng.
    //
    // Không có vé thì không đính gì, kể cả khi nơi gọi lỡ truyền ảnh vào: một ảnh
    // QR trong thư của sự kiện không dùng QR là một tấm vé không ai quét.
    attachments:
      hasTicket && input.qrPngBase64
        ? [
            {
              filename: `ve-${String(input.ticketCode ?? "").trim() || "tham-du"}.png`,
              contentBase64: input.qrPngBase64
            }
          ]
        : undefined
  };
}


/**
 * Thư báo một buổi đã đổi giờ.
 *
 * ---------------------------------------------------------------------------
 * BA ĐIỀU THƯ NÀY PHẢI NÓI, THEO ĐÚNG THỨ TỰ NGƯỜI ĐỌC CẦN
 * ---------------------------------------------------------------------------
 * 1. Giờ MỚI, ngay dòng đầu. Người mở thư trên điện thoại giữa giờ làm chỉ đọc
 *    hai dòng đầu rồi cất máy — nếu giờ mới nằm ở đoạn ba thì coi như không nói.
 * 2. Giờ CŨ, để họ đối chiếu với thứ đang ghi trong lịch của mình. Không có nó,
 *    người ta không biết mình có cần sửa lịch hay không.
 * 3. Vé cũ vẫn dùng được. Đây là câu hỏi đầu tiên họ sẽ nghĩ tới, và nếu thư
 *    không trả lời thì ban tổ chức sẽ phải trả lời từng người một.
 *
 * Không đính kèm lại mã QR: mã không đổi, và gửi lại một ảnh khác cho cùng một
 * tấm vé là cách chắc chắn để tới hôm sự kiện có người mở nhầm ảnh cũ.
 */
export function buildEventScheduleChangeEmail(input: {
  recipientName: string;
  eventName: string;
  /** Khung giờ mới, đã định dạng sẵn theo giờ Việt Nam. */
  whenLabel: string;
  /** Khung giờ cũ. Bỏ trống thì thư chỉ nói giờ mới. */
  previousWhenLabel?: string | null;
  placeLabel?: string | null;
  mapUrl?: string | null;
  joinUrl?: string | null;
  ticketUrl?: string | null;
  shortCode?: string | null;
}): EmailMessage {
  const name = safeDisplayName(input.recipientName);
  const eventName = String(input.eventName ?? "").trim() || "sự kiện";
  const previous = String(input.previousWhenLabel ?? "").trim();
  const ticketUrl = String(input.ticketUrl ?? "").trim();
  const shortCode = String(input.shortCode ?? "").trim();
  // Chỉ nói về vé khi người này THẬT có vé. Sự kiện không dùng QR thì câu "mã QR
  // đã gửi trước đây không đổi" nói về một thứ họ chưa từng nhận, và họ sẽ đi
  // lục hộp thư tìm nó.
  const hasTicket = ticketUrl !== "" || shortCode !== "";

  const subject = `Đổi lịch: ${eventName} — ${input.whenLabel}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Ban tổ chức xin báo: buổi ${eventName} mà bạn đã đăng ký ĐÃ ĐỔI THỜI GIAN.`,
    "",
    `THỜI GIAN MỚI: ${input.whenLabel}`
  ];

  if (previous) lines.push(`Thời gian cũ: ${previous}`);
  if (input.placeLabel) lines.push(`Địa điểm: ${input.placeLabel} (không đổi)`);
  if (input.mapUrl) lines.push(`Xem trên bản đồ: ${input.mapUrl}`);
  if (input.joinUrl) lines.push(`Đường dẫn tham gia: ${input.joinUrl}`);

  if (hasTicket) {
    lines.push(
      "",
      "VÉ CỦA BẠN VẪN DÙNG ĐƯỢC",
      "Mã QR đã gửi trước đây không đổi. Bạn không cần đăng ký lại — chỉ cần mở đúng ảnh QR đó ra cho ban tổ chức quét vào giờ mới."
    );
    if (shortCode) lines.push(`Mã dự phòng của bạn vẫn là: ${shortCode}`);
    if (ticketUrl) lines.push("", `Mở lại vé: ${ticketUrl}`);
  } else {
    lines.push(
      "",
      "ĐĂNG KÝ CỦA BẠN VẪN GIỮ NGUYÊN",
      "Bạn không cần đăng ký lại. Ban tổ chức sẽ điểm danh theo danh sách đăng ký vào giờ mới."
    );
  }

  lines.push(
    "",
    "Nếu giờ mới không phù hợp với bạn, vui lòng phản hồi lại thư này để ban tổ chức sắp xếp."
  );

  const ticketHtml = hasTicket
    ? [
        `<p style="margin:20px 0 8px"><strong>Vé của bạn vẫn dùng được</strong></p>`,
        `<p style="margin:0 0 12px">Mã QR đã gửi trước đây <strong>không đổi</strong>. Bạn không cần đăng ký lại — chỉ cần mở đúng ảnh QR đó ra cho ban tổ chức quét vào giờ mới.${
          shortCode
            ? ` Mã dự phòng của bạn vẫn là <strong style="font-family:monospace;letter-spacing:3px">${escapeHtml(shortCode)}</strong>.`
            : ""
        }</p>`,
        ticketUrl
          ? `<p style="margin:16px 0"><a href="${escapeHtml(ticketUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Mở lại vé</a></p>`
          : ""
      ]
    : [
        `<p style="margin:20px 0 8px"><strong>Đăng ký của bạn vẫn giữ nguyên</strong></p>`,
        `<p style="margin:0 0 12px">Bạn không cần đăng ký lại. Ban tổ chức sẽ điểm danh theo danh sách đăng ký vào giờ mới.</p>`
      ];

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức xin báo: buổi <strong>${escapeHtml(eventName)}</strong> mà bạn đã đăng ký <strong>đã đổi thời gian</strong>.</p>`,
      `<p style="margin:16px 0;padding:14px 18px;background:#e8f6ee;border-left:4px solid #16834c;border-radius:6px"><span style="color:#4f6b60;font-size:13px;text-transform:uppercase;letter-spacing:1px">Thời gian mới</span><br /><strong style="font-size:18px">${escapeHtml(input.whenLabel)}</strong></p>`,
      previous
        ? `<p style="color:#6b7c74">Thời gian cũ: <s>${escapeHtml(previous)}</s></p>`
        : "",
      input.placeLabel
        ? `<p><strong>Địa điểm:</strong> ${escapeHtml(input.placeLabel)} <span style="color:#6b7c74">(không đổi)</span></p>`
        : "",
      input.mapUrl
        ? `<p><a href="${escapeHtml(input.mapUrl)}" style="color:#16834c">Xem trên bản đồ</a></p>`
        : "",
      input.joinUrl
        ? `<p><a href="${escapeHtml(input.joinUrl)}" style="color:#16834c">Đường dẫn tham gia trực tuyến</a></p>`
        : ""
    ]
      .concat(ticketHtml)
      .concat([
        `<p style="color:#6b7c74;font-size:13px">Nếu giờ mới không phù hợp với bạn, vui lòng phản hồi lại thư này để ban tổ chức sắp xếp.</p>`
      ])
      .join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Thư nhắc lịch một buổi sự kiện, do ban tổ chức bấm "Gửi remind".
 *
 * ---------------------------------------------------------------------------
 * THƯ NÀY TỰ ĐỦ, VÌ NÓ LÀ LÁ NGƯỜI TA MỞ VÀO SÁNG HÔM SỰ KIỆN
 * ---------------------------------------------------------------------------
 * Người nhận có thể đang giữ một thư xác nhận từ hai tuần trước — trước khi đổi
 * phòng, trước khi có link họp. Nên lá này mang lại đủ: giờ, nơi, bản đồ, link
 * họp, và tấm vé. Mọi giá trị do nơi gọi đọc từ database ngay lúc gửi, không lấy
 * từ lúc bấm nút.
 *
 * Đính kèm lại ảnh QR, khác với thư đổi lịch: ảnh dựng từ đúng đường dẫn vé cũ
 * nên giống hệt ảnh đã gửi, và người lỡ xoá lá thư đầu cần một bản để lưu vào
 * máy trước khi tới cửa.
 */
export function buildEventReminderEmail(input: {
  recipientName: string;
  eventName: string;
  /** Khung giờ, đã định dạng sẵn theo giờ Việt Nam. */
  whenLabel: string;
  placeLabel?: string | null;
  mapUrl?: string | null;
  joinUrl?: string | null;
  /** Mô tả ban tổ chức viết cho sự kiện. Văn bản thuần, được escape. */
  description?: string | null;
  /** Sự kiện có dùng mã QR check-in không. */
  qrCheckin: boolean;
  ticketUrl?: string | null;
  ticketCode?: string | null;
  shortCode?: string | null;
  qrPngBase64?: string | null;
  pendingApproval?: boolean;
}): EmailMessage {
  const name = safeDisplayName(input.recipientName);
  const eventName = String(input.eventName ?? "").trim() || "sự kiện";
  const ticketUrl = String(input.ticketUrl ?? "").trim();
  const shortCode = String(input.shortCode ?? "").trim();
  const hasTicket = ticketUrl !== "";
  const pending = Boolean(input.pendingApproval);
  const rawDescription = String(input.description ?? "").trim();
  const description = rawDescription.length > 1500 ? `${rawDescription.slice(0, 1497)}...` : rawDescription;

  // Ba cách nói về điểm danh, và mỗi người chỉ nhận đúng một cách. Sự kiện dùng QR
  // mà người này chưa có vé thì KHÔNG được nói "sự kiện không dùng mã QR" — đó là
  // câu sai, và họ sẽ đứng ở cửa cãi với người quét.
  const noQrNote =
    "Sự kiện này không dùng mã QR check-in. Bạn không cần mang theo mã nào — ban tổ chức sẽ điểm danh theo danh sách đăng ký.";
  const missingTicketNote =
    "Tại quầy check-in, vui lòng báo họ tên và email bạn đã dùng để đăng ký — ban tổ chức sẽ điểm danh theo danh sách.";

  const subject = `Nhắc lịch: ${eventName} — ${input.whenLabel}`;

  const intro = `Ban tổ chức nhắc bạn lịch tham dự ${eventName}. Thông tin dưới đây là thông tin mới nhất tính tới lúc gửi thư này.`;
  const pendingNote = "Đăng ký của bạn đang chờ ban tổ chức xác nhận.";

  const lines = [`Chào ${name},`, "", intro];
  if (pending) lines.push("", pendingNote);
  lines.push("", `THỜI GIAN: ${input.whenLabel}`);
  if (input.placeLabel) lines.push(`Địa điểm: ${input.placeLabel}`);
  if (input.mapUrl) lines.push(`Xem trên bản đồ: ${input.mapUrl}`);
  if (input.joinUrl) lines.push(`Đường dẫn tham gia: ${input.joinUrl}`);
  if (description) lines.push("", "NỘI DUNG", description);

  if (hasTicket) {
    lines.push(
      "",
      "VÉ THAM DỰ",
      "Ảnh mã QR của bạn được đính kèm thư này. Vui lòng lưu ảnh vào máy và mở ra cho ban tổ chức quét khi tới sự kiện.",
      "",
      `Vé của bạn (mở được trên trình duyệt): ${ticketUrl}`
    );
    if (shortCode) {
      lines.push("", `MÃ DỰ PHÒNG: ${shortCode}`, "Nếu máy quét không đọc được mã QR, chỉ cần đọc 4 ký tự này cho ban tổ chức.");
    }
  } else {
    lines.push("", "ĐIỂM DANH", input.qrCheckin ? missingTicketNote : noQrNote);
  }

  lines.push("", "Nếu bạn không thể tham dự, vui lòng phản hồi thư này để ban tổ chức sắp xếp chỗ cho người khác.", "", SIGNATURE_TEXT);

  const ticketHtml = hasTicket
    ? [
        `<p style="margin:20px 0 8px"><strong>Vé tham dự</strong></p>`,
        `<p style="margin:0 0 16px">Ảnh mã QR của bạn được <strong>đính kèm thư này</strong>. Vui lòng <strong>lưu ảnh vào máy</strong> và mở ra cho ban tổ chức quét khi tới sự kiện.</p>`,
        shortCode
          ? `<p style="margin:0 0 16px;padding:12px 16px;background:#fbf4ea;border-radius:6px">Mã dự phòng: <strong style="font-family:monospace;font-size:20px;letter-spacing:4px">${escapeHtml(shortCode)}</strong><br /><span style="color:#4f6b60;font-size:13px">Nếu máy quét không đọc được mã QR, chỉ cần đọc 4 ký tự này cho ban tổ chức.</span></p>`
          : "",
        `<p style="margin:16px 0"><a href="${escapeHtml(ticketUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Mở vé trên trình duyệt</a></p>`
      ]
    : [
        `<p style="margin:20px 0 8px"><strong>Điểm danh</strong></p>`,
        `<p style="margin:0 0 16px">${escapeHtml(input.qrCheckin ? missingTicketNote : noQrNote)}</p>`
      ];

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Ban tổ chức nhắc bạn lịch tham dự <strong>${escapeHtml(eventName)}</strong>. Thông tin dưới đây là thông tin mới nhất tính tới lúc gửi thư này.</p>`,
      pending ? `<p style="color:#8a5a00">${escapeHtml(pendingNote)}</p>` : "",
      `<p style="margin:16px 0;padding:14px 18px;background:#e8f6ee;border-left:4px solid #16834c;border-radius:6px"><span style="color:#4f6b60;font-size:13px;text-transform:uppercase;letter-spacing:1px">Thời gian</span><br /><strong style="font-size:18px">${escapeHtml(input.whenLabel)}</strong></p>`,
      input.placeLabel ? `<p><strong>Địa điểm:</strong> ${escapeHtml(input.placeLabel)}</p>` : "",
      input.mapUrl ? `<p><a href="${escapeHtml(input.mapUrl)}" style="color:#16834c">Xem trên bản đồ</a></p>` : "",
      input.joinUrl
        ? `<p><a href="${escapeHtml(input.joinUrl)}" style="color:#16834c">Đường dẫn tham gia trực tuyến</a></p>`
        : "",
      description
        ? `<p style="margin:20px 0 8px"><strong>Nội dung</strong></p><p style="margin:0 0 16px">${escapeHtml(description).replace(/\r?\n/g, "<br />")}</p>`
        : ""
    ]
      .concat(ticketHtml)
      .concat([
        `<p style="color:#6b7c74;font-size:13px">Nếu bạn không thể tham dự, vui lòng phản hồi thư này để ban tổ chức sắp xếp chỗ cho người khác.</p>`
      ])
      .join("")
  );

  return {
    to: "",
    subject,
    text: lines.join("\n"),
    html,
    attachments:
      hasTicket && input.qrPngBase64
        ? [
            {
              filename: `ve-${String(input.ticketCode ?? "").trim() || "tham-du"}.png`,
              contentBase64: input.qrPngBase64
            }
          ]
        : undefined
  };
}

/**
 * Thư khảo sát sau sự kiện.
 *
 * Gửi vào cuối buổi, cho người đã check in. Điều lá thư này phải nói rõ — và là
 * lý do nó không dùng lại khuôn thư nhắc lịch — là NỘP PHIẾU CHÍNH LÀ CHECK OUT:
 * người đọc lướt rồi để đó vì tưởng "khảo sát thì tuỳ" sẽ mất phần điểm rèn
 * luyện mà chính buổi này được lập ra để đề xuất.
 *
 * Hai câu hỏi hiện ngay trong thư, không giấu sau đường dẫn: người đọc trên điện
 * thoại giữa hội trường cần biết mình sắp trả lời gì trước khi bấm.
 */
export function buildEventSurveyEmail(input: {
  recipientName: string;
  eventName: string;
  /** Câu hỏi 1, dựng theo tên buổi ở lib/event-survey-core.ts. */
  impressionQuestion: string;
  /** Câu hỏi 2. */
  question: string;
  /** Câu nói rõ phiếu dùng để đề xuất điểm rèn luyện. */
  trackingNotice: string;
  surveyUrl: string;
  /** Hạn điền, đã định dạng sẵn theo giờ Việt Nam. Không có thì không nhắc hạn. */
  deadlineLabel?: string | null;
}): EmailMessage {
  const name = safeDisplayName(input.recipientName);
  const eventName = String(input.eventName ?? "").trim() || "sự kiện";
  const url = String(input.surveyUrl ?? "").trim();
  const deadline = String(input.deadlineLabel ?? "").trim();

  const subject = `Khảo sát cuối buổi ${eventName} — cũng là bước check out của bạn`;

  const checkoutNote =
    "Bấm gửi phiếu này ĐƯỢC TÍNH LÀ THAO TÁC CHECK OUT của bạn cho buổi hôm nay. Ban tổ chức đối chiếu với lượt check in đầu buổi để ghi nhận bạn tham dự đầy đủ.";

  const lines = [
    `Chào ${name},`,
    "",
    `Cảm ơn bạn đã tham dự ${eventName}. Ban tổ chức xin bạn hai phút cho hai câu hỏi ngắn.`,
    "",
    checkoutNote,
    "",
    "HAI CÂU HỎI",
    `1. ${input.impressionQuestion}`,
    `2. ${input.question}`,
    "",
    `Điền phiếu tại: ${url}`
  ];
  if (deadline) lines.push("", `Vui lòng gửi trước ${deadline}.`);
  lines.push("", String(input.trackingNotice ?? "").trim(), "", SIGNATURE_TEXT);

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Cảm ơn bạn đã tham dự <strong>${escapeHtml(eventName)}</strong>. Ban tổ chức xin bạn hai phút cho hai câu hỏi ngắn.</p>`,
      `<p style="margin:16px 0;padding:14px 18px;background:#e8f6ee;border-left:4px solid #16834c;border-radius:6px">${escapeHtml(checkoutNote)}</p>`,
      `<p style="margin:20px 0 8px"><strong>Hai câu hỏi</strong></p>`,
      `<ol style="margin:0 0 16px;padding-left:20px"><li>${escapeHtml(input.impressionQuestion)}</li><li>${escapeHtml(input.question)}</li></ol>`,
      `<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Điền phiếu khảo sát</a></p>`,
      `<p style="margin:0 0 16px;font-size:13px;color:#4f6b60">Nếu nút trên không bấm được, mở đường dẫn này: ${escapeHtml(url)}</p>`,
      deadline ? `<p>Vui lòng gửi trước <strong>${escapeHtml(deadline)}</strong>.</p>` : "",
      `<p style="color:#6b7c74;font-size:13px">${escapeHtml(String(input.trackingNotice ?? "").trim())}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Thư mời mentee chọn ca phỏng vấn trực tiếp — mang link riêng tới /dat-ca.
 *
 * KHÁC buildInterviewRoundInviteEmail: thư đó cố ý không có link, vì lúc viết
 * nó ứng viên chưa có màn hình nào để tự chọn lịch. Với mentee thì màn hình ấy
 * đã có, nên từ giai đoạn 1 mentee nhận ĐÚNG MỘT thư mời: thư này.
 *
 * Ngày phỏng vấn là THAM SỐ, không viết cứng: giai đoạn 2 (10–11/10) dùng lại
 * đúng hàm này, và một thư viết cứng "03–04/10" sẽ nói sai với cả đợt đó.
 */
export function buildMenteeSessionInviteEmail(input: {
  candidateName: string;
  seasonLabel: string;
  interviewDaysLabel: string;
  bookingUrl: string;
  deadlineLabel: string;
  hotlineZalo: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.candidateName, "bạn");
  const season = safeDisplayName(input.seasonLabel, "mùa mới");
  const days = safeDisplayName(input.interviewDaysLabel, "");
  const deadline = safeDisplayName(input.deadlineLabel, "");

  const subject = `[UEH Mentoring] Mời bạn chọn ca phỏng vấn — ${season}`;

  const lines = [
    `Chào ${name},`,
    "",
    `Chúc mừng bạn đã qua vòng hồ sơ ${season}. Ban tổ chức mời bạn tham gia vòng phỏng vấn trực tiếp vào ${days}.`,
    "",
    "Mỗi buổi phỏng vấn dài tối đa 30 phút, 1:1 với một mentor. Bạn mở đường dẫn riêng dưới đây và chọn MỘT ca phù hợp. Mỗi ca có số chỗ giới hạn, ca nào kín thì không chọn được nữa, nên bạn chọn sớm nhé:",
    input.bookingUrl,
    "",
    `Hạn chọn ca: ${deadline}. Sau hạn này mà chưa chọn ca, bạn được xem như không tham gia vòng phỏng vấn.`,
    "",
    "Chọn xong, bạn sẽ nhận một thư xác nhận ca và địa điểm. Cần đổi ca, bạn mở lại đúng đường dẫn này trước hạn.",
    "",
    `Cần hỗ trợ, bạn nhắn Zalo ban tổ chức ${input.hotlineZalo} hoặc trả lời email này.`,
    "",
    "Hẹn gặp bạn!",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      `<p>Chúc mừng bạn đã qua vòng hồ sơ <strong>${escapeHtml(season)}</strong>. Ban tổ chức mời bạn tham gia vòng phỏng vấn trực tiếp vào <strong>${escapeHtml(days)}</strong>.</p>`,
      "<p>Mỗi buổi phỏng vấn dài tối đa 30 phút, 1:1 với một mentor. Bạn mở đường dẫn riêng dưới đây và chọn <strong>một</strong> ca phù hợp. Mỗi ca có số chỗ giới hạn, ca nào kín thì không chọn được nữa, nên bạn chọn sớm nhé.</p>",
      `<p style="margin:20px 0"><a href="${escapeHtml(input.bookingUrl)}" style="background:#16834c;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;font-weight:600">Chọn ca phỏng vấn</a></p>`,
      `<p>Hạn chọn ca: <strong>${escapeHtml(deadline)}</strong>. Sau hạn này mà chưa chọn ca, bạn được xem như không tham gia vòng phỏng vấn.</p>`,
      "<p>Chọn xong, bạn sẽ nhận một thư xác nhận ca và địa điểm. Cần đổi ca, bạn mở lại đúng đường dẫn này trước hạn.</p>",
      `<p>Cần hỗ trợ, bạn nhắn Zalo ban tổ chức <strong>${escapeHtml(input.hotlineZalo)}</strong> hoặc trả lời email này.</p>`,
      `<p style="color:#4f6b60;font-size:13px">Đường dẫn là riêng cho bạn, vui lòng không chuyển tiếp. Nếu nút trên không bấm được, mở đường dẫn này: ${escapeHtml(input.bookingUrl)}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}

/**
 * Thư xác nhận ca phỏng vấn của mentee — gửi cả lúc đặt lần đầu lẫn lúc đổi ca.
 *
 * MỘT lá cho hai thời điểm, có chủ ý: câu "ban tổ chức đã ghi nhận ca của bạn"
 * đúng cho cả hai, và hai lá gần giống nhau là hai chỗ để câu chữ lệch nhau.
 *
 * `venueLabel` luôn có giá trị: địa điểm thật khi ban tổ chức đã điền, hoặc một
 * câu hẹn báo sau. Dòng "Địa điểm:" đứng trơ là thứ khiến người nhận gọi điện.
 */
export function buildMenteeSessionConfirmedEmail(input: {
  candidateName: string;
  sessionLabel: string;
  venueLabel: string;
  manageUrl: string;
  hotlineZalo: string;
}): EmailMessage & { to: string } {
  const name = safeDisplayName(input.candidateName, "bạn");
  const session = safeDisplayName(input.sessionLabel, "");
  const venue = safeDisplayName(input.venueLabel, "");

  const subject = `[UEH Mentoring] Xác nhận ca phỏng vấn — ${session}`;

  const lines = [
    `Chào ${name},`,
    "",
    "Ban tổ chức đã ghi nhận ca phỏng vấn của bạn:",
    "",
    `- Thời gian: ${session}`,
    `- Địa điểm: ${venue}`,
    "",
    "Buổi phỏng vấn dài tối đa 30 phút. Bạn đến trước giờ hẹn 10 phút để ban tổ chức kịp hướng dẫn vào phòng.",
    "",
    "Cần đổi ca? Bạn mở lại đường dẫn riêng của mình trước hạn chọn ca và chọn ca khác. Ca hiện tại chỉ được nhả khi ca mới còn chỗ, nên bạn không bao giờ bị mất chỗ vì đổi:",
    input.manageUrl,
    "",
    `Cần hỗ trợ, bạn nhắn Zalo ban tổ chức ${input.hotlineZalo} hoặc trả lời email này.`,
    "",
    "Hẹn gặp bạn!",
    "",
    SIGNATURE_TEXT
  ];

  const html = wrapHtml(
    [
      `<p>Chào <strong>${escapeHtml(name)}</strong>,</p>`,
      "<p>Ban tổ chức đã ghi nhận ca phỏng vấn của bạn:</p>",
      `<ul><li>Thời gian: <strong>${escapeHtml(session)}</strong></li><li>Địa điểm: <strong>${escapeHtml(venue)}</strong></li></ul>`,
      "<p>Buổi phỏng vấn dài tối đa 30 phút. Bạn đến trước giờ hẹn 10 phút để ban tổ chức kịp hướng dẫn vào phòng.</p>",
      `<p>Cần đổi ca? Bạn mở lại <a href="${escapeHtml(input.manageUrl)}">đường dẫn riêng của mình</a> trước hạn chọn ca và chọn ca khác. Ca hiện tại chỉ được nhả khi ca mới còn chỗ, nên bạn không bao giờ bị mất chỗ vì đổi.</p>`,
      `<p>Cần hỗ trợ, bạn nhắn Zalo ban tổ chức <strong>${escapeHtml(input.hotlineZalo)}</strong> hoặc trả lời email này.</p>`,
      `<p style="color:#4f6b60;font-size:13px">Nếu đường dẫn trên không mở được: ${escapeHtml(input.manageUrl)}</p>`
    ].join("")
  );

  return { to: "", subject, text: lines.join("\n"), html };
}
