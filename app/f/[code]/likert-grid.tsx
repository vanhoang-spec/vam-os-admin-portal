"use client";

import { gridAnswerKey, type CustomFormField } from "@/lib/custom-form-core";

/**
 * Lưới thang đo Likert trên form công khai (VAM00032). Một bố cục cho cả hai cỡ màn hình, không vẽ hai bản:
 * hai bản thì mỗi mức có hai nút radio cùng tên, trình đọc màn hình đọc đôi và test chọn nhầm bản đang ẩn.
 *
 * - Điện thoại: mỗi phát biểu một khối, các mức xếp thành nút có chữ, tự xuống dòng — bảng 5–11 cột không
 *   vừa bề ngang điện thoại.
 * - Máy tính (sm trở lên): bảng hàng × cột; hàng tiêu đề ghi chữ của mức, nên chữ trong từng ô chỉ còn cho
 *   trình đọc màn hình (`sm:sr-only`). Khối chứa các mức thành `display: contents` để từng mức là một ô
 *   của lưới hàng.
 */
export function LikertGrid({
  field,
  common,
  invalid,
  valueOf,
  onPick
}: {
  field: CustomFormField;
  common: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string; "aria-required"?: boolean };
  invalid: boolean;
  valueOf: (key: string) => string;
  onPick: (key: string, option: string) => void;
}) {
  const columns = field.options;
  const style = { "--likert-cols": `minmax(9rem, 2fr) repeat(${columns.length}, minmax(3.5rem, 1fr))` } as React.CSSProperties;
  const columnsClass = "sm:items-center sm:gap-1 sm:[grid-template-columns:var(--likert-cols)]";
  const rowClass = `grid gap-2 ${columnsClass}`;
  return (
    <div {...common} role="group" tabIndex={-1} data-testid="likert-grid" className="grid gap-3 sm:gap-0" style={style}>
      <div aria-hidden="true" className={`hidden border-b border-vam-line pb-2 text-center text-xs font-medium text-slate-600 sm:grid ${columnsClass}`}>
        <span />
        {columns.map((column) => (
          <span key={column} className="break-words px-1">
            {column}
          </span>
        ))}
      </div>
      {(field.rows ?? []).map((row, rowIndex) => {
        const key = gridAnswerKey(field.id, row.id);
        const picked = valueOf(key);
        const missing = invalid && !picked;
        const labelId = `q-${key}-label`;
        return (
          <div
            key={row.id}
            role="radiogroup"
            aria-labelledby={labelId}
            aria-invalid={missing || undefined}
            data-testid="likert-row"
            data-row={row.id}
            className={`${rowClass} rounded-md border border-vam-line p-3 sm:rounded-none sm:border-0 sm:border-b sm:px-0 sm:py-2 ${rowIndex % 2 ? "sm:bg-slate-50" : ""}`}
          >
            <span id={labelId} className={`text-base font-medium sm:pl-1 sm:text-sm sm:font-normal ${missing ? "text-red-600" : "text-vam-ink"}`}>
              {row.label}
            </span>
            <div className="flex flex-wrap gap-2 sm:contents">
              {columns.map((column, columnIndex) => {
                const checked = picked === column;
                return (
                  <label
                    key={column}
                    className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm sm:justify-center sm:rounded-none sm:border-0 sm:px-0 sm:py-1 ${
                      checked ? "border-vam-green bg-vam-mint/40" : "border-vam-line bg-white sm:bg-transparent"
                    }`}
                  >
                    <input
                      type="radio"
                      id={`q-${key}-${columnIndex}`}
                      name={`q-${key}`}
                      className="h-4 w-4"
                      checked={checked}
                      onChange={() => onPick(key, column)}
                    />
                    <span className="sm:sr-only">{column}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
