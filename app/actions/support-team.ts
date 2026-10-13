"use server";

import { revalidatePath } from "next/cache";
import { markSupportTeam } from "@/lib/support-team-mark";
import { SUPPORT_TEAM_NOT_TICKED_MESSAGE, type SupportTeamActionState } from "@/lib/support-team-mark-core";

/**
 * Lưu việc tích "Support team" của một người. Mã người đi qua `.bind` ở phía máy chủ dựng trang,
 * không nằm trong ô ẩn — nhưng vẫn chỉ là thứ người gửi đặt được, nên quyền và dữ liệu đều do
 * markSupportTeam + RPC kiểm lại.
 *
 * Ô tích phải có mặt trong yêu cầu: bấm Lưu mà không tích thì KHÔNG làm gì (không có lệnh "bỏ tích";
 * muốn ngừng làm mentee thì đổi tư cách ở phần "Trạng thái tham gia").
 */
export async function markSupportTeamAction(
  personId: string,
  _previous: SupportTeamActionState,
  formData: FormData
): Promise<SupportTeamActionState> {
  if (formData.get("support_team") !== "on") {
    return { status: "error", message: SUPPORT_TEAM_NOT_TICKED_MESSAGE };
  }
  const result = await markSupportTeam({ personId });
  if (result.ok) {
    // Người này vừa thành mentee của mùa: hồ sơ, danh sách mentee, ghép cặp, Vòng 2 và trang đặc cách đều phải đọc lại.
    for (const path of [`/people/${personId}`, "/mentees", "/matches", "/matches/vong-2", "/matches/vong-2/bao-cao", "/applications/mentee-dac-cach"]) {
      revalidatePath(path);
    }
  }
  return { status: result.ok ? "ok" : "error", message: result.message };
}
