"use client";

import { useEffect, useMemo, useState } from "react";
// React 18.3.1: useFormState của react-dom — hook thay thế của React 19 qua
// được cả bốn cổng rồi mới vỡ trắng trang lúc chạy, nên cấm dùng ở đây.
import { useFormState, useFormStatus } from "react-dom";
import { saveInterviewerAvailabilityAction } from "@/app/actions/interview-schedule";
import { INITIAL_AVAILABILITY_STATE } from "@/lib/interview-schedule-action-types";
import { formatDateTime } from "@/lib/utils";

/**
 * Lưới giờ rảnh của interviewer: 14 ngày × 15 giờ (07:00–21:00, mỗi ô 60
 * phút). Tick ô mình rảnh rồi Lưu; ô đã có mentor đặt thì khoá lại và hiện
 * tên — gỡ ô đó là việc của phần Huỷ lịch bên ban tổ chức, không phải của
 * cái checkbox này.
 */

type GridSlotProp = {
  startsAtIso: string;
  hour: number;
  isPast: boolean;
  mine: "open" | "removed" | "booked" | null;
  candidateName: string | null;
};
type GridDayProp = { dateKey: string; label: string; slots: GridSlotProp[] };
type StatsProp = { total: number; done: number; bookedUpcoming: number; open: number; expired: number };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      {pending ? "Đang lưu..." : "Lưu giờ rảnh"}
    </button>
  );
}

export function AvailabilityGrid({
  days,
  phone,
  needsPhone,
  stats
}: {
  days: GridDayProp[];
  phone: string;
  needsPhone: boolean;
  stats: StatsProp;
}) {
  const [state, formAction] = useFormState(saveInterviewerAvailabilityAction, INITIAL_AVAILABILITY_STATE);

  // Trạng thái tick khởi từ dữ liệu server; sau mỗi lần lưu, server trả bản
  // mới và chữ ký đổi → đồng bộ lại, để cái đang thấy luôn là cái đã lưu.
  const signature = useMemo(
    () => days.map((day) => day.slots.map((slot) => `${slot.startsAtIso}:${slot.mine ?? "-"}`).join("|")).join("\n"),
    [days]
  );
  const initialChecked = useMemo(() => {
    const set = new Set<string>();
    for (const day of days) {
      for (const slot of day.slots) if (slot.mine === "open") set.add(slot.startsAtIso);
    }
    return set;
  }, [days]);
  const [checked, setChecked] = useState<Set<string>>(initialChecked);
  useEffect(() => {
    setChecked(initialChecked);
    // signature đại diện cho dữ liệu server mới nhất — đổi thì đồng bộ lại.
  }, [signature, initialChecked]);

  const toggle = (iso: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  };

  const toggleDay = (day: GridDayProp) => {
    const togglable = day.slots.filter((slot) => !slot.isPast && slot.mine !== "booked");
    const allOn = togglable.every((slot) => checked.has(slot.startsAtIso));
    setChecked((current) => {
      const next = new Set(current);
      for (const slot of togglable) {
        if (allOn) next.delete(slot.startsAtIso);
        else next.add(slot.startsAtIso);
      }
      return next;
    });
  };

  // Chỉ gửi phần CHÊNH so với bản server: thêm gì, gỡ gì.
  const { add, remove } = useMemo(() => {
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const day of days) {
      for (const slot of day.slots) {
        if (slot.isPast || slot.mine === "booked") continue;
        const wasOpen = slot.mine === "open";
        const wantOpen = checked.has(slot.startsAtIso);
        if (wantOpen && !wasOpen) toAdd.push(slot.startsAtIso);
        if (!wantOpen && wasOpen) toRemove.push(slot.startsAtIso);
      }
    }
    return { add: toAdd, remove: toRemove };
  }, [days, checked]);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="add" value={JSON.stringify(add)} />
      <input type="hidden" name="remove" value={JSON.stringify(remove)} />

      <div className="rounded-md border border-vam-line bg-vam-mint/30 px-3 py-2 text-sm text-vam-ink">
        Đã đăng ký <strong>{stats.total} giờ</strong> trong đợt · Đã phỏng vấn xong (theo lịch){" "}
        <strong>{stats.done}</strong> · Sắp diễn ra <strong>{stats.bookedUpcoming}</strong> · Còn trống{" "}
        <strong>{stats.open}</strong> · Trống nhưng đã trôi qua <strong>{stats.expired}</strong>
      </div>

      <label className="block max-w-xs">
        <span className="text-sm font-medium text-vam-ink">
          Số điện thoại của anh/chị {needsPhone ? "(bắt buộc trước lần lưu đầu)" : ""}
        </span>
        <input
          name="phone"
          defaultValue={phone}
          inputMode="numeric"
          placeholder="0912345678"
          className="mt-1 block w-full rounded-md border border-vam-line px-3 py-2 text-base sm:text-sm"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Ghi vào thư xác nhận gửi mentor để hai bên gọi được nhau trước buổi phỏng vấn.
        </span>
      </label>

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

      <div className="overflow-x-auto rounded-lg border border-vam-line bg-white">
        <table className="min-w-[900px] border-collapse text-center text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left text-vam-ink">Ngày \ Giờ</th>
              {days[0]?.slots.map((slot) => (
                <th key={slot.hour} className="px-1 py-2 font-medium text-vam-ink">
                  {String(slot.hour).padStart(2, "0")}h
                </th>
              ))}
              <th className="px-2 py-2" aria-label="Chọn cả ngày" />
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.dateKey} className="border-t border-vam-line">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 text-left font-medium text-vam-ink">
                  {day.label}
                </th>
                {day.slots.map((slot) => (
                  <td key={slot.startsAtIso} className="px-1 py-1">
                    {slot.mine === "booked" ? (
                      <span
                        title={`Đã có mentor đặt${slot.candidateName ? `: ${slot.candidateName}` : ""} — ${formatDateTime(slot.startsAtIso)}`}
                        className="inline-block rounded bg-vam-green px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      >
                        Đặt
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`${day.label} ${String(slot.hour).padStart(2, "0")}:00`}
                        disabled={slot.isPast}
                        checked={checked.has(slot.startsAtIso)}
                        onChange={() => toggle(slot.startsAtIso)}
                        className="h-4 w-4 accent-vam-green disabled:opacity-30"
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => toggleDay(day)}
                    className="whitespace-nowrap rounded border border-vam-line px-2 py-0.5 text-[11px] text-vam-ink hover:bg-vam-mint/40"
                  >
                    cả ngày
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <span className="text-xs text-slate-500">
          Đang chờ lưu: thêm {add.length} giờ, gỡ {remove.length} giờ. Ô «Đặt» là buổi đã có mentor giữ — muốn trả
          giờ đó thì nhờ ban tổ chức huỷ lịch.
        </span>
      </div>
    </form>
  );
}
