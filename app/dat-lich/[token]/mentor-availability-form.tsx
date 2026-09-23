"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// React 18.3.1: useFormState của react-dom — hook thay thế của React 19 qua
// được cả bốn cổng rồi mới vỡ trắng trang lúc chạy, nên cấm dùng ở đây.
import { useFormState, useFormStatus } from "react-dom";
import type { GridDay } from "@/lib/interview-schedule-core";
import { INITIAL_MENTOR_AVAILABILITY_STATE } from "@/lib/interview-booking-action-types";
import { saveMentorAvailabilityAction } from "./actions";

/**
 * Chiều ngược: mentor tự khai giờ MÌNH rảnh.
 *
 * Đây KHÔNG phải giữ chỗ. Không ai bị hẹn khi bấm Lưu ở đây — chỉ là một lời
 * ngỏ để ban tổ chức mở lưới ra ghép. Chữ trên màn hình phải nói đúng điều đó,
 * vì người đọc nhầm sẽ ngồi chờ một buổi hẹn chưa tồn tại.
 *
 * Chip từng ngày chứ không phải bảng 14×15: người bấm là ứng viên trên điện
 * thoại, một bảng cuộn ngang ở đó là cực hình.
 */

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md border border-vam-green bg-white px-4 py-3 text-base font-semibold text-vam-green disabled:opacity-60 sm:w-auto sm:text-sm"
    >
      {pending ? "Đang lưu..." : "Lưu giờ tôi rảnh"}
    </button>
  );
}

export function MentorAvailabilityForm({
  token,
  days,
  mine
}: {
  token: string;
  days: GridDay[];
  mine: string[];
}) {
  const [state, formAction] = useFormState(saveMentorAvailabilityAction, INITIAL_MENTOR_AVAILABILITY_STATE);

  // Chỉ những ngày còn ít nhất một giờ chưa trôi qua. Ngày đã hết thì hiện ra
  // chỉ tổ làm trang dài thêm.
  const openDays = useMemo(
    () => days.map((day) => ({ ...day, slots: day.slots.filter((slot) => !slot.isPast) })).filter((day) => day.slots.length > 0),
    [days]
  );

  const serverChecked = useMemo(() => new Set(mine), [mine]);
  // Chữ ký của dữ liệu máy chủ: giờ đã khai, cộng số ô còn bấm được. Trang này
  // có <LiveRefresh /> đọc lại mỗi 15 giây, và props luôn là mảng MỚI kể cả khi
  // dữ liệu y hệt — đồng bộ theo danh tính sẽ xoá sạch ô vừa tick (đúng lỗi đã
  // sửa ở lưới interviewer ngày 23/09/2026).
  const signature = useMemo(
    () => `${[...mine].sort().join("|")}#${openDays.map((day) => `${day.dateKey}:${day.slots.length}`).join(",")}`,
    [mine, openDays]
  );

  const [checked, setChecked] = useState<Set<string>>(serverChecked);
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setChecked((current) => {
      // Ở ô còn bấm được, phần đang làm dở của người dùng được giữ; mọi thứ
      // khác lấy theo máy chủ.
      const next = new Set(serverChecked);
      for (const day of openDays) {
        for (const slot of day.slots) {
          if (current.has(slot.startsAtIso)) next.add(slot.startsAtIso);
          else next.delete(slot.startsAtIso);
        }
      }
      return next;
    });
  }, [signature, openDays, serverChecked]);

  const toggle = (iso: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  };

  const toggleDay = (day: GridDay) => {
    const allOn = day.slots.every((slot) => checked.has(slot.startsAtIso));
    setChecked((current) => {
      const next = new Set(current);
      for (const slot of day.slots) {
        if (allOn) next.delete(slot.startsAtIso);
        else next.add(slot.startsAtIso);
      }
      return next;
    });
  };

  const { add, remove } = useMemo(() => {
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const day of openDays) {
      for (const slot of day.slots) {
        const was = serverChecked.has(slot.startsAtIso);
        const want = checked.has(slot.startsAtIso);
        if (want && !was) toAdd.push(slot.startsAtIso);
        if (!want && was) toRemove.push(slot.startsAtIso);
      }
    }
    return { add: toAdd, remove: toRemove };
  }, [openDays, serverChecked, checked]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="add" value={JSON.stringify(add)} />
      <input type="hidden" name="remove" value={JSON.stringify(remove)} />

      {state.status !== "idle" ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-md border px-3 py-2 text-sm ${
            state.status === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-vam-green/40 bg-vam-mint/40 text-vam-ink"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-3">
        {openDays.map((day) => (
          <fieldset key={day.dateKey} className="rounded-lg border border-vam-line bg-white p-3">
            <legend className="px-1 text-sm font-semibold text-vam-ink">{day.label}</legend>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {day.slots.map((slot) => {
                const on = checked.has(slot.startsAtIso);
                return (
                  <button
                    key={slot.startsAtIso}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${day.label} ${String(slot.hour).padStart(2, "0")}:00`}
                    onClick={() => toggle(slot.startsAtIso)}
                    className={`rounded-md border px-2.5 py-2 text-sm ${
                      on
                        ? "border-vam-green bg-vam-green font-semibold text-white"
                        : "border-vam-line bg-white text-vam-ink"
                    }`}
                  >
                    {String(slot.hour).padStart(2, "0")}h
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => toggleDay(day)}
                className="rounded-md border border-vam-line px-2.5 py-2 text-xs text-slate-600"
              >
                cả ngày
              </button>
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <span className="text-xs text-slate-500">
          Đang chờ lưu: thêm {add.length} giờ, bỏ {remove.length} giờ.
        </span>
      </div>
    </form>
  );
}
