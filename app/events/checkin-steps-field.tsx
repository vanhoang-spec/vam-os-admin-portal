"use client";

import { useEffect, useRef, useState } from "react";
import {
  CHECKIN_PURPOSES,
  DEFAULT_CHECKIN_STEPS,
  MAX_CHECKIN_STEPS,
  isCheckinPurpose,
  type CheckinPurpose
} from "@/lib/event-checkin-steps";

const SMALL_BUTTON =
  "rounded border border-vam-line bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Lần quét mới gợi ý một mục chưa dùng tới, thay vì lặp lại Check in: sự kiện hai
 * lần Check in là ngoại lệ, không phải lựa chọn nên được điền sẵn.
 */
function nextPurpose(current: readonly CheckinPurpose[]): CheckinPurpose {
  return CHECKIN_PURPOSES.find((purpose) => !current.includes(purpose.value))?.value ?? "checkout";
}

/**
 * Thiết lập các lần quét mã QR của một sự kiện: Quét lần 1, Quét lần 2… mỗi lần
 * một mục chọn trong danh sách.
 *
 * Giá trị gửi lên nằm trong các ô ẩn `checkin_steps`, đúng thứ tự, kèm ô đánh dấu
 * `checkin_steps_present`. Ô đánh dấu để máy chủ phân biệt "form này có phần thiết
 * lập" với "form không gửi phần này" — thiếu nó, một form không có phần này sẽ bị
 * hiểu là muốn đổi các lần quét.
 *
 * Tắt QR thì phần này chỉ ẨN, vẫn nằm trong form: bỏ khỏi form là mất danh sách
 * đang có ngay lần lưu đó, và bật lại QR thì BTC phải thiết lập lại từ đầu.
 */
export function CheckinStepsField({
  initialSteps,
  hidden
}: {
  initialSteps: readonly CheckinPurpose[];
  hidden: boolean;
}) {
  const [steps, setSteps] = useState<CheckinPurpose[]>(() =>
    initialSteps.length ? initialSteps.slice(0, MAX_CHECKIN_STEPS) : DEFAULT_CHECKIN_STEPS.slice()
  );

  // Next đặt lại form sau mỗi lần gửi. Ô chọn điều khiển bằng state thì bị trình
  // duyệt đưa về lựa chọn đầu tiên trong khi state vẫn giữ giá trị thật: màn hình
  // nói "Check in" còn ô ẩn gửi "Check out". Dựng lại các ô chọn sau mỗi lần đặt
  // lại để chữ trên màn hình luôn khớp thứ sẽ được lưu.
  const [resetCount, setResetCount] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const onReset = () => setResetCount((count) => count + 1);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const change = (index: number, value: string) => {
    if (!isCheckinPurpose(value)) return;
    setSteps((current) => current.map((purpose, position) => (position === index ? value : purpose)));
  };

  const move = (from: number, to: number) => {
    setSteps((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = current.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  // Luôn còn ít nhất một lần quét: máy quét không có lần quét nào để chọn là máy
  // quét không dùng được.
  const remove = (index: number) => {
    setSteps((current) => (current.length <= 1 ? current : current.filter((_, position) => position !== index)));
  };

  const add = () => {
    setSteps((current) => (current.length >= MAX_CHECKIN_STEPS ? current : current.concat(nextPurpose(current))));
  };

  return (
    <div
      ref={rootRef}
      id="checkin-steps"
      hidden={hidden}
      className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
    >
      <input type="hidden" name="checkin_steps_present" value="1" />

      <p className="text-sm font-medium text-vam-ink">Các lần quét mã QR</p>
      <p className="mt-1 text-xs text-slate-500">
        Người tham dự chỉ nhận một mã QR. Mỗi lần quét dưới đây là một điểm quét trong sự kiện, và máy quét của
        người hỗ trợ chỉ hiện đúng danh sách này. Được quét ở bất kỳ lần nào cũng tính là đã tham dự.
      </p>

      <ol className="mt-3 grid gap-2">
        {steps.map((purpose, index) => (
          <li key={`${index}-${resetCount}`} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="checkin_steps" value={purpose} />
            <span className="w-24 shrink-0 text-sm font-medium text-slate-700">Quét lần {index + 1}</span>
            <select
              aria-label={`Mục của lần quét ${index + 1}`}
              value={purpose}
              onChange={(event) => change(index, event.target.value)}
              className="min-w-0 flex-1 rounded border border-vam-line bg-white px-3 py-1.5 text-sm sm:w-64 sm:flex-none"
            >
              {CHECKIN_PURPOSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="flex gap-1">
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={index === 0}
                aria-label={`Đưa lần quét ${index + 1} lên trước`}
                className={SMALL_BUTTON}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={index === steps.length - 1}
                aria-label={`Đưa lần quét ${index + 1} xuống sau`}
                className={SMALL_BUTTON}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(index)}
                disabled={steps.length <= 1}
                aria-label={`Xoá lần quét ${index + 1}`}
                className={SMALL_BUTTON}
              >
                Xoá
              </button>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={steps.length >= MAX_CHECKIN_STEPS}
          className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-sm font-medium text-vam-green hover:bg-vam-mint disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Thêm lần quét
        </button>
        <span className="text-xs tabular-nums text-slate-500">
          {steps.length}/{MAX_CHECKIN_STEPS} lần quét
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Có lần Check in thì người chưa qua Check in mà tới các lần quét khác sẽ hiện nhắc màu vàng trên máy quét,
        nhưng vẫn được ghi nhận. Sửa danh sách khi đang có người quét thì các máy quét phải tải lại trang.
      </p>
    </div>
  );
}
