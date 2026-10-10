"use server";

import { revalidatePath } from "next/cache";
import { setMentorCapacity } from "@/lib/mentor-capacity-admin";

export type MentorCapacityActionState = { status: "idle" | "ok" | "error"; message: string | null };

/**
 * Lưu số mentee tối đa của một mentor. Mã người đi qua `.bind` ở phía máy chủ dựng
 * trang, không nằm trong ô ẩn — nhưng vẫn chỉ là thứ người gửi đặt được, nên quyền và
 * dữ liệu đều do setMentorCapacity + RPC kiểm lại.
 */
export async function setMentorCapacityAction(
  personId: string,
  _previous: MentorCapacityActionState,
  formData: FormData
): Promise<MentorCapacityActionState> {
  const result = await setMentorCapacity({
    personId,
    expected: formData.get("expected"),
    capacity: formData.get("capacity")
  });
  if (result.ok) {
    // Trần đổi thì mọi nơi đếm chỗ phải đọc lại: hồ sơ, danh sách mentor, ghép cặp, Vòng 2.
    for (const path of [`/people/${personId}`, "/mentors", "/matches", "/matches/vong-2", "/matches/vong-2/bao-cao"]) {
      revalidatePath(path);
    }
  }
  return { status: result.ok ? "ok" : "error", message: result.message };
}
