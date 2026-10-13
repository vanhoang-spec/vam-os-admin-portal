"use server";

import { revalidatePath } from "next/cache";
import {
  addMenteeExemptions,
  revokeMenteeExemption,
  runMenteeExemptionDispatch,
  sendMenteeExemptionTest
} from "@/lib/mentee-exemption";
import { MENTEE_EXEMPTION_PATH, type ExemptionActionState } from "@/lib/mentee-exemption-action-types";

/**
 * Server action của màn hình "Mentee đặc cách (Support team)".
 *
 * Mọi ô trong biểu mẫu là thứ người gửi tự đặt được: ở đây chỉ kiểm hình dạng và dấu xác
 * nhận của bước hai; quyền do lib/mentee-exemption.ts kiểm, luật do database kiểm.
 */

// Người vừa xác nhận / vừa được thêm đổi cả số liệu của Vòng 2 (báo cáo đọc đơn đã duyệt).
const PATHS = [MENTEE_EXEMPTION_PATH, "/matches/vong-2", "/matches/vong-2/bao-cao"];

function done(result: { ok: boolean; message: string }): ExemptionActionState {
  return { status: result.ok ? "ok" : "error", message: result.message };
}

export async function addMenteeExemptionsAction(_prev: ExemptionActionState, formData: FormData): Promise<ExemptionActionState> {
  const personIds = formData.getAll("personId").map((value) => String(value));
  const result = await addMenteeExemptions(personIds);
  for (const path of PATHS) revalidatePath(path);
  return done(result);
}

/** Gỡ một người. Chỉ chạy khi form mang đúng dấu xác nhận của bước thứ hai trên trang. */
export async function revokeMenteeExemptionAction(_prev: ExemptionActionState, formData: FormData): Promise<ExemptionActionState> {
  if (formData.get("confirmed") !== "yes") return { status: "error", message: "Cần bấm xác nhận trước khi gỡ." };
  const result = await revokeMenteeExemption(String(formData.get("exemptionId") ?? "").trim());
  for (const path of PATHS) revalidatePath(path);
  return done(result);
}

export async function sendMenteeExemptionTestAction(_prev: ExemptionActionState, _formData: FormData): Promise<ExemptionActionState> {
  return done(await sendMenteeExemptionTest());
}

/** Gửi thật. Chỉ chạy khi form mang đúng dấu xác nhận của bước thứ hai trên trang. */
export async function sendMenteeExemptionInvitesAction(_prev: ExemptionActionState, formData: FormData): Promise<ExemptionActionState> {
  if (formData.get("confirmed") !== "yes") return { status: "error", message: "Cần bấm xác nhận trước khi gửi." };
  const result = await runMenteeExemptionDispatch();
  for (const path of PATHS) revalidatePath(path);
  return done(result);
}
