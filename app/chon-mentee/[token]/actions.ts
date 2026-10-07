"use server";

import { revalidatePath } from "next/cache";
import { pickRound2Mentee, unpickRound2Match } from "@/lib/matching-round2-link";
import { MENTOR_PICK_PATH_PREFIX } from "@/lib/matching-round2-link-core";
import type { Round2PickState } from "@/lib/matching-round2-action-types";

/**
 * Mentor chọn một mentee. Token đi qua tham số đã bind ở trang, KHÔNG qua ô ẩn trong
 * biểu mẫu: cái đến từ biểu mẫu là thứ người gửi tự đặt được. Mã đơn mentee thì đến từ
 * biểu mẫu — vam113_round2_pick tự kiểm cùng nhóm, còn trống, còn chỗ.
 */
export async function pickMenteeAction(token: string, _prev: Round2PickState, formData: FormData): Promise<Round2PickState> {
  const result = await pickRound2Mentee({ token, menteeApplicationId: String(formData.get("menteeApplicationId") ?? "") });
  revalidatePath(`${MENTOR_PICK_PATH_PREFIX}/${token}`);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

export async function unpickMenteeAction(token: string, _prev: Round2PickState, formData: FormData): Promise<Round2PickState> {
  const result = await unpickRound2Match({ token, matchId: String(formData.get("matchId") ?? "") });
  revalidatePath(`${MENTOR_PICK_PATH_PREFIX}/${token}`);
  return { status: result.ok ? "ok" : "error", message: result.message };
}
