"use server";

import { revalidatePath } from "next/cache";
import { addMatchResultHolds, confirmMatchResultHolds, removeMatchResultHold, saveMatchResultSettings } from "@/lib/match-result";
import { resendMatchResultNotice, runMatchResultDispatch, sendMatchResultGroupTest, sendMatchResultTest } from "@/lib/match-result-dispatch";
import type { MatchResultBatchResult } from "@/lib/match-result-action-types";
import { parseSkipKeys } from "@/lib/match-result-core";
import type { Round2ActionState } from "@/lib/matching-round2-action-types";

const PATH = "/matches/ket-qua";

function state(result: { ok: boolean; message: string }): Round2ActionState {
  if (result.ok) revalidatePath(PATH);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

/** Link đăng ký Kick-off. Ô do người gửi tự đặt được: máy chủ kiểm lại https và quyền. */
export async function saveMatchResultSettingsAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  return state(
    await saveMatchResultSettings({ kickoffRegisterUrl: form.get("kickoffRegisterUrl") })
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

/** Gửi thử bản mentee và bản mentor cho chính người bấm. */
export async function sendMatchResultTestAction(_prev: Round2ActionState, _form: FormData): Promise<Round2ActionState> {
  const result = await sendMatchResultTest();
  return { status: result.ok ? "ok" : "error", message: result.message };
}

/** Gửi thật một lô (trọn từng nhóm mentor). Chỉ chạy khi form mang dấu của bước xác nhận thứ hai. */
export async function sendMatchResultAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  if (form.get("confirmed") !== "yes") return { status: "error", message: "Cần bấm xác nhận trước khi gửi." };
  const result = await runMatchResultDispatch();
  revalidatePath(PATH);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

/** Gửi riêng / gửi lại một người. Mã link mới — link trong thư trước của người đó hết hiệu lực. */
export async function resendMatchResultAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  if (form.get("confirmed") !== "yes") return { status: "error", message: "Cần bấm xác nhận trước khi gửi." };
  const result = await resendMatchResultNotice({ personId: form.get("personId"), role: form.get("role") });
  revalidatePath(PATH);
  return { status: result.ok ? "ok" : "error", message: result.message };
}

/** Gửi thử thư thật của một nhóm mentor tới người bấm hoặc một tài khoản nhân sự. Không gửi tới mentor/mentee. */
export async function sendMatchResultGroupTestAction(_prev: Round2ActionState, form: FormData): Promise<Round2ActionState> {
  const result = await sendMatchResultGroupTest({ mentor: form.get("mentor"), toEmail: form.get("toEmail") });
  return { status: result.ok ? "ok" : "error", message: result.message };
}

/**
 * Một vòng của chế độ gửi liên tục: trang gọi lại hàm này tới khi `more` = false. Chỉ chạy khi trang gửi
 * kèm dấu đã qua bước xác nhận; quyền, hạn mức và cách chia lô do máy chủ tự kiểm ở mỗi vòng.
 */
export async function sendMatchResultBatchAction(input: { confirmed?: unknown; skip?: unknown }): Promise<MatchResultBatchResult> {
  if (input?.confirmed !== true) {
    return { ok: false, message: "Cần bấm xác nhận trước khi gửi.", sent: 0, failed: 0, left: 0, failedKeys: [], more: false };
  }
  const result = await runMatchResultDispatch({ skip: parseSkipKeys(input.skip) });
  return {
    ok: result.ok,
    message: result.message,
    sent: result.sent,
    failed: result.failed,
    left: result.left ?? 0,
    failedKeys: result.failedKeys ?? [],
    more: result.ok && result.more === true
  };
}
