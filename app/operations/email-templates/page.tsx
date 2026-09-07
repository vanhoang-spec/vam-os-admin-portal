import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSeasons } from "@/lib/data";
import { canManageProgramDocuments } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { listEmailTemplates } from "@/lib/email-templates";
import { getProviderConfig } from "@/lib/ai-provider";
import { SEASON_CONFIG } from "@/lib/season-config";
import { TemplatesClient } from "./templates-client";

/**
 * Page: /operations/email-templates
 *
 * The four letters the season sends after matching. Each is drafted (by hand
 * or with assistance), edited, and approved — and only an approved one can be
 * used by a bulk send.
 */
export const dynamic = "force-dynamic";

/** A draft request goes out to the provider and back. */
export const maxDuration = 120;

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function EmailTemplatesPage(
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

  const seasons = await getSeasons(scope);
  const defaultSeason =
    seasons.data.find((season) => season.code === SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE) ??
    seasons.data[0];

  const requestedSeasonId = param(searchParams?.season_id).trim();
  const seasonId = requestedSeasonId || defaultSeason?.id || "";
  const season = seasons.data.find((row) => row.id === seasonId);

  const templates = seasonId ? await listEmailTemplates({ seasonId }) : null;
  const rows = templates?.rows ?? [];
  const approved = rows.filter((row) => row.status === "approved").length;

  const provider = getProviderConfig();

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Mẫu thư sau ghép cặp"
        description="Bốn lá thư gửi sau khi ghép cặp xong. Soạn nháp (tự viết hoặc nhờ AI), sửa cho đúng giọng chương trình, rồi bấm duyệt — chỉ mẫu đã duyệt mới gửi hàng loạt được."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/operations" className="text-sm text-vam-green hover:underline">
          ← Quay lại Vận hành
        </Link>
        <Link href="/operations/documents" className="text-sm text-vam-green hover:underline">
          Tài liệu chương trình
        </Link>
        <Link href="/operations/communications" className="text-sm text-vam-green hover:underline">
          Gửi thư sau ghép cặp
        </Link>
      </div>

      <ErrorBox message={seasons.error || templates?.error} />

      {!provider.ok ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Chưa bật soạn nháp bằng AI: {provider.reason}. Bạn vẫn tự viết và duyệt mẫu thư bình thường.
        </div>
      ) : null}

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Đã duyệt"
          value={approved}
          tone={approved === 4 ? "success" : "warning"}
          helper={`/4 mẫu thư · mùa ${season?.code ?? "—"}`}
        />
        <KpiCard label="Bản nháp" value={rows.filter((row) => row.status === "draft").length} helper="Chưa gửi được" />
        <KpiCard
          label="Chưa có nội dung"
          value={rows.filter((row) => !String(row.body ?? "").trim()).length}
          helper="Cần soạn nội dung"
        />
        <KpiCard
          label="AI soạn nháp"
          value={rows.filter((row) => row.ai_generated).length}
          helper="Đã có người sửa và duyệt lại"
        />
      </div>

      <TemplatesClient
        seasonId={seasonId}
        templates={rows}
        canOperate={canOperate}
        canDraftWithAi={provider.ok}
      />
    </div>
  );
}
