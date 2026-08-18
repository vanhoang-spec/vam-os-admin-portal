"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import {
  ensureConfirmationRows,
  grantExtraSlots,
  recordMentorConfirmation,
  reissueConfirmationLink,
  sendConfirmationLinks
} from "@/lib/mentor-confirmations";
import type {
  MentorConfirmationActionState,
  MentorConfirmationBatchActionState
} from "@/lib/mentor-confirmation-action-types";

/**
 * Server actions for the admin mentor-confirmation roster.
 *
 * Thin by design: parse FormData, call the lib function, revalidate, return
 * state. Every authorization and validation rule lives in
 * lib/mentor-confirmations.ts so it cannot be bypassed by another caller.
 */

const ADMIN_PATH = "/mentors/season-confirmations";

function revalidateRoster() {
  revalidatePath(ADMIN_PATH);
  revalidatePath("/mentors");
  revalidatePath("/matches");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Record an answer collected by phone, on the mentor's behalf. */
export async function recordMentorConfirmationAction(
  _prev: MentorConfirmationActionState,
  formData: FormData
): Promise<MentorConfirmationActionState> {
  try {
    const result = await recordMentorConfirmation({
      confirmationId: text(formData, "confirmation_id"),
      decision: text(formData, "decision"),
      maxMentees: text(formData, "max_mentees"),
      agreeToReview: formData.get("agree_to_review"),
      agreeToInterview: formData.get("agree_to_interview"),
      note: text(formData, "note"),
      source: text(formData, "source") === "phone" ? "phone" : "manual",
      expectedStatus: text(formData, "expected_status") || null
    });

    if (result.ok) revalidateRoster();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[mentor-confirmations action] record", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Give a confirmed mentor extra mentee slots beyond their declared capacity. */
export async function grantExtraSlotsAction(
  _prev: MentorConfirmationActionState,
  formData: FormData
): Promise<MentorConfirmationActionState> {
  try {
    const result = await grantExtraSlots({
      confirmationId: text(formData, "confirmation_id"),
      extraSlots: text(formData, "extra_slots"),
      reason: text(formData, "reason")
    });

    if (result.ok) revalidateRoster();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[mentor-confirmations action] extra slots", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Issue a fresh link (invalidating the old one) or extend the current expiry. */
export async function reissueConfirmationLinkAction(
  _prev: MentorConfirmationActionState,
  formData: FormData
): Promise<MentorConfirmationActionState> {
  try {
    const result = await reissueConfirmationLink({
      confirmationId: text(formData, "confirmation_id"),
      mode: text(formData, "mode") === "extend" ? "extend" : "reissue"
    });

    if (result.ok) revalidateRoster();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[mentor-confirmations action] reissue", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Create a pending row + personal link for every mentor who does not have one. */
export async function generateConfirmationLinksAction(
  _prev: MentorConfirmationBatchActionState,
  formData: FormData
): Promise<MentorConfirmationBatchActionState> {
  try {
    const result = await ensureConfirmationRows({
      targetSeasonIdOrCode: text(formData, "season"),
      sourceSeasonIdOrCode: text(formData, "source_season")
    });

    if (result.ok) revalidateRoster();
    return { ok: result.ok, message: result.message, created: result.created };
  } catch (err) {
    console.error("[mentor-confirmations action] generate links", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

/** Email the next batch of invitation links (bounded server-side). */
export async function sendConfirmationLinksAction(
  _prev: MentorConfirmationBatchActionState,
  formData: FormData
): Promise<MentorConfirmationBatchActionState> {
  try {
    const result = await sendConfirmationLinks({
      seasonIdOrCode: text(formData, "season"),
      baseUrl: text(formData, "base_url"),
      limit: Number(text(formData, "limit")) || 50
    });

    if (result.ok) revalidateRoster();
    return {
      ok: result.ok,
      message: result.message,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed
    };
  } catch (err) {
    console.error("[mentor-confirmations action] send links", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
