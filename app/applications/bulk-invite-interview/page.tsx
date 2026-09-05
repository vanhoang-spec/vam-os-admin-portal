import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAllApplicationReviews, getApplications, getIntakeBatches } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getStageRequirements } from "@/lib/recruitment-stage-requirements";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import {
  BULK_INVITE_MAX,
  BULK_INVITE_SOURCE_STATUSES,
  isBulkInviteCandidate
} from "@/lib/bulk-invite-interview";
import { PROFILE_REVIEW_ROUND } from "@/lib/screening-decision";
import { BulkInviteForm, type BulkInviteRow } from "./bulk-invite-form";

export const dynamic = "force-dynamic";

/**
 * Mời phỏng vấn hàng loạt.
 *
 * Source population is exactly the applications the individual "Mời phỏng vấn"
 * command would accept: a profile round that has finished, with the season's
 * minimum submitted profile reviews already in. Rows are counted from ONE
 * scoped read of the review table rather than a query per application.
 */
export default async function BulkInviteInterviewPage(props: {
  searchParams: Promise<{ intake_batch_id?: string; role_applied?: string; q?: string }>;
}) {
  const searchParams = await props.searchParams;
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canDecide(actor.role)) redirect("/applications");

  const scopeContext = await getAdminScopeContext();
  if (!canOperateAnyScope(scopeContext)) redirect("/applications");
  const scope = await getScopeFilter(scopeContext);

  const [applicationsResult, batchesResult, reviewsResult] = await Promise.all([
    getApplications(scope),
    getIntakeBatches(scope),
    getAllApplicationReviews(scope)
  ]);

  const intakeBatchId = searchParams.intake_batch_id?.trim() ?? "";
  const roleApplied = searchParams.role_applied?.trim() ?? "";
  const query = (searchParams.q ?? "").trim().toLowerCase();

  // Season requirements for every season in scope, read once.
  const seasonIds = Array.from(
    new Set(applicationsResult.data.map((app) => String(app.season_id ?? "")).filter(Boolean))
  );
  const requirementsResult = seasonIds.length
    ? await getStageRequirements(seasonIds)
    : { data: [], error: null };
  const requiredBySeason = new Map(
    requirementsResult.data
      .filter((row) => row.review_stage === "profile_screening")
      .map((row) => [row.season_id, row.minimum_submitted_reviews] as const)
  );

  // DISTINCT submitted reviewers per application, mirroring the RPC's count.
  const submittedReviewers = new Map<string, Set<string>>();
  for (const review of reviewsResult.data) {
    if (review.review_round !== PROFILE_REVIEW_ROUND) continue;
    if (review.status !== "submitted") continue;
    if (!review.reviewer_admin_user_id) continue;
    const key = String(review.application_id);
    const set = submittedReviewers.get(key) ?? new Set<string>();
    set.add(String(review.reviewer_admin_user_id));
    submittedReviewers.set(key, set);
  }

  const eligible = applicationsResult.data.filter((app) => {
    if (intakeBatchId && app.intake_batch_id !== intakeBatchId) return false;
    if (roleApplied && app.role_applied !== roleApplied) return false;
    if (query) {
      const haystack = `${app.full_name ?? ""} ${app.email_primary ?? ""} ${app.sbd ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return isBulkInviteCandidate(
      {
        status: app.status,
        submittedProfileReviews: submittedReviewers.get(String(app.id))?.size ?? 0
      },
      requiredBySeason.get(String(app.season_id ?? "")) ?? 1
    );
  });

  const rows: BulkInviteRow[] = eligible.slice(0, BULK_INVITE_MAX).map((app) => ({
    id: String(app.id),
    fullName: String(app.full_name ?? app.email_primary ?? app.id),
    role: String(app.role_applied ?? "-"),
    status: String(app.status ?? ""),
    statusLabel: applicationStatusLabel(app.status),
    submittedReviews: submittedReviewers.get(String(app.id))?.size ?? 0
  }));

  const readError = applicationsResult.error || batchesResult.error || reviewsResult.error || requirementsResult.error;

  return (
    <>
      <PageHeader
        title="Mời phỏng vấn hàng loạt"
        description="Hồ sơ đã có đủ đánh giá và đang chờ quyết định vòng hồ sơ. Chọn và mời phỏng vấn trong một lượt."
      />
      <div className="mb-4">
        <Link href="/applications" className="text-sm text-vam-green hover:underline">
          ← Quay lại danh sách
        </Link>
      </div>
      <ErrorBox message={readError} />

      <Card className="mb-4">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Đợt tuyển
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId}
              className="mt-1 block rounded-md border border-vam-line px-3 py-2"
            >
              <option value="">Tất cả</option>
              {batchesResult.data.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name ?? batch.code ?? batch.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Vai trò
            <select
              name="role_applied"
              defaultValue={roleApplied}
              className="mt-1 block rounded-md border border-vam-line px-3 py-2"
            >
              <option value="">Tất cả</option>
              <option value="mentor">Mentor</option>
              <option value="mentee">Mentee</option>
            </select>
          </label>
          <label className="text-sm">
            Tìm ứng viên
            <input
              name="q"
              type="search"
              defaultValue={searchParams.q ?? ""}
              placeholder="Tên, email hoặc SBD"
              className="mt-1 block rounded-md border border-vam-line px-3 py-2"
            />
          </label>
          <button className="rounded-md border border-vam-line px-4 py-2 text-sm" type="submit">
            Lọc
          </button>
        </form>
      </Card>

      <p className="mb-3 text-sm text-slate-600">
        {eligible.length} hồ sơ đủ điều kiện
        {eligible.length > BULK_INVITE_MAX ? ` — đang hiển thị ${BULK_INVITE_MAX} hồ sơ đầu tiên` : ""}
        . Chỉ hồ sơ ở trạng thái{" "}
        {Array.from(BULK_INVITE_SOURCE_STATUSES)
          .map((status) => applicationStatusLabel(status))
          .join(" / ")}{" "}
        và đã đủ đánh giá mới xuất hiện ở đây.
      </p>

      <Card>
        <BulkInviteForm rows={rows} />
      </Card>
    </>
  );
}
