"use server";

import { revalidatePath } from "next/cache";
import {
  cancelInterviewBookingByBtc,
  matchMentorAtHour,
  runInterviewInviteDispatch,
  saveInterviewerSlots
} from "@/lib/interview-schedule";
import type { DispatchResult } from "@/lib/interview-schedule-core";
import type { AvailabilityFormState, MatchFormState } from "@/lib/interview-schedule-action-types";

/**
 * app/actions/interview-schedule.ts
 *
 * Action của trang Lịch phỏng vấn (/interviews/lich). Mọi phép kiểm quyền
 * nằm trong lib/interview-schedule.ts; file này chỉ nhận tham số từ form và
 * làm mới trang.
 */

function revalidateSchedule() {
  revalidatePath("/interviews/lich");
}

/** Danh sách giờ trong một ô input ẩn: JSON mảng chuỗi ISO. Sai khuôn coi như rỗng. */
function parseIsoList(formData: FormData, key: string): string[] {
  try {
    const parsed = JSON.parse(String(formData.get(key) ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => String(value ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Ghép một mentor đang chờ vào khung giờ này (chiều ngược).
 *
 * Người được ghép do database chọn — ai khai giờ đó sớm nhất — nên action
 * không nhận id của ai cả, chỉ nhận khung giờ. Nhờ vậy hai interviewer bấm
 * cùng lúc không thể cùng nhắm vào một người.
 */
export async function matchMentorAtHourAction(
  _previousState: MatchFormState,
  formData: FormData
): Promise<MatchFormState> {
  const result = await matchMentorAtHour({ slotStartsAt: String(formData.get("slotStartsAt") ?? "") });
  if (result.ok) revalidateSchedule();
  return { status: result.ok ? "success" : "error", message: result.message };
}

export async function saveInterviewerAvailabilityAction(
  _previousState: AvailabilityFormState,
  formData: FormData
): Promise<AvailabilityFormState> {
  const result = await saveInterviewerSlots({
    phone: String(formData.get("phone") ?? ""),
    add: parseIsoList(formData, "add"),
    remove: parseIsoList(formData, "remove")
  });
  if (result.ok) revalidateSchedule();
  return {
    status: result.ok ? "success" : "error",
    message: result.message,
    blockedRemovals: result.blockedRemovals
  };
}

/** Nút "Gửi thư mời/nhắc ngay" và vòng tự động 20 giây của panel dùng chung. */
export async function runInterviewDispatchAction(): Promise<DispatchResult> {
  const result = await runInterviewInviteDispatch({ source: "manual" });
  if (result.sent > 0) revalidateSchedule();
  return result;
}

export async function cancelBookingByBtcAction(input: {
  bookingId: string;
  note?: string;
}): Promise<{ ok: boolean; message: string }> {
  const result = await cancelInterviewBookingByBtc({ bookingId: input.bookingId, note: input.note });
  if (result.ok) revalidateSchedule();
  return { ok: result.ok, message: result.message };
}
