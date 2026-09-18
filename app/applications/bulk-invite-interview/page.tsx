import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  getAllApplicationReviews,
  getApplications,
  getIntakeBatches,
  getLatestNeedsMoreReviewByApplication,
  getSeasons
} from "@/lib/data";
import { canDecideAnyApplicationResult } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getStageRequirements } from "@/lib/recruitment-stage-requirements";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { BULK_INVITE_MAX, evaluateBulkInviteCandidate } from "@/lib/bulk-invite-interview";
import { DIRECT_INVITE_SOURCE_STATUSES } from "@/lib/direct-interview-eligibility";
import { PROFILE_REVIEW_ROUND } from "@/lib/screening-decision";
import { BulkInviteForm, type BulkInviteRow } from "./bulk-invite-form";

export const dynamic = "force-dynamic";

/**
 * Mời phỏng vấn kéo theo một lá thư cho mỗi ứng viên, gửi tuần tự, và mỗi lời
 * gọi tới nhà cung cấp email có thể treo tới 20 giây. Trần mặc định của Vercel
 * ngắn hơn tổng đó, nên quyết định đã ghi xong vẫn có thể bị báo là hỏng.
 */
export const maxDuration = 60;

/**
 * Mời phỏng vấn hàng loạt.
 *
 * The candidate population is decided by `evaluateBulkInviteCandidate`, which
 * delegates to the one canonical mirror of the database's own
 * `invited_to_interview` branch. Profile-stage `needs_more_review` is included
 * when its provenance holds, exactly as the individual command allows.
 *
 * Every per-application input is derived from THREE scoped reads — applications,
 * reviews and needs_more_review decisions — not one query per row.
 */
export default async function BulkInviteInterviewPage(props: {
  searchParams: Promise<{
    season_id?: string;
    intake_batch_id?: string;
    role_applied?: string;
    q?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canDecideAnyApplicationResult(actor.role)) redirect("/applications");

  const scopeContext = await getAdminScopeContext();
  if (!canOperateAnyScope(scopeContext)) redirect("/applications");
  const scope = await getScopeFilter(scopeContext);

  const [applicationsResult, batchesResult, seasonsResult, reviewsResult] = await Promise.all([
    getApplications(scope),
    getIntakeBatches(scope),
    getSeasons(scope),
    getAllApplicationReviews(scope)
  ]);

  const seasonId = searchParams.season_id?.trim() ?? "";
  const intakeBatchId = searchParams.intake_batch_id?.trim() ?? "";
  const roleApplied = searchParams.role_applied?.trim() ?? "";
  const query = (searchParams.q ?? "").trim().toLowerCase();

  // Narrow by the operator's filters BEFORE the per-application reads, so the
  // decisions lookup is bounded by what is actually on screen.
  const filtered = applicationsResult.data.filter((app) => {
    if (seasonId && String(app.season_id ?? "") !== seasonId) return false;
    if (intakeBatchId && app.intake_batch_id !== intakeBatchId) return false;
    if (roleApplied && app.role_applied !== roleApplied) return false;
    if (query) {
      const haystack = `${app.full_name ?? ""} ${app.email_primary ?? ""} ${app.sbd ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return DIRECT_INVITE_SOURCE_STATUSES.has(String(app.status ?? "").trim());
  });

  const candidateIds = filtered.map((app) => String(app.id));
  const [requirementsResult, needsMoreReviewResult] = await Promise.all([
    (async () => {
      const seasonIds = Array.from(
        new Set(filtered.map((app) => String(app.season_id ?? "")).filter(Boolean))
      );
      return seasonIds.length
        ? getStageRequirements(seasonIds)
        : { data: [], error: null as string | null };
    })(),
    getLatestNeedsMoreReviewByApplication(candidateIds)
  ]);

  // A requirement that could not be read must NOT become an assumed 1.
  const requiredBySeason = new Map<string, number>(
    requirementsResult.data
      .filter((row) => row.review_stage === "profile_screening")
      .map((row) => [row.season_id, row.minimum_submitted_reviews] as const)
  );

  // DISTINCT submitted reviewers and newest submission per application,
  // mirroring the RPC's counting.
  const profileReviewers = new Map<string, Set<string>>();
  const interviewReviewers = new Map<string, Set<string>>();
  const latestProfileSubmission = new Map<string, string>();
  for (const review of reviewsResult.data) {
    if (review.status !== "submitted" || !review.reviewer_admin_user_id) continue;
    const key = String(review.application_id);
    const target = review.review_round === PROFILE_REVIEW_ROUND ? profileReviewers : interviewReviewers;
    const set = target.get(key) ?? new Set<string>();
    set.add(String(review.reviewer_admin_user_id));
    target.set(key, set);
    if (review.review_round === PROFILE_REVIEW_ROUND && review.submitted_at) {
      const at = String(review.submitted_at);
      const current = latestProfileSubmission.get(key);
      if (!current || at > current) latestProfileSubmission.set(key, at);
    }
  }

  const eligible = filtered.filter((app) => {
    const key = String(app.id);
    const seasonKey = String(app.season_id ?? "");
    return evaluateBulkInviteCandidate({
      status: app.status,
      submittedProfileReviewers: profileReviewers.get(key)?.size ?? 0,
      requiredProfileReviews: requirementsResult.error
        ? null
        : requiredBySeason.get(seasonKey) ?? null,
      submittedInterviewReviewers: interviewReviewers.get(key)?.size ?? 0,
      latestNeedsMoreReviewAt: needsMoreReviewResult.data.get(key) ?? null,
      latestProfileSubmissionAt: latestProfileSubmission.get(key) ?? null
    }).eligible;
  });

  const rows: BulkInviteRow[] = eligible.slice(0, BULK_INVITE_MAX).map((app) => ({
    id: String(app.id),
    fullName: String(app.full_name ?? app.email_primary ?? app.id),
    role: String(app.role_applied ?? "-"),
    status: String(app.status ?? ""),
    statusLabel: applicationStatusLabel(app.status),
    submittedReviews: profileReviewers.get(String(app.id))?.size ?? 0
  }));

  const readError =
    applicationsResult.error ||
    batchesResult.error ||
    seasonsResult.error ||
    reviewsResult.error ||
    requirementsResult.error ||
    needsMoreReviewResult.error;

  return (
    <>
      <PageHeader
        title="Mời phỏng vấn hàng loạt"
        description="Hồ sơ đã đủ đánh giá và đang chờ quyết định vòng hồ sơ. Chọn và mời phỏng vấn trong một lượt."
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
            Mùa
            <select
              name="season_id"
              defaultValue={seasonId}
              className="mt-1 block rounded-md border border-vam-line px-3 py-2"
            >
              <option value="">Tất cả</option>
              {seasonsResult.data.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name ?? season.code ?? season.id}
                </option>
              ))}
            </select>
          </label>
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
        {eligible.length > BULK_INVITE_MAX
          ? ` — đang hiển thị ${BULK_INVITE_MAX} hồ sơ đầu tiên`
          : ""}
        . Chỉ hồ sơ đã hoàn tất vòng đánh giá và đủ số đánh giá tối thiểu mới xuất hiện ở đây.
      </p>

      <Card>
        <BulkInviteForm rows={rows} />
      </Card>
    </>
  );
}
