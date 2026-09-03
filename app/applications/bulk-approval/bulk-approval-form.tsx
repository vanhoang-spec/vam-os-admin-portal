"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { bulkOfficialApprovalAction } from "@/app/actions/bulk-official-approval";
import { ConfirmActionDialog, InlineActionMessage } from "@/components/action-feedback";
import {
  initialBulkApprovalActionState,
  MAX_BULK_APPROVAL_IDS,
  type BulkApprovalOutcome
} from "@/lib/bulk-official-approval-types";

type Row = { id: string; fullName: string; email: string; role: "mentor" | "mentee"; status: string; isRenewal: boolean };

const OUTCOME_LABEL: Record<BulkApprovalOutcome, string> = {
  approved: "Đã duyệt",
  skipped: "Bỏ qua",
  manual_required: "Cần xử lý thủ công",
  failed: "Lỗi"
};

const OUTCOME_BADGE_CLASS: Record<BulkApprovalOutcome, string> = {
  approved: "bg-green-50 text-green-700 border-green-200",
  skipped: "bg-slate-50 text-slate-600 border-slate-200",
  manual_required: "bg-amber-50 text-amber-800 border-amber-200",
  failed: "bg-red-50 text-red-700 border-red-200"
};

export function BulkApprovalForm({ rows }: { rows: Row[] }) {
  const [state, action] = useFormState(bulkOfficialApprovalAction, initialBulkApprovalActionState);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const checkboxRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Same in-flight submit lock used by BulkDecisionForm/DecisionForm — this
  // is a recorded, mutating write (creates/reuses people and profiles), so a
  // second Enter or a scripted form.requestSubmit() must not slip a
  // duplicate batch through before `pending` flips true.
  const submitLock = useRef(false);

  /**
   * Bumped every time a result arrives. Used as the confirm dialog's key.
   *
   * Current main's ConfirmActionDialog owns its open/closed state internally
   * and has no success prop (the historical M092 build passed `isSuccess`,
   * which does not exist here). Without this, the modal would stay open on top
   * of the per-row result table the operator has to read. Remounting it on a
   * new result closes it, and does not touch the shared component.
   */
  const [resultSeq, setResultSeq] = useState(0);

  useEffect(() => {
    submitLock.current = false;
    setResultSeq((n) => n + 1);
    if (!state.ok) {
      // React's form-action plugin resets the native DOM state synchronously
      // at submit time regardless of outcome — restore the last-submitted
      // selection directly so a failed batch stays retryable without
      // re-selecting anything.
      checkboxRefs.current.forEach((el, id) => {
        el.checked = selectedIds.has(id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (submitLock.current) {
      event.preventDefault();
      return;
    }
    submitLock.current = true;
  };

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= MAX_BULK_APPROVAL_IDS) return prev;
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function selectAllUpToLimit() {
    setSelectedIds(new Set(rows.slice(0, MAX_BULK_APPROVAL_IDS).map((r) => r.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  /** Re-selects only the rows the last attempt reported as failed/manual, so the operator can retry them without hunting through the full list. */
  function retryUnresolvedRows() {
    if (!state.rows) return;
    const unresolved = state.rows
      .filter((r) => r.outcome === "failed" || r.outcome === "manual_required")
      .map((r) => r.applicationId);
    setSelectedIds(new Set(unresolved));
  }

  const selectedCount = selectedIds.size;
  const selectedRoles = useMemo(() => {
    const roles = new Set<string>();
    rows.forEach((r) => {
      if (selectedIds.has(r.id)) roles.add(r.role);
    });
    return Array.from(roles);
  }, [rows, selectedIds]);

  const resultRows = state.rows ?? [];
  const hasUnresolved = resultRows.some((r) => r.outcome === "failed" || r.outcome === "manual_required");

  return (
    <form action={action} onSubmit={handleSubmit} className="space-y-4">
      <InlineActionMessage state={state} />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium text-vam-ink">
          Đã chọn: {selectedCount}/{MAX_BULK_APPROVAL_IDS}
        </span>
        <button
          type="button"
          onClick={selectAllUpToLimit}
          className="rounded-md border border-vam-line px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Chọn tất cả (tối đa {MAX_BULK_APPROVAL_IDS})
        </button>
        <button
          type="button"
          onClick={clearSelection}
          className="rounded-md border border-vam-line px-3 py-1.5 text-xs hover:bg-slate-50"
        >
          Bỏ chọn tất cả
        </button>
        {hasUnresolved && (
          <button
            type="button"
            onClick={retryUnresolvedRows}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
          >
            Chọn lại các dòng Lỗi/Cần xử lý thủ công để thử lại
          </button>
        )}
      </div>

      <div className="max-h-[28rem] overflow-auto rounded-md border border-vam-line">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">Chọn</th>
              <th className="px-3 py-2 text-left">Ứng viên</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Vai trò</th>
              <th className="px-3 py-2 text-left">Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-vam-line">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    name="application_id"
                    value={row.id}
                    checked={selectedIds.has(row.id)}
                    disabled={!selectedIds.has(row.id) && selectedCount >= MAX_BULK_APPROVAL_IDS}
                    onChange={(e) => toggleRow(row.id, e.target.checked)}
                    ref={(el) => {
                      if (el) checkboxRefs.current.set(row.id, el);
                      else checkboxRefs.current.delete(row.id);
                    }}
                  />
                </td>
                <td className="px-3 py-2">{row.fullName}</td>
                <td className="px-3 py-2 text-slate-500">{row.email}</td>
                <td className="px-3 py-2 capitalize">{row.role}</td>
                <td className="px-3 py-2">{row.status}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Không có đơn nào phù hợp bộ lọc hiện tại.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        Duyệt chính thức sẽ <strong>tạo hoặc liên kết hồ sơ người (people)</strong> và{" "}
        <strong>tạo hoặc liên kết mentor/mentee profile chính thức</strong> cho từng đơn được chọn, sau đó chuyển đơn
        sang trạng thái duyệt chính thức tương ứng (approved_as_mentor / approved_as_mentee). Vai trò được suy ra từ
        chính đơn ứng tuyển, không phải lựa chọn của người thao tác. Mỗi đơn được khóa và kiểm tra lại toàn bộ điều
        kiện tại database; đơn không đủ điều kiện, đơn gia hạn, hoặc danh tính không rõ ràng sẽ được báo Bỏ qua / Cần
        xử lý thủ công thay vì tự đoán. Thao tác này <strong>không</strong> tạo membership, match hay gửi thông báo.
      </p>

      <ConfirmActionDialog
        key={resultSeq}
        triggerLabel={`Duyệt chính thức ${selectedCount} đơn`}
        pendingLabel="Đang duyệt…"
        title="Xác nhận duyệt chính thức hàng loạt"
        description={`Bạn sắp duyệt chính thức ${selectedCount} đơn (${selectedRoles.join(" + ") || "-"}). Thao tác này sẽ tạo hoặc liên kết hồ sơ người và mentor/mentee profile chính thức cho từng đơn hợp lệ. Vui lòng xác nhận trước khi tiếp tục.`}
        confirmLabel="Xác nhận duyệt"
        triggerClassName="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        confirmClassName="bg-vam-green text-white hover:bg-vam-ink"
        disabled={selectedCount === 0}
      />

      {resultRows.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-vam-ink">Kết quả theo từng đơn</h3>
          <div className="max-h-[24rem] overflow-auto rounded-md border border-vam-line">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Application ID</th>
                  <th className="px-3 py-2 text-left">Vai trò</th>
                  <th className="px-3 py-2 text-left">Kết quả</th>
                  <th className="px-3 py-2 text-left">Lý do</th>
                  <th className="px-3 py-2 text-left">Person</th>
                  <th className="px-3 py-2 text-left">Profile</th>
                </tr>
              </thead>
              <tbody>
                {resultRows.map((row) => (
                  <tr key={row.applicationId} className="border-t border-vam-line">
                    <td className="px-3 py-2 font-mono text-xs">{row.applicationId}</td>
                    <td className="px-3 py-2 capitalize">{row.targetRole ?? "-"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${OUTCOME_BADGE_CLASS[row.outcome]}`}
                      >
                        {OUTCOME_LABEL[row.outcome]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.reasonMessage}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.personId ? (row.personCreated ? "Đã tạo mới" : "Đã liên kết sẵn có") : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {row.profileId ? (row.profileCreated ? "Đã tạo mới" : "Đã liên kết sẵn có") : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </form>
  );
}
