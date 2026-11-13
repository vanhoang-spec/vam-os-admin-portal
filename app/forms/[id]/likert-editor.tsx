"use client";

import { CUSTOM_FORM_LIMITS, LIKERT_PRESETS, newGridRowId, type CustomFormGridRow } from "@/lib/custom-form-core";

const BOX =
  "w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
const SMALL_BUTTON = "rounded-md border border-vam-line bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40";

/** Dán nhiều dòng vào một ô thì tách thành nhiều mục, như ô lựa chọn của câu chọn một. */
const pastedLines = (e: React.ClipboardEvent<HTMLInputElement>) =>
  e.clipboardData
    .getData("text")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);

/**
 * Soạn hàng và cột của một lưới thang đo (VAM00032). Hàng giữ mã riêng suốt lúc soạn, nên sửa chữ một phát
 * biểu đã có câu trả lời vẫn giữ câu trả lời cũ. Đã có câu trả lời thì hàng cũ và mức cũ không xoá được (máy
 * chủ cũng từ chối), chỉ thêm — thang mẫu cũng khoá vì nó thay cả bộ mức.
 */
export function LikertEditor({
  rows,
  columnsText,
  lockedRowIds,
  lockedColumns,
  onChange
}: {
  rows: CustomFormGridRow[];
  columnsText: string;
  lockedRowIds: ReadonlySet<string>;
  lockedColumns: readonly string[];
  onChange: (patch: { rows?: CustomFormGridRow[]; optionsText?: string }) => void;
}) {
  const columns = columnsText.split("\n");
  const setColumns = (next: string[]) => onChange({ optionsText: next.join("\n") });
  const rowsFull = rows.length >= CUSTOM_FORM_LIMITS.gridRows;
  const columnsFull = columns.length >= CUSTOM_FORM_LIMITS.gridColumns;
  return (
    <div className="grid gap-3 rounded-md border border-vam-line p-2" data-testid="likert-editor">
      <div className="grid gap-2" data-testid="likert-rows">
        <p className="text-xs text-slate-600">
          Phát biểu cần đánh giá (hàng), tối đa {CUSTOM_FORM_LIMITS.gridRows}. Dán nhiều dòng vào một ô thì tự tách thành nhiều phát biểu.
          {lockedRowIds.size ? " Đã có câu trả lời: sửa chữ được, không xoá được phát biểu cũ." : ""}
        </p>
        {rows.map((row, index) => (
          <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-2" data-testid="likert-row-edit">
            <input
              className={BOX}
              aria-label={`Phát biểu ${index + 1}`}
              maxLength={CUSTOM_FORM_LIMITS.label}
              value={row.label}
              onChange={(e) => onChange({ rows: rows.map((r) => (r.id === row.id ? { ...r, label: e.target.value } : r)) })}
              onPaste={(e) => {
                const pasted = pastedLines(e);
                if (pasted.length < 2) return;
                e.preventDefault();
                const extra = pasted.slice(1).map((label) => ({ id: newGridRowId(), label }));
                const next = [...rows.slice(0, index), { ...row, label: pasted[0] }, ...extra, ...rows.slice(index + 1)];
                onChange({ rows: next.slice(0, CUSTOM_FORM_LIMITS.gridRows) });
              }}
            />
            <button
              type="button"
              className={SMALL_BUTTON}
              disabled={lockedRowIds.has(row.id) || rows.length <= 1}
              aria-label={`Xoá phát biểu ${index + 1}`}
              onClick={() => onChange({ rows: rows.filter((r) => r.id !== row.id) })}
            >
              Xoá
            </button>
          </div>
        ))}
        <button
          type="button"
          data-testid="likert-add-row"
          className={`${SMALL_BUTTON} justify-self-start`}
          disabled={rowsFull}
          onClick={() => onChange({ rows: [...rows, { id: newGridRowId(), label: "" }] })}
        >
          + Thêm phát biểu
        </button>
      </div>

      <div className="grid gap-2" data-testid="likert-columns">
        <p className="text-xs text-slate-600">
          Mức đánh giá (cột), từ 2 tới {CUSTOM_FORM_LIMITS.gridColumns} mức, theo thứ tự hiện trên form.
          {lockedColumns.length ? " Đã có câu trả lời: giữ các mức cũ, chỉ thêm mức mới." : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-600">Thang mẫu:</span>
          {LIKERT_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className={SMALL_BUTTON}
              disabled={lockedColumns.length > 0}
              title={lockedColumns.length ? "Đã có câu trả lời — không thay được cả bộ mức" : undefined}
              onClick={() => setColumns([...preset.columns])}
            >
              {preset.name}
            </button>
          ))}
        </div>
        {columns.map((column, index) => {
          const columnLocked = lockedColumns.includes(column.trim());
          return (
            <div key={index} className="grid grid-cols-[1fr_auto] items-center gap-2" data-testid="likert-column-edit">
              <input
                className={BOX}
                aria-label={`Mức ${index + 1}`}
                maxLength={CUSTOM_FORM_LIMITS.gridColumn}
                readOnly={columnLocked}
                value={column}
                onChange={(e) => setColumns(columns.map((c, i) => (i === index ? e.target.value : c)))}
                onPaste={(e) => {
                  const pasted = pastedLines(e);
                  if (columnLocked || pasted.length < 2) return;
                  e.preventDefault();
                  setColumns([...columns.slice(0, index), ...pasted, ...columns.slice(index + 1)].slice(0, CUSTOM_FORM_LIMITS.gridColumns));
                }}
              />
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={columnLocked || columns.length <= 2}
                aria-label={`Xoá mức ${index + 1}`}
                onClick={() => setColumns(columns.filter((_, i) => i !== index))}
              >
                Xoá
              </button>
            </div>
          );
        })}
        <button
          type="button"
          data-testid="likert-add-column"
          className={`${SMALL_BUTTON} justify-self-start`}
          disabled={columnsFull}
          onClick={() => setColumns([...columns, ""])}
        >
          + Thêm mức
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Người điền chọn đúng một mức cho mỗi phát biểu. Bật “Bắt buộc trả lời” thì phải chọn đủ mọi phát biểu. Trong CSV mỗi phát biểu là một cột “Câu hỏi [Phát biểu]”.
      </p>
    </div>
  );
}
