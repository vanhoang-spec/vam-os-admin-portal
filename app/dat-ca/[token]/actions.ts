"use server";

import { revalidatePath } from "next/cache";
import { bookMenteeSession, changeMenteeSession } from "@/lib/mentee-interview";
import { MENTEE_BOOKING_PATH_PREFIX } from "@/lib/mentee-interview-core";
import {
  type SessionBookingState
} from "@/lib/mentee-interview-action-types";

/**
 * Giữ một ca phỏng vấn. Token đi qua tham số đã bind ở trang, KHÔNG qua ô ẩn
 * trong biểu mẫu: cái đến từ biểu mẫu là thứ người gửi tự đặt được.
 */
export async function bookSessionAction(
  token: string,
  _previousState: SessionBookingState,
  formData: FormData
): Promise<SessionBookingState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const result = await bookMenteeSession({ token, sessionId });

  if (!result.ok) {
    return { status: "error", message: result.message, sessionLabel: null };
  }

  // Đọc lại trang để số chỗ còn lại của mọi ca khớp với thực tế vừa đổi.
  revalidatePath(`${MENTEE_BOOKING_PATH_PREFIX}/${token}`);
  return {
    status: "success",
    message: result.message,
    sessionLabel: result.sessionLabel ?? null
  };
}

/**
 * Đổi sang ca khác. Dùng hàm RIÊNG chứ không gọi lại bookSessionAction: chỗ cũ
 * chỉ được nhả sau khi database chắc chắn ca mới còn chỗ, và phép đảm bảo đó
 * nằm trong vam102 chứ không ở đây.
 */
export async function changeSessionAction(
  token: string,
  _previousState: SessionBookingState,
  formData: FormData
): Promise<SessionBookingState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const result = await changeMenteeSession({ token, sessionId });

  if (!result.ok) {
    return { status: "error", message: result.message, sessionLabel: null };
  }

  revalidatePath(`${MENTEE_BOOKING_PATH_PREFIX}/${token}`);
  return {
    status: "success",
    message: result.message,
    sessionLabel: result.sessionLabel ?? null
  };
}
