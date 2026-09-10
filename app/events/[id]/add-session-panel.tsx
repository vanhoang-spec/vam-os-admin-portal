"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addEventSessionAction } from "@/app/actions/events";
import type { EventActionState } from "@/lib/event-action-types";
import { toVietnamInputValue } from "@/lib/event-datetime";
import { VietnamDateTimeField } from "../vietnam-datetime-field";

const initialState: EventActionState = { ok: false, message: null };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Đang thêm…" : "Thêm buổi"}
    </button>
  );
}

/**
 * Thêm một buổi nữa vào chuỗi.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CÓ Ô NÀY, KHI LÚC TẠO ĐÃ CÓ "SỰ KIỆN LẶP LẠI"
 * ---------------------------------------------------------------------------
 * Lịch đổi sau khi sự kiện đã tạo là chuyện bình thường: chốt thêm một buổi vì
 * đăng ký vượt dự kiến, hoặc lúc tạo chưa biết có mấy buổi. Không có ô này thì
 * cách duy nhất là xoá đi tạo lại — và mất luôn những đăng ký đã có.
 *
 * Giờ mặc định lấy đúng khung giờ của buổi đang mở, chỉ đẩy sang tuần sau:
 * gần như mọi lần thêm buổi đều là "y như vậy, tuần tới", nên gõ lại từ đầu là
 * bắt người ta làm việc thừa.
 */
export function AddSessionPanel({
  eventId,
  startsAt,
  endsAt,
  seriesIndex,
  seriesTotal
}: {
  eventId: string;
  startsAt: string | null;
  endsAt: string | null;
  seriesIndex: number | null;
  seriesTotal: number | null;
}) {
  const [state, formAction] = useFormState(addEventSessionAction, initialState);

  const nextWeek = (iso: string | null): string => {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return toVietnamInputValue(new Date(date.getTime() + 7 * 86_400_000).toISOString());
  };

  const [start, setStart] = useState(() => nextWeek(startsAt));
  const [end, setEnd] = useState(() => nextWeek(endsAt));

  const inSeries = seriesIndex !== null && seriesTotal !== null;

  return (
    <section className="rounded-md border border-vam-line bg-white p-4">
      <h2 className="text-sm font-semibold text-vam-ink">
        {inSeries ? `Chuỗi ${seriesTotal} buổi — đang xem buổi ${seriesIndex}` : "Thêm buổi cho sự kiện này"}
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        {inSeries
          ? "Thêm một buổi nữa vào chuỗi. Buổi mới chép lại toàn bộ cấu hình của buổi này, chỉ khác ngày giờ."
          : "Sự kiện này đang là buổi đơn lẻ. Thêm một buổi sẽ biến nó thành chuỗi, và một link đăng ký duy nhất sẽ cho người tham dự chọn buổi."}
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-start gap-3">
        <input type="hidden" name="event_id" value={eventId} />

        <VietnamDateTimeField
          name="starts_at"
          label="Bắt đầu buổi mới"
          required
          defaultValue={start}
        />

        <VietnamDateTimeField name="ends_at" label="Kết thúc" defaultValue={end} />

        <div className="pt-5">
          <Submit />
        </div>
      </form>

      {state.message ? (
        <p
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-vam-green/40 bg-vam-mint text-vam-ink"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
