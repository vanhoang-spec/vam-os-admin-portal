"use client";

import { useFormState, useFormStatus } from "react-dom";
import { confirmMenteeExemptionAction } from "./actions";
import { EXEMPTION_IDLE } from "@/lib/mentee-exemption-action-types";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-vam-green px-5 py-3 text-base font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60 sm:w-auto"
    >
      {pending ? "Đang ghi nhận…" : "Xác nhận tham gia"}
    </button>
  );
}

/**
 * Một nút, một lần bấm — đúng lời BTC: "các bạn bấm xác nhận là xong".
 *
 * Không có bước hỏi lại: việc này không làm mất gì của ai, và người nhận đã phải mở thư rồi
 * mở trang mới tới được đây. Xác nhận KHÔNG chạy khi mở trang (GET) — nhiều hộp thư tự mở
 * trước mọi đường dẫn trong thư để quét, và một lần quét không được biến ai thành mentee.
 */
export function ConfirmForm({ token }: { token: string }) {
  const [state, action] = useFormState(confirmMenteeExemptionAction.bind(null, token), EXEMPTION_IDLE);
  if (state.status === "ok") {
    return (
      <p role="status" data-testid="confirm-done" className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-3" data-testid="confirm-form">
      <Submit />
      {state.status === "error" ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
