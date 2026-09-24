"use client";

import { useFormState, useFormStatus } from "react-dom";
import { keepFormValues } from "@/lib/keep-form-values";
import {
  applySeatLimitToAllAction,
  applyVenueToAllAction,
  saveSessionConfigAction
} from "@/app/actions/mentee-sessions";
import {
  INITIAL_SESSION_CONFIG_STATE,
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
 * Áp một số ghế cho cả 12 ca.
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
          Áp số ghế cho cả 12 ca
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
          Áp địa điểm cho cả 12 ca
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
