"use server";

import type { CustomFormSubmitResult } from "@/lib/custom-form-action-types";
import { submitPublicCustomForm } from "@/lib/custom-forms";

/**
 * Người điền bấm "Gửi" ở /f/<mã>. Mã form đi qua tham số đã bind ở trang; câu trả lời, ô đồng ý và ô
 * bẫy đến từ trình duyệt — là thứ người gửi tự đặt được, nên submitPublicCustomForm kiểm lại tất cả
 * theo định nghĩa trường đã lưu.
 */
export async function submitCustomFormAction(
  code: string,
  input: { values: Record<string, string | string[]>; consent: boolean; trap: string }
): Promise<CustomFormSubmitResult> {
  const safe = (input ?? {}) as Partial<typeof input>;
  return submitPublicCustomForm(String(code ?? ""), { values: safe.values, consent: safe.consent, trap: safe.trap });
}
