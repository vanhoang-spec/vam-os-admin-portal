"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { stationLabel } from "@/lib/event-checkin-code";
import { recordScan } from "@/lib/event-checkin";
import type { ScanActionState } from "@/lib/event-scan-action-types";

/**
 * Ghi nhận một lần quét mã QR tại sự kiện.
 *
 * Gọi từ máy của event supporter, mỗi lần camera đọc được một mã. Vì thế nó
 * phải trả lời NHANH và trả lời RÕ: người bấm đang đứng trước một hàng người,
 * và họ chỉ liếc màn hình một cái rồi cho người tiếp theo vào.
 *
 * Cổng quyền hiện dùng chung với các thao tác sự kiện khác. Vai trò "event
 * supporter" gắn theo từng buổi là lát tiếp theo; tới lúc đó cổng này nới ra ở
 * đúng một chỗ.
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
    if (!canEditRecaps(adminUser)) {
      return {
        ok: false,
        tone: "error",
        message: "Bạn không có quyền điểm danh tại sự kiện này.",
        fullName: null,
        badges: []
      };
    }

    const eventId = String(formData.get("event_id") ?? "").trim();
    if (!eventId) {
      return { ok: false, tone: "error", message: "Thiếu mã sự kiện.", fullName: null, badges: [] };
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
    // tên để người quét biết "đúng người này, đã vào rồi".
    return {
      ok: true,
      tone: result.repeat ? "repeat" : "success",
      message: result.repeat
        ? `${result.fullName} đã được quét ở ${stationLabel(result.station)} rồi.`
        : `${result.fullName} — ${stationLabel(result.station)}.`,
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
