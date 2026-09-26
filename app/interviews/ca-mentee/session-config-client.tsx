"use client";

import { useFormState, useFormStatus } from "react-dom";
import { keepFormValues } from "@/lib/keep-form-values";
import { useState } from "react";
import {
  applySeatLimitToAllAction,
  applyVenueToAllAction,
  saveSessionConfigAction,
  sendMenteeInvitesAction
} from "@/app/actions/mentee-sessions";
import {
  INITIAL_INVITE_DISPATCH_STATE,
  INITIAL_SESSION_CONFIG_STATE,
  type InviteDispatchState,
  type SessionConfigState
} from "@/lib/mentee-session-admin-action-types";
import type { SessionAdminRow } from "@/lib/mentee-session-admin";

const inputClass =
  "h-10 w-full rounded-md border border-vam-line bg-white px-2.5 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";

function SaveButton({ label = "Lưu" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 whitespace-nowrap rounded-md bg-vam-green px-4 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang lưu…" : label}
    </button>
  );
}

function Banner({ state }: { state: SessionConfigState }) {
  if (state.status === "idle" || !state.message) return null;
  const ok = state.status === "success";
  return (
    <p
      role={ok ? "status" : "alert"}
      className={
        ok
          ? "mt-2 rounded-md border border-vam-green bg-vam-mint/40 px-3 py-2 text-sm text-vam-ink"
          : "mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
      }
    >
      {state.message}
    </p>
  );
}

/**
 * Áp một số ghế cho mọi ca.
 *
 * Đây là thao tác thật của ban tổ chức: số mentor mỗi ca thường như nhau, nên
 * bắt gõ mười hai lần chỉ là mười hai cơ hội gõ lệch một ô. Ai cần một ca khác
 * số thì sửa riêng ca đó ở bảng dưới.
 */
export function BulkPanel() {
  const [seatState, seatAction] = useFormState<SessionConfigState, FormData>(
    applySeatLimitToAllAction,
    INITIAL_SESSION_CONFIG_STATE
  );
  const [venueState, venueAction] = useFormState<SessionConfigState, FormData>(
    applyVenueToAllAction,
    INITIAL_SESSION_CONFIG_STATE
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form action={seatAction} onReset={keepFormValues}>
        <label htmlFor="bulk-seats" className="mb-1 block text-sm font-medium text-vam-ink">
          Áp số ghế cho mọi ca
        </label>
        <div className="flex gap-2">
          <input
            id="bulk-seats"
            name="seatLimit"
            inputMode="numeric"
            placeholder="ví dụ 40"
            className={inputClass}
          />
          <SaveButton label="Áp" />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Ghế mỗi ca = số mentor ngồi bàn × (60 phút ÷ độ dài một buổi).
        </p>
        <Banner state={seatState} />
      </form>

      <form action={venueAction} onReset={keepFormValues}>
        <label htmlFor="bulk-venue" className="mb-1 block text-sm font-medium text-vam-ink">
          Áp địa điểm cho mọi ca
        </label>
        <div className="flex gap-2">
          <input
            id="bulk-venue"
            name="venue"
            placeholder="ví dụ Phòng B2-208, Cơ sở B UEH"
            className={inputClass}
          />
          <SaveButton label="Áp" />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Thư xác nhận gửi ứng viên mang đúng dòng này.
        </p>
        <Banner state={venueState} />
      </form>
    </div>
  );
}

/** Một ca: số ghế, địa điểm riêng, và nút đóng ca. */
export function SessionRowForm({ row }: { row: SessionAdminRow }) {
  const [state, action] = useFormState<SessionConfigState, FormData>(
    saveSessionConfigAction,
    INITIAL_SESSION_CONFIG_STATE
  );
  const moiBao = state.sessionId === row.id ? state : INITIAL_SESSION_CONFIG_STATE;

  return (
    <form action={action} onReset={keepFormValues} className="border-t border-vam-line py-3">
      <input type="hidden" name="sessionId" value={row.id} />
      <div className="grid gap-2 sm:grid-cols-[7rem_5.5rem_1fr_auto] sm:items-center">
        <div className="text-sm font-semibold text-vam-ink">{row.timeLabel}</div>

        <div>
          <label className="sr-only" htmlFor={`seats-${row.id}`}>
            Số ghế ca {row.timeLabel}
          </label>
          <input
            id={`seats-${row.id}`}
            name="seatLimit"
            inputMode="numeric"
            defaultValue={row.seatLimit ?? ""}
            placeholder="trống"
            className={inputClass}
          />
        </div>

        <div>
          <label className="sr-only" htmlFor={`venue-${row.id}`}>
            Địa điểm ca {row.timeLabel}
          </label>
          <input
            id={`venue-${row.id}`}
            name="venue"
            defaultValue={row.venue}
            placeholder="địa điểm riêng của ca này (nếu khác)"
            className={inputClass}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-600">
            <input type="checkbox" name="closed" value="yes" defaultChecked={row.status === "closed"} />
            Đóng
          </label>
          <SaveButton />
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
        <span className={row.taken > 0 ? "font-medium text-vam-ink" : "text-slate-500"}>
          Đã giữ chỗ: {row.taken}
        </span>
        {row.seatLimit === null ? (
          <span className="text-amber-700">Chưa điền ghế — ứng viên không đặt được ca này</span>
        ) : null}
        {/*
          Hạ trần xuống dưới số người đã giữ chỗ KHÔNG đuổi ai ra — ca chỉ hiện
          là đã kín. Nhưng người vận hành phải thấy mình vừa làm việc đó, chứ
          không phát hiện vào sáng ngày phỏng vấn.
        */}
        {row.overbooked ? (
          <span className="font-medium text-red-700">
            Trần đang thấp hơn số người đã giữ chỗ — không ai bị đuổi ra, nhưng ca này sẽ hiện là kín.
          </span>
        ) : null}
      </div>

      <Banner state={moiBao} />
    </form>
  );
}

