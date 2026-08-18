import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSeasons } from "@/lib/data";
import { canManageProgramDocuments } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { listProgramDocuments } from "@/lib/program-documents";
import { isDocumentReady } from "@/lib/program-documents-core";
import { resolveEmailBaseUrl } from "@/lib/email";
import { SEASON_CONFIG } from "@/lib/season-config";
import { DocumentsClient } from "./documents-client";

/**
 * Page: /operations/documents
 *
 * The four documents a season needs — code of conduct and tips, for mentees
 * and for mentors. They are written here and read by applicants at a public
 * address, which is what the post-matching emails link to.
 */
export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function ProgramDocumentsPage({
  searchParams
}: {
  searchParams?: { season_id?: string | string[] };
}) {
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

  const documents = seasonId ? await listProgramDocuments({ seasonId }) : null;
  const rows = documents?.rows ?? [];
  const readyCount = rows.filter((row) => isDocumentReady(row)).length;

  const baseUrl = resolveEmailBaseUrl(null);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Tài liệu chương trình"
        description="Quy tắc ứng xử và cẩm nang đồng hành, bản dành cho mentee và bản dành cho mentor. Email sau khi ghép cặp sẽ gửi đường dẫn tới các trang này — sửa nội dung ở đây là người đọc thấy bản mới ngay."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/operations" className="text-sm text-vam-green hover:underline">
          ← Quay lại Vận hành
        </Link>
        <Link href="/operations/communications" className="text-sm text-vam-green hover:underline">
          Gửi thư sau ghép cặp
        </Link>
      </div>

      <ErrorBox message={seasons.error || documents?.error} />

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
          label="Đã phát hành"
          value={readyCount}
          tone={readyCount === 4 ? "success" : "warning"}
          helper={`/4 tài liệu · mùa ${season?.code ?? "—"}`}
        />
        <KpiCard label="Bản nháp" value={rows.filter((row) => row.status === "draft").length} helper="Chưa ai đọc được" />
        <KpiCard
          label="Chưa có nội dung"
          value={rows.filter((row) => !String(row.body ?? "").trim()).length}
          helper="Cần dán nội dung vào"
        />
        <KpiCard label="Tổng số tài liệu" value={rows.length} helper="Mỗi mùa cần đủ 4" />
      </div>

      <DocumentsClient
        seasonId={seasonId}
        documents={rows}
        baseUrl={baseUrl}
        canOperate={canOperate}
      />
    </div>
  );
}
