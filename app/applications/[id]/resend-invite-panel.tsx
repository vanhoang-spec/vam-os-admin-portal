"use client";

import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { correctEmailAndResendMenteeInviteAction } from "@/app/actions/mentee-invite-resend";
import type { ResendResult } from "@/lib/mentee-invite-resend";

function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className="rounded-md bg-vam-green px-4 py-2 text-sm text-white disabled:opacity-50">
      {pending ? "Đang gửi…" : label}
    </button>
  );
}

/**
 * Sửa email + gửi lại thư mời chọn ca cho MỘT ứng viên mentee.
 *
 * Xác nhận bằng bước thứ hai NGAY TRÊN TRANG, không dùng window.confirm():
 * trình duyệt tích hợp của Claude chặn hộp hỏi đó và trả "Không", làm nút bấm
 * không có tác dụng (02/10/2026).
 */
export function ResendInvitePanel({ applicationId, currentEmail }: { applicationId: string; currentEmail: string }) {
  const [state, action] = useFormState<ResendResult | null, FormData>(correctEmailAndResendMenteeInviteAction, null);
  const [email, setEmail] = useState(currentEmail);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = email.trim().toLowerCase() !== currentEmail.trim().toLowerCase();
  const label = changed ? `Sửa email thành ${email.trim()} và gửi lại thư mời` : `Gửi lại thư mời tới ${currentEmail}`;

  return (
    <form
      className="grid gap-2 text-sm"
      onSubmit={(e) => {
        // onSubmit + startTransition thay cho action={hàm}: chạy được cả trên bản React
        // Next đóng gói lẫn bản React 18.3.1 ổn định mà vitest dùng.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setConfirming(false);
        startTransition(() => action(fd));
      }}
    >
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="expected_email" value={currentEmail} />
      <p>Email hiện tại: <strong>{currentEmail || "—"}</strong></p>
      <label htmlFor="new_email" className="font-medium">Email đúng của ứng viên</label>
      <input id="new_email" name="new_email" type="email" required value={email}
        onChange={(e) => { setEmail(e.target.value); setConfirming(false); }}
        className="w-full rounded-md border border-slate-300 bg-white p-2" />
      <p className="text-xs text-slate-500">Thư mời dùng lại đúng link đặt ca đã cấp. Mọi thư sau này (xác nhận ca, nhắc lịch) cũng đi tới email này.</p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2">
          <span>{label}?</span>
          <SubmitButton label="Xác nhận gửi" pending={pending} />
          <button type="button" className="rounded-md border px-3 py-2" onClick={() => setConfirming(false)}>Huỷ</button>
        </div>
      ) : (
        <button type="button" className="w-fit rounded-md border border-vam-green px-4 py-2 text-vam-green" onClick={() => setConfirming(true)}>
          {changed ? "Sửa email & gửi lại thư mời chọn ca" : "Gửi lại thư mời chọn ca"}
        </button>
      )}
      {state ? <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-vam-green" : "text-red-700"}>{state.message}</p> : null}
    </form>
  );
}
