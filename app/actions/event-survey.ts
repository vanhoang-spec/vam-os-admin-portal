"use server";

import { revalidatePath } from "next/cache";
import { createSurveyLinkForEvent } from "@/lib/events";
import { getEventSurveyOverview, runEventSurveySend, setEventSurveySendAt } from "@/lib/event-survey";
import { isSurveyAudience, surveyAutoSendDue, type SurveySendResult } from "@/lib/event-survey-core";

/**
 * app/actions/event-survey.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cửa của ban tổ chức cho khảo sát cuối buổi.
 *
 * Mọi hàm ở đây đi qua `lib/event-survey.ts`, nơi đã có phép kiểm quyền vận hành
 * trong mùa của sự kiện. File này chỉ lo chuyện nhận tham số và làm mới trang.
 */

function revalidateEvent(eventId: string) {
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/survey`);
}

export async function createEventSurveyLinkAction(eventId: string): Promise<{ ok: boolean; message: string }> {
  const result = await createSurveyLinkForEvent(eventId);
  if (result.ok) revalidateEvent(eventId);
  return { ok: result.ok, message: result.message };
}

export async function sendEventSurveyAction(input: {
  eventId: string;
  audience: string;
}): Promise<SurveySendResult> {
  if (!isSurveyAudience(input.audience)) {
    return { ok: false, message: "Chưa chọn nhóm người nhận hợp lệ." };
  }
  const result = await runEventSurveySend({ eventId: input.eventId, audience: input.audience });
  if (result.ok) revalidateEvent(input.eventId);
  return result;
}

/**
 * Lượt gửi TỰ ĐỘNG, do màn hình gọi theo chu kỳ khi trang sự kiện đang mở.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO TỰ ĐỘNG LẠI CẦN MỘT TRANG ĐANG MỞ
 * ---------------------------------------------------------------------------
 * Hệ thống này không có bộ hẹn giờ chạy nền: Vercel cron chưa bật cho dự án, và
 * GitHub Actions thì cần một khoá bí mật mới. Nên "tự động" ở đây nghĩa là: tới
 * giờ đã đặt, bất kỳ tab trang sự kiện nào đang mở sẽ tự gọi hàm này — không ai
 * phải canh đồng hồ, nhưng phải có một máy đang mở trang.
 *
 * Lượt gửi vẫn đi qua đúng cổng quyền của lượt bấm tay, và vẫn là cùng một hàng
 * đợi, nên gọi trùng nhau từ nhiều tab không làm ai nhận hai thư. Nút bấm tay
 * luôn còn đó làm đường lùi.
 */
export async function dispatchEventSurveyAction(eventId: string): Promise<SurveySendResult & { due: boolean }> {
  const overview = await getEventSurveyOverview(eventId);
  if (!overview.ok) return { ok: false, due: false, message: overview.message ?? "Không đọc được khảo sát." };
  if (!surveyAutoSendDue(overview.sendAt, Date.now())) {
    return { ok: true, due: false, message: "Chưa tới giờ tự gửi." };
  }

  const result = await runEventSurveySend({ eventId, audience: "checked_in" });
  if (result.ok) revalidateEvent(eventId);
  return { ...result, due: true };
}

export async function setEventSurveySendAtAction(input: {
  eventId: string;
  sendAtIso: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const result = await setEventSurveySendAt(input);
  if (result.ok) revalidateEvent(input.eventId);
  return result;
}
