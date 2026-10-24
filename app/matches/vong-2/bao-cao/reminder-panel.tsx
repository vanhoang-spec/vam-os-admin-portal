"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { sendRound2ReminderTestAction, sendRound2RemindersAction } from "@/app/actions/matching-round2";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";
import { Message, Submit } from "./dispatch-panel";
import { dailyEmailLimitNumber } from "@/lib/email-quota-core";

export type ReminderPanelProps = {
  window: "not_open" | "open" | "closed";
  eligible: number;
  remindedRecently: number;
  sentInWindow: number | null;
  allowance: number;
};

/**
 * Nhắc mentor chưa chọn mentee (BTC 16/10/2026). Danh sách người nhận được máy chủ tính lại ở lúc bấm
 * gửi — con số ở đây chỉ để BTC biết cỡ; ai chọn xong trong lúc đó sẽ không bị nhắc. Xác nhận bằng bước
 * thứ hai NGAY TRÊN TRANG, không dùng window.confirm() (trình duyệt tích hợp chặn hộp hỏi đó).
 */
export function Round2ReminderPanel(props: ReminderPanelProps) {
  const [testState, testAction] = useFormState(sendRound2ReminderTestAction, ROUND2_IDLE);
  const [sendState, sendAction] = useFormState(sendRound2RemindersAction, ROUND2_IDLE);
  const [confirming, setConfirming] = useState(false);
  const batch = Math.min(props.eligible, props.allowance);
  const blocked =
    props.window === "not_open"
      ? "Vòng 2 chưa mở — chưa nhắc được."
      : props.window === "closed"
        ? "Vòng 2 đã đóng — không gửi thư nhắc."
        : props.eligible === 0
          ? "Không có mentor nào cần nhắc lúc này: ai còn chỗ đều đã chọn mentee hoặc đã được nhắc trong 18 giờ qua."
          : props.allowance === 0
            ? props.sentInWindow === null
              ? "Không đếm được số thư đã gửi trong 24 giờ qua, nên tạm khoá nút gửi."
              : "Đã chạm phần hạn mức thư trong 24 giờ qua. Thử lại sau vài giờ."
            : null;

  return (
    <div className="grid gap-3 rounded-md border border-vam-line p-3" data-testid="round2-reminder">
      <div className="text-sm font-semibold text-vam-ink">3. Nhắc mentor chưa chọn mentee</div>
      <p className="text-sm text-slate-600">
        Sẽ nhắc: <strong>{props.eligible}</strong> mentor (đã nhận link mời, còn chỗ, chưa có cặp Vòng 2 nào, chưa được nhắc trong 18 giờ qua) · Đã được nhắc
        gần đây: <strong>{props.remindedRecently}</strong> · Thư cả hệ thống trong 24 giờ: {props.sentInWindow ?? "?"}/{dailyEmailLimitNumber()} · Mỗi lần bấm gửi tối đa{" "}
        {props.allowance} thư.
      </p>
      <p className="text-xs text-slate-500">
        Thư dùng đúng đường dẫn riêng đã gửi trước đó của từng mentor, giọng thân mật. Danh sách người nhận được tính lại lúc bấm gửi: ai đã chọn mentee
        trước đó thì không bị nhắc.
      </p>
      <form action={testAction} className="flex flex-wrap items-center gap-3">
        <Submit label="Gửi thử thư nhắc cho tôi" pendingLabel="Đang gửi thử…" />
        <Message state={testState} />
      </form>
      {blocked ? (
        <p className="text-sm text-amber-700">{blocked}</p>
      ) : confirming ? (
        <form action={sendAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="confirmed" value="yes" />
          <span className="text-sm text-vam-ink">Gửi {batch} thư nhắc tới mentor thật?</span>
          <Submit label="Xác nhận gửi" pendingLabel="Đang gửi…" />
          <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-vam-line px-3 py-2 text-sm text-slate-700">
            Huỷ
          </button>
        </form>
      ) : (
        <button
          type="button"
          data-testid="reminder-send"
          onClick={() => setConfirming(true)}
          className="self-start rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
        >
          Gửi thư nhắc (tối đa {batch} thư)
        </button>
      )}
      <Message state={sendState} />
    </div>
  );
}
