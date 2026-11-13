"use client";

import { gridAnswerKey, type CustomFormField } from "@/lib/custom-form-core";

/**
 * Số mức tối đa còn vẽ được dạng bảng. Thẻ form rộng tối đa `max-w-2xl` (672px), trừ đệm còn khoảng 640px;
 * bảng cần ít nhất 9rem (144px) cho cột phát biểu + 3.5rem (56px) mỗi mức + khe. 8 mức ≈ 600px là vừa;
 * từ 9 mức trở lên lưới rộng hơn khung và cả trang cuộn ngang (đo 13/11/2026: 11 mức ở màn 768px tràn 125px,
 * 9 mức tràn 5px), cột phát biểu bị bóp thành cột chữ dọc. Bớt bề rộng tối thiểu mỗi ô thì nút radio và chữ
 * mức sát nhau khó bấm, nên quá ngưỡng thì dùng dạng thẻ (như trên điện thoại) ở mọi cỡ màn hình.
 */
export const LIKERT_TABLE_MAX_COLUMNS = 8;

/**
 * Lưới thang đo Likert trên form công khai (VAM00032). Một bố cục cho cả hai cỡ màn hình, không vẽ hai bản:
 * hai bản thì mỗi mức có hai nút radio cùng tên, trình đọc màn hình đọc đôi và test chọn nhầm bản đang ẩn.
 *
 * - Điện thoại: mỗi phát biểu một khối, các mức xếp thành nút có chữ, tự xuống dòng — bảng 5–11 cột không
 *   vừa bề ngang điện thoại.
 * - Máy tính (sm trở lên), khi số mức không quá LIKERT_TABLE_MAX_COLUMNS: bảng hàng × cột; hàng tiêu đề ghi
 *   chữ của mức, nên chữ trong từng ô chỉ còn cho trình đọc màn hình (`sm:sr-only`). Khối chứa các mức thành
 *   `display: contents` để từng mức là một ô của lưới hàng.
 * - Quá ngưỡng: dạng thẻ ở mọi cỡ màn hình. Các lớp viết thành hai chuỗi tĩnh đầy đủ (không ghép tên lớp)
 *   để Tailwind quét thấy.
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
  const table = columns.length <= LIKERT_TABLE_MAX_COLUMNS;
  const style = table
    ? ({ "--likert-cols": `minmax(9rem, 2fr) repeat(${columns.length}, minmax(3.5rem, 1fr))` } as React.CSSProperties)
    : undefined;
  const columnsClass = "sm:items-center sm:gap-1 sm:[grid-template-columns:var(--likert-cols)]";
  return (
    <div
      {...common}
      role="group"
      tabIndex={-1}
      data-testid="likert-grid"
      data-layout={table ? "table" : "cards"}
      className={table ? "grid gap-3 sm:gap-0" : "grid gap-3"}
      style={style}
    >
      {table ? (
        <div
          aria-hidden="true"
          data-testid="likert-header"
          className={`hidden border-b border-vam-line pb-2 text-center text-xs font-medium text-slate-600 sm:grid ${columnsClass}`}
        >
          <span />
          {columns.map((column) => (
            <span key={column} className="break-words px-1">
              {column}
            </span>
          ))}
        </div>
      ) : null}
      {(field.rows ?? []).map((row, rowIndex) => {
        const key = gridAnswerKey(field.id, row.id);
        const picked = valueOf(key);
        const missing = invalid && !picked;
        const labelId = `q-${key}-label`;
        const rowClass = table
          ? `grid gap-2 ${columnsClass} rounded-md border border-vam-line p-3 sm:rounded-none sm:border-0 sm:border-b sm:px-0 sm:py-2 ${rowIndex % 2 ? "sm:bg-slate-50" : ""}`
          : "grid gap-2 rounded-md border border-vam-line p-3";
        const statementClass = table ? "text-base font-medium sm:pl-1 sm:text-sm sm:font-normal" : "text-base font-medium";
        return (
          <div
            key={row.id}
            role="radiogroup"
            aria-labelledby={labelId}
            aria-invalid={missing || undefined}
            data-testid="likert-row"
            data-row={row.id}
            className={rowClass}
          >
            <span id={labelId} className={`${statementClass} ${missing ? "text-red-600" : "text-vam-ink"}`}>
              {row.label}
            </span>
            <div data-testid="likert-options" className={table ? "flex flex-wrap gap-2 sm:contents" : "flex flex-wrap gap-2"}>
              {columns.map((column, columnIndex) => {
                const checked = picked === column;
                const optionClass = table
                  ? `flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm sm:justify-center sm:rounded-none sm:border-0 sm:px-0 sm:py-1 ${
                      checked ? "border-vam-green bg-vam-mint/40" : "border-vam-line bg-white sm:bg-transparent"
                    }`
                  : `flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                      checked ? "border-vam-green bg-vam-mint/40" : "border-vam-line bg-white"
                    }`;
                return (
                  <label key={column} className={optionClass}>
                    <input
                      type="radio"
                      id={`q-${key}-${columnIndex}`}
                      name={`q-${key}`}
                      className="h-4 w-4"
                      checked={checked}
                      onChange={() => onPick(key, column)}
                    />
                    <span className={table ? "sm:sr-only" : undefined}>{column}</span>
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
