"use server";

import { revalidatePath } from "next/cache";
import {
  getRound2AvailableIds,
  getRound2MenteeDetail,
  getRound2WindowCards,
  pickRound2Mentee,
  swapRound2Window,
  unpickRound2Match,
  type Round2SwapResult,
  type Round2WindowView
} from "@/lib/matching-round2-link";
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

/**
 * Danh sách 15 hồ sơ mới nhất của mentor — trang gọi khi phát hiện một bạn trong danh sách vừa được
 * người khác chọn, để bù hồ sơ khác vào (BTC 14/10/2026). Chỉ tải 15 thẻ, không tải lại cả trang.
 */
export async function windowCardsAction(token: string): Promise<({ ok: true } & Round2WindowView) | { ok: false }> {
  return getRound2WindowCards(String(token ?? ""));
}

export async function menteeDetailAction(
  token: string,
  applicationId: string
): Promise<{ ok: true; texts: Array<[string, string]>; viewed: boolean } | { ok: false; message: string }> {
  return getRound2MenteeDetail(String(token ?? ""), String(applicationId ?? ""));
}

/**
 * "Đổi 15 hồ sơ khác" (BTC 15/10/2026). Máy chủ tự kiểm mentor đã xem chi tiết hết danh sách — nút
 * chỉ hiện trên trang khi đã xem hết, nhưng cái trình duyệt gửi lên là thứ người gửi tự đặt được.
 */
export async function swapWindowAction(token: string): Promise<Round2SwapResult> {
  return swapRound2Window(String(token ?? ""));
}
