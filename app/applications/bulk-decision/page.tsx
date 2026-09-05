import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications, getIntakeBatches } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { BulkDecisionForm } from "./bulk-decision-form";
import {
  BULK_FINAL_DECISION_SOURCE_STATUS,
  BULK_FINAL_DECISION_SOURCE_STATUSES,
  resolveSourceStatus
} from "./decision-options";

import { getReviewsForApplications } from "@/lib/data";

/** Rows shown per batch. The server action enforces the same ceiling. */
const MAX_ROWS = 500;

export default async function BulkDecisionPage(props: {
  searchParams: Promise<{ intake_batch_id?: string; role_applied?: string; status?: string }>;
}) {
  const searchParams = await props.searchParams;
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canDecide(actor.role)) redirect("/applications");
  const scope = await getScopeFilter(await getAdminScopeContext());
  const [result, batches] = await Promise.all([getApplications(scope), getIntakeBatches(scope)]);
  const intakeBatchId = searchParams.intake_batch_id?.trim() ?? "";
  const roleApplied = searchParams.role_applied?.trim() ?? "";
  // Bounded: an absent, blank or out-of-domain status resolves to the canonical
  // source state instead of listing every application in scope.
  const status = resolveSourceStatus(searchParams.status);
  const filtered = result.data.filter(app =>
    app.status === status &&
    (!intakeBatchId || app.intake_batch_id === intakeBatchId) &&
    (!roleApplied || app.role_applied === roleApplied)
  );
  
  const selectedApps = filtered.slice(0, MAX_ROWS);
  const reviewsResult = await getReviewsForApplications(selectedApps.map(a => a.id));
  
  // Inject reviewer names
  const { getSupabaseServerClient } = await import("@/lib/supabase-server");
  const client = getSupabaseServerClient();
  const { data: adminUsers } = client ? await client.from("admin_users").select("id, full_name, email") : { data: [] };
  const adminMap = new Map(adminUsers?.map((u: any) => [u.id, u.full_name || u.email]) || []);

  const reviewsByApp = new Map<string, any[]>();
  if (reviewsResult.data) {
    for (const review of reviewsResult.data) {
      const rName = adminMap.get(review.reviewer_admin_user_id || "") || "Reviewer";
      const enhancedReview = { ...review, reviewer_name: rName };
      if (!reviewsByApp.has(review.application_id)) {
        reviewsByApp.set(review.application_id, []);
      }
      reviewsByApp.get(review.application_id)!.push(enhancedReview);
    }
  }

  const rows = selectedApps.map(app => ({
    id: app.id,
    fullName: String(app.full_name ?? app.email_primary ?? app.id),
    role: String(app.role_applied ?? "-"),
    status: String(app.status ?? ""),
    statusLabel: applicationStatusLabel(app.status),
    reviews: reviewsByApp.get(app.id) ?? []
  }));
  
  const isFiltered = Boolean(intakeBatchId || roleApplied);
  return <><PageHeader title="Quyết định sau phỏng vấn" description="Ra quyết định cuối hàng loạt cho các đơn đã hoàn tất đánh giá phỏng vấn, có kiểm tra vòng đời tại database." />
    <div className="mb-4"><Link href="/applications" className="text-sm text-vam-green hover:underline">← Quay lại danh sách</Link></div>
    <ErrorBox message={result.error || batches.error} />
    <Card className="mb-4"><form method="GET" className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Đợt tuyển<select name="intake_batch_id" defaultValue={intakeBatchId} className="mt-1 block rounded-md border border-vam-line px-3 py-2"><option value="">Tất cả</option>{batches.data.map(batch => <option key={batch.id} value={batch.id}>{batch.name ?? batch.code ?? batch.id}</option>)}</select></label>
      <label className="text-sm">Vai trò<select name="role_applied" defaultValue={roleApplied} className="mt-1 block rounded-md border border-vam-line px-3 py-2"><option value="">Tất cả</option><option value="mentor">Mentor</option><option value="mentee">Mentee</option></select></label>
      <label className="text-sm">Trạng thái hồ sơ
        <span className="mt-1 block rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-slate-500">{applicationStatusLabel(BULK_FINAL_DECISION_SOURCE_STATUS)}</span>
        <input type="hidden" name="status" value={status} />
      </label>
      <button className="rounded-md border border-vam-line px-4 py-2 text-sm">Lọc</button>
    </form></Card>
    <p className="mb-3 text-xs text-slate-500">
      Màn hình này chỉ làm việc với đơn ở trạng thái <code>{BULK_FINAL_DECISION_SOURCE_STATUS}</code> ({applicationStatusLabel(BULK_FINAL_DECISION_SOURCE_STATUS)}) — tức đã đủ số đánh giá phỏng vấn tối thiểu và đang chờ Core Team ra quyết định cuối. Các bước sớm hơn (qua vòng hồ sơ, mời phỏng vấn, đặt lịch phỏng vấn) không thuộc màn hình này.
    </p>
    {filtered.length > MAX_ROWS && <p className="mb-3 text-sm text-amber-700">Có {filtered.length} đơn phù hợp; thu hẹp bộ lọc để mỗi lượt không quá {MAX_ROWS} đơn.</p>}
    <Card><BulkDecisionForm rows={rows} isFiltered={isFiltered} /></Card></>;
}
