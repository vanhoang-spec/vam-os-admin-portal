"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// React 18.3.1: useFormState của react-dom — hook thay thế của React 19 qua
// được cả bốn cổng rồi mới vỡ trắng trang lúc chạy, nên cấm dùng ở đây.
import { useFormState, useFormStatus } from "react-dom";
import { slotRangeLabel, type GridDay } from "@/lib/interview-schedule-core";
import { INITIAL_MENTOR_AVAILABILITY_STATE } from "@/lib/interview-booking-action-types";
import { saveMentorAvailabilityAction } from "./actions";

/**
 * Chiều ngược: mentor chọn MỘT giờ mình rảnh rồi chờ được ghép.
 *
 * Đây KHÔNG phải giữ chỗ. Không ai bị hẹn khi bấm ở đây — chỉ là một lời ngỏ
 * để ban tổ chức mở lưới ra ghép. Chữ trên màn hình phải nói đúng điều đó, vì
 * người đọc nhầm sẽ ngồi chờ một buổi hẹn chưa tồn tại.
 *
 * Một giờ tại một thời điểm (chủ dự án chốt 23/09/2026): các ô cư xử như một
 * nhóm radio, chọn ô mới là bỏ ô cũ. Database canh luật đó bằng chỉ số bộ
 * phận, màn hình chỉ làm cho nó hiển nhiên.
 */

function SubmitButton({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex w-full items-center justify-center rounded-md border border-vam-green bg-white px-4 py-3 text-base font-semibold text-vam-green disabled:opacity-60 sm:w-auto sm:text-sm"
    >
      {pending ? "Đang lưu..." : label}
    </button>
  );
}

export function MentorAvailabilityForm({
  token,
  days,
  chosen
}: {
  token: string;
  days: GridDay[];
  chosen: string | null;
}) {
  const [state, formAction] = useFormState(saveMentorAvailabilityAction, INITIAL_MENTOR_AVAILABILITY_STATE);

  // Chỉ những ngày còn ít nhất một giờ chưa trôi qua.
  const openDays = useMemo(
    () =>
      days
        .map((day) => ({ ...day, slots: day.slots.filter((slot) => !slot.isPast) }))
        .filter((day) => day.slots.length > 0),
    [days]
  );

  // Trang này có <LiveRefresh /> đọc lại máy chủ mỗi 15 giây, và props luôn là
  // mảng MỚI kể cả khi dữ liệu y hệt. Đồng bộ theo danh tính sẽ xoá ô vừa chọn
  // — đúng lỗi đã sửa ở lưới interviewer ngày 23/09/2026 — nên chỉ đồng bộ khi
  // CHỮ KÝ dữ liệu đổi.
  const signature = useMemo(
    () => `${chosen ?? "-"}#${openDays.map((day) => `${day.dateKey}:${day.slots.length}`).join(",")}`,
    [chosen, openDays]
  );

  const [selected, setSelected] = useState<string>(chosen ?? "");
  const lastSignature = useRef(signature);
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    setSelected(chosen ?? "");
  }, [signature, chosen]);

  const dirty = selected !== (chosen ?? "");
  const label = !selected ? "Bỏ giờ đã chọn" : chosen && chosen !== selected ? "Đổi sang giờ này" : "Chọn giờ này";

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="slotStartsAt" value={selected} />

      {chosen ? (
        <p className="rounded-md border border-vam-green/40 bg-vam-mint/40 px-3 py-2 text-sm text-vam-ink">
          Anh/chị đang chờ được ghép vào <strong>{slotRangeLabel(chosen)}</strong>. Chọn ô khác bên dưới nếu muốn
          đổi giờ.
        </p>
      ) : null}

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
                const on = selected === slot.startsAtIso;
                return (
                  <button
                    key={slot.startsAtIso}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${day.label} ${String(slot.hour).padStart(2, "0")}:00`}
                    onClick={() => setSelected((current) => (current === slot.startsAtIso ? "" : slot.startsAtIso))}
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
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={label} disabled={!dirty} />
        <span className="text-xs text-slate-500">
          Mỗi lần chỉ chọn được một khung giờ. Chọn ô khác là tự bỏ ô cũ.
        </span>
      </div>
    </form>
  );
}
