"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { ConfirmActionDialog, InlineActionMessage } from "@/components/action-feedback";
import { initialDecisionActionState } from "@/lib/decision-action-types";

type Row = { id: string; fullName: string; role: string; status: string; statusLabel: string };
const MAX_ROWS = 500;
const TARGET_STATUS = "invited_to_interview";

export function BulkInviteForm({ rows, isFiltered = false }: { rows: Row[]; isFiltered?: boolean }) {
  const [state, action] = useFormState(bulkApplicationDecisionAction, initialDecisionActionState);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const submitLock = useRef(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (submitLock.current) {
      event.preventDefault();
      return;
    }
    submitLock.current = true;
  }

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
  const isEmpty = rows.length === 0;

  if (isEmpty) {
    return <div className="rounded-md border border-dashed border-vam-line bg-slate-50 px-4 py-10 text-center">
      <p className="text-sm font-medium text-vam-ink">Không có đơn nào đang chờ mời phỏng vấn.</p>
    </div>;
  }

  return <form action={action} onSubmit={handleSubmit} className="space-y-4">
    <InlineActionMessage state={state} />
    {/* Hidden inputs to feed bulkApplicationDecisionAction with a fixed status */}
    <input type="hidden" name="new_status" value={TARGET_STATUS} />
    <input type="hidden" name="decision_note" value="Mời phỏng vấn hàng loạt" />

    <p className="text-sm font-medium text-vam-ink">Đã chọn: {selectedCount}/{Math.min(rows.length, MAX_ROWS)}</p>
    <div className="max-h-[34rem] overflow-auto rounded-md border border-vam-line">
      <table className="min-w-full text-sm"><thead className="sticky top-0 bg-slate-50 shadow-sm z-10"><tr><th className="px-3 py-2 text-left">Chọn</th><th className="px-3 py-2 text-left">Ứng viên</th><th className="px-3 py-2 text-left">Vai trò</th><th className="px-3 py-2 text-left">Trạng thái</th></tr></thead>
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
    <p className="text-xs text-slate-500">Mỗi đơn được khóa và kiểm tra lại tại database.</p>
    <ConfirmActionDialog
      triggerLabel={`Mời phỏng vấn ${selectedCount} đơn`}
      pendingLabel="Đang kiểm tra…"
      title="Xác nhận mời phỏng vấn hàng loạt"
      description={`Bạn sắp chuyển ${selectedCount} đơn sang trạng thái "Đã mời phỏng vấn".`}
      confirmLabel="Xác nhận"
      cancelLabel="Hủy"
      triggerClassName="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      confirmClassName="bg-vam-green text-white hover:bg-vam-ink"
      disabled={selectedCount === 0}
    />
  </form>;
}
