import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications, getIntakeBatches } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { BulkInviteForm } from "./bulk-invite-form";

const MAX_ROWS = 500;
const SOURCE_STATUS = "screening_passed";

export default async function BulkInviteInterviewPage(props: {
  searchParams: Promise<{ intake_batch_id?: string; role_applied?: string }>;
}) {
  const searchParams = await props.searchParams;
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canDecide(actor.role)) redirect("/applications");
  
  const scope = await getScopeFilter(await getAdminScopeContext());
  const [result, batches] = await Promise.all([getApplications(scope), getIntakeBatches(scope)]);
  const intakeBatchId = searchParams.intake_batch_id?.trim() ?? "";
  const roleApplied = searchParams.role_applied?.trim() ?? "";
  
  const filtered = result.data.filter(app =>
    app.status === SOURCE_STATUS &&
    (!intakeBatchId || app.intake_batch_id === intakeBatchId) &&
    (!roleApplied || app.role_applied === roleApplied)
  );
  
  const rows = filtered.slice(0, MAX_ROWS).map(app => ({
    id: app.id,
    fullName: String(app.full_name ?? app.email_primary ?? app.id),
    role: String(app.role_applied ?? "-"),
    status: String(app.status ?? ""),
    statusLabel: applicationStatusLabel(app.status)
  }));
  
  const isFiltered = Boolean(intakeBatchId || roleApplied);
  return <><PageHeader title="Mời phỏng vấn hàng loạt" description="Chuyển trạng thái các hồ sơ đã qua vòng đơn sang chờ phỏng vấn." />
    <div className="mb-4"><Link href="/applications" className="text-sm text-vam-green hover:underline">← Quay lại danh sách</Link></div>
    <ErrorBox message={result.error || batches.error} />
    <Card className="mb-4"><form method="GET" className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Đợt tuyển<select name="intake_batch_id" defaultValue={intakeBatchId} className="mt-1 block rounded-md border border-vam-line px-3 py-2"><option value="">Tất cả</option>{batches.data.map(batch => <option key={batch.id} value={batch.id}>{batch.name ?? batch.code ?? batch.id}</option>)}</select></label>
      <label className="text-sm">Vai trò<select name="role_applied" defaultValue={roleApplied} className="mt-1 block rounded-md border border-vam-line px-3 py-2"><option value="">Tất cả</option><option value="mentor">Mentor</option><option value="mentee">Mentee</option></select></label>
      <label className="text-sm">Trạng thái hồ sơ
        <span className="mt-1 block rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-slate-500">{applicationStatusLabel(SOURCE_STATUS)}</span>
      </label>
      <button className="rounded-md border border-vam-line px-4 py-2 text-sm">Lọc</button>
    </form></Card>
    <p className="mb-3 text-xs text-slate-500">
      Màn hình này chỉ làm việc với đơn ở trạng thái <code>{SOURCE_STATUS}</code> ({applicationStatusLabel(SOURCE_STATUS)}). Mời phỏng vấn không kèm xếp lịch.
    </p>
    {filtered.length > MAX_ROWS && <p className="mb-3 text-sm text-amber-700">Có {filtered.length} đơn phù hợp; thu hẹp bộ lọc để mỗi lượt không quá {MAX_ROWS} đơn.</p>}
    <Card><BulkInviteForm rows={rows} isFiltered={isFiltered} /></Card></>;
}
