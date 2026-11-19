"use client";

import { useEffect, useRef, useState } from "react";
import { gridAnswerKey, type CustomFormField } from "@/lib/custom-form-core";

/**
 * Số mức tối đa còn vẽ được dạng bảng. Thẻ form rộng tối đa `max-w-2xl` (672px), trừ đệm còn khoảng 640px;
 * từ 9 mức trở lên bảng rộng hơn khung (đo 13/11/2026: 11 mức ở màn 768px tràn 125px, 9 mức tràn 5px), cột
 * phát biểu bị bóp thành cột chữ dọc. Bớt bề rộng tối thiểu mỗi ô thì nút radio và chữ mức sát nhau khó bấm,
 * nên quá ngưỡng thì dùng dạng thẻ ở mọi cỡ màn hình.
 */
export const LIKERT_TABLE_MAX_COLUMNS = 8;

/** Bề rộng tối thiểu (rem) của cột phát biểu và của mỗi mức trong dạng bảng; 3rem ≈ 48px, đủ cho một ngón tay. */
const STATEMENT_MIN_REM = 7;
const COLUMN_MIN_REM = 3;
const GAP_REM = 0.25;

/** Bề rộng tối thiểu của bảng n mức. Hẹp hơn thì khung lưới cuộn ngang (chỉ khung lưới, không cả trang). */
export function likertTableMinWidth(columns: number): string {
  return `${STATEMENT_MIN_REM + columns * (COLUMN_MIN_REM + GAP_REM)}rem`;
}

/** Bảng có rộng hơn khung không (để hiện dòng nhắc vuốt ngang). Trình duyệt không có ResizeObserver thì coi là không. */
function useOverflowsX(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === "undefined") return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, overflows };
}

/**
 * Lưới thang đo Likert trên form công khai (VAM00032). Một bố cục cho mọi cỡ màn hình, không vẽ hai bản:
 * hai bản thì mỗi mức có hai nút radio cùng tên, trình đọc màn hình đọc đôi và test chọn nhầm bản đang ẩn.
 *
 * - Không quá LIKERT_TABLE_MAX_COLUMNS mức: bảng hàng × cột ở MỌI cỡ màn hình, điện thoại trình bày như laptop
 *   (VAM00035: dạng nút tự xuống dòng trên điện thoại dễ chọn nhầm). Hàng tiêu đề ghi chữ của mức, chữ trong
 *   từng ô chỉ cho trình đọc màn hình. Màn hẹp hơn bảng thì khung lưới cuộn ngang, cột phát biểu đứng yên bên
 *   trái (`sticky`) để luôn biết đang chọn cho phát biểu nào, và hiện dòng nhắc vuốt ngang.
 * - Quá ngưỡng: dạng thẻ ở mọi cỡ màn hình, mỗi phát biểu một khối, các mức là nút có chữ.
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
  const { ref, overflows } = useOverflowsX(table);
  if (!table) {
    return (
      <div {...common} role="group" tabIndex={-1} data-testid="likert-grid" data-layout="cards" className="grid gap-3">
        {(field.rows ?? []).map((row) => {
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
              className="grid gap-2 rounded-md border border-vam-line p-3"
            >
              <span id={labelId} className={`text-base font-medium ${missing ? "text-red-600" : "text-vam-ink"}`}>
                {row.label}
              </span>
              <div data-testid="likert-options" className="flex flex-wrap gap-2">
                {columns.map((column, columnIndex) => {
                  const checked = picked === column;
                  return (
                    <label
                      key={column}
                      className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                        checked ? "border-vam-green bg-vam-mint/40" : "border-vam-line bg-white"
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
                      <span>{column}</span>
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
  const style = {
    "--likert-cols": `minmax(${STATEMENT_MIN_REM}rem, 3fr) repeat(${columns.length}, minmax(${COLUMN_MIN_REM}rem, 1fr))`
  } as React.CSSProperties;
  const columnsClass = "grid items-center gap-1 [grid-template-columns:var(--likert-cols)]";
  return (
    <div className="grid gap-1">
      {overflows ? (
        <p data-testid="likert-scroll-hint" className="text-xs text-slate-500">
          Vuốt ngang trong bảng để xem hết các mức.
        </p>
      ) : null}
      <div
        {...common}
        ref={ref}
        role="group"
        tabIndex={-1}
        data-testid="likert-grid"
        data-layout="table"
        className="overflow-x-auto"
        style={style}
      >
        <div data-testid="likert-table" className="grid" style={{ minWidth: likertTableMinWidth(columns.length) }}>
          <div
            aria-hidden="true"
            data-testid="likert-header"
            className={`${columnsClass} border-b border-vam-line pb-2 text-center text-xs font-medium text-slate-600`}
          >
            <span className="sticky left-0 z-10 self-stretch bg-white" />
            {columns.map((column) => (
              <span key={column} className="break-words px-0.5">
                {column}
              </span>
            ))}
          </div>
          {(field.rows ?? []).map((row, rowIndex) => {
            const key = gridAnswerKey(field.id, row.id);
            const picked = valueOf(key);
            const missing = invalid && !picked;
            const labelId = `q-${key}-label`;
            const rowBg = rowIndex % 2 ? "bg-slate-50" : "bg-white";
            return (
              <div
                key={row.id}
                role="radiogroup"
                aria-labelledby={labelId}
                aria-invalid={missing || undefined}
                data-testid="likert-row"
                data-row={row.id}
                className={`${columnsClass} border-b border-vam-line py-1 ${rowBg}`}
              >
                <span
                  id={labelId}
                  data-testid="likert-statement"
                  className={`sticky left-0 z-10 flex self-stretch items-center py-1 pl-1 pr-2 text-sm ${rowBg} ${missing ? "text-red-600" : "text-vam-ink"}`}
                >
                  {row.label}
                </span>
                {columns.map((column, columnIndex) => {
                  const checked = picked === column;
                  return (
                    <label
                      key={column}
                      data-testid="likert-cell"
                      className={`flex min-h-11 cursor-pointer items-center justify-center rounded-md ${checked ? "bg-vam-mint/40" : ""}`}
                    >
                      <input
                        type="radio"
                        id={`q-${key}-${columnIndex}`}
                        name={`q-${key}`}
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => onPick(key, column)}
                      />
                      <span className="sr-only">{column}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
