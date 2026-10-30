"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CustomFormAdminResult, CustomFormSavePayload } from "@/lib/custom-form-action-types";
import { CUSTOM_FORMS_PATH } from "@/lib/custom-form-core";
import { createCustomForm, saveCustomForm, sendCustomFormReceiptTest, setCustomFormStatus } from "@/lib/custom-forms";
import { createEvent } from "@/lib/events";

/**
 * Lệnh của trình tạo form (BTC 15/10/2026). Mỗi lệnh tự kiểm quyền ở lib/custom-forms.ts — nút ẩn
 * hay hiện trên trang không phải phép kiểm, và mọi thứ gửi lên đều được kiểm lại.
 */
export async function createCustomFormAction(): Promise<void> {
  const result = await createCustomForm();
  if (!result.ok) redirect(`${CUSTOM_FORMS_PATH}?loi=tao-form`);
  revalidatePath(CUSTOM_FORMS_PATH);
  redirect(`${CUSTOM_FORMS_PATH}/${result.id}`);
}

export async function saveCustomFormAction(id: string, payload: CustomFormSavePayload): Promise<CustomFormAdminResult> {
  const formId = String(id ?? "");
  const result = await saveCustomForm(formId, payload);
  if (result.ok) {
    revalidatePath(CUSTOM_FORMS_PATH);
    revalidatePath(`${CUSTOM_FORMS_PATH}/${formId}`);
  }
  return result;
}

/** "Gửi thử cho tôi" ở phần thư tự động: gửi cho chính người đang bấm, với chữ đang trên trang. */
export async function sendCustomFormReceiptTestAction(id: string, input: { subject: string; body: string }): Promise<CustomFormAdminResult> {
  return sendCustomFormReceiptTest(String(id ?? ""), input ?? { subject: "", body: "" });
}

export async function setCustomFormStatusAction(id: string, status: string): Promise<CustomFormAdminResult> {
  const formId = String(id ?? "");
  const result = await setCustomFormStatus(formId, String(status ?? ""));
  if (result.ok) {
    revalidatePath(CUSTOM_FORMS_PATH);
    revalidatePath(`${CUSTOM_FORMS_PATH}/${formId}`);
  }
  return result;
}

export type QuickEventResult = CustomFormAdminResult & {
  event?: { id: string; name: string; startsAt: string | null; capacity: number | null; status: string; blocker: string | null };
};

/**
 * "Tạo sự kiện mới" ngay trong trình tạo form (VAM00008): gọi đúng createEvent của trang Sự kiện, nên
 * quyền tạo sự kiện, phạm vi mùa và nhật ký giữ nguyên. Chỉ hỏi vài ô cần cho đăng ký; chi tiết khác
 * (giờ kết thúc, link check-in…) sửa tiếp ở trang Sự kiện.
 */
export async function createEventForFormAction(input: {
  name: string;
  startsAt: string;
  location: string;
  capacity: string;
}): Promise<QuickEventResult> {
  const capacityRaw = String(input?.capacity ?? "").trim();
  const capacity = capacityRaw ? Number(capacityRaw) : null;
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) return { ok: false, message: "Sức chứa phải là số nguyên dương, hoặc để trống." };
  const result = await createEvent({
    event_name: input?.name,
    starts_at: input?.startsAt,
    event_format: "offline",
    location_name: input?.location,
    registration_required: "true",
    capacity_limit_enabled: capacity !== null ? "true" : "false",
    capacity_limit: capacity !== null ? String(capacity) : "",
    qr_checkin_enabled: "true"
  });
  if (!result.ok) return { ok: false, message: result.message };
  const row = (result.data ?? {}) as Record<string, unknown>;
  revalidatePath("/events");
  return {
    ok: true,
    message: "Đã tạo sự kiện và chọn sẵn cho form — bấm “Lưu form” để gắn.",
    event: {
      id: String(row.id),
      name: String(row.event_name ?? ""),
      startsAt: (row.starts_at as string | null) ?? null,
      capacity,
      status: "active",
      blocker: null
    }
  };
}
