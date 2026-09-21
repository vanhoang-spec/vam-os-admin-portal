"use client";

import { useState } from "react";
// React 18.3.1: useFormState của react-dom — hook thay thế của React 19 qua
// được cả bốn cổng rồi mới vỡ trắng trang lúc chạy, nên cấm dùng ở đây.
import { useFormState, useFormStatus } from "react-dom";
import type { BookingPageDayGroup } from "@/lib/interview-schedule-core";
import { INITIAL_BOOKING_FORM_STATE } from "@/lib/interview-booking-action-types";
import { bookInterviewSlotAction, cancelInterviewBookingAction } from "./actions";

/**
 * Lưới chọn giờ của mentor: bấm một khung giờ rồi "Giữ chỗ". Ai bấm giữ
 * trước được trước — số "còn N chỗ" chỉ là ảnh chụp lúc tải trang, nên khi
 * trượt slot, câu báo mời chọn giờ khác hiện ngay tại chỗ.
 */

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex w-full items-center justify-center rounded-md bg-vam-green px-4 py-3 text-base font-semibold text-white disabled:opacity-60 sm:w-auto sm:text-sm"
    >
      {pending ? "Đang xử lý..." : label}
    </button>
  );
}

export function BookingForm({ token, days }: { token: string; days: BookingPageDayGroup[] }) {
  const [state, formAction] = useFormState(bookInterviewSlotAction, INITIAL_BOOKING_FORM_STATE);
  const [selected, setSelected] = useState<string>("");

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-vam-green/40 bg-vam-mint/40 p-5 text-vam-ink" role="status">
        <h2 className="text-lg font-semibold">Đã giữ chỗ thành công</h2>
        {state.slotLabel ? <p className="mt-2 text-sm font-medium">{state.slotLabel}</p> : null}
        <p className="mt-2 text-sm">
          Thư xác nhận kèm thông tin người phỏng vấn đang được gửi tới email của anh/chị. Tải lại trang này để xem
          chi tiết buổi hẹn.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="slotStartsAt" value={selected} />

      {state.status === "error" ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {state.message}
        </p>
      ) : null}

      {days.map((day) => (
        <fieldset key={day.dateKey} className="rounded-lg border border-vam-line bg-white p-3">
          <legend className="px-1 text-sm font-semibold text-vam-ink">{day.label}</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {day.hours.map((hour) => {
              const isSelected = selected === hour.startsAtIso;
              return (
                <button
                  key={hour.startsAtIso}
                  type="button"
                  onClick={() => setSelected(hour.startsAtIso)}
                  aria-pressed={isSelected}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    isSelected
                      ? "border-vam-green bg-vam-green font-semibold text-white"
                      : "border-vam-line bg-white text-vam-ink hover:bg-vam-mint/40"
                  }`}
                >
                  {String(hour.hour).padStart(2, "0")}:00
                  <span className={`ml-1 text-xs ${isSelected ? "text-white/90" : "text-slate-500"}`}>
                    · còn {hour.openCount}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <SubmitButton label="Giữ chỗ khung giờ đã chọn" disabled={!selected} />
      {!selected ? <p className="text-xs text-slate-500">Bấm chọn một khung giờ trước rồi mới giữ chỗ được.</p> : null}
    </form>
  );
}

/** Nút huỷ lịch của mentor — chỉ hiện khi còn hơn 24 giờ trước buổi hẹn. */
export function CancelBookingForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(cancelInterviewBookingAction, INITIAL_BOOKING_FORM_STATE);

  if (state.status === "success") {
    return (
      <p className="rounded-md border border-vam-line bg-vam-mint/40 px-3 py-2 text-sm text-vam-ink" role="status">
        {state.message}
      </p>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Huỷ buổi hẹn này? Khung giờ sẽ mở lại cho người khác và anh/chị phải chọn giờ mới.")) {
          event.preventDefault();
        }
      }}
      className="grid gap-2"
    >
      <input type="hidden" name="token" value={token} />
      {state.status === "error" ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {state.message}
        </p>
      ) : null}
      <SubmitButton label="Huỷ lịch hẹn này" />
    </form>
  );
}