function SendButton({ disabled, allowance }: { disabled: boolean; allowance: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="h-10 whitespace-nowrap rounded-md bg-vam-green px-4 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang gửi…" : `Gửi thư mời chọn ca (tối đa ${allowance} thư)`}
    </button>
  );
}

export type InviteDispatchPanelProps = {
  waiting: number;
  invitedNotBooked: number;
  booked: number;
  lastFailed: number;
  sentInWindow: number | null;
  allowance: number;
  dailyLimit: number;
  reserve: number;
  anyBookable: boolean;
  deadlineLabel: string;
  sessionsWithoutVenue: number;
};

/**
 * Gửi thư mời mentee chọn ca.
 *
 * Nút bị khoá cho tới khi tích ô xác nhận — và máy chủ kiểm lại đúng ô đó.
 * Thư mời đã gửi không rút lại được, nên thao tác này phải có một khoảnh khắc
 * người bấm thật sự đọc lại số ghế, địa điểm và hạn đặt, không phải một cú bấm
 * theo phản xạ.
 */
export function InviteDispatchPanel(props: InviteDispatchPanelProps) {
  const [state, action] = useFormState<InviteDispatchState, FormData>(
    sendMenteeInvitesAction,
    INITIAL_INVITE_DISPATCH_STATE
  );
  const [confirmed, setConfirmed] = useState(false);

  const blockedReason = !props.anyBookable
    ? "Chưa có ca nào đặt được — điền số ghế cho các ca, hoặc kiểm tra hạn đặt, rồi mới gửi."
    : props.waiting === 0
      ? "Không còn ai chờ thư mời."
      : props.allowance === 0
        ? props.sentInWindow === null
          ? "Không đếm được số thư đã gửi trong 24 giờ qua, nên tạm khoá nút gửi."
          : `Đã chạm phần hạn mức của thư mời trong 24 giờ qua — ${props.reserve} thư còn lại chừa cho thư xác nhận ca. Thử lại sau vài giờ.`
        : null;

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-vam-line bg-white px-3 py-2">
          <p className="text-xs uppercase text-slate-500">Chờ thư mời</p>
          <p className="text-xl font-semibold tabular-nums text-vam-ink">{props.waiting}</p>
        </div>
        <div className="rounded-md border border-vam-line bg-white px-3 py-2">
          <p className="text-xs uppercase text-slate-500">Đã nhận thư, chưa chọn ca</p>
          <p className="text-xl font-semibold tabular-nums text-vam-ink">{props.invitedNotBooked}</p>
        </div>
        <div className="rounded-md border border-vam-line bg-white px-3 py-2">
          <p className="text-xs uppercase text-slate-500">Đã chọn ca</p>
          <p className="text-xl font-semibold tabular-nums text-vam-ink">{props.booked}</p>
        </div>
        <div className="rounded-md border border-vam-line bg-white px-3 py-2">
          <p className="text-xs uppercase text-slate-500">Thư đã gửi 24 giờ qua</p>
          <p className="text-xl font-semibold tabular-nums text-vam-ink">
            {props.sentInWindow === null ? "—" : props.sentInWindow}
            <span className="text-sm font-normal text-slate-500">/{props.dailyLimit}</span>
          </p>
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Danh sách nhận thư là mọi mentee ở trạng thái <strong>Đã mời phỏng vấn</strong> chưa chọn ca và chưa
        nhận thư mời. Mỗi lần bấm gửi tối đa <strong>{props.allowance}</strong> thư — gói thư hiện tại cho{" "}
        {props.dailyLimit} thư mỗi 24 giờ cho cả hệ thống, và <strong>{props.reserve}</strong> thư luôn được chừa lại
        cho thư xác nhận ca. Còn người chờ thì bấm lại để gửi tiếp.
      </p>

      {props.lastFailed > 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {props.lastFailed} bạn gửi lần trước bị lỗi và vẫn đang chờ — lần bấm tới sẽ thử lại. Chi tiết ở Vận hành → Mail →
          Nhật ký gửi.
        </p>
      ) : null}

      {props.sessionsWithoutVenue > 0 && props.anyBookable ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {props.sessionsWithoutVenue} ca chưa có địa điểm. Bạn nào đặt vào các ca đó sẽ nhận thư xác nhận với câu
          “Ban tổ chức sẽ báo địa điểm cụ thể trước ngày phỏng vấn”. Nên điền địa điểm trước khi gửi thư mời.
        </p>
      ) : null}

      <form action={action} className="grid gap-3">
        <label className="flex items-start gap-2 text-sm text-vam-ink">
          <input
            type="checkbox"
            name="confirmed"
            value="yes"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-1"
          />
          <span>
            Tôi đã kiểm tra <strong>số ghế</strong>, <strong>địa điểm</strong> và <strong>hạn đặt ca
            {props.deadlineLabel ? ` (${props.deadlineLabel})` : ""}</strong>. Thư mời đã gửi thì không rút lại được.
          </span>
        </label>
        <div>
          <SendButton disabled={!confirmed || blockedReason !== null} allowance={props.allowance} />
        </div>
        {blockedReason ? <p className="text-sm text-slate-600">{blockedReason}</p> : null}
        {state.status !== "idle" && state.message ? (
          <p
            role={state.status === "success" ? "status" : "alert"}
            className={
              state.status === "success"
                ? "rounded-md border border-vam-green bg-vam-mint/40 px-3 py-2 text-sm text-vam-ink"
                : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            }
          >
            {state.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
