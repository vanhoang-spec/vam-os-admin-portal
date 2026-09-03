"use client";

import { useFormState, useFormStatus } from "react-dom";
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { initialDecisionActionState } from "@/lib/decision-action-types";

type Row = { id: string; fullName: string; role: string; status: string };

function Submit() {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Đang kiểm tra…" : "Áp dụng quyết định"}</button>;
}

export function BulkDecisionForm({ rows }: { rows: Row[] }) {
  const [state, action] = useFormState(bulkApplicationDecisionAction, initialDecisionActionState);
  return <form action={action} className="space-y-4">
    {state.message && <div className={`rounded-md border px-3 py-2 text-sm ${state.ok ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>{state.message}</div>}
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm">Quyết định
        <select required name="new_status" className="mt-1 block w-full rounded-md border border-vam-line px-3 py-2">
          <option value="">-- Chọn --</option>
          <option value="screening_passed">Qua vòng hồ sơ</option>
          <option value="invited_to_interview">Mời phỏng vấn</option>
          <option value="interview_scheduled">Đã đặt lịch phỏng vấn</option>
          <option value="interview_passed">Qua vòng phỏng vấn</option>
          <option value="waitlisted">Danh sách chờ</option>
          <option value="rejected_or_not_fit">Không phù hợp / từ chối</option>
          <option value="needs_more_review">Cần review thêm</option>
        </select>
      </label>
      <label className="text-sm">Ghi chú chung
        <input name="decision_note" className="mt-1 block w-full rounded-md border border-vam-line px-3 py-2" />
      </label>
    </div>
    <div className="max-h-[34rem] overflow-auto rounded-md border border-vam-line">
      <table className="min-w-full text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-2 text-left">Chọn</th><th className="px-3 py-2 text-left">Ứng viên</th><th className="px-3 py-2 text-left">Vai trò</th><th className="px-3 py-2 text-left">Trạng thái</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className="border-t border-vam-line">
        <td className="px-3 py-2"><input type="checkbox" name="application_id" value={row.id} /><input type="hidden" name={`expected_status_${row.id}`} value={row.status} /></td>
        <td className="px-3 py-2">{row.fullName}</td><td className="px-3 py-2">{row.role}</td><td className="px-3 py-2">{row.status}</td>
      </tr>)}</tbody></table>
    </div>
    <p className="text-xs text-slate-500">Mỗi đơn được khóa và kiểm tra lại tại database. Đơn đủ điều kiện được cập nhật; đơn sai scope, đã đổi trạng thái, hoặc chưa đủ review bị chặn và được báo trong kết quả.</p>
    <Submit />
  </form>;
}
