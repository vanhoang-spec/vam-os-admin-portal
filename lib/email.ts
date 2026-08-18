import "server-only";

import { Resend } from "resend";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  buildApplicationConfirmationEmail,
  buildMentorConfirmationLinkEmail,
  buildReviewBatchAssignedEmail,
  buildReviewerInviteEmail,
  evaluateEmailGate,
  isSafeAppLink,
  normalizeEmailAddress,
  type EmailKind,
  type EmailMessage
} from "@/lib/email-core";

/**
 * lib/email.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The single outbound-email path for the whole application (Resend).
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
}) {
  const client = getSupabaseServiceRoleClient();
  if (!client) return;
  const { error } = await client.from("outbound_emails").insert({
    kind: row.kind,
    to_email: row.toEmail,
    subject: row.subject,
    status: row.status,
    provider: "resend",
    provider_message_id: row.providerMessageId ?? null,
    error: row.error ? row.error.slice(0, 500) : null,
    related_table: row.relation?.table ?? null,
    related_id: row.relation?.id ?? null
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
  relation?: EmailRelation | null
): Promise<SendEmailResult> {
  const to = normalizeEmailAddress(message.to);
  if (!to) {
    await logOutboundEmail({
      kind,
      toEmail: String(message.to ?? "").slice(0, 200),
      subject: message.subject,
      status: "failed",
      error: "Địa chỉ email không hợp lệ",
      relation
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
      relation
    });
    return { ok: true, skipped: true, reason: gate.reason };
  }

  const from = (process.env.VAM_OS_EMAIL_FROM ?? "").trim();
  const replyTo = (process.env.VAM_OS_EMAIL_REPLY_TO ?? "").trim();

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(replyTo ? { replyTo } : {})
    });

    if (error) {
      await logOutboundEmail({
        kind,
        toEmail: to,
        subject: message.subject,
        status: "failed",
        error: error.message,
        relation
      });
      console.error("[email] resend send failed", { kind, name: error.name });
      return { ok: false, skipped: false, reason: "Không gửi được email. Vui lòng thử lại sau." };
    }

    await logOutboundEmail({
      kind,
      toEmail: to,
      subject: message.subject,
      status: "sent",
      providerMessageId: data?.id ?? null,
      relation
    });
    return { ok: true, skipped: false, providerMessageId: data?.id ?? null };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown";
    await logOutboundEmail({
      kind,
      toEmail: to,
      subject: message.subject,
      status: "failed",
      error: detail,
      relation
    });
    console.error("[email] resend threw", { kind });
    return { ok: false, skipped: false, reason: "Không gửi được email. Vui lòng thử lại sau." };
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
