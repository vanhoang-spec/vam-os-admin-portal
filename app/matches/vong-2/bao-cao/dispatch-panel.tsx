"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { VietnamDateTimeField } from "@/app/events/vietnam-datetime-field";
import { sendRound2InvitesAction, sendRound2TestAction, setRound2WindowAction } from "@/app/actions/matching-round2";
import { ROUND2_IDLE, type Round2ActionState } from "@/lib/matching-round2-action-types";

export type DispatchPanelProps = {
  window: "not_open" | "open" | "closed";
  opensAt: string | null;
  closesAt: string | null;
  wave: number;
  pending: number;
  sentThisWave: number;
  sentInWindow: number | null;
  allowance: number;
  windowLabel: string;
};

function Message({ state }: { state: Round2ActionState }) {
  if (state.status === "idle") return null;
  return (
    <p role="status" className={`text-sm ${state.status === "ok" ? "text-green-700" : "text-red-600"}`}>
      {state.message}
    </p>
  );
}

function Submit({ label, pendingLabel, disabled }: { label: string; pendingLabel: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Mở vòng 2 và gửi link chọn mentee. Xác nhận gửi bằng bước thứ hai NGAY TRÊN TRANG,
 * không dùng window.confirm() (trình duyệt tích hợp chặn hộp hỏi đó, 02/10/2026).
 */
export function Round2DispatchPanel(props: DispatchPanelProps) {
  const [windowState, windowAction] = useFormState(setRound2WindowAction, ROUND2_IDLE);
  const [testState, testAction] = useFormState(sendRound2TestAction, ROUND2_IDLE);
  const [sendState, sendAction] = useFormState(sendRound2InvitesAction, ROUND2_IDLE);
  const [confirming, setConfirming] = useState(false);
  const batch = Math.min(props.pending, props.allowance);
  const blocked =
    props.window !== "open"
      ? props.window === "closed"
        ? "Vòng 2 đã đóng — không gửi link."
        : "Vòng 2 chưa mở — đặt giờ mở (và chờ tới giờ) trước khi gửi."
      : props.pending === 0
        ? `Không còn mentor nào chờ thư của đợt ${props.wave}.`
        : props.allowance === 0
          ? props.sentInWindow === null
            ? "Không đếm được số thư đã gửi trong 24 giờ qua, nên tạm khoá nút gửi."
            : "Đã chạm phần hạn mức thư trong 24 giờ qua. Thử lại sau vài giờ."
          : null;

  return (
    <div className="grid gap-4" data-testid="round2-dispatch">
      <form action={windowAction} className="grid gap-3 rounded-md border border-vam-line p-3">
        <div className="text-sm font-semibold text-vam-ink">1. Giờ mở / đóng vòng 2 · {props.windowLabel}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <VietnamDateTimeField name="opensAt" label="Mở lúc (giờ Việt Nam)" defaultValue={props.opensAt} required />
          <VietnamDateTimeField name="closesAt" label="Đóng lúc (để trống = chưa định)" defaultValue={props.closesAt} />
        </div>
        <label className="text-sm text-slate-600">
          Đợt gửi thư
          <select name="wave" defaultValue={String(props.wave)} className="mt-1 block rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm">
            <option value="1">Đợt 1 — mời mọi mentor còn chỗ</option>
            <option value="2">Đợt 2 — mentor còn chỗ sau đợt phỏng vấn sau</option>
            <option value="3">Đợt 3</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Submit label="Lưu giờ và đợt" pendingLabel="Đang lưu…" />
          <Message state={windowState} />
        </div>
      </form>

      <div className="grid gap-3 rounded-md border border-vam-line p-3">
        <div className="text-sm font-semibold text-vam-ink">2. Gửi link chọn mentee — đợt {props.wave}</div>
        <p className="text-sm text-slate-600">
          Chờ thư: <strong>{props.pending}</strong> mentor · Đã nhận thư đợt này: <strong>{props.sentThisWave}</strong> · Thư cả hệ thống trong 24 giờ:{" "}
          {props.sentInWindow ?? "?"}/1.000 · Mỗi lần bấm gửi tối đa {props.allowance} thư.
        </p>
        <form action={testAction} className="flex flex-wrap items-center gap-3">
          <Submit label="Gửi thử cho tôi" pendingLabel="Đang gửi thử…" />
          <Message state={testState} />
        </form>
        {blocked ? (
          <p className="text-sm text-amber-700">{blocked}</p>
        ) : confirming ? (
          <form action={sendAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="confirmed" value="yes" />
            <span className="text-sm text-vam-ink">Gửi {batch} thư mời chọn mentee tới mentor thật?</span>
            <Submit label="Xác nhận gửi" pendingLabel="Đang gửi…" />
            <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-vam-line px-3 py-2 text-sm text-slate-700">
              Huỷ
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="self-start rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Gửi link chọn mentee (tối đa {batch} thư)
          </button>
        )}
        <Message state={sendState} />
      </div>
    </div>
  );
}
