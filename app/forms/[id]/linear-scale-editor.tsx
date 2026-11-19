"use client";

import {
  CUSTOM_FORM_LIMITS,
  LINEAR_SCALE_MAX_FROM,
  LINEAR_SCALE_MAX_TO,
  LINEAR_SCALE_MINS,
  scaleValues,
  type CustomFormScale
} from "@/lib/custom-form-core";

const BOX =
  "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const SELECT = "rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm";
const MAXES = Array.from({ length: LINEAR_SCALE_MAX_TO - LINEAR_SCALE_MAX_FROM + 1 }, (_, i) => LINEAR_SCALE_MAX_FROM + i);

/**
 * Soạn một thang đo tuyến tính (VAM00033): điểm bắt đầu 0 hoặc 1, điểm kết thúc 2–10, nhãn tuỳ chọn cho hai đầu —
 * đúng các lựa chọn Google Forms cho, nên không có ô nào nhập được khoảng sai. Dòng xem trước liệt kê các mức để
 * người tạo form thấy ngay người điền sẽ chọn gì.
 *
 * `locked`: khoảng đã lưu của câu đã có câu trả lời. Câu trả lời lưu mức điểm, nên chỉ được mở rộng khoảng (máy chủ
 * cũng từ chối thu hẹp); các giá trị thu hẹp bị tắt trong ô chọn. Nhãn sửa tự do.
 */
export function LinearScaleEditor({
  scale,
  locked,
  onChange
}: {
  scale: CustomFormScale;
  locked: CustomFormScale | null;
  onChange: (scale: CustomFormScale) => void;
}) {
  const set = (patch: Partial<CustomFormScale>) => onChange({ ...scale, ...patch });
  return (
    <div className="grid gap-3 rounded-md border border-vam-line p-2" data-testid="linear-scale-editor">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span>Từ</span>
        <select aria-label="Điểm bắt đầu" className={SELECT} value={scale.min} onChange={(e) => set({ min: Number(e.target.value) })}>
          {LINEAR_SCALE_MINS.map((n) => (
            <option key={n} value={n} disabled={Boolean(locked && n > locked.min)}>
              {n}
            </option>
          ))}
        </select>
        <span>đến</span>
        <select aria-label="Điểm kết thúc" className={SELECT} value={scale.max} onChange={(e) => set({ max: Number(e.target.value) })}>
          {MAXES.map((n) => (
            <option key={n} value={n} disabled={Boolean(locked && n < locked.max)}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-slate-600">
          <span>Nhãn cho điểm {scale.min} (không bắt buộc)</span>
          <input
            className={BOX}
            aria-label="Nhãn điểm bắt đầu"
            placeholder="Ví dụ: Rất không hài lòng"
            maxLength={CUSTOM_FORM_LIMITS.scaleLabel}
            value={scale.minLabel}
            onChange={(e) => set({ minLabel: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-xs text-slate-600">
          <span>Nhãn cho điểm {scale.max} (không bắt buộc)</span>
          <input
            className={BOX}
            aria-label="Nhãn điểm kết thúc"
            placeholder="Ví dụ: Rất hài lòng"
            maxLength={CUSTOM_FORM_LIMITS.scaleLabel}
            value={scale.maxLabel}
            onChange={(e) => set({ maxLabel: e.target.value })}
          />
        </label>
      </div>
      <p className="text-xs text-slate-500" data-testid="linear-scale-preview">
        Người điền chọn một mức: {scaleValues(scale).join(" · ")}. Excel xuất ra ghi số để tổng hợp.
        {locked ? ` Đã có câu trả lời: chỉ mở rộng được thang (đang lưu ${locked.min}–${locked.max}), sửa nhãn thì được.` : ""}
      </p>
    </div>
  );
}
