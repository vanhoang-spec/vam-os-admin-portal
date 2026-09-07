"use server";

import { revalidatePath } from "next/cache";

import {
  cancelCrossRequest,
  completeCrossSession,
  publishCrossSession,
  reviewCrossRequest,
  scheduleCrossSession,
  submitCrossRequest
} from "@/lib/cross-requests";
import { decideInvitations, sweepInvitations } from "@/lib/cross-invitations";
import { draftCrossPost, saveCrossPostDraft } from "@/lib/cross-post";
import { setMentorFields } from "@/lib/mentor-cross-fields";
import { getCurrentParticipant } from "@/lib/participant-auth";
import { registerForSession } from "@/lib/participant-event-registration";
import type {
  CrossActionState,
  CrossSweepActionState
} from "@/lib/cross-action-types";

/**
 * app/actions/cross.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin by house rule: parse the form, call the library, revalidate, return.
 *
 * Every authorization check and every validation lives in `lib/`, so posting
 * straight at one of these actions gets the same treatment the form does. The
 * one thing done here that is not parsing is `revalidatePath`, because only the
 * action knows which screens a change was visible on.
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function textList(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

// ── The mentee ───────────────────────────────────────────────────────────────

export async function submitCrossRequestAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const programCode = text(formData, "program_code");
  const combined = text(formData, "field");

  // The picker posts one value carrying both halves — "industry:finance_banking"
  // — so the two selects cannot drift apart in the browser.
  const separator = combined.indexOf(":");
  const fieldKind = separator > 0 ? combined.slice(0, separator) : "";
  const fieldCode = separator > 0 ? combined.slice(separator + 1) : "";

  const result = await submitCrossRequest({
    programCode,
    fieldKind,
    fieldCode,
    topic: text(formData, "topic"),
    note: text(formData, "note")
  });

  if (result.ok) {
    revalidatePath(`/ct/${programCode}/cross`);
    revalidatePath("/operations/cross");
  }

  return { ok: result.ok, message: result.message };
}

// ── The mentor's own fields ──────────────────────────────────────────────────

export async function saveMyCrossFieldsAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const participant = await getCurrentParticipant();
  if (participant.state !== "participant") {
    return { ok: false, message: "Bạn cần đăng nhập." };
  }

  const programCode = text(formData, "program_code");
  const seasonId = text(formData, "season_id");

  const result = await setMentorFields({
    personId: participant.account.personId,
    seasonId,
    industries: textList(formData, "industries"),
    functions: textList(formData, "functions"),
    source: "self"
  });

  if (result.ok) revalidatePath(`/ct/${programCode}/cross`);
  return { ok: result.ok, message: result.message };
}

// ── The organisers ───────────────────────────────────────────────────────────

function revalidateOperations(requestId?: string) {
  revalidatePath("/operations/cross");
  if (requestId) revalidatePath(`/operations/cross/${requestId}`);
}

export async function reviewCrossRequestAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");

  const result = await reviewCrossRequest({
    requestId,
    decision: text(formData, "decision"),
    reviewNote: text(formData, "review_note")
  });

  if (result.ok) revalidateOperations(requestId);
  return { ok: result.ok, message: result.message };
}

export async function sweepInvitationsAction(
  _previous: CrossSweepActionState,
  formData: FormData
): Promise<CrossSweepActionState> {
  const requestId = text(formData, "request_id");
  const result = await sweepInvitations({ requestId });

  if (result.ok) revalidateOperations(requestId);

  return {
    ok: result.ok,
    message: result.message,
    invited: result.invited,
    rested: result.rested,
    alreadyInvited: result.alreadyInvited,
    noEmail: result.noEmail,
    failed: result.failed
  };
}

export async function decideInvitationsAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");

  const result = await decideInvitations({
    requestId,
    selectedIds: textList(formData, "selected"),
    // Only ever false on the cancel path, which has its own action; a decision
    // taken here is a real decision about the mentors.
    countsTowardDecline: true
  });

  if (result.ok) revalidateOperations(requestId);
  return { ok: result.ok, message: result.message };
}

export async function scheduleCrossSessionAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");

  const result = await scheduleCrossSession({
    requestId,
    scheduledAt: text(formData, "scheduled_at"),
    location: text(formData, "location"),
    eventName: text(formData, "event_name")
  });

  if (result.ok) {
    revalidateOperations(requestId);
    revalidatePath("/events");
  }

  return { ok: result.ok, message: result.message };
}

export async function draftCrossPostAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");
  const result = await draftCrossPost({ requestId });

  if (result.ok) revalidateOperations(requestId);
  return { ok: result.ok, message: result.message };
}

export async function saveCrossPostDraftAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");
  const result = await saveCrossPostDraft({ requestId, draft: text(formData, "draft") });

  if (result.ok) revalidateOperations(requestId);
  return { ok: result.ok, message: result.message };
}

export async function publishCrossSessionAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");
  const result = await publishCrossSession({ requestId });

  if (result.ok) {
    revalidateOperations(requestId);
    revalidatePath("/events");
  }

  return { ok: result.ok, message: result.message };
}

export async function completeCrossSessionAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");
  const result = await completeCrossSession({ requestId });

  if (result.ok) {
    revalidateOperations(requestId);
    revalidatePath("/events");
  }

  return { ok: result.ok, message: result.message };
}

export async function cancelCrossRequestAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const requestId = text(formData, "request_id");

  const result = await cancelCrossRequest({
    requestId,
    reason: text(formData, "reason")
  });

  if (result.ok) revalidateOperations(requestId);
  return { ok: result.ok, message: result.message };
}

// ── Registering from the portal ──────────────────────────────────────────────

export async function registerForSessionAction(
  _previous: CrossActionState,
  formData: FormData
): Promise<CrossActionState> {
  const programCode = text(formData, "program_code");
  const result = await registerForSession({ eventId: text(formData, "event_id") });

  if (result.ok) revalidatePath(`/ct/${programCode}/cross`);
  return { ok: result.ok, message: result.message };
}
