"use server";

import { revalidatePath } from "next/cache";
import {
  APPLICATION_FORM_TEXTS_PATH,
  APPLICATION_FORM_TEXT_SLOTS,
  type FormTextActionState
} from "@/lib/application-form-text-core";
import { saveApplicationFormTexts } from "@/lib/application-form-text-write";

/**
 * Lưu một nhóm khối chữ từ trang "Chữ trên form đăng ký".
 *
 * Chỉ chuyển xuống những khối CÓ MẶT trong form của nhóm đó, kèm chữ màn hình đã
 * hiện lúc mở trang (`expected:<khoá>`) để hàm ghi nhận ra bản đã bị người khác
 * sửa trong lúc này. Quyền nằm ở hàm ghi.
 */
export async function saveApplicationFormTextsAction(
  _previous: FormTextActionState,
  formData: FormData
): Promise<FormTextActionState> {
  try {
    const submitted: Record<string, string> = {};
    const expected: Record<string, string> = {};
    for (const entry of APPLICATION_FORM_TEXT_SLOTS) {
      if (formData.has(entry.key)) submitted[entry.key] = String(formData.get(entry.key) ?? "");
      const expectedField = `expected:${entry.key}`;
      if (formData.has(expectedField)) expected[entry.key] = String(formData.get(expectedField) ?? "");
    }

    const result = await saveApplicationFormTexts({ submitted, expected });
    if (result.changed > 0) {
      revalidatePath("/apply/mentor");
      revalidatePath("/apply/mentee");
      revalidatePath(APPLICATION_FORM_TEXTS_PATH);
    }
    return { ok: result.ok, message: result.message };
  } catch (error) {
    console.error("[application-form-texts] saveApplicationFormTextsAction", error);
    return { ok: false, message: "Lỗi hệ thống. Thử lưu lại." };
  }
}
