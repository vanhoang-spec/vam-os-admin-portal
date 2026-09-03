"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const BULK_SCREENING_MAX_CLIENT = 25;

/**
 * Selection controls shared by the Mentor and Mentee screening queues.
 *
 * The header state is DERIVED from the live row checkboxes on every change and
 * on every mount — it is never stored independently. That is deliberate: the
 * previous Mentor-only control kept its own checked state, so a header could
 * stay visually ticked while the rows underneath it were empty (after a
 * back/forward navigation or a server re-render), which is exactly the
 * ambiguity Owner UAT reported. Deriving it means a checked header always
 * means "every selectable row on this page is selected", and nothing else.
 *
 * Selection is page-local by construction: the checkboxes are ordinary form
 * inputs inside the queue form, so navigating to another page, changing the
 * search/filter, or switching queue re-renders fresh unchecked inputs. Nothing
 * is persisted — no hidden fields carrying ids from other pages, no
 * localStorage, no sessionStorage. `resetKey` additionally remounts this
 * component when the page/filter/role changes, so the derived state cannot
 * survive a client-side navigation either.
 */
export function BulkScreeningToolbar({
  role,
  noteName = "decision_note"
}: {
  role: "mentor" | "mentee";
  /** Present so the field name stays explicit at the call site. */
  noteName?: string;
}) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLInputElement | null>(null);
  const [selected, setSelected] = useState(0);
  const [total, setTotal] = useState(0);

  const rowInputs = useCallback((): HTMLInputElement[] => {
    const form = anchorRef.current?.closest("form");
    if (!form) return [];
    return Array.from(
      form.querySelectorAll<HTMLInputElement>(
        `input[type="checkbox"][name="application_id"][data-bulk-role="${role}"]`
      )
    );
  }, [role]);

  const sync = useCallback(() => {
    const inputs = rowInputs();
    const checked = inputs.filter((input) => input.checked).length;
    setSelected(checked);
    setTotal(inputs.length);
    if (headerRef.current) {
      headerRef.current.checked = inputs.length > 0 && checked === inputs.length;
      headerRef.current.indeterminate = checked > 0 && checked < inputs.length;
    }
  }, [rowInputs]);

  useEffect(() => {
    sync();
    const form = anchorRef.current?.closest("form");
    if (!form) return;
    // Delegated, so rows re-rendered by the server are picked up without
    // re-binding per input.
    form.addEventListener("change", sync);
    // A bfcache restore replays the old DOM checked state; re-derive on it.
    window.addEventListener("pageshow", sync);
    return () => {
      form.removeEventListener("change", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [sync]);

  function toggleAll(checked: boolean) {
    for (const input of rowInputs()) input.checked = checked;
    sync();
  }

  const overLimit = selected > BULK_SCREENING_MAX_CLIENT;
  const canSubmit = selected > 0 && !overLimit;

  return (
    <div
      ref={anchorRef}
      className="mb-3 flex flex-col gap-3 rounded-md border border-vam-line bg-white p-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
          <input
            ref={headerRef}
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            data-testid="bulk-select-all"
            aria-label="Chọn tất cả hồ sơ trên trang này"
            onChange={(event) => toggleAll(event.currentTarget.checked)}
          />
          Chọn tất cả hồ sơ trên trang này
        </label>

        {selected > 0 && (
          <span
            data-testid="bulk-selected-count"
            className={`text-xs font-medium ${overLimit ? "text-red-700" : "text-vam-ink"}`}
          >
            Đã chọn {selected} hồ sơ
          </span>
        )}

        <label className="text-xs text-slate-600">
          Ghi chú chung
          <input
            name={noteName}
            placeholder="Không bắt buộc"
            className="ml-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-col items-end gap-2">
        {overLimit && (
          <p data-testid="bulk-over-limit" className="text-xs font-medium text-red-700">
            Tối đa {BULK_SCREENING_MAX_CLIENT} hồ sơ mỗi lần. Trang này đang chọn {selected}/{total}.
          </p>
        )}
        <BulkScreeningButtons disabled={!canSubmit} />
      </div>
    </div>
  );
}

function BulkScreeningButtons({ disabled }: { disabled: boolean }) {
  const base = "rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="submit"
        name="new_status"
        value="screening_passed"
        disabled={disabled}
        className={`${base} bg-vam-green text-white hover:opacity-90`}
      >
        Qua vòng hồ sơ
      </button>
      <button
        type="submit"
        name="new_status"
        value="needs_more_review"
        disabled={disabled}
        className={`${base} border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`}
      >
        Cần review thêm
      </button>
      <button
        type="submit"
        name="new_status"
        value="rejected_or_not_fit"
        disabled={disabled}
        onClick={(event) => {
          if (!window.confirm("Xác nhận đánh dấu các hồ sơ đã chọn là Không phù hợp / từ chối?")) {
            event.preventDefault();
          }
        }}
        className={`${base} border border-red-300 bg-red-50 text-red-700 hover:bg-red-100`}
      >
        Không phù hợp
      </button>
    </div>
  );
}

/**
 * One selectable row. `expected_status` travels with the row so the server can
 * reject a row whose status moved since this page was rendered.
 */
export function BulkScreeningRowCheckbox({
  role,
  applicationId,
  expectedStatus
}: {
  role: "mentor" | "mentee";
  applicationId: string;
  expectedStatus: string;
}) {
  return (
    <>
      <input
        type="checkbox"
        name="application_id"
        value={applicationId}
        data-bulk-role={role}
        aria-label={`Chọn hồ sơ ${applicationId.slice(0, 8)}`}
        className="h-4 w-4 rounded border-slate-300"
      />
      <input type="hidden" name={`expected_status_${applicationId}`} value={expectedStatus} />
    </>
  );
}
