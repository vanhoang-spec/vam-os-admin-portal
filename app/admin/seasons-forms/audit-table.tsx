import { EmptyState, ErrorBox } from "@/components/ui";
import type { FormControlAuditRow } from "@/lib/application-form-audit";
import { formatDateTime } from "@/lib/utils";

const STATE_LABEL: Record<string, string> = {
  closed: "ĐÓNG",
  pilot: "PILOT",
  open: "MỞ CÔNG KHAI"
};

function stateLabel(value: string | null) {
  if (!value) return "—";
  return STATE_LABEL[value] ?? value;
}

export function FormControlAuditTable({
  rows,
  error
}: {
  rows: FormControlAuditRow[];
  error: string | null;
}) {
  if (error) return <ErrorBox message={error} />;
  if (rows.length === 0) {
    return <EmptyState message="Chưa có thay đổi trạng thái nào được ghi nhận." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-vam-line text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-4 font-medium">Thời điểm</th>
            <th className="py-2 pr-4 font-medium">Người thực hiện</th>
            <th className="py-2 pr-4 font-medium">Vai trò</th>
            <th className="py-2 pr-4 font-medium">Trước</th>
            <th className="py-2 pr-4 font-medium">Sau</th>
            <th className="py-2 font-medium">Đợt tuyển</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-vam-line/60">
              <td className="py-2 pr-4 text-slate-700">
                {row.createdAt ? formatDateTime(row.createdAt) : "—"}
              </td>
              <td className="py-2 pr-4 text-slate-700">{row.actorEmail ?? "—"}</td>
              <td className="py-2 pr-4 text-slate-700">{row.applicantRole ?? "—"}</td>
              <td className="py-2 pr-4 text-slate-500">{stateLabel(row.previousState)}</td>
              <td className="py-2 pr-4 font-medium text-vam-ink">{stateLabel(row.newState)}</td>
              <td className="py-2 font-mono text-xs text-slate-500">
                {row.intakeBatchCode ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
