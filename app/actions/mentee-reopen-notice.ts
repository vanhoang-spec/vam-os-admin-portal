"use server";

import { revalidatePath } from "next/cache";
import { sendReopenNotices, sendReopenNoticeTest, type ReopenSendResult } from "@/lib/mentee-reopen-notice";

const PATH = "/interviews/ca-mentee";

/** Quyền kiểm trong lib/mentee-reopen-notice.ts (requireBtc) — action chỉ gọi xuống. */
export async function sendReopenNoticesAction(_prev: ReopenSendResult | null, formData: FormData): Promise<ReopenSendResult> {
  try {
    const result = formData.get("mode") === "test" ? await sendReopenNoticeTest() : await sendReopenNotices();
    revalidatePath(PATH);
    return result;
  } catch (error) {
    console.error("[sendReopenNoticesAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Tải lại trang để xem đã gửi được bao nhiêu thư.", sent: 0, failed: 0 };
  }
}
