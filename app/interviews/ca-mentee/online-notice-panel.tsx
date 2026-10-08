"use client";

import { useState, useTransition } from "react";
import { useFormState } from "react-dom";
import { sendOnlineNoticesAction } from "@/app/actions/mentee-online-notice";
import type { OnlineSendResult } from "@/lib/mentee-online-notice";

export type OnlineNoticePanelProps = {
  total: number;
  pending: number;
  notified: number;
  sessionsWithoutLink: number;
  sentInWindow: number | null;
  allowance: number;
  preview: { subject: string; text: string } | null;
  canOperate: boolean;
};

/**
 * Báo cho mentee đang giữ ca online (chiều 10/10, BTC 08/10/2026) — xem
 * lib/mentee-online-notice.ts. Cùng khuôn với khung "Mở lại chọn ca": xác nhận bằng
 * bước thứ hai ngay trên trang, không dùng window.confirm() (trình duyệt tích hợp của
 * Claude chặn hộp hỏi đó và trả "Không").
 */
export function OnlineNoticePanel(props: OnlineNoticePanelProps) {
  const [state, action] = useFormState<OnlineSendResult | null, FormData>(sendOnlineNoticesAction, null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const batch = Math.min(props.pending, props.allowance);

  const blocked =
    props.pending === 0
      ? "Mọi bạn giữ ca online đã nhận thư."
      : props.allowance === 0
        ? props.sentInWindow === null
          ? "Không đếm được số thư đã gửi trong 24 giờ qua, nên tạm khoá nút gửi."
          : "Đã chạm phần hạn mức thư trong 24 giờ qua. Thử lại sau vài giờ."
        : null;

  const submit = (mode: "test" | "send") => {
    const fd = new FormData();
    fd.set("mode", mode);
    setConfirming(false);
    startTransition(() => action(fd));
  };

  return (
    <div className="grid gap-3 text-sm">
      <p>
        <strong className="tabular-nums">{props.total}</strong> bạn đang giữ ca phỏng vấn online. Thư báo ca chuyển sang
        online, kèm link nhóm Zalo (lấy từ địa điểm của ca) và đúng giờ ca của từng bạn.
      </p>
      {props.sessionsWithoutLink > 0 ? (
        <p className="text-amber-800">
          {props.sessionsWithoutLink} ca online chưa có link nhóm trong địa điểm — các bạn của những ca đó chưa được tính.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-vam-line bg-white px-3 py-2">
          <p className="text-xs uppercase text-slate-500">Chờ thư báo</p>
          <p className="text-xl font-semibold tabular-nums text-vam-ink" data-testid="online-pending">{props.pending}</p>
        </div>
        <div className="rounded-md border border-vam-line bg-white px-3 py-2">
          <p className="text-xs uppercase text-slate-500">Đã nhận thư báo</p>
          <p className="text-xl font-semibold tabular-nums text-vam-ink">{props.notified}</p>
        </div>
        <div className="rounded-md border border-vam-line bg-white px-3 py-2">
          <p className="text-xs uppercase text-slate-500">Mỗi lần bấm gửi tối đa</p>
          <p className="text-xl font-semibold tabular-nums text-vam-ink">{props.allowance}</p>
        </div>
      </div>

      {props.preview ? (
        <details className="rounded-md border border-vam-line bg-white px-3 py-2">
          <summary className="cursor-pointer font-medium">Xem thư mẫu</summary>
          <p className="mt-2 font-semibold">{props.preview.subject}</p>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{props.preview.text}</pre>
        </details>
      ) : null}

      {props.canOperate ? (
        <div className="grid gap-2">
          {blocked ? <p className="text-amber-800">{blocked}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pending || props.total === 0} onClick={() => submit("test")}
              className="rounded-md border border-vam-green px-4 py-2 text-vam-green disabled:opacity-50">
              Gửi thử cho tôi
            </button>
            {confirming ? (
              <span className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-2">
                <span>Gửi thư báo phỏng vấn online tới {batch} bạn?</span>
                <button type="button" disabled={pending} onClick={() => submit("send")}
                  className="rounded-md bg-vam-green px-3 py-2 text-white disabled:opacity-50">
                  {pending ? "Đang gửi…" : "Xác nhận gửi"}
                </button>
                <button type="button" className="rounded-md border px-3 py-2" onClick={() => setConfirming(false)}>Huỷ</button>
              </span>
            ) : (
              <button type="button" disabled={pending || Boolean(blocked)} onClick={() => setConfirming(true)}
                className="rounded-md bg-vam-green px-4 py-2 text-white disabled:opacity-50">
                Gửi thư cho {batch} bạn
              </button>
            )}
          </div>
        </div>
      ) : null}

      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-vam-green" : "text-red-700"}>{state.message}</p>
      ) : null}
    </div>
  );
}
