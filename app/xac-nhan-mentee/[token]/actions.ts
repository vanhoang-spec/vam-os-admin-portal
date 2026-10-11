"use server";

import { revalidatePath } from "next/cache";
import { confirmMenteeExemption } from "@/lib/mentee-exemption";
import { MENTEE_EXEMPTION_PATH, type ExemptionActionState } from "@/lib/mentee-exemption-action-types";
import { MENTEE_CONFIRM_PATH_PREFIX } from "@/lib/mentee-exemption-core";

/**
 * Người nhận bấm "Xác nhận tham gia". Token đi qua tham số đã bind ở trang, KHÔNG qua ô ẩn
 * trong biểu mẫu: cái đến từ biểu mẫu là thứ người gửi tự đặt được. Biểu mẫu không mang ô
 * nào cả — một lần bấm là toàn bộ câu trả lời; vam117_confirm_mentee_exemption tự kiểm link
 * còn hiệu lực và hồ sơ còn hợp lệ.
 */
export async function confirmMenteeExemptionAction(token: string, _prev: ExemptionActionState, _formData: FormData): Promise<ExemptionActionState> {
  const result = await confirmMenteeExemption(token);
  revalidatePath(`${MENTEE_CONFIRM_PATH_PREFIX}/${token}`);
  // Màn hình của BTC và số liệu Vòng 2 đổi theo: thêm một mentee đã duyệt.
  for (const path of [MENTEE_EXEMPTION_PATH, "/matches/vong-2", "/matches/vong-2/bao-cao"]) revalidatePath(path);
  return { status: result.ok ? "ok" : "error", message: result.message };
}
