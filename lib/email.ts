import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  buildApplicationConfirmationEmail,
  buildInterviewInviteEmail,
  buildInterviewScheduleEmail,
  buildMentorConfirmationLinkEmail,
  textToHtmlEmail,
  buildRecapPeriodReminderEmail,
  buildReviewBatchAssignedEmail,
  buildReviewerInviteEmail,
  evaluateEmailGate,
  isSafeAppLink,
  normalizeEmailAddress,
  parseSenderAddress,
  type EmailKind,
  type EmailMessage,
  type EmailProvider
} from "@/lib/email-core";

/**
 * lib/email.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The single outbound-email path for the whole application.
 *
 * The provider is Brevo by default and Resend on request — both are called over
 * plain fetch with the same request shape, so `VAM_OS_EMAIL_PROVIDER` moves the
 * whole application between them without touching code. Brevo is the default
 * because its free plan allows 300 emails a day against 100, and a season sends
 * ~2.700 in bursts: the daily ceiling, not the monthly one, is what decides how
 * many days a round of letters takes.
 *
 * Design rules:
 *   * Sending is gated twice — VAM_OS_EMAIL_ENABLED=true AND a production
 *     runtime — so preview deployments and local builds can never mail real
 *     mentors or applicants. See evaluateEmailGate in lib/email-core.ts.
 *   * Every send attempt is recorded in public.outbound_emails (migration 064),
 *     including the ones skipped by the gate, so operators can see what would
 *     have gone out and can chase failures.
 *   * Sending is always non-fatal to the caller: a mutation that succeeded must
 *     never be reported as failed because an email bounced. Callers get
 *     { ok, skipped, error } and decide what to surface.
 *   * Bodies come from server-authored templates. No caller can pass raw HTML,
 *     a subject, or an arbitrary link; links are validated against the app's own
 *     base URL first.
 */

export type SendEmailResult = {
  ok: boolean;
  /** True when configuration deliberately suppressed the send (not an error). */
  skipped: boolean;
  reason?: string;
  providerMessageId?: string | null;
};

export type EmailRelation = {
  table: string;
  id: string;
};

