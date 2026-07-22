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
              ["Mùa", season?.code ?? season?.name],
              ["Trạng thái", match.data.status],
              ["Loại ghép", match.data.match_type],
              ["Nguồn", match.data.match_source_raw],
              ["Độ tin cậy", match.data.match_confidence],
              ["Ghi chú", match.data.notes]
            ]}
          />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin Mentor</h2>
          <div className="grid gap-3">
            <DetailGrid
              rows={[
                ["Họ tên", mentor?.full_name],
                ["Email", mentor?.email_primary],
                ["SĐT", mentor?.phone_primary],
                ["Mã Mentor", displayCode(mentorProfile?.mentor_code)],
                ["Công ty", displayText(mentorProfile?.company_current)],
                ["Chức vụ", displayText(mentorProfile?.title_current)]
              ]}
            />
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <div className="text-xs font-medium uppercase text-slate-500">Hồ sơ Mentor</div>
              <div className="mt-1">
                <ExternalLinkButton href={mentorProfile?.bio_url} label="Xem hồ sơ Mentor" />
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin Mentee</h2>
          <DetailGrid
            rows={[
              ["Họ tên", mentee?.full_name],
              ["Email", mentee?.email_primary],
              ["SĐT", mentee?.phone_primary],
              ["Mã Mentee", displayCode(menteeProfile?.mentee_code)],
              ["Trường", displayCode(menteeProfile?.school_code)],
              ["Ngành", displayText(menteeProfile?.major)],
              ["MSSV", displayText(menteeProfile?.mssv)]
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
