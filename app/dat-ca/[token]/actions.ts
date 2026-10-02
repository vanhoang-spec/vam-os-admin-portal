"use server";

import { revalidatePath } from "next/cache";
import { bookMenteeSession, changeMenteeSession, saveMenteePrepAnswers } from "@/lib/mentee-interview";
import { MENTEE_BOOKING_PATH_PREFIX } from "@/lib/mentee-interview-core";
import { MENTEE_PREP_QUESTIONS } from "@/lib/email-core";
import {
  type PrepAnswersState,
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
  // Hai câu trả lời đi cùng lần bấm chọn ca: lưu trước, rồi bookMenteeSession tự
  // kiểm lại đủ chưa (không tin trang). Lưu được mà giữ chỗ hỏng thì câu trả lời
  // vẫn còn — bấm ca khác không phải gõ lại.
  if (MENTEE_PREP_QUESTIONS.some((q) => formData.has(q.rawPayloadKey))) {
    const answers: [string, string] = [
      String(formData.get(MENTEE_PREP_QUESTIONS[0].rawPayloadKey) ?? ""),
      String(formData.get(MENTEE_PREP_QUESTIONS[1].rawPayloadKey) ?? "")
    ];
    const saved = await saveMenteePrepAnswers({ token, answers });
    if (!saved.ok) return { status: "error", message: saved.message, sessionLabel: null };
  }
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

/**
 * Lưu (sửa) hai câu trả lời chuẩn bị sau khi đã giữ chỗ. Bắt buộc lúc CHỌN CA
 * (xem bookSessionAction); ở đây mentee bỏ trống ô nào thì ô đó lưu thành chuỗi rỗng, ghi đè đúng chuỗi rỗng đó, không phải "giữ nguyên
 * giá trị cũ": người xoá hết chữ trong ô rồi bấm Lưu đang nói "xoá câu trả
 * lời này", không phải bấm nhầm.
 */
export async function savePrepAnswersAction(
  token: string,
  _previousState: PrepAnswersState,
  formData: FormData
): Promise<PrepAnswersState> {
  const answers: [string, string] = [
    String(formData.get(MENTEE_PREP_QUESTIONS[0].rawPayloadKey) ?? ""),
    String(formData.get(MENTEE_PREP_QUESTIONS[1].rawPayloadKey) ?? "")
  ];
  const result = await saveMenteePrepAnswers({ token, answers });

  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  revalidatePath(`${MENTEE_BOOKING_PATH_PREFIX}/${token}`);
  return { status: "success", message: result.message };
}
