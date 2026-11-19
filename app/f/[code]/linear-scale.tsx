"use client";

import { scaleValues, themeTextColor, type CustomFormField } from "@/lib/custom-form-core";

/**
 * Thang đo tuyến tính trên form công khai (VAM00033), như "Linear scale" của Google Forms: các mức điểm tăng dần
 * trên MỘT hàng ngang, một bộ radio duy nhất (chọn đúng một mức), nhãn hai đầu hiện ngay dưới hai đầu thang.
 *
 * Một bố cục cho mọi cỡ màn hình: hàng mức là lưới `repeat(n, minmax(0, 1fr))`, mỗi mức chia đều bề ngang và được
 * phép co dưới bề rộng chữ, nên 11 mức (0–10) vẫn nằm gọn một hàng ở màn 360px (khung form còn ~294px, mỗi mức
 * ~23px, đủ cho nút radio 16px và chữ số). Không xuống dòng: thang gãy thành hai hàng thì mức cao nằm dưới mức thấp,
 * đọc sai chiều. Nhãn hai đầu nằm dưới hàng mức (không nằm hai bên) để không lấy bớt chỗ của các mức trên điện thoại.
 *
 * Mức đã chọn tô theo màu chủ đạo của form (`themeColor`) nếu có, như nút Gửi.
 */
export function LinearScale({
  field,
  common,
  value,
  themeColor,
  onPick
}: {
  field: CustomFormField;
  common: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; "aria-required"?: boolean };
  value: string;
  themeColor?: string | null;
  onPick: (value: string) => void;
}) {
  const values = scaleValues(field.scale);
  const minLabel = field.scale?.minLabel ?? "";
  const maxLabel = field.scale?.maxLabel ?? "";
  const pickedStyle = themeColor ? { backgroundColor: themeColor, borderColor: themeColor, color: themeTextColor(themeColor) } : undefined;
  const ends = values.length ? { [values[0]]: minLabel, [values[values.length - 1]]: maxLabel } : {};
  return (
    <div {...common} role="radiogroup" tabIndex={-1} data-testid="linear-scale" className="grid min-w-0 gap-1.5">
      <div
        data-testid="linear-scale-options"
        className="grid min-w-0 gap-1"
        style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
      >
        {values.map((n, index) => {
          const checked = value === n;
          const end = ends[n];
          return (
            <label
              key={n}
              data-testid="linear-scale-option"
              data-value={n}
              className={`flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-md border py-2 text-sm font-medium tabular-nums ${
                checked ? (pickedStyle ? "" : "border-vam-green bg-vam-mint/40 text-vam-ink") : "border-vam-line bg-white text-vam-ink hover:bg-slate-50"
              }`}
              style={checked ? pickedStyle : undefined}
            >
              <span>{n}</span>
              <input
                type="radio"
                id={`q-${field.id}-${index}`}
                name={`q-${field.id}`}
                value={n}
                className="h-4 w-4"
                style={themeColor ? { accentColor: themeColor } : undefined}
                aria-label={end ? `${n} – ${end}` : n}
                checked={checked}
                onChange={() => onPick(n)}
              />
            </label>
          );
        })}
      </div>
      {minLabel || maxLabel ? (
        <div data-testid="linear-scale-labels" className="flex min-w-0 justify-between gap-3 text-xs text-slate-600">
          <span data-testid="linear-scale-min-label" className="min-w-0 max-w-[48%] break-words text-left">
            {minLabel}
          </span>
          <span data-testid="linear-scale-max-label" className="min-w-0 max-w-[48%] break-words text-right">
            {maxLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
