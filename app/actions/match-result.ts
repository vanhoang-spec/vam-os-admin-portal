"use server";

import { revalidatePath } from "next/cache";
import { addMatchResultHolds, confirmMatchResultHolds, removeMatchResultHold, saveMatchResultSettings } from "@/lib/match-result";
import type { Round2ActionState } from "@/lib/matching-round2-action-types";

const PATH = "/matches/ket-qua";

function state(result: { ok: boolean; message: string }): Round2ActionState {
  if (result.ok) revalidatePath(PATH);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

/** Ba link trong thư. Mọi ô do người gửi tự đặt được: máy chủ kiểm lại https và quyền. */
export async function saveMatchResultSettingsAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  return state(
    await saveMatchResultSettings({
      menteeHandbookUrl: form.get("menteeHandbookUrl"),
      mentorHandbookUrl: form.get("mentorHandbookUrl"),
      kickoffRegisterUrl: form.get("kickoffRegisterUrl")
    })
  );
}

export async function addMatchResultHoldsAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  return state(await addMatchResultHolds({ text: form.get("emails"), reason: form.get("reason") }));
}

export async function removeMatchResultHoldAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  return state(await removeMatchResultHold({ mentorPersonId: form.get("mentorPersonId") }));
}

/** Chốt danh sách giữ lại. Chỉ chạy khi form mang dấu của bước xác nhận thứ hai trên trang. */
export async function confirmMatchResultHoldsAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  if (form.get("confirmed") !== "yes") return { status: "error", message: "Cần bấm xác nhận trước." };
  return state(await confirmMatchResultHolds({ fingerprint: form.get("fingerprint") }));
}
