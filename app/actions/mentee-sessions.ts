"use server";

import { revalidatePath } from "next/cache";
import {
  applySeatLimitToAllSessions,
  applyVenueToAllSessions,
  saveSessionConfig
} from "@/lib/mentee-session-admin";
import { runMenteeInviteDispatch } from "@/lib/mentee-invite-dispatch";
import {
  type InviteDispatchState,
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

/**
 * Gửi một lượt thư mời chọn ca.
 *
 * Ô xác nhận được kiểm Ở MÁY CHỦ, không chỉ ở nút bị khoá trên màn hình: nút
 * khoá là thứ trình duyệt vẽ, còn một POST thẳng vào action thì không đi qua
 * nút nào cả.
 */
export async function sendMenteeInvitesAction(
  _previousState: InviteDispatchState,
  formData: FormData
): Promise<InviteDispatchState> {
  if (formData.get("confirmed") !== "yes") {
    return {
      status: "error",
      message: "Tích ô xác nhận đã kiểm tra số ghế, địa điểm và hạn đặt ca trước khi gửi."
    };
  }

  const result = await runMenteeInviteDispatch();
  revalidatePath(PATH);
  return { status: result.ok ? "success" : "error", message: result.message };
}
