"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { addEventSupporter, removeEventSupporter } from "@/lib/event-supporters";
import type { EventSupporterActionState } from "@/lib/event-supporter-action-types";

/**
 * Cấp và thu hồi quyền quét cho một buổi.
 *
 * Cổng ở đây HẸP hơn cổng của chính việc quét: người hỗ trợ quét được, nhưng
 * không tự thêm người hỗ trợ khác. Nếu không thì một dòng ghép sẽ tự nhân lên,
 * và danh sách người được vào cửa lớn dần mà không ai quyết định.
 */
async function authorize(): Promise<
  { ok: true; adminUserId: string } | { ok: false; state: EventSupporterActionState }
> {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) return { ok: false, state: { ok: false, message: "Bạn chưa đăng nhập." } };
  if (!canEditRecaps(adminUser)) {
    return {
      ok: false,
      state: { ok: false, message: "Bạn không có quyền sửa danh sách người hỗ trợ." }
    };
  }
  return { ok: true, adminUserId: adminUser.id };
}

export async function addEventSupporterAction(
  _previousState: EventSupporterActionState,
  formData: FormData
): Promise<EventSupporterActionState> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.state;

    const eventId = String(formData.get("event_id") ?? "").trim();
    if (!eventId) return { ok: false, message: "Thiếu mã sự kiện." };

    const result = await addEventSupporter({
      eventId,
      adminUserId: String(formData.get("admin_user_id") ?? ""),
      addedBy: auth.adminUserId
    });

    revalidatePath(`/events/${eventId}`);
    return result;
  } catch (error) {
    console.error("[addEventSupporterAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}

export async function removeEventSupporterAction(
  _previousState: EventSupporterActionState,
  formData: FormData
): Promise<EventSupporterActionState> {
  try {
    const auth = await authorize();
    if (!auth.ok) return auth.state;

    const eventId = String(formData.get("event_id") ?? "").trim();
    const supporterId = String(formData.get("supporter_id") ?? "").trim();
    if (!eventId || !supporterId) return { ok: false, message: "Thiếu thông tin." };

    const result = await removeEventSupporter({ eventId, supporterId });
    revalidatePath(`/events/${eventId}`);
    return result;
  } catch (error) {
    console.error("[removeEventSupporterAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}
