"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { bulkInviteInterviewAction } from "@/app/actions/bulk-invite-interview";
import { ConfirmActionDialog } from "@/components/action-feedback";
import { initialBulkInviteState } from "@/lib/bulk-invite-action-types";
import { BULK_INVITE_MAX } from "@/lib/bulk-invite-interview";

/**
 * Bulk "Mời phỏng vấn".
 *
 * Eligibility is decided by the server, twice: the page only lists rows the
 * canonical eligibility model accepts, and the action re-derives every one of
 * them under a row lock. The result is reported per applicant — an operator who
 * selected 100 names needs to know which one was blocked and why.
 *
 * Closing or cancelling the confirmation mutates nothing: the confirm dialog is
 * the only control that submits this form.
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
  const [state, action] = useFormState(bulkInviteInterviewAction, initialBulkInviteState);
  const [selected, setSelected] = useState<string[]>([]);

  const selectedSet = new Set(selected);
  const overLimit = selected.length > BULK_INVITE_MAX;
  const canSubmit = selected.length > 0 && !overLimit;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div className="space-y-4">
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

      {state.rows.length ? (
        <div className="overflow-x-auto rounded-lg border border-vam-line" data-testid="bulk-invite-rows">
          <table className="min-w-full divide-y divide-vam-line text-sm">
            <caption className="px-3 py-2 text-left text-xs text-slate-600">
              Kết quả từng hồ sơ — thành công {state.appliedCount}, bị chặn {state.blockedCount}.
            </caption>
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Ứng viên</th>
                <th className="px-3 py-2">Kết quả</th>
                <th className="px-3 py-2">Lý do</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line">
              {state.rows.map((row) => (
                <tr key={row.applicationId}>
                  <td className="px-3 py-2 text-vam-ink">{row.applicantName}</td>
                  <td
                    className={`px-3 py-2 font-medium ${
                      row.applied ? "text-green-700" : "text-red-700"
                    }`}
                  >
                    {row.applied ? "Đã mời" : "Bị chặn"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{row.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!rows.length ? (
        <p className="rounded-lg border border-dashed border-vam-line bg-white p-6 text-center text-sm text-slate-500">
          Không có hồ sơ nào đủ điều kiện mời phỏng vấn với bộ lọc hiện tại.
        </p>
      ) : (
        <form action={action} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(rows.slice(0, BULK_INVITE_MAX).map((row) => row.id))}
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
                description={`Bạn đang mời ${selected.length} hồ sơ sang vòng phỏng vấn. Hồ sơ chưa đủ đánh giá hoặc đã đổi trạng thái sẽ bị chặn và báo lại theo từng ứng viên.`}
                confirmLabel="Mời phỏng vấn"
                disabled={!canSubmit}
                triggerClassName="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:cursor-not-allowed disabled:opacity-50"
                confirmClassName="bg-vam-green text-white hover:opacity-90"
              />
            </div>
          </div>

          <label className="block text-xs font-medium uppercase text-slate-500">
            Ghi chú chung (tuỳ chọn)
            <input
              name="decision_note"
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
            />
          </label>

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
                            {/* Travels with the row so the server refuses
                                anything whose status moved since this render. */}
                            <input
                              type="hidden"
                              name={`expected_status_${row.id}`}
                              value={row.status}
                            />
                            <input
                              type="hidden"
                              name={`applicant_name_${row.id}`}
                              value={row.fullName}
                            />
                          </>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-vam-ink">{row.fullName}</td>
                      <td className="px-3 py-2 text-slate-600">{row.role}</td>
                      <td className="px-3 py-2 text-slate-600 tabular-nums">
                        {row.submittedReviews}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{row.statusLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}
    </div>
  );
}
