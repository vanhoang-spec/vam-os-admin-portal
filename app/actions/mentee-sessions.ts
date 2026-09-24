"use server";

import { revalidatePath } from "next/cache";
import {
  applySeatLimitToAllSessions,
  applyVenueToAllSessions,
  saveSessionConfig
} from "@/lib/mentee-session-admin";
import {
  type SessionConfigState
} from "@/lib/mentee-session-admin-action-types";

const PATH = "/interviews/ca-mentee";

/**
 * Mọi phép kiểm quyền nằm trong lib/mentee-session-admin.ts, không ở đây. Các
 * action này chỉ nhận tham số, gọi xuống, và làm mới trang.
 */
export async function saveSessionConfigAction(
  _previousState: SessionConfigState,
  formData: FormData
): Promise<SessionConfigState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const result = await saveSessionConfig({
    sessionId,
    seatLimit: formData.get("seatLimit"),
    venue: formData.get("venue"),
    closed: formData.get("closed")
  });

  if (result.ok) revalidatePath(PATH);
  return {
    status: result.ok ? "success" : "error",
    message: result.message,
    sessionId: sessionId || null
  };
}

export async function applySeatLimitToAllAction(
  _previousState: SessionConfigState,
  formData: FormData
): Promise<SessionConfigState> {
  const result = await applySeatLimitToAllSessions({ seatLimit: formData.get("seatLimit") });
  if (result.ok) revalidatePath(PATH);
  return { status: result.ok ? "success" : "error", message: result.message, sessionId: null };
}

export async function applyVenueToAllAction(
  _previousState: SessionConfigState,
  formData: FormData
): Promise<SessionConfigState> {
  const result = await applyVenueToAllSessions({ venue: formData.get("venue") });
  if (result.ok) revalidatePath(PATH);
  return { status: result.ok ? "success" : "error", message: result.message, sessionId: null };
}
