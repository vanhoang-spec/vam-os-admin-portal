import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getEvents, getSeasons } from "@/lib/data";
import { canManageProgramDocuments } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getCommunicationReadiness } from "@/lib/post-match-emails";
import { getProviderConfig } from "@/lib/ai-provider";
import { SEASON_CONFIG } from "@/lib/season-config";
import { CommunicationsClient } from "./communications-client";

/**
 * Page: /operations/communications
 *
 * The four sends that close recruitment, in the order they happen, each showing
 * what still stands in its way: a template nobody approved, a document nobody
 * published, a mentee nobody matched.
 *
 * The second stage is locked until every selected mentee has a mentor. Telling
 * one student who their mentor is while another has nobody turns good news into
 * a comparison.
 */
export const dynamic = "force-dynamic";

/** A batch of fifty emails, one provider call each. */
export const maxDuration = 300;

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function CommunicationsPage(
  props: {
    searchParams?: Promise<{ season_id?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canManageProgramDocuments(adminUser.role)) redirect("/operations");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const canOperate = canOperateAnyScope(scopeContext);

  const [seasons, events] = await Promise.all([getSeasons(scope), getEvents(scope)]);

  const defaultSeason =
    seasons.data.find((season) => season.code === SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE) ??
    seasons.data[0];
  const requestedSeasonId = param(searchParams?.season_id).trim();
  const seasonId = requestedSeasonId || defaultSeason?.id || "";

  const readiness = seasonId ? await getCommunicationReadiness({ seasonId }) : null;
  const provider = getProviderConfig();

  const seasonEvents = events.data
    .filter((event) => !seasonId || event.season_id === seasonId)
    .map((event) => ({
      id: String(event.id),
      name: String(event.name ?? event.event_type ?? event.id),
      startsAt: (event.starts_at as string | null) ?? null
    }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Gửi thư sau ghép cặp"
        description="Bốn đợt thư: báo mentee trúng tuyển, giới thiệu mentor cho mentee, gửi mentor hồ sơ mentee, và mời kick-off. Mỗi đợt chỉ gửi được khi mẫu thư đã duyệt và tài liệu đã phát hành."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/operations" className="text-sm text-vam-green hover:underline">
          ← Quay lại Vận hành
        </Link>
        <Link href="/operations/documents" className="text-sm text-vam-green hover:underline">
          Tài liệu chương trình
        </Link>
        <Link href="/operations/email-templates" className="text-sm text-vam-green hover:underline">
          Mẫu thư
        </Link>
        <Link href="/matches/unmatched" className="text-sm text-vam-green hover:underline">
          Danh sách chưa ghép
        </Link>
      </div>

      <ErrorBox message={seasons.error || events.error || readiness?.error} />

      <Card>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Mùa</label>
            <select
              name="season_id"
              defaultValue={seasonId}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              {seasons.data.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code ?? row.name ?? row.id}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Xem
          </button>
        </form>
      </Card>

      {readiness ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Mentee đã đậu"
              value={readiness.menteesSelected}
              helper={`Mùa ${readiness.seasonLabel ?? "—"}`}
            />
            <KpiCard
              label="Chưa có mentor"
              value={readiness.menteesWaiting}
              tone={readiness.menteesWaiting > 0 ? "warning" : "success"}
              helper={readiness.menteesWaiting > 0 ? "Đợt 2 còn bị khoá" : "Đủ điều kiện gửi đợt 2"}
            />
            <KpiCard label="Cặp đang hoạt động" value={readiness.activePairs} tone="success" helper="Mentor – mentee" />
            <KpiCard
              label="Mentor thiếu giới thiệu"
              value={readiness.mentorsMissingBio}
              tone={readiness.mentorsMissingBio > 0 ? "warning" : "default"}
              helper="Cần cho thư giới thiệu mentor"
            />
          </div>

          <CommunicationsClient
            seasonId={seasonId}
            readiness={readiness}
            events={seasonEvents}
            canOperate={canOperate}
            canDraftWithAi={provider.ok}
          />
        </>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">Chọn một mùa để xem trạng thái các đợt thư.</p>
        </Card>
      )}
    </div>
  );
}
