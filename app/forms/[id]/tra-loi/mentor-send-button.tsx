"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendPendingMentorForwardsAction } from "@/app/forms/actions";
import type { CustomFormAdminResult } from "@/lib/custom-form-action-types";

/** Cùng nếp với các nút của trình tạo form. Khoá nút trong lúc chạy để bấm hai lần không thành hai lượt song song. */
export function MentorSendButton({ formId }: { formId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CustomFormAdminResult | null>(null);
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await sendPendingMentorForwardsAction(formId));
      router.refresh();
    } catch {
      setResult({ ok: false, message: "Chưa gửi được — kiểm tra kết nối mạng rồi thử lại." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <button
        type="button"
        data-testid="mentor-send-pending"
        disabled={busy}
        onClick={() => void send()}
        className="w-fit rounded-md border border-vam-green px-4 py-2 text-sm font-semibold text-vam-green hover:bg-vam-mint/40 disabled:opacity-50"
      >
        {busy ? "Đang gửi…" : "Gửi các bản đang chờ"}
      </button>
      {result ? (
        <p role="status" data-testid="mentor-send-result" className={result.ok ? "text-sm text-vam-green" : "text-sm text-red-700"}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
