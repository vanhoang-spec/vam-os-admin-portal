"use server";

import { revalidatePath } from "next/cache";
import { getRound2AvailableIds, getRound2MenteeDetail, pickRound2Mentee, unpickRound2Match } from "@/lib/matching-round2-link";
import { MENTOR_PICK_PATH_PREFIX } from "@/lib/matching-round2-link-core";
import type { Round2PickState } from "@/lib/matching-round2-action-types";

/**
 * Mentor chọn một mentee. Token đi qua tham số đã bind ở trang, KHÔNG qua ô ẩn trong
 * biểu mẫu: cái đến từ biểu mẫu là thứ người gửi tự đặt được. Mã đơn mentee thì đến từ
 * biểu mẫu — vam113_round2_pick tự kiểm cùng cụm, còn trống, còn chỗ.
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

/**
 * Trang tự gọi mỗi 20 giây để ẩn bạn vừa được mentor khác chọn. Chỉ trả mã đơn, không làm mới
 * trang: tải lại cả trang cho hàng trăm mentor cùng lúc là kiểu đọc đã làm sập database ngày 11/10.
 * Token và mã đơn đều đến từ trình duyệt — máy chủ và database kiểm lại cả hai.
 */
export async function availableMenteesAction(token: string): Promise<{ ok: boolean; ids: string[] }> {
  const ids = await getRound2AvailableIds(String(token ?? ""));
  return ids === null ? { ok: false, ids: [] } : { ok: true, ids };
}

export async function menteeDetailAction(
  token: string,
  applicationId: string
): Promise<{ ok: true; texts: Array<[string, string]> } | { ok: false; message: string }> {
  return getRound2MenteeDetail(String(token ?? ""), String(applicationId ?? ""));
}
