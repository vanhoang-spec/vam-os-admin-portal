"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CustomFormAdminResult, CustomFormSavePayload } from "@/lib/custom-form-action-types";
import { CUSTOM_FORMS_PATH } from "@/lib/custom-form-core";
import { createCustomForm, saveCustomForm, setCustomFormStatus } from "@/lib/custom-forms";

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

export async function setCustomFormStatusAction(id: string, status: string): Promise<CustomFormAdminResult> {
  const formId = String(id ?? "");
  const result = await setCustomFormStatus(formId, String(status ?? ""));
  if (result.ok) {
    revalidatePath(CUSTOM_FORMS_PATH);
    revalidatePath(`${CUSTOM_FORMS_PATH}/${formId}`);
  }
  return result;
}
