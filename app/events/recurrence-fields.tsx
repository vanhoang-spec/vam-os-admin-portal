"use client";

import { useState } from "react";
import {
  MAX_OCCURRENCES,
  MONTHLY_MODES,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_LABELS,
  WEEKDAY_LABELS,
  describeRecurrence,
  generateOccurrences,
  weekdayOf,
  weekdayOrdinalOf,
  type EndMode,
  type MonthlyMode,
  type RecurrenceFrequency
} from "@/lib/event-recurrence";
import { formatDate, formatTime } from "@/lib/utils";

const INPUT =
  "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";

/**
 * Chuỗi từ một ô `datetime-local`, thành ISO — hoặc null nếu chưa đọc được.
 *
 * Tồn tại vì `new Date(x).toISOString()` **ném RangeError** với một Date không
 * hợp lệ; nó không trả về chuỗi rỗng. Một ô đang được gõ dở luôn có lúc không
 * hợp lệ, nên gọi thẳng `.toISOString()` ở đây từng làm sập cả trang tạo sự
 * kiện xuống error boundary — chỉ vì ai đó đang gõ một ngày.
 */
function toIsoOrNull(local: string): string | null {
  const raw = String(local ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Ô đặt lịch lặp, kèm danh sách ngày sẽ được tạo.
 *
 * ---------------------------------------------------------------------------
 * DANH SÁCH NGÀY LÀ PHẦN QUAN TRỌNG NHẤT
 * ---------------------------------------------------------------------------
 * "Hằng tháng vào ngày 31" nghe hợp lý cho tới khi nhìn thấy tháng Hai và
 * tháng Tư biến mất khỏi danh sách. Câu chữ nói ý định, danh sách ngày nói kết
 * quả, và chỗ hai thứ đó lệch nhau chính là chỗ người dùng phát hiện mình chọn
 * nhầm — trước khi tạo, không phải sau.
 *
 * Các lựa chọn hằng tháng được đặt tên theo chính ngày người dùng đã chọn
 * ("ngày 20" / "Chủ nhật tuần thứ 3") thay vì bằng thuật ngữ chung, nên không
 * ai phải dịch từ khái niệm sang trường hợp của mình.
 */
export function RecurrenceFields({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekly");
  const [interval, setInterval] = useState("1");
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>("day_of_month");
  const [endMode, setEndMode] = useState<EndMode>("after_count");
  const [count, setCount] = useState("4");
  const [endsOn, setEndsOn] = useState("");

  // `datetime-local` cho ra giờ theo máy người dùng; ISO hoá để phần sinh buổi
  // đọc cùng một mốc với máy chủ. Qua `toIsoOrNull` — xem chú thích ở hàm đó.
  const startIso = toIsoOrNull(startsAt);
  const endIso = toIsoOrNull(endsAt);
  const valid = startIso !== null;

  const rule = {
    frequency,
    interval: Number(interval),
    monthlyMode,
    endMode,
    endsOn: endsOn || null,
    count: count ? Number(count) : null
  };

  const preview = startIso
    ? generateOccurrences({
        startsAt: startIso,
        endsAt: endIso,
        rule
      })
    : null;

  const weekday = startIso ? weekdayOf(startIso) : null;
  const ordinal = startIso ? weekdayOrdinalOf(startIso) : null;
  // Ngày trong tháng đọc từ chuỗi đã định dạng theo giờ Việt Nam, không từ
  // `getUTCDate()`: một buổi 8 giờ tối ngày 20 giờ Việt Nam đã sang ngày 21
  // theo UTC, và nhãn "Ngày 21 hằng tháng" sẽ nói sai với người đang nhìn.
  const dayLabel = startIso ? formatDate(startIso).slice(0, 2) : null;

  const monthlyLabel: Record<MonthlyMode, string> = {
    day_of_month: dayLabel ? `Ngày ${dayLabel} hằng tháng` : "Theo ngày trong tháng",
    weekday_of_month:
      weekday !== null && ordinal
        ? `${WEEKDAY_LABELS[weekday]} tuần thứ ${ordinal} hằng tháng`
        : "Theo thứ trong tháng"
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <input
          type="checkbox"
          name="recurrence_enabled"
          value="true"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green"
        />
        Sự kiện lặp lại
      </label>

      {!enabled ? (
        <p className="mt-1 text-[11px] text-slate-500">
          Tick vào đây nếu sự kiện diễn ra nhiều buổi theo lịch cố định.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium uppercase text-slate-500">Tần suất</span>
              <select
                name="recurrence_frequency"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}
                className={INPUT}
              >
                {RECURRENCE_FREQUENCIES.map((value) => (
                  <option key={value} value={value}>
                    {RECURRENCE_FREQUENCY_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase text-slate-500">
                Cách nhau {frequency === "weekly" ? "mấy tuần" : "mấy tháng"}
              </span>
              <input
                name="recurrence_interval"
                type="number"
                min={1}
                max={12}
                step={1}
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
                className={INPUT}
              />
            </label>
          </div>

          {frequency === "monthly" ? (
            <fieldset>
              <legend className="text-xs font-medium uppercase text-slate-500">Lặp theo</legend>
              <div className="mt-2 flex flex-col gap-2">
                {MONTHLY_MODES.map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-vam-ink">
                    <input
                      type="radio"
                      name="recurrence_monthly_mode"
                      value={value}
                      checked={monthlyMode === value}
                      onChange={() => setMonthlyMode(value)}
                      className="h-4 w-4 border-slate-300 text-vam-green focus:ring-vam-green"
                    />
                    {monthlyLabel[value]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <input type="hidden" name="recurrence_monthly_mode" value="day_of_month" />
          )}

          <fieldset>
            <legend className="text-xs font-medium uppercase text-slate-500">Kết thúc</legend>
            <div className="mt-2 flex flex-col gap-2">
              <label className="flex flex-wrap items-center gap-2 text-sm text-vam-ink">
                <input
                  type="radio"
                  name="recurrence_end_mode"
                  value="after_count"
                  checked={endMode === "after_count"}
                  onChange={() => setEndMode("after_count")}
                  className="h-4 w-4 border-slate-300 text-vam-green focus:ring-vam-green"
                />
                Sau
                <input
                  name="recurrence_count"
                  type="number"
                  min={1}
                  max={MAX_OCCURRENCES}
                  step={1}
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                  disabled={endMode !== "after_count"}
                  className="w-20 rounded-md border border-vam-line bg-white px-2 py-1 text-sm tabular-nums disabled:bg-slate-100"
                />
                buổi
              </label>

              <label className="flex flex-wrap items-center gap-2 text-sm text-vam-ink">
                <input
                  type="radio"
                  name="recurrence_end_mode"
                  value="on_date"
                  checked={endMode === "on_date"}
                  onChange={() => setEndMode("on_date")}
                  className="h-4 w-4 border-slate-300 text-vam-green focus:ring-vam-green"
                />
                Đến hết ngày
                <input
                  name="recurrence_ends_on"
                  type="date"
                  value={endsOn}
                  onChange={(event) => setEndsOn(event.target.value)}
                  disabled={endMode !== "on_date"}
                  className="rounded-md border border-vam-line bg-white px-2 py-1 text-sm disabled:bg-slate-100"
                />
              </label>
            </div>
          </fieldset>

          <div className="rounded-md border border-vam-line bg-white p-3">
            <h4 className="text-xs font-semibold uppercase text-slate-500">Sẽ tạo các buổi</h4>
            {!valid ? (
              <p className="mt-2 text-sm text-slate-500">Chọn thời điểm bắt đầu để xem trước.</p>
            ) : preview?.ok ? (
              <>
                <p className="mt-1 text-sm text-vam-ink">
                  {describeRecurrence({
                    startsAt: startIso,
                    rule,
                    total: preview.occurrences.length
                  })}
                </p>
                <ol className="mt-2 flex flex-col gap-0.5 text-sm tabular-nums text-slate-700">
                  {preview.occurrences.slice(0, 10).map((occurrence, index) => (
                    <li key={occurrence.startsAt}>
                      <span className="mr-2 text-slate-400">{index + 1}.</span>
                      {formatDate(occurrence.startsAt)}
                      <span className="ml-2 text-slate-500">
                        {formatTime(occurrence.startsAt)}
                        {occurrence.endsAt ? ` – ${formatTime(occurrence.endsAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
                {preview.occurrences.length > 10 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    …và {preview.occurrences.length - 10} buổi nữa.
                  </p>
                ) : null}
                {preview.capped ? (
                  <p className="mt-2 text-xs text-amber-800">
                    Mỗi lần tạo tối đa {MAX_OCCURRENCES} buổi. Muốn dài hơn thì tạo tiếp một chuỗi
                    mới từ buổi cuối.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-amber-800">{preview?.message}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
