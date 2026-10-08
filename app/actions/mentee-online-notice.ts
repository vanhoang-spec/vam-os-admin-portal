"use server";

import { revalidatePath } from "next/cache";
import { sendOnlineNotices, sendOnlineNoticeTest, type OnlineSendResult } from "@/lib/mentee-online-notice";

const PATH = "/interviews/ca-mentee";

/** Quyền kiểm trong lib/mentee-online-notice.ts (requireBtc) — action chỉ gọi xuống. */
export async function sendOnlineNoticesAction(_prev: OnlineSendResult | null, formData: FormData): Promise<OnlineSendResult> {
  try {
    const result = formData.get("mode") === "test" ? await sendOnlineNoticeTest() : await sendOnlineNotices();
    revalidatePath(PATH);
    return result;
  } catch (error) {
    console.error("[sendOnlineNoticesAction]", error);
    return { ok: false, message: "Lỗi hệ thống. Tải lại trang để xem đã gửi được bao nhiêu thư.", sent: 0, failed: 0 };
  }
}
