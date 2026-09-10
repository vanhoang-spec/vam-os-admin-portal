"use server";

import { revalidatePath } from "next/cache";
import { inviteParticipant } from "@/lib/participant-invites";
import type { ParticipantInviteState } from "@/lib/participant-action-types";

/**
 * Gửi lời mời lập tài khoản cho một người trong danh bạ.
 *
 * Cổng quyền nằm trong `inviteParticipant` chứ không ở đây: hàm đó là chỗ duy
 * nhất gửi được lời mời, nên nó phải tự gác cửa cho mình. Một cổng đặt ở lớp
 * hành động sẽ vắng mặt vào ngày có chỗ thứ hai gọi thẳng vào hàm.
 */
export async function inviteParticipantAction(
  _previousState: ParticipantInviteState,
  formData: FormData
): Promise<ParticipantInviteState> {
  try {
    const result = await inviteParticipant({
      personId: String(formData.get("person_id") ?? "")
    });

    if (result.ok) revalidatePath("/admin/participants");
    return { ok: result.ok, message: result.message };
  } catch (error) {
    console.error("[inviteParticipantAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}
