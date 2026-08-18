"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import {
  draftMentorBios,
  sendKickoffInviteBatch,
  sendMenteeMentorIntroBatch,
  sendMenteeSelectedBatch,
  sendMentorPackageBatch
} from "@/lib/post-match-emails";
import { ensureDossierLinks } from "@/lib/mentee-dossier";
import type { PostMatchEmailActionState } from "@/lib/post-match-email-action-types";

/**
 * Server actions for the post-matching sends.
 *
 * Thin by design: the approved-template rule, the "nobody twice" rule and the
 * "wait until everybody is matched" gate all live in lib/post-match-emails.ts.
 */

function revalidateCommunications() {
  revalidatePath("/operations/communications");
  revalidatePath("/matches/unmatched");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function sendMenteeSelectedAction(
  _prev: PostMatchEmailActionState,
  formData: FormData
): Promise<PostMatchEmailActionState> {
  try {
    const result = await sendMenteeSelectedBatch({
      seasonId: text(formData, "season_id"),
      limit: text(formData, "limit")
    });
    if (result.ok) revalidateCommunications();
    return { ok: result.ok, message: result.message, sent: result.sent, remaining: result.remaining };
  } catch (err) {
    console.error("[post match emails action] mentee selected", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function sendMenteeMentorIntroAction(
  _prev: PostMatchEmailActionState,
  formData: FormData
): Promise<PostMatchEmailActionState> {
  try {
    const result = await sendMenteeMentorIntroBatch({
      seasonId: text(formData, "season_id"),
      limit: text(formData, "limit")
    });
    if (result.ok) revalidateCommunications();
    return { ok: result.ok, message: result.message, sent: result.sent, remaining: result.remaining };
  } catch (err) {
    console.error("[post match emails action] mentor intro", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function sendMentorPackageAction(
  _prev: PostMatchEmailActionState,
  formData: FormData
): Promise<PostMatchEmailActionState> {
  try {
    const result = await sendMentorPackageBatch({
      seasonId: text(formData, "season_id"),
      limit: text(formData, "limit")
    });
    if (result.ok) revalidateCommunications();
    return { ok: result.ok, message: result.message, sent: result.sent, remaining: result.remaining };
  } catch (err) {
    console.error("[post match emails action] mentor package", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function sendKickoffInviteAction(
  _prev: PostMatchEmailActionState,
  formData: FormData
): Promise<PostMatchEmailActionState> {
  try {
    const result = await sendKickoffInviteBatch({
      seasonId: text(formData, "season_id"),
      eventId: text(formData, "event_id"),
      audience: text(formData, "audience") || "both",
      limit: text(formData, "limit")
    });
    if (result.ok) revalidateCommunications();
    return { ok: result.ok, message: result.message, sent: result.sent, remaining: result.remaining };
  } catch (err) {
    console.error("[post match emails action] kickoff", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function draftMentorBiosAction(
  _prev: PostMatchEmailActionState,
  formData: FormData
): Promise<PostMatchEmailActionState> {
  try {
    const result = await draftMentorBios({
      seasonId: text(formData, "season_id"),
      limit: text(formData, "limit")
    });
    if (result.ok) revalidateCommunications();
    return { ok: result.ok, message: result.message, sent: result.drafted };
  } catch (err) {
    console.error("[post match emails action] bios", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function ensureDossierLinksAction(
  _prev: PostMatchEmailActionState,
  formData: FormData
): Promise<PostMatchEmailActionState> {
  try {
    const result = await ensureDossierLinks({
      seasonId: text(formData, "season_id"),
      ttlDays: Number(text(formData, "ttl_days")) || undefined
    });
    if (result.ok) revalidateCommunications();
    return { ok: result.ok, message: result.message, sent: result.created };
  } catch (err) {
    console.error("[post match emails action] dossier links", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
