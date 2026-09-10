"use client";

import { useState } from "react";
import {
  combineVietnamDateTime,
  maskVietnamDate,
  maskVietnamTime,
  parseVietnamDateInput,
  parseVietnamDateTime,
  splitVietnamDateTime,
  toVietnamDateInput
} from "@/lib/event-datetime";
import { WEEKDAY_LABELS, weekdayOf } from "@/lib/event-recurrence";
import { formatDate, formatTime } from "@/lib/utils";

const BOX =
  "rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";

/**
 * Ô nhập ngày giờ của CRM — luôn `dd/mm/yyyy`, bất kể trình duyệt.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO KHÔNG DÙNG <input type="datetime-local">
 * ---------------------------------------------------------------------------
 * Ô đó hiển thị theo NGÔN NGỮ CỦA TRÌNH DUYỆT. Chrome đặt tiếng Anh vẽ ra
 * `mm/dd/yyyy`, và không có thuộc tính HTML hay CSS nào bắt nó đổi — đó là
 * giao diện của hệ điều hành, không phải của trang web.
 *
 * Chương trình đã chốt định dạng ngày là `dd/mm/yyyy` xuyên suốt. Một ô nhập
 * nói `09/20/2026` trong khi cả phần còn lại của CRM nói `20/09/2026` là chỗ
 * người ta sẽ đọc nhầm — và với ngày như `05/09`, đọc nhầm mà không hề biết.
 *
 * Đổi lại: mất bộ chọn lịch bật lên. Với người nhập vài sự kiện một mùa, gõ
 * tám chữ số nhanh hơn mở lịch rồi bấm.
 *
 * ---------------------------------------------------------------------------
 * GIÁ TRỊ GỬI LÊN
 * ---------------------------------------------------------------------------
 * Ô ẩn mang đúng dạng `YYYY-MM-DDTHH:mm` mà máy chủ vốn đã đọc được, nên không
 * chỗ nào ở phía sau phải sửa. Thiếu ngày hoặc thiếu giờ thì ô ẩn rỗng — một
 * nửa mốc thời gian không phải một mốc thời gian.
 */
export function VietnamDateTimeField({
  name,
  label,
  defaultValue,
  required,
  helper,
  onChange
}: {
  name: string;
  label: string;
  /** ISO hoặc `YYYY-MM-DDTHH:mm`. */
  defaultValue?: string | null;
  required?: boolean;
  helper?: string;
  /** Báo lên trên mỗi khi giá trị đổi, để phần xem trước lịch lặp theo kịp. */
  onChange?: (value: string) => void;
}) {
  const initial = splitVietnamDateTime(defaultValue);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  const combined = combineVietnamDateTime(date, time);
  const iso = parseVietnamDateTime(combined);
  const weekday = iso ? weekdayOf(iso) : null;

  function update(nextDate: string, nextTime: string) {
    setDate(nextDate);
    setTime(nextTime);
    onChange?.(combineVietnamDateTime(nextDate, nextTime));
  }

  // Chỉ báo lỗi khi người ta đã gõ ĐỦ cả hai ô mà vẫn không ra một mốc thật —
  // ví dụ 31/02 hay 25:00. Báo sớm hơn thì nó nhấp nháy đỏ ngay dưới tay người
  // đang gõ dở, mà chưa ai làm gì sai cả.
  const bothComplete =
    date.replace(/\D/g, "").length === 8 && time.replace(/\D/g, "").length === 4;
  const badDate = bothComplete && !iso;

  return (
    <div className="block">
      <span className="text-xs font-medium uppercase text-slate-500">
        {label}
        {required ? " (*)" : ""}
      </span>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`${label} — ngày, dạng ngày/tháng/năm`}
          placeholder="dd/mm/yyyy"
          value={date}
          onChange={(event) => update(maskVietnamDate(event.target.value), time)}
          className={`${BOX} w-36 tabular-nums`}
        />
        <span className="text-sm text-slate-400">lúc</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label={`${label} — giờ, dạng giờ:phút`}
          placeholder="hh:mm"
          value={time}
          onChange={(event) => update(date, maskVietnamTime(event.target.value))}
          className={`${BOX} w-24 tabular-nums`}
        />
      </div>

      {/* Thứ thật sự được gửi lên. */}
      <input type="hidden" name={name} value={combined} />
      {/* Bắt buộc mà chưa đủ thì trình duyệt chặn ngay, không đợi tới máy chủ. */}
      {required ? (
        <input
          type="text"
          required
          value={combined}
          onChange={() => undefined}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only h-0 w-0 border-0 p-0"
        />
      ) : null}

      {iso ? (
        <span className="mt-1 block text-[11px] font-medium text-vam-green">
          {weekday === null ? "" : `${WEEKDAY_LABELS[weekday]}, `}
          {formatDate(iso)} lúc {formatTime(iso)} (giờ Việt Nam)
        </span>
      ) : badDate ? (
        <span className="mt-1 block text-[11px] font-medium text-amber-800">
          Ngày hoặc giờ không có thật. Kiểm lại — ngày trước, tháng sau.
        </span>
      ) : (
        <span className="mt-1 block text-[11px] text-slate-500">
          {helper ?? "Gõ ngày trước, tháng sau. Ví dụ 20/09/2026 lúc 08:00."}
        </span>
      )}
    </div>
  );
}

/**
 * Chỉ ngày, không giờ — cùng lý do với `VietnamDateTimeField`.
 *
 * Dùng cho những chỗ mốc thời gian là một NGÀY chứ không phải một thời điểm,
 * ví dụ "chuỗi lặp đến hết ngày nào".
 */
export function VietnamDateField({
  name,
  label,
  defaultValue,
  disabled,
  onChange
}: {
  name: string;
  label: string;
  /** `YYYY-MM-DD`. */
  defaultValue?: string | null;
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  const [text, setText] = useState(toVietnamDateInput(defaultValue));
  const iso = parseVietnamDateInput(text);
  const complete = text.replace(/\D/g, "").length === 8;

  return (
    <span className="inline-flex flex-col">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={`${label} — dạng ngày/tháng/năm`}
        placeholder="dd/mm/yyyy"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const next = maskVietnamDate(event.target.value);
          setText(next);
          onChange?.(parseVietnamDateInput(next) ?? "");
        }}
        className={`${BOX} w-36 tabular-nums disabled:bg-slate-100`}
      />
      {/* Máy chủ vẫn nhận `YYYY-MM-DD` như trước. */}
      <input type="hidden" name={name} value={iso ?? ""} />
      {complete && !iso ? (
        <span className="mt-1 text-[11px] font-medium text-amber-800">Ngày không có thật.</span>
      ) : null}
    </span>
  );
}
