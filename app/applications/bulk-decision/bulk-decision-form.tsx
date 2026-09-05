"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { ConfirmActionDialog, InlineActionMessage } from "@/components/action-feedback";
import {
  DESTRUCTIVE_DECISION_STATUSES,
  initialDecisionActionState
} from "@/lib/decision-action-types";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { BULK_FINAL_DECISION_STATUSES } from "./decision-options";

type Row = { id: string; fullName: string; role: string; status: string; statusLabel: string };

/** Same ceiling the server action enforces. */
const MAX_ROWS = 500;

export function BulkDecisionForm({ rows, isFiltered = false }: { rows: Row[]; isFiltered?: boolean }) {
  const [state, action] = useFormState(bulkApplicationDecisionAction, initialDecisionActionState);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newStatus, setNewStatus] = useState("");

  // Recorded, mutating write: a second Enter or a scripted requestSubmit()
  // must not slip a duplicate batch through before `pending` flips true.
  const submitLock = useRef(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (submitLock.current) {
      event.preventDefault();
      return;
    }
    submitLock.current = true;
  }

  // A result (success or failure) ends the in-flight batch, so the next
  // deliberate submit is allowed again.
  useEffect(() => {
    submitLock.current = false;
  }, [state]);

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const selectedCount = selectedIds.size;
  const decisionLabel = newStatus ? applicationStatusLabel(newStatus) : "";
  const isDestructive = DESTRUCTIVE_DECISION_STATUSES.has(newStatus);
  // Nothing to decide on, and nothing to select: an empty table with a live
  // "apply" control reads as a broken screen rather than an empty queue.
  const isEmpty = rows.length === 0;

  if (isEmpty) {
    return <div className="rounded-md border border-dashed border-vam-line bg-slate-50 px-4 py-10 text-center">
      <p className="text-sm font-medium text-vam-ink">Không có đơn nào đang chờ quyết định cuối.</p>
      <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
        {isFiltered
          ? "Không có đơn nào ở trạng thái “Sẵn sàng ra quyết định cuối” khớp bộ lọc hiện tại. Hãy nới bộ lọc đợt tuyển / vai trò."
          : "Đơn chỉ xuất hiện ở đây sau khi đã đủ số đánh giá phỏng vấn tối thiểu của mùa. Hãy kiểm tra tiến độ phỏng vấn trước."}
      </p>
    </div>;
  }

  return <form action={action} onSubmit={handleSubmit} className="space-y-4">
    <InlineActionMessage state={state} />
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm">Quyết định
        <select
          required
          name="new_status"
          value={newStatus}
          onChange={event => setNewStatus(event.target.value)}
          className="mt-1 block w-full rounded-md border border-vam-line px-3 py-2"
        >
          <option value="">-- Chọn --</option>
          {BULK_FINAL_DECISION_STATUSES.map(value => (
            <option key={value} value={value}>{applicationStatusLabel(value)}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">Ghi chú chung
        <input name="decision_note" className="mt-1 block w-full rounded-md border border-vam-line px-3 py-2" />
      </label>
    </div>
    <p className="text-sm font-medium text-vam-ink">Đã chọn: {selectedCount}/{Math.min(rows.length, MAX_ROWS)}</p>
    <div className="max-h-[34rem] overflow-auto rounded-md border border-vam-line">
      <table className="min-w-full text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-2 text-left">Chọn</th><th className="px-3 py-2 text-left">Ứng viên</th><th className="px-3 py-2 text-left">Vai trò</th><th className="px-3 py-2 text-left">Trạng thái</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className="border-t border-vam-line">
        <td className="px-3 py-2">
          <input
            type="checkbox"
            name="application_id"
            value={row.id}
            aria-label={`Chọn ${row.fullName}`}
            checked={selectedIds.has(row.id)}
            onChange={event => toggleRow(row.id, event.target.checked)}
          />
          <input type="hidden" name={`expected_status_${row.id}`} value={row.status} />
        </td>
        <td className="px-3 py-2">{row.fullName}</td><td className="px-3 py-2">{row.role}</td><td className="px-3 py-2">{row.statusLabel}</td>
      </tr>)}</tbody></table>
    </div>
    <p className="text-xs text-slate-500">Mỗi đơn được khóa và kiểm tra lại tại database. Đơn đủ điều kiện được cập nhật; đơn sai scope, đã đổi trạng thái, hoặc chưa đủ review bị chặn và được báo trong kết quả.</p>
    <ConfirmActionDialog
      triggerLabel={`Áp dụng quyết định cho ${selectedCount} đơn`}
      pendingLabel="Đang kiểm tra…"
      title={isDestructive ? "Xác nhận từ chối hàng loạt" : "Xác nhận quyết định hàng loạt"}
      description={
        isDestructive
          ? `Bạn sắp áp dụng quyết định “${decisionLabel}” cho ${selectedCount} đơn. Đây là thay đổi trạng thái hàng loạt có tính kết thúc: các ứng viên này sẽ bị loại khỏi quy trình tuyển và việc hoàn tác phải làm thủ công từng đơn. Vui lòng xác nhận trước khi tiếp tục.`
          : `Bạn sắp áp dụng quyết định “${decisionLabel}” cho ${selectedCount} đơn. Đây là thay đổi trạng thái hàng loạt và sẽ được ghi vào lịch sử quyết định của từng đơn. Vui lòng xác nhận trước khi tiếp tục.`
      }
      warning={isDestructive ? `Thao tác không thể hoàn tác hàng loạt: ${selectedCount} đơn sẽ chuyển sang “${decisionLabel}”.` : null}
      confirmLabel={isDestructive ? "Xác nhận từ chối" : "Xác nhận quyết định"}
      cancelLabel="Hủy"
      triggerClassName={
        isDestructive
          ? "rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          : "rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      }
      confirmClassName={isDestructive ? "bg-red-600 text-white hover:bg-red-700" : "bg-vam-green text-white hover:bg-vam-ink"}
      disabled={selectedCount === 0 || !newStatus}
    />
    {(selectedCount === 0 || !newStatus) && <p className="text-xs text-slate-500">Chọn ít nhất một đơn và một quyết định để tiếp tục.</p>}
  </form>;
}