function baseUrl(): string {
  return (process.env.VAM_OS_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
}

/**
 * Absolute base URL for links placed in emails.
 * Prefers the configured value; falls back to a caller-supplied request origin
 * (see getRequestOrigin in app/events/[id]/page.tsx) so a first deployment still
 * produces working links before the env var is set.
 */
export function resolveEmailBaseUrl(requestOrigin?: string | null): string {
  const configured = baseUrl();
  if (configured) return configured;
  const fallback = (requestOrigin ?? "").trim().replace(/\/+$/, "");
  return fallback;
}

async function logOutboundEmail(row: {
  kind: EmailKind;
  toEmail: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  providerMessageId?: string | null;
  error?: string | null;
  relation?: EmailRelation | null;
  batchId?: string | null;
  provider?: EmailProvider;
}) {
  const client = getSupabaseServiceRoleClient();
  if (!client) return;
  const { error } = await client.from("outbound_emails").insert({
    kind: row.kind,
    to_email: row.toEmail,
    subject: row.subject,
    status: row.status,
    provider: row.provider ?? "brevo",
    provider_message_id: row.providerMessageId ?? null,
    error: row.error ? row.error.slice(0, 500) : null,
    related_table: row.relation?.table ?? null,
    related_id: row.relation?.id ?? null,
    batch_id: row.batchId ?? null
  });
  if (error) {
    // Logging must never break the caller; surface it in server logs only.
    console.error("[email] outbound_emails insert failed", {
      code: error.code,
      message: error.message,
      kind: row.kind
    });
  }
}

async function deliver(
  kind: EmailKind,
  message: EmailMessage,
  relation?: EmailRelation | null,
  batchId?: string | null
): Promise<SendEmailResult> {
  const to = normalizeEmailAddress(message.to);
  if (!to) {
    await logOutboundEmail({
      kind,
      toEmail: String(message.to ?? "").slice(0, 200),
      subject: message.subject,
      status: "failed",
      error: "Địa chỉ email không hợp lệ",
      relation,
      batchId
    });
    return { ok: false, skipped: false, reason: "Địa chỉ email không hợp lệ" };
  }

  const gate = evaluateEmailGate(process.env);
  if (!gate.canSend) {
    await logOutboundEmail({
      kind,
      toEmail: to,
      subject: message.subject,
      status: "skipped",
      error: gate.reason,
      relation,
      batchId
    });
    return { ok: true, skipped: true, reason: gate.reason };
  }

  const sender = parseSenderAddress(gate.from);
  if (!sender) {
    // The gate already checked this; the branch stays so a later edit to the
    // environment cannot reach the wire with a broken From address.
    await logOutboundEmail({
      kind,
      toEmail: to,
      subject: message.subject,
      status: "failed",
      error: "VAM_OS_EMAIL_FROM không hợp lệ",
      relation,
      batchId,
      provider: gate.provider
    });
    return { ok: false, skipped: false, reason: "Cấu hình địa chỉ gửi không hợp lệ." };
  }

  const replyTo = normalizeEmailAddress(process.env.VAM_OS_EMAIL_REPLY_TO) ?? null;

  try {
    const sent =
      gate.provider === "brevo"
        ? await sendViaBrevo({ apiKey: gate.apiKey, sender, replyTo, to, message })
        : await sendViaResend({ apiKey: gate.apiKey, from: gate.from, replyTo, to, message });

    if (!sent.ok) {
      await logOutboundEmail({
        kind,
        toEmail: to,
        subject: message.subject,
        status: "failed",
        error: sent.error,
        relation,
        batchId,
        provider: gate.provider
      });
      console.error("[email] send failed", { kind, provider: gate.provider });
      return { ok: false, skipped: false, reason: "Không gửi được email. Vui lòng thử lại sau." };
    }

    await logOutboundEmail({
      kind,
      toEmail: to,
      subject: message.subject,
      status: "sent",
      providerMessageId: sent.messageId,
      relation,
      batchId,
      provider: gate.provider
    });
    return { ok: true, skipped: false, providerMessageId: sent.messageId };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown";
    await logOutboundEmail({
      kind,
      toEmail: to,
      subject: message.subject,
      status: "failed",
      error: detail,
      relation,
      batchId,
      provider: gate.provider
    });
    console.error("[email] transport threw", { kind, provider: gate.provider });
    return { ok: false, skipped: false, reason: "Không gửi được email. Vui lòng thử lại sau." };
  }
}

type TransportResult = { ok: true; messageId: string | null } | { ok: false; error: string };

const TRANSPORT_TIMEOUT_MS = 20_000;

/**
 * Brevo transactional send — the provider this program uses.
 *
 * Plain fetch rather than an SDK: the request is six fields, and one dependency
 * fewer is one dependency that cannot break a deploy. The timeout is explicit
 * because a batch of fifty is fifty sequential calls, and one provider that
 * hangs must not hold the whole batch.
 */
async function sendViaBrevo(input: {
  apiKey: string;
  sender: { name: string | null; email: string };
  replyTo: string | null;
  to: string;
  message: EmailMessage;
}): Promise<TransportResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSPORT_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": input.apiKey,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        sender: input.sender.name
          ? { name: input.sender.name, email: input.sender.email }
          : { email: input.sender.email },
        to: [{ email: input.to }],
        subject: input.message.subject,
        textContent: input.message.text,
        htmlContent: input.message.html,
        ...(input.replyTo ? { replyTo: { email: input.replyTo } } : {})
      }),
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      // Brevo answers a rejection with { code, message }: the code is what says
      // whether the key, the sender or the daily allowance is the problem.
      const detail = await readProviderError(response);
      return { ok: false, error: `Brevo HTTP ${response.status}: ${detail}` };
    }

    const payload = (await response.json().catch(() => null)) as { messageId?: string } | null;
    return { ok: true, messageId: payload?.messageId ?? null };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Brevo không phản hồi kịp thời" : String((err as Error)?.message ?? err)
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resend transactional send, kept as the alternative.
 *
 * Same shape as the Brevo call, so moving between providers is a change to
 * VAM_OS_EMAIL_PROVIDER rather than a change to code — which matters on the day
 * one of them suspends an account in the middle of a season.
 */
