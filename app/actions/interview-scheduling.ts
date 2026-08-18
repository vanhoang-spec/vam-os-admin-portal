"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import { cancelInterviewSlot, scheduleInterviews } from "@/lib/interview-scheduling";
import type { InterviewScheduleActionState } from "@/lib/interview-scheduling-action-types";

/**
 * Server actions for the interview schedule.
 *
 * Thin by design: permission, scope and every scheduling rule live in
 * lib/interview-scheduling.ts, so posting straight to one of these gets the
 * same treatment as pressing the button.
 */

function revalidateInterviews() {
  revalidatePath("/interviews");
  revalidatePath("/interviews/schedule");
  revalidatePath("/reviews");
  revalidatePath("/applications");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function scheduleInterviewsAction(
  _prev: InterviewScheduleActionState,
  formData: FormData
): Promise<InterviewScheduleActionState> {
  try {
    const result = await scheduleInterviews({
      applicationIds: formData.getAll("application_ids").map((value) => String(value)),
      interviewerAdminUserId: text(formData, "interviewer_admin_user_id"),
      startAt: text(formData, "start_at"),
      mode: text(formData, "mode"),
      location: text(formData, "location"),
      slotMinutes: text(formData, "slot_minutes"),
      notifyInterviewer: formData.get("notify_interviewer") === "on",
      notifyCandidates: formData.get("notify_candidates") === "on",
      seasonLabel: text(formData, "season_label") || null
    });

    if (result.ok) revalidateInterviews();
    return {
      ok: result.ok,
      message: result.message,
      scheduled: result.ok ? result.scheduled : undefined
    };
  } catch (err) {
    console.error("[interview scheduling action] schedule", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function cancelInterviewSlotAction(
  _prev: InterviewScheduleActionState,
  formData: FormData
): Promise<InterviewScheduleActionState> {
  try {
    const result = await cancelInterviewSlot({ reviewId: text(formData, "review_id") });
    if (result.ok) revalidateInterviews();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[interview scheduling action] cancel", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
