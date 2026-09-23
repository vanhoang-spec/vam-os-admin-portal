"use server";

import { revalidatePath } from "next/cache";
import {
  bookInterviewSlot,
  cancelInterviewBookingByMentor,
  saveMentorAvailability
} from "@/lib/interview-schedule";
import type { BookingFormState, MentorAvailabilityState } from "@/lib/interview-booking-action-types";

function formText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}


/**
 * Giữ một khung giờ phỏng vấn.
 *
 * Trả kết quả về ngay trên trang thay vì chuyển hướng: người bấm là ứng viên
 * trên điện thoại, và câu "khung giờ này vừa có người giữ trước" phải hiện
 * ngay cạnh lưới giờ để họ chọn lại — chứ không phải sau một lần tải trang.
 */
export async function bookInterviewSlotAction(
  _previousState: BookingFormState,
  formData: FormData
): Promise<BookingFormState> {
  const token = formText(formData, "token");
  const result = await bookInterviewSlot({ token, slotStartsAt: formText(formData, "slotStartsAt") });
  if (result.ok && token) revalidatePath(`/dat-lich/${token}`);
  return {
    status: result.ok ? "success" : "error",
    message: result.message,
    slotLabel: result.slotLabel ?? null
  };
}

/**
 * Mentor chọn MỘT giờ mình rảnh (chiều ngược), hoặc bỏ chọn bằng chuỗi rỗng.
 *
 * Không giữ chỗ của ai: đây chỉ là lời ngỏ để interviewer mở lưới ra ghép. Vì
 * vậy thông báo phải nói rõ "đã ghi nhận anh/chị rảnh", tuyệt đối không được
 * nghe như đã có lịch — người đọc nhầm sẽ ngồi chờ một buổi hẹn chưa tồn tại.
 */
export async function saveMentorAvailabilityAction(
  _previousState: MentorAvailabilityState,
  formData: FormData
): Promise<MentorAvailabilityState> {
  const token = formText(formData, "token");
  const result = await saveMentorAvailability({ token, slotStartsAt: formText(formData, "slotStartsAt") });
  if (result.ok && token) revalidatePath(`/dat-lich/${token}`);
  return { status: result.ok ? "success" : "error", message: result.message };
}

/** Mentor tự huỷ lịch — hàm database đã chặn ca còn dưới 24 giờ. */
export async function cancelInterviewBookingAction(
  _previousState: BookingFormState,
  formData: FormData
): Promise<BookingFormState> {
  const token = formText(formData, "token");
  const result = await cancelInterviewBookingByMentor({ token });
  if (result.ok && token) revalidatePath(`/dat-lich/${token}`);
  return {
    status: result.ok ? "success" : "error",
    message: result.message,
    slotLabel: null
  };
}
