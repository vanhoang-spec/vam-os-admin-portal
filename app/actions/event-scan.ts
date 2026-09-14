"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import type { EventActionState } from "@/lib/event-action-types";
import { canScanEvent } from "@/lib/event-supporters";
import { recordScan } from "@/lib/event-checkin";
import { updateEventCheckinSteps } from "@/lib/event-checkin-steps-server";
import { MISSING_CHECK_IN_NOTE, type ScanActionState } from "@/lib/event-scan-action-types";

/**
 * Ghi nhận một lần quét mã QR tại sự kiện.
 *
 * Gọi từ máy của event supporter, mỗi lần camera đọc được một mã. Vì thế nó
 * phải trả lời NHANH và trả lời RÕ: người bấm đang đứng trước một hàng người,
 * và họ chỉ liếc màn hình một cái rồi cho người tiếp theo vào.
 */
export async function recordEventScanAction(
  _previousState: ScanActionState,
  formData: FormData
): Promise<ScanActionState> {
  try {
    const adminUser = await getCurrentAdminUser();
    if (!adminUser?.id) {
      return { ok: false, tone: "error", message: "Bạn chưa đăng nhập.", fullName: null, badges: [] };
    }
    const eventId = String(formData.get("event_id") ?? "").trim();
    if (!eventId) {
      return { ok: false, tone: "error", message: "Thiếu mã sự kiện.", fullName: null, badges: [] };
    }

    // Cổng quyền hỏi về ĐÚNG buổi này: quản trị sự kiện, hoặc được ghép làm
    // người hỗ trợ của chính buổi đó. Người hỗ trợ buổi orientation không quét
    // được vé của buổi phỏng vấn tuần sau.
    if (!(await canScanEvent(adminUser, eventId))) {
      return {
        ok: false,
        tone: "error",
        message: "Bạn không có quyền điểm danh tại sự kiện này.",
        fullName: null,
        badges: []
      };
    }

    const result = await recordScan({
      eventId,
      scanned: String(formData.get("scanned") ?? ""),
      station: String(formData.get("station") ?? ""),
      adminUserId: adminUser.id
    });

    if (!result.ok) {
      return { ok: false, tone: "error", message: result.message, fullName: null, badges: [] };
    }

    revalidatePath(`/events/${eventId}`);
    revalidatePath(`/events/${eventId}/scan`);

    // Quét lại không phải lỗi — máy không đọc được lần đầu, hàng người dồn
    // lại, người quét bấm hai lần. Màu vàng chứ không phải màu đỏ, và vẫn hiện
    // tên để người quét biết "đúng người này, đã qua rồi".
    const said = result.repeat
      ? `${result.fullName} đã được quét ở ${result.stationLabel} rồi.`
      : `${result.fullName} — ${result.stationLabel}.`;

    // Chưa Check in thì vẫn ghi nhận, chỉ nhắc: người vào cửa phụ hay bị quét sót
    // ở cửa vẫn phải nhận được quà, vẫn Check out được.
    return {
      ok: true,
      tone: result.repeat ? "repeat" : result.missingCheckIn ? "warning" : "success",
      message: result.missingCheckIn ? `${said} ${MISSING_CHECK_IN_NOTE}` : said,
      fullName: result.fullName,
      badges: result.badges.map((badge) => badge.label)
    };
  } catch (error) {
    console.error("[recordEventScanAction]", error);
    return {
      ok: false,
      tone: "error",
      message: "Lỗi hệ thống. Thử quét lại.",
      fullName: null,
      badges: []
    };
  }
}

/**
 * Lưu các lần quét từ khung "Thiết lập các lần quét" trên trang máy quét.
 *
 * Quyền nằm trong `updateEventCheckinSteps`, không ở đây: một cổng quyền đặt ở
 * action thì hàm ghi gọi từ chỗ khác sẽ không có cổng nào.
 */
export async function updateCheckinStepsAction(
  _previousState: EventActionState,
  formData: FormData
): Promise<EventActionState> {
  try {
    const eventId = String(formData.get("event_id") ?? "").trim();
    const result = await updateEventCheckinSteps({
      eventId,
      steps: formData.getAll("checkin_steps").map((value) => String(value))
    });

    if (!result.ok) return { ok: false, message: result.message };

    revalidatePath(`/events/${eventId}`);
    revalidatePath(`/events/${eventId}/scan`);
    revalidatePath(`/events/${eventId}/edit`);

    return {
      ok: true,
      message: "Đã lưu các lần quét. Máy quét của các bạn hỗ trợ khác cần tải lại trang để thấy danh sách mới."
    };
  } catch (error) {
    console.error("[updateCheckinStepsAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Thử lưu lại." };
  }
}
