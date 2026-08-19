"use server";

import { revalidatePath } from "next/cache";

import { normalizeActionError } from "@/lib/action-feedback";
import { setProgramMembership } from "@/lib/participant-programs";
import { setParticipantAccountStatus } from "@/lib/participant-auth";
import { setCurrentSeason } from "@/lib/current-season";
import { inviteParticipants } from "@/lib/participant-invites";
import type { ParticipantActionState } from "@/lib/participant-action-types";

/**
 * Server actions for participant administration.
 *
 * Thin by design: every permission check and every validation lives in the
 * `lib/` function, so posting straight to one of these gets the same treatment
 * as pressing the button. All four are super-admin only, enforced there.
 */

function revalidateParticipants() {
  revalidatePath("/admin/participants");
  revalidatePath("/chon-chuong-trinh");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function setProgramMembershipAction(
  _prev: ParticipantActionState,
  formData: FormData
): Promise<ParticipantActionState> {
  try {
    const result = await setProgramMembership({
      personId: text(formData, "person_id").trim(),
      programId: text(formData, "program_id").trim(),
      role: text(formData, "role").trim(),
      status: text(formData, "status").trim(),
      reason: text(formData, "reason")
    });
    if (result.ok) revalidateParticipants();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[participants action] membership", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function setCurrentSeasonAction(
  _prev: ParticipantActionState,
  formData: FormData
): Promise<ParticipantActionState> {
  try {
    const result = await setCurrentSeason({
      programId: text(formData, "program_id").trim(),
      seasonId: text(formData, "season_id").trim()
    });
    if (result.ok) {
      revalidateParticipants();
      revalidatePath("/ct", "layout");
    }
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[participants action] current season", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function setAccountStatusAction(
  _prev: ParticipantActionState,
  formData: FormData
): Promise<ParticipantActionState> {
  try {
    const status = text(formData, "status").trim();
    const result = await setParticipantAccountStatus({
      accountId: text(formData, "account_id").trim(),
      status: status === "disabled" ? "disabled" : "active"
    });
    if (result.ok) revalidateParticipants();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[participants action] account status", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function inviteParticipantsAction(
  _prev: ParticipantActionState,
  formData: FormData
): Promise<ParticipantActionState> {
  try {
    const result = await inviteParticipants({
      personIds: formData.getAll("person_ids").map((value) => String(value))
    });
    if (result.ok) revalidateParticipants();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[participants action] invite", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
