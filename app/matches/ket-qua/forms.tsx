"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import {
  addMatchResultHoldsAction,
  confirmMatchResultHoldsAction,
  removeMatchResultHoldAction,
  saveMatchResultSettingsAction
} from "@/app/actions/match-result";
import { Message, Submit } from "@/app/matches/vong-2/bao-cao/dispatch-panel";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";

const INPUT = "mt-1 block w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm";

export function MatchResultSettingsForm(props: {
  menteeHandbookUrl: string | null;
  mentorHandbookUrl: string | null;
  kickoffRegisterUrl: string | null;
}) {
  const [state, action] = useFormState(saveMatchResultSettingsAction, ROUND2_IDLE);
  return (
    <form action={action} className="grid gap-3" data-testid="match-result-settings">
      <label className="text-sm text-slate-600">
        Link Handbook cho mentee (bắt buộc trước khi gửi)
        <input name="menteeHandbookUrl" type="url" defaultValue={props.menteeHandbookUrl ?? ""} placeholder="https://" className={INPUT} />
      </label>
      <label className="text-sm text-slate-600">
        Link Handbook cho mentor (bắt buộc trước khi gửi)
        <input name="mentorHandbookUrl" type="url" defaultValue={props.mentorHandbookUrl ?? ""} placeholder="https://" className={INPUT} />
      </label>
      <label className="text-sm text-slate-600">
        Link đăng ký Kick-off 20/11 (để trống thì thư ghi “BTC sẽ cập nhật sau”)
        <input name="kickoffRegisterUrl" type="url" defaultValue={props.kickoffRegisterUrl ?? ""} placeholder="https://" className={INPUT} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Lưu link" pendingLabel="Đang lưu…" />
        <Message state={state} />
      </div>
    </form>
  );
}

export function AddHoldsForm() {
  const [state, action] = useFormState(addMatchResultHoldsAction, ROUND2_IDLE);
  return (
    <form action={action} className="grid gap-3" data-testid="match-result-add-holds">
      <label className="text-sm text-slate-600">
        Email mentor cần giữ lại (mỗi dòng một email, hoặc ngăn bằng dấu phẩy)
        <textarea name="emails" rows={5} className={INPUT} placeholder={"mentor1@example.com\nmentor2@example.com"} />
      </label>
      <label className="text-sm text-slate-600">
        Lý do (để trống = “Nhóm mentor cần tham gia Training 15/11 — BTC gửi thư riêng.”)
        <input name="reason" maxLength={300} className={INPUT} />
      </label>
      <p className="text-xs text-slate-500">
        Mỗi email phải khớp đúng một mentor đã duyệt mùa này. Có email không khớp thì không ghi email nào — sửa rồi dán lại.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Thêm vào danh sách giữ lại" pendingLabel="Đang kiểm…" />
        <Message state={state} />
      </div>
    </form>
  );
}

export function RemoveHoldButton({ mentorPersonId }: { mentorPersonId: string }) {
  const [state, action] = useFormState(removeMatchResultHoldAction, ROUND2_IDLE);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="mentorPersonId" value={mentorPersonId} />
      <button type="submit" className="rounded-md border border-vam-line px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
        Bỏ giữ
      </button>
      {state.status === "error" ? <Message state={state} /> : null}
    </form>
  );
}

/**
 * Chốt danh sách giữ lại. Bước thứ hai ngay trên trang, không dùng window.confirm() (trình duyệt tích
 * hợp chặn hộp hỏi đó, 02/10/2026). Form mang dấu của danh sách đang hiện: ai đó vừa đổi danh sách ở
 * tab khác thì máy chủ từ chối.
 */
export function ConfirmHoldsPanel({ fingerprint, count, confirmedLabel }: { fingerprint: string; count: number; confirmedLabel: string | null }) {
  const [state, action] = useFormState(confirmMatchResultHoldsAction, ROUND2_IDLE);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-2" data-testid="match-result-confirm-holds">
      <p className="text-sm text-slate-600">
        {confirmedLabel ? <>Đã xác nhận lúc {confirmedLabel}.</> : <strong className="text-amber-700">Chưa xác nhận.</strong>} Đổi danh sách thì phải
        xác nhận lại.
      </p>
      {confirming ? (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="confirmed" value="yes" />
          <input type="hidden" name="fingerprint" value={fingerprint} />
          <span className="text-sm text-vam-ink">Chốt danh sách {count} mentor giữ lại (cùng mentee của họ không nhận thư đợt này)?</span>
          <Submit label="Xác nhận danh sách" pendingLabel="Đang lưu…" />
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
          Xác nhận danh sách giữ lại
        </button>
      )}
      <Message state={state} />
    </div>
  );
}