async function sendViaResend(input: {
  apiKey: string;
  from: string;
  replyTo: string | null;
  to: string;
  message: EmailMessage;
}): Promise<TransportResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSPORT_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.message.subject,
        text: input.message.text,
        html: input.message.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {})
      }),
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      const detail = await readProviderError(response);
      return { ok: false, error: `Resend HTTP ${response.status}: ${detail}` };
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, messageId: payload?.id ?? null };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Resend không phản hồi kịp thời" : String((err as Error)?.message ?? err)
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the provider's own reason for an operator to read, bounded. */
async function readProviderError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; code?: string; name?: string };
    const parts = [body?.code ?? body?.name, body?.message].filter(Boolean);
    return parts.length ? parts.join(" - ").slice(0, 300) : "không rõ lý do";
  } catch {
    return "không đọc được phản hồi";
  }
}

/**
 * Invitation asking a mentor to confirm participation in a season.
 * The link must be one this application generated under its own base URL.
 */
export async function sendMentorConfirmationLink(input: {
  toEmail: string;
  mentorName: string;
  seasonLabel: string;
  confirmUrl: string;
  deadlineLabel?: string | null;
  confirmationId: string;
  requestOrigin?: string | null;
}): Promise<SendEmailResult> {
  const base = resolveEmailBaseUrl(input.requestOrigin);
  if (!base || !isSafeAppLink(input.confirmUrl, base)) {
    return { ok: false, skipped: false, reason: "Đường dẫn xác nhận không hợp lệ." };
  }

  const built = buildMentorConfirmationLinkEmail({
    mentorName: input.mentorName,
    seasonLabel: input.seasonLabel,
    confirmUrl: input.confirmUrl,
    deadlineLabel: input.deadlineLabel ?? null
  });

  return deliver(
    "mentor_confirmation_link",
    { ...built, to: input.toEmail },
    { table: "mentor_season_confirmations", id: input.confirmationId }
  );
}

/** Receipt for a public mentor/mentee application. */
export async function sendApplicationConfirmation(input: {
  toEmail: string;
  applicantName: string;
  role: "mentor" | "mentee";
  seasonLabel: string;
  applicationId: string;
}): Promise<SendEmailResult> {
  const built = buildApplicationConfirmationEmail({
    applicantName: input.applicantName,
    role: input.role,
    seasonLabel: input.seasonLabel
  });

  return deliver(
    input.role === "mentor" ? "mentor_application_confirmation" : "mentee_application_confirmation",
    { ...built, to: input.toEmail },
    { table: "applications", id: input.applicationId }
  );
}

/**
 * Invite a mentor who agreed to score applications.
 *
 * The link comes from Supabase Auth (`generateLink`), not from us, so it is
 * validated as an absolute https URL rather than against our own base URL —
 * Supabase hosts the password-setting page.
 */
export async function sendReviewerInvite(input: {
  toEmail: string;
  mentorName: string;
  seasonLabel: string;
  inviteUrl: string;
  adminUserId?: string | null;
}): Promise<SendEmailResult> {
  const url = String(input.inviteUrl ?? "").trim();
  if (!url.startsWith("https://") || /[\r\n\s]/.test(url)) {
    return { ok: false, skipped: false, reason: "Đường dẫn mời không hợp lệ." };
  }

  const built = buildReviewerInviteEmail({
    mentorName: input.mentorName,
    seasonLabel: input.seasonLabel,
    inviteUrl: url
  });

  return deliver(
    "reviewer_invite",
    { ...built, to: input.toEmail },
    input.adminUserId ? { table: "admin_users", id: input.adminUserId } : null
  );
}

/** Tell a reviewer that a batch of applications is waiting for them. */
export async function sendReviewBatchAssigned(input: {
  toEmail: string;
  reviewerName: string;
  seasonLabel: string;
  assignmentCount: number;
  dueLabel?: string | null;
  assignmentBatchId?: string | null;
  requestOrigin?: string | null;
}): Promise<SendEmailResult> {
  const base = resolveEmailBaseUrl(input.requestOrigin);
  if (!base) {
    return { ok: false, skipped: false, reason: "Chưa cấu hình VAM_OS_PUBLIC_BASE_URL." };
  }

  const built = buildReviewBatchAssignedEmail({
    reviewerName: input.reviewerName,
    seasonLabel: input.seasonLabel,
    assignmentCount: input.assignmentCount,
    reviewsUrl: `${base}/reviews`,
    dueLabel: input.dueLabel ?? null
  });

  return deliver(
    "review_batch_assigned",
    { ...built, to: input.toEmail },
    input.assignmentBatchId ? { table: "review_assignment_batches", id: input.assignmentBatchId } : null
  );
}

