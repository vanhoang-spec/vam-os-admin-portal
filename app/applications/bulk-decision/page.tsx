import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications, getIntakeBatches } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { BulkDecisionForm } from "./bulk-decision-form";

/**
 * Quyết định "mời phỏng vấn" từ màn này cũng gửi thư cho từng ứng viên, tuần
 * tự, mỗi lời gọi có thể treo tới 20 giây. Cùng lý do với màn mời hàng loạt.
 */
export const maxDuration = 60;

export default async function BulkDecisionPage(props: { searchParams: Promise<{ intake_batch_id?: string; role_applied?: string; status?: string }> }) {
  const searchParams = await props.searchParams;
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canDecide(actor.role)) redirect("/applications");
  const scope = await getScopeFilter(await getAdminScopeContext());
  const [result, batches] = await Promise.all([getApplications(scope), getIntakeBatches(scope)]);
  const intakeBatchId = searchParams.intake_batch_id?.trim() ?? "";
  const roleApplied = searchParams.role_applied?.trim() ?? "";
  const status = searchParams.status?.trim() ?? "";
  const filtered = result.data.filter(app =>
    (!intakeBatchId || app.intake_batch_id === intakeBatchId) &&
    (!roleApplied || app.role_applied === roleApplied) &&
    (!status || app.status === status)
  );
  const rows = filtered.slice(0, 500).map(app => ({
    id: app.id,
    fullName: String(app.full_name ?? app.email_primary ?? app.id),
    role: String(app.role_applied ?? "-"),
    status: String(app.status ?? "")
  }));
  return <><PageHeader title="Bulk Final Decision" description="Quyết định hàng loạt có kiểm tra lifecycle tại database." />
    <div className="mb-4"><Link href="/applications" className="text-sm text-vam-green hover:underline">← Quay lại danh sách</Link></div>
    <ErrorBox message={result.error || batches.error} />
    <Card className="mb-4"><form method="GET" className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Đợt tuyển<select name="intake_batch_id" defaultValue={intakeBatchId} className="mt-1 block rounded-md border border-vam-line px-3 py-2"><option value="">Tất cả</option>{batches.data.map(batch => <option key={batch.id} value={batch.id}>{batch.name ?? batch.code ?? batch.id}</option>)}</select></label>
      <label className="text-sm">Vai trò<select name="role_applied" defaultValue={roleApplied} className="mt-1 block rounded-md border border-vam-line px-3 py-2"><option value="">Tất cả</option><option value="mentor">Mentor</option><option value="mentee">Mentee</option></select></label>
      <label className="text-sm">Trạng thái<input name="status" defaultValue={status} placeholder="ready_for_final_decision" className="mt-1 block rounded-md border border-vam-line px-3 py-2" /></label>
      <button className="rounded-md border border-vam-line px-4 py-2 text-sm">Lọc</button>
    </form></Card>
    {filtered.length > 500 && <p className="mb-3 text-sm text-amber-700">Có {filtered.length} đơn phù hợp; thu hẹp bộ lọc để mỗi lượt không quá 500 đơn.</p>}
    <Card><BulkDecisionForm rows={rows} /></Card></>;
}
