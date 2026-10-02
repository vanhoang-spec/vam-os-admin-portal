"use server";

import { revalidatePath } from "next/cache";
import { correctEmailAndResendMenteeInvite, type ResendResult } from "@/lib/mentee-invite-resend";

export async function correctEmailAndResendMenteeInviteAction(_prev: ResendResult | null, formData: FormData): Promise<ResendResult> {
  try {
    const applicationId = String(formData.get("application_id") ?? "");
    const result = await correctEmailAndResendMenteeInvite({
      applicationId,
      newEmail: formData.get("new_email"),
      expectedEmail: formData.get("expected_email")
    });
    if (result.ok) revalidatePath(`/applications/${applicationId}`);
    return result;
  } catch (error) {
    console.error("[correctEmailAndResendMenteeInviteAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Vui lòng thử lại." };
  }
}