/**
 * Tell an interviewer which candidates they have been booked to interview.
 * Both this and sendInterviewInvite use the `interview_scheduled` kind; the
 * related_table distinguishes the interviewer's copy (a review row) from the
 * candidate's copy (their application).
 */
export async function sendInterviewSchedule(input: {
  toEmail: string;
  interviewerName: string;
  seasonLabel: string;
  interviewCount: number;
  firstSlotLabel?: string | null;
  modeLabel?: string | null;
  location?: string | null;
  reviewId?: string | null;
  requestOrigin?: string | null;
}): Promise<SendEmailResult> {
  const base = resolveEmailBaseUrl(input.requestOrigin);
  if (!base) {
    return { ok: false, skipped: false, reason: "Chưa cấu hình VAM_OS_PUBLIC_BASE_URL." };
  }

  const built = buildInterviewScheduleEmail({
    interviewerName: input.interviewerName,
    seasonLabel: input.seasonLabel,
    interviewCount: input.interviewCount,
    firstSlotLabel: input.firstSlotLabel ?? null,
    modeLabel: input.modeLabel ?? null,
    location: input.location ?? null,
    interviewsUrl: `${base}/interviews`
  });

  return deliver(
    "interview_scheduled",
    { ...built, to: input.toEmail },
    input.reviewId ? { table: "application_reviews", id: input.reviewId } : null
  );
}

/** Send a candidate the time, mode and place of their interview. */
export async function sendInterviewInvite(input: {
  toEmail: string;
  candidateName: string;
  seasonLabel: string;
  timeLabel: string;
  modeLabel?: string | null;
  location?: string | null;
  applicationId: string;
}): Promise<SendEmailResult> {
  const built = buildInterviewInviteEmail({
    candidateName: input.candidateName,
    seasonLabel: input.seasonLabel,
    timeLabel: input.timeLabel,
    modeLabel: input.modeLabel ?? null,
    location: input.location ?? null
  });

  return deliver(
    "interview_scheduled",
    { ...built, to: input.toEmail },
    { table: "applications", id: input.applicationId }
  );
}

/**
 * Send a message built from an APPROVED template.
 *
 * The subject and body arrive already rendered — placeholders filled, checked
 * for leftovers — from lib/post-match-emails.ts. This function only turns the
 * text into the HTML half and records the attempt against its batch.
 *
 * It is the only sender whose words are not fixed in code, which is exactly
 * why the template it comes from has to be approved by a person first.
 */
export async function sendTemplatedEmail(input: {
  kind: EmailKind;
  toEmail: string;
  subject: string;
  body: string;
  relation?: EmailRelation | null;
  batchId?: string | null;
}): Promise<SendEmailResult> {
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const body = String(input.body ?? "").trim();
  if (!subject || !body) {
    return { ok: false, skipped: false, reason: "Thư chưa có tiêu đề hoặc nội dung." };
  }

  return deliver(
    input.kind,
    { to: input.toEmail, subject, text: body, html: textToHtmlEmail(body) },
    input.relation ?? null,
    input.batchId ?? null
  );
}

/**
 * Tell one organiser that a collection period has closed.
 *
 * `related` points at nothing: the reminder is about a date, not about a row.
 * The log line in `outbound_emails` is still written, so a missed reminder is
 * visible after the fact.
 */
export async function sendRecapPeriodReminder(input: {
  toEmail: string;
  recipientName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  requestOrigin?: string | null;
}): Promise<SendEmailResult> {
  const base = resolveEmailBaseUrl(input.requestOrigin);
  if (!base) {
    return { ok: false, skipped: false, reason: "Chưa cấu hình VAM_OS_PUBLIC_BASE_URL." };
  }

  const built = buildRecapPeriodReminderEmail({
    recipientName: input.recipientName,
    periodLabel: input.periodLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    importUrl: `${base}/operations/recap-import`
  });

  return deliver("recap_period_reminder", { ...built, to: input.toEmail }, null);
}
