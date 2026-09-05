"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { ConfirmActionDialog } from "@/components/action-feedback";
import { initialDecisionActionState } from "@/lib/decision-action-types";
import { BULK_INVITE_MAX, BULK_INVITE_TARGET_STATUS } from "@/lib/bulk-invite-interview";

/**
 * Bulk "Mời phỏng vấn".
 *
 * Nothing about eligibility is decided here. Every selected row carries its own
 * `expected_status_<id>`, and `vam084_apply_application_decisions` re-derives
 * eligibility per application under a row lock — including the profile-review
 * minimum. The list below is an operator convenience; the database is the gate.
 *
 * Closing or cancelling the confirmation mutates nothing: the confirm dialog is
 * the only thing that submits the form.
 */

export type BulkInviteRow = {
  id: string;
  fullName: string;
  role: string;
  status: string;
  statusLabel: string;
  submittedReviews: number;
};

export function BulkInviteForm({ rows }: { rows: BulkInviteRow[] }) {
  const [state, action] = useFormState(bulkApplicationDecisionAction, initialDecisionActionState);
  const [selected, setSelected] = useState<string[]>([]);

  const selectedSet = new Set(selected);
  const overLimit = selected.length > BULK_INVITE_MAX;
  const canSubmit = selected.length > 0 && !overLimit;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAll() {
    setSelected(rows.slice(0, BULK_INVITE_MAX).map((row) => row.id));
  }

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-dashed border-vam-line bg-white p-6 text-center text-sm text-slate-500">
        Không có hồ sơ nào đủ điều kiện mời phỏng vấn với bộ lọc hiện tại.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="new_status" value={BULK_INVITE_TARGET_STATUS} />

      {state.message ? (
        <div
          role="status"
          data-testid="bulk-invite-result"
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-md border border-vam-line px-3 py-1.5 text-sm"
          >
            Chọn {Math.min(rows.length, BULK_INVITE_MAX)} hồ sơ
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="rounded-md border border-vam-line px-3 py-1.5 text-sm"
          >
            Bỏ chọn
          </button>
          <span data-testid="bulk-invite-selected" className="text-sm text-slate-600">
            Đã chọn {selected.length}/{rows.length}
          </span>
        </div>

        <div className="flex flex-col items-end gap-1">
          {overLimit ? (
            <p className="text-xs font-medium text-red-700">
              Tối đa {BULK_INVITE_MAX} hồ sơ mỗi lần.
            </p>
          ) : null}
          <ConfirmActionDialog
            triggerLabel={`Mời phỏng vấn (${selected.length})`}
            pendingLabel="Đang gửi…"
            title="Xác nhận mời phỏng vấn"
            description={`Bạn đang mời ${selected.length} hồ sơ sang vòng phỏng vấn. Hồ sơ chưa đủ đánh giá hoặc đã đổi trạng thái sẽ bị hệ thống chặn và báo lại theo từng dòng.`}
            confirmLabel="Mời phỏng vấn"
            disabled={!canSubmit}
            triggerClassName="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:cursor-not-allowed disabled:opacity-50"
            confirmClassName="bg-vam-green text-white hover:opacity-90"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-vam-line">
        <table className="min-w-full divide-y divide-vam-line text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Chọn</th>
              <th className="px-3 py-2">Ứng viên</th>
              <th className="px-3 py-2">Vai trò</th>
              <th className="px-3 py-2">Đánh giá đã nộp</th>
              <th className="px-3 py-2">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vam-line">
            {rows.map((row) => {
              const checked = selectedSet.has(row.id);
              return (
                <tr key={row.id} className="hover:bg-vam-mint/40">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${row.fullName}`}
                      checked={checked}
                      onChange={() => toggle(row.id)}
                    />
                    {checked ? (
                      <>
                        <input type="hidden" name="application_id" value={row.id} />
                        {/* Travels with the row so the server refuses anything
                            whose status moved since this page rendered. */}
                        <input
                          type="hidden"
                          name={`expected_status_${row.id}`}
                          value={row.status}
                        />
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-vam-ink">{row.fullName}</td>
                  <td className="px-3 py-2 text-slate-600">{row.role}</td>
                  <td className="px-3 py-2 text-slate-600 tabular-nums">{row.submittedReviews}</td>
                  <td className="px-3 py-2 text-slate-600">{row.statusLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </form>
  );
}
