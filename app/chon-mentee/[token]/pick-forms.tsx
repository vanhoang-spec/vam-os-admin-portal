"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { pickMenteeAction, unpickMenteeAction } from "./actions";
import { ROUND2_PICK_IDLE } from "@/lib/matching-round2-action-types";

function Status({ status, message }: { status: string; message: string }) {
  if (status === "idle") return null;
  return (
    <p role="status" className={`text-sm ${status === "ok" ? "text-green-700" : "text-red-600"}`}>
      {message}
    </p>
  );
}

function Submit({ label, pendingLabel, tone = "primary" }: { label: string; pendingLabel: string; tone?: "primary" | "plain" }) {
  const { pending } = useFormStatus();
  const cls =
    tone === "primary"
      ? "bg-vam-green text-white hover:bg-vam-green/90"
      : "border border-vam-line bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button type="submit" disabled={pending} className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${cls}`}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Nút Chọn hai bước NGAY TRÊN TRANG (không window.confirm — trình duyệt tích hợp chặn hộp
 * hỏi đó). Bước một chỉ mở xác nhận; bước hai mới gửi.
 */
export function PickButton({ token, applicationId, menteeName }: { token: string; applicationId: string; menteeName: string }) {
  const [state, action] = useFormState(pickMenteeAction.bind(null, token), ROUND2_PICK_IDLE);
  const [confirming, setConfirming] = useState(false);
  if (state.status === "ok") return <Status status={state.status} message={state.message} />;
  return (
    <div className="flex flex-col gap-2" data-testid="pick-button">
      {confirming ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="menteeApplicationId" value={applicationId} />
          <span className="text-sm text-vam-ink">Chọn {menteeName} làm mentee của anh/chị?</span>
          <Submit label="Xác nhận chọn" pendingLabel="Đang lưu…" />
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
          Chọn bạn này
        </button>
      )}
      <Status status={state.status} message={state.message} />
    </div>
  );
}

export function UnpickButton({ token, matchId, minutesLeft }: { token: string; matchId: string; minutesLeft: number }) {
  const [state, action] = useFormState(unpickMenteeAction.bind(null, token), ROUND2_PICK_IDLE);
  const [confirming, setConfirming] = useState(false);
  if (state.status === "ok") return <Status status={state.status} message={state.message} />;
  return (
    <div className="flex flex-col gap-1" data-testid="unpick-button">
      {confirming ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="matchId" value={matchId} />
          <Submit label="Xác nhận bỏ chọn" pendingLabel="Đang bỏ…" tone="plain" />
          <button type="button" onClick={() => setConfirming(false)} className="text-sm text-slate-600">
            Giữ lại
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="self-start text-sm font-medium text-red-600">
          Bỏ chọn (còn {minutesLeft} phút)
        </button>
      )}
      <Status status={state.status} message={state.message} />
    </div>
  );
}
