import Link from "next/link";
import { Card, DetailGrid, EmptyState, ErrorBox, ExternalLinkButton, PageHeader } from "@/components/ui";
import { getMatch, getSeasons, keyById } from "@/lib/data";
import { getMatchRelatedDisplayData } from "@/lib/matches";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayCode, displayText } from "@/lib/utils";

export default async function MatchDetailPage({ params }: { params: { id: string } }) {
  const scope = await getScopeFilter(await getAdminScopeContext());
  const [match, seasons] = await Promise.all([
    getMatch(params.id, scope),
    getSeasons(scope)
  ]);
  const related = await getMatchRelatedDisplayData(match.data);
  const seasonsById = keyById(seasons.data);
  const mentor = related.mentor ?? undefined;
  const mentee = related.mentee ?? undefined;
  const mentorProfile = related.mentorProfile ?? undefined;
  const menteeProfile = related.menteeProfile ?? undefined;
  const season = match.data?.season_id ? seasonsById.get(match.data.season_id) : undefined;
  const error = match.error || seasons.error;

  if (!match.data) {
    return (
      <>
        <PageHeader title="Không tìm thấy match" />
        <ErrorBox message={error} />
        <EmptyState message="Không tìm thấy match_id này trong bảng matches." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Chi tiết match" description={`${mentor?.full_name ?? "Mentor chưa rõ"} - ${mentee?.full_name ?? "Mentee chưa rõ"}`} />
      <ErrorBox message={error} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin match</h2>
          <DetailGrid
            rows={[
              ["season", season?.code ?? season?.name],
              ["status", match.data.status],
              ["match_type", match.data.match_type],
              ["match_source_raw", match.data.match_source_raw],
              ["match_confidence", match.data.match_confidence],
              ["notes", match.data.notes]
            ]}
          />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentor details</h2>
          <div className="grid gap-3">
            <DetailGrid
              rows={[
                ["full_name", mentor?.full_name],
                ["email_primary", mentor?.email_primary],
                ["phone_primary", mentor?.phone_primary],
                ["mentor_code", displayCode(mentorProfile?.mentor_code)],
                ["company_current", displayText(mentorProfile?.company_current)],
                ["title_current", displayText(mentorProfile?.title_current)]
              ]}
            />
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="text-xs font-medium uppercase text-slate-500">profile mentor</div>
              <div className="mt-1">
                <ExternalLinkButton href={mentorProfile?.bio_url} label="Xem profile mentor" />
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentee details</h2>
          <DetailGrid
            rows={[
              ["full_name", mentee?.full_name],
              ["email_primary", mentee?.email_primary],
              ["phone_primary", mentee?.phone_primary],
              ["mentee_code", displayCode(menteeProfile?.mentee_code)],
              ["school_code", displayCode(menteeProfile?.school_code)],
              ["major", displayText(menteeProfile?.major)],
              ["mssv", displayText(menteeProfile?.mssv)]
            ]}
          />
        </Card>
      </div>
      <div className="mt-4">
        <Link href="/matches" className="text-sm font-medium text-vam-green">Quay lại Matches</Link>
      </div>
    </>
  );
}
