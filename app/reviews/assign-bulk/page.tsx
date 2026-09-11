import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getIntakeBatches,
  getReviewAssignableApplications,
  getReviewEligibleReviewers,
  getSeasons
} from "@/lib/data";
import { canAssignReviewLots, canManageReviewers, canReview } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { AssignBulkForm } from "./assign-bulk-form";

// ---------------------------------------------------------------------------
// Page: /reviews/assign-bulk
// ---------------------------------------------------------------------------

export default async function AssignBulkPage(props: { searchParams: Promise<{ intake_batch_id?: string; role_applied?: string; review_round?: string }> }) {
  const searchParams = await props.searchParams;

  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canAssignReviewLots(adminUser.role)) redirect("/reviews");

  // Support team reaches this screen without the rest of /reviews. A link to a
  // page that turns them away is worse than no link.
  const canOpenGuide = canReview(adminUser.role);
  const canOpenPool = canManageReviewers(adminUser.role);

  const intakeBatchId = searchParams.intake_batch_id?.trim() || null;
  const roleApplied = searchParams.role_applied?.trim() || null;
  const reviewRoundRaw = searchParams.review_round?.trim() || "profile_screening";
  const reviewRound = reviewRoundRaw === "interview" ? "interview" : "profile_screening";
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  // Always fetch batches + seasons for the selector dropdowns
  const [intakeBatches, seasons] = await Promise.all([getIntakeBatches(scope), getSeasons(scope)]);

  // If no batch or role is selected, show the filter selector only
  if (!intakeBatchId || !roleApplied) {
    return (
      <>
        <PageHeader
          title="Chia hồ sơ cho reviewer"
          description="Chọn batch và role để xem danh sách hồ sơ và phân công reviewer."
        />
        <ErrorBox message={intakeBatches.error || seasons.error} />

        <Card>
          <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Bước 1 — Chọn batch và role ứng tuyển</p>
          <div className="flex gap-3">
            {canOpenPool ? (
              <Link href="/reviews/reviewer-pool" className="text-xs text-slate-400 hover:text-vam-green hover:underline">
                Quản lý reviewer pool
              </Link>
            ) : null}
            {canOpenGuide ? (
              <Link href="/reviews/guide" className="text-xs text-slate-400 hover:text-vam-green hover:underline">
                Hướng dẫn vận hành
              </Link>
            ) : null}
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
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">Vòng phân công</label>
              <select
                name="review_round"
                defaultValue={reviewRound}
                className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
              >
                <option value="profile_screening">Đánh giá hồ sơ</option>
                <option value="interview">Phỏng vấn</option>
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
  const [appsResult, reviewersResult] = await Promise.all([
    getReviewAssignableApplications({ intakeBatchId, roleApplied, reviewRound, scope }),
    seasonId
      ? getReviewEligibleReviewers(String(seasonId), reviewRound)
      : Promise.resolve({ data: [], error: "Batch chưa gắn mùa." })
  ]);

  const batchName =
    intakeBatches.data.find((b) => b.id === intakeBatchId)?.name ??
    intakeBatches.data.find((b) => b.id === intakeBatchId)?.code ??
    intakeBatchId;

  return (
    <>
      <PageHeader
        title={reviewRound === "interview" ? "Giao ứng viên phỏng vấn" : "Giao hồ sơ đánh giá"}
        description={`Đợt tuyển: ${batchName} · Vai trò: ${roleApplied} · Vòng: ${reviewRound === "interview" ? "Phỏng vấn" : "Đánh giá hồ sơ"}`}
      />

      {/* Nav breadcrumb back to step 1 */}
      <div className="mb-4">
        <Link
          href="/reviews/assign-bulk"
          className="text-sm text-vam-green hover:underline"
        >
          ← Chọn batch / role khác
        </Link>
      </div>

      <ErrorBox message={appsResult.error || reviewersResult.error} />

      <AssignBulkForm
        applications={appsResult.data}
        reviewers={reviewersResult.data}
        intakeBatchId={intakeBatchId}
        roleApplied={roleApplied}
        reviewRound={reviewRound}
        intakeBatches={intakeBatches.data}
        seasons={seasons.data}
        adminUserId={adminUser.id}
      />
    </>
  );
}
