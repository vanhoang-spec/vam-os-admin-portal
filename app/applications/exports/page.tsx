import Link from "next/link";
import { redirect } from "next/navigation";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSeasons } from "@/lib/data";
import { canAssignReview } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getSeasonReviewerOptions } from "@/lib/review-reviewer-options";
import { SEASON_CONFIG } from "@/lib/season-config";
import { ResultsExportPanel, ScoresExportPanel } from "./export-panels";

export default async function ApplicationExportsPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  // Both files carry candidate PII, so this page follows the same gate as the
  // endpoints it builds URLs for rather than a looser read-only one.
  if (!canAssignReview(adminUser.role)) redirect("/applications");

  const scope = await getScopeFilter(await getAdminScopeContext());
  const seasons = await getSeasons(scope);
  const season = seasons.data.find((row) => row.code === SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE);

  if (!season?.id) {
    return (
      <>
        <PageHeader title="Xuất dữ liệu tuyển sinh" description="Kết quả tuyển và điểm review." />
        <ErrorBox
          message={
            seasons.error ||
            `Bạn không có quyền vận hành mùa ${SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE}, hoặc mùa này chưa được cấu hình.`
          }
        />
        <Link href="/applications" className="text-sm font-medium text-vam-green underline">
          Quay lại Ứng tuyển
        </Link>
      </>
    );
  }

  const reviewers = await getSeasonReviewerOptions(String(season.id));
  const seasonLabel = season.code ?? String(season.id);

  return (
    <>
      <PageHeader
        title="Xuất dữ liệu tuyển sinh"
        description="Chọn bộ lọc rồi tải CSV. Không cần chỉnh URL thủ công."
      />
      <ErrorBox message={seasons.error || reviewers.error} />
      <ResultsExportPanel seasonId={String(season.id)} seasonLabel={seasonLabel} />
      <ScoresExportPanel seasonId={String(season.id)} seasonLabel={seasonLabel} reviewers={reviewers.data} />
      <Link href="/applications" className="text-sm font-medium text-vam-green underline">
        Quay lại Ứng tuyển
      </Link>
    </>
  );
}
