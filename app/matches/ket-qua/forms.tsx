"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import {
  addMatchResultHoldsAction,
  confirmMatchResultHoldsAction,
  removeMatchResultHoldAction,
  resendMatchResultAction,
  saveMatchResultSettingsAction,
  sendMatchResultAction,
  sendMatchResultGroupTestAction,
  sendMatchResultTestAction
} from "@/app/actions/match-result";
import { Message, Submit } from "@/app/matches/vong-2/bao-cao/dispatch-panel";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";

const INPUT = "mt-1 block w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm";

export function MatchResultSettingsForm(props: { kickoffRegisterUrl: string | null }) {
  const [state, action] = useFormState(saveMatchResultSettingsAction, ROUND2_IDLE);
  return (
    <form action={action} className="grid gap-3" data-testid="match-result-settings">
      <label className="text-sm text-slate-600">
        Link đăng ký Kick-off 20/11 (để trống thì thư ghi “BTC sẽ cập nhật sau”)
        <input name="kickoffRegisterUrl" type="url" defaultValue={props.kickoffRegisterUrl ?? ""} placeholder="https://" className={INPUT} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Lưu link Kick-off" pendingLabel="Đang lưu…" />
        <Message state={state} />
      </div>
    </form>
  );
}

/**
 * Gửi thử thư thật của một nhóm mentor (mentor + từng mentee của họ) — để team support xem trước. Người
 * nhận là người bấm hoặc một tài khoản nhân sự; máy chủ từ chối mọi địa chỉ khác.
 */
export function GroupTestForm() {
  const [state, action] = useFormState(sendMatchResultGroupTestAction, ROUND2_IDLE);
  return (
    <form action={action} className="grid gap-3 rounded-md border border-vam-line p-3" data-testid="match-result-group-test">
      <div className="text-sm font-semibold text-vam-ink">Xem trước thư của một nhóm mentor</div>
      <p className="text-xs text-slate-500">
        Gửi thư thử đúng chữ, đúng tên của một mentor và từng mentee của họ (link hồ sơ trong thư thử không bấm được). Không gửi tới
        mentor hay mentee thật.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-600">
          Email hoặc họ tên mentor
          <input name="mentor" required className={INPUT} placeholder="Lương Quốc Vĩ" />
        </label>
        <label className="text-sm text-slate-600">
          Gửi tới (để trống = email của bạn; chỉ nhận email tài khoản nhân sự VAM OS)
          <input name="toEmail" type="email" className={INPUT} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit label="Gửi thử nhóm này" pendingLabel="Đang gửi thử…" />
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

export type MatchResultSendPanelProps = {
  blocked: string[];
  sentInWindow: number | null;
  allowance: number;
  readyGroups: number;
  readyPeople: number;
  nextBatchGroups: number;
  nextBatchPeople: number;
};

/**
 * Gửi thư kết quả. Mỗi lần bấm gửi trọn từng nhóm mentor (mentor + các mentee của họ) trong phần hạn
 * mức còn lại; máy chủ tự tính lại lô lúc bấm. Xác nhận bằng bước thứ hai ngay trên trang.
 */
export function MatchResultSendPanel(props: MatchResultSendPanelProps) {
  const [testState, testAction] = useFormState(sendMatchResultTestAction, ROUND2_IDLE);
  const [sendState, sendAction] = useFormState(sendMatchResultAction, ROUND2_IDLE);
  const [confirming, setConfirming] = useState(false);
  const blocked = props.blocked.length
    ? null
    : props.readyPeople === 0
      ? "Không còn ai chờ thư kết quả."
      : props.sentInWindow === null
        ? "Không đếm được số thư đã gửi trong 24 giờ qua, nên tạm khoá nút gửi."
        : props.nextBatchPeople === 0
          ? `Phần hạn mức còn ${props.allowance} thư, không đủ cho trọn một nhóm mentor. Thử lại sau vài giờ.`
          : null;

  return (
    <div className="grid gap-3" data-testid="match-result-send">
      <p className="text-sm text-slate-600">
        Chờ gửi: <strong>{props.readyPeople}</strong> người trong <strong>{props.readyGroups}</strong> nhóm mentor · Thư cả hệ thống trong 24 giờ:{" "}
        {props.sentInWindow ?? "?"}/1.000 · Lần bấm kế tiếp: {props.nextBatchPeople} thư ({props.nextBatchGroups} nhóm).
      </p>
      <form action={testAction} className="flex flex-wrap items-center gap-3">
        <Submit label="Gửi thử cho tôi (2 thư)" pendingLabel="Đang gửi thử…" />
        <Message state={testState} />
      </form>
      {props.blocked.length ? (
        <ul className="list-disc pl-5 text-sm text-amber-700" data-testid="match-result-blocked">
          {props.blocked.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : blocked ? (
        <p className="text-sm text-amber-700">{blocked}</p>
      ) : confirming ? (
        <form action={sendAction} className="flex flex-wrap items-center gap-3" data-testid="match-result-send-confirm">
          <input type="hidden" name="confirmed" value="yes" />
          <span className="text-sm text-vam-ink">
            Gửi {props.nextBatchPeople} thư kết quả ({props.nextBatchGroups} nhóm mentor) tới người thật?
          </span>
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
          Gửi thư kết quả (tối đa {props.nextBatchPeople} thư)
        </button>
      )}
      <Message state={sendState} />
    </div>
  );
}

/** Gửi riêng một người (thí điểm, hoặc gửi lại khi cặp đổi). Bước xác nhận nói rõ link cũ hết hiệu lực. */
export function ResendButton({ personId, role, name, sentBefore }: { personId: string; role: "mentor" | "mentee"; name: string; sentBefore: boolean }) {
  const [state, action] = useFormState(resendMatchResultAction, ROUND2_IDLE);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <div className="grid gap-1">
        <button type="button" onClick={() => setConfirming(true)} className="self-start rounded-md border border-vam-line px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {sentBefore ? "Gửi lại" : "Gửi riêng"}
        </button>
        <Message state={state} />
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-1" data-testid="match-result-resend-confirm">
      <input type="hidden" name="confirmed" value="yes" />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="role" value={role} />
      <span className="text-xs text-vam-ink">
        Gửi thư kết quả tới {name}?{sentBefore ? " Link trong thư trước sẽ hết hiệu lực." : ""}
      </span>
      <div className="flex gap-2">
        <Submit label="Xác nhận" pendingLabel="Đang gửi…" />
        <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-vam-line px-2 py-1 text-xs text-slate-700">
          Huỷ
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
