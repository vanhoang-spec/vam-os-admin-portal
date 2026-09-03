import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSeasons } from "@/lib/data";
import { canBulkAssignReviews } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getStageRequirements } from "@/lib/recruitment-stage-requirements";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { RequirementForm } from "./requirement-form";

export default async function ReviewSettingsPage() {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canBulkAssignReviews(actor.role)) redirect("/reviews");
  const scope = await getScopeFilter(await getAdminScopeContext());
  const seasons = await getSeasons(scope);
  const requirements = await getStageRequirements(seasons.data.map(season => season.id));
  const value = (seasonId: string, stage: string) => requirements.data.find(row => row.season_id === seasonId && row.review_stage === stage)?.minimum_submitted_reviews ?? 1;
  return <><PageHeader title="Cấu hình Recruitment Review" description="Số review đã nộp tối thiểu theo mùa và vòng; có thể giao thêm người khi cần." />
    <ErrorBox message={seasons.error || requirements.error} />
    <div className="space-y-4">{seasons.data.map(season => <Card key={season.id}><h2 className="mb-3 font-semibold">{season.code ?? season.name}</h2><div className="space-y-3"><RequirementForm seasonId={season.id} stage="profile_screening" minimum={value(season.id,"profile_screening")} /><RequirementForm seasonId={season.id} stage="interview" minimum={value(season.id,"interview")} /></div></Card>)}</div></>;
}
