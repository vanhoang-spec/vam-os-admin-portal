import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getIntakeBatches,
  getInterviewCandidates,
  getReviewEligibleReviewers,
  getSeasons
} from "@/lib/data";
import { canBulkAssignReviews } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { AssignInterviewForm } from "./assign-interview-form";

// ---------------------------------------------------------------------------
// Page: /interviews/assign
// ---------------------------------------------------------------------------

export default async function AssignInterviewPage(props: { searchParams: Promise<{ intake_batch_id?: string; role_applied?: string }> }) {
  const searchParams = await props.searchParams;

  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canBulkAssignReviews(adminUser.role)) redirect("/interviews");

  const intakeBatchId = searchParams.intake_batch_id?.trim() || null;
  const roleApplied = searchParams.role_applied?.trim() || null;
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  // Always fetch batches + seasons for the selector dropdowns
  const [intakeBatches, seasons] = await Promise.all([getIntakeBatches(scope), getSeasons(scope)]);

  // If no batch or role is selected, show the filter selector only
  if (!intakeBatchId || !roleApplied) {
    return (
      <>
        <PageHeader
          title="Chia hồ sơ Phỏng vấn"
          description="Chọn batch và role để xem danh sách ứng viên và phân công interviewer."
        />
        <ErrorBox message={intakeBatches.error || seasons.error} />

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Bước 1 — Chọn batch và role ứng tuyển</p>
            <div className="flex gap-3">
              <Link href="/reviews/reviewer-pool" className="text-xs text-slate-400 hover:text-vam-green hover:underline">
                Quản lý reviewer pool
              </Link>
            </div>
          </div>
          <form method="GET" className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Đợt tuyển</label>
              <select
                name="intake_batch_id"
                defaultValue={intakeBatchId ?? ""}
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
              >
                <option value="">-- Chọn batch --</option>
                {intakeBatches.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name ?? b.code ?? b.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Role ứng tuyển</label>
              <select
                name="role_applied"
                defaultValue={roleApplied ?? ""}
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
              >
                <option value="">-- Chọn role --</option>
                <option value="mentor">Mentor</option>
                <option value="mentee">Mentee</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
              >
                Tiếp tục
              </button>
            </div>
          </form>
        </Card>
      </>
    );
  }

  // Load application pool and reviewer list in parallel
  const seasonId = intakeBatches.data.find((batch) => batch.id === intakeBatchId)?.season_id;
  const [candidatesResult, reviewersResult] = await Promise.all([
    getInterviewCandidates({
      intakeBatchId,
      roleApplied,
      scope,
      actor: { role: adminUser.role, adminUserId: adminUser.id }
    }),
    seasonId
      ? getReviewEligibleReviewers(String(seasonId), "interview")
      : Promise.resolve({ data: [], error: "Batch chưa gắn mùa." })
  ]);

  const batchName =
    intakeBatches.data.find((b) => b.id === intakeBatchId)?.name ??
    intakeBatches.data.find((b) => b.id === intakeBatchId)?.code ??
    intakeBatchId;

  return (
    <>
      <PageHeader
        title="Phân công Phỏng vấn"
        description={`Batch: ${batchName} · Role: ${roleApplied}`}
      />

      {/* Nav breadcrumb back to step 1 */}
      <div className="mb-4">
        <Link
          href="/interviews/assign"
          className="text-sm text-vam-green hover:underline"
        >
          ← Chọn batch / role khác
        </Link>
      </div>

      <ErrorBox message={candidatesResult.error || reviewersResult.error} />

      <AssignInterviewForm
        candidates={candidatesResult.data}
        reviewers={reviewersResult.data}
        intakeBatchId={intakeBatchId}
        roleApplied={roleApplied}
        intakeBatches={intakeBatches.data}
        seasons={seasons.data}
        adminUserId={adminUser.id}
      />
    </>
  );
}
