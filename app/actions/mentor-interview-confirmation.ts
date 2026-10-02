"use server";

import { revalidatePath } from "next/cache";
import {
  grantInterviewAccessFromSheet,
  previewMentorConfirmations,
  sendMentorConfirmations,
  sendMentorConfirmationTest,
  type GrantResult,
  type PreviewResult,
  type SendResult
} from "@/lib/mentor-interview-confirmation";

export async function previewMentorConfirmationsAction(_prev: PreviewResult | null, formData: FormData): Promise<PreviewResult> {
  try {
    return await previewMentorConfirmations(formData.get("sheet_link"));
  } catch (error) {
    console.error("[previewMentorConfirmationsAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}

export async function sendMentorConfirmationTestAction(sheetLink: string): Promise<{ ok: boolean; message: string }> {
  try {
    return await sendMentorConfirmationTest(sheetLink);
  } catch (error) {
    console.error("[sendMentorConfirmationTestAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}

export async function sendMentorConfirmationsAction(sheetLink: string, typedCount: string): Promise<SendResult> {
  try {
    const result = await sendMentorConfirmations(sheetLink, typedCount);
    revalidatePath("/operations/emails");
    return result;
  } catch (error) {
    console.error("[sendMentorConfirmationsAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại.", sent: 0, failed: [], remaining: 0 };
  }
}

export async function grantInterviewAccessAction(sheetLink: string): Promise<GrantResult> {
  try {
    const result = await grantInterviewAccessFromSheet(sheetLink);
    revalidatePath("/reviews/reviewer-pool");
    return result;
  } catch (error) {
    console.error("[grantInterviewAccessAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại.", granted: [], failed: [], notMentor: [], remaining: 0 };
  }
}
