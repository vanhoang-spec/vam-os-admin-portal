import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canViewCrossProgramReports } from "@/lib/participant-auth-core";
import { getCrossProgramReport } from "@/lib/cross-program-report";
import { ReportClient } from "./report-client";

/**
 * Page: /bao-cao
 *
 * The reporting console for super admins and the read-only VAM admin role.
 *
 * Three dimensions, as asked for: a time window, one or many programmes with a
 * total when there is more than one, and a choice of what to count. Everything
 * on it is aggregate — this screen never shows a name, and the role that lands
 * here by default can do nothing else.
 */
export const dynamic = "force-dynamic";

function list(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return value.split(",");
}

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function CrossProgramReportPage({
  searchParams
}: {
  searchParams?: { program?: string | string[]; metric?: string | string[]; from?: string | string[]; to?: string | string[] };
}) {
  const adminUser = await getCurrentAdminUser();
  // Not-found rather than a refusal, so the screen's existence is not confirmed
  // to a role that may not use it.
  if (!canViewCrossProgramReports(adminUser?.role)) notFound();

  const view = await getCrossProgramReport({
    programIds: list(searchParams?.program),
    metrics: list(searchParams?.metric),
    from: param(searchParams?.from),
    to: param(searchParams?.to)
  });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Báo cáo toàn hệ thống"
        description="Chọn khoảng thời gian, chọn một hoặc nhiều chương trình, chọn loại số liệu. Chỉ xem và xuất — màn hình này không sửa được dữ liệu chương trình nào."
      />

      {view.error ? <ErrorBox message={view.error} /> : null}

      {view.availablePrograms.length === 0 && !view.error ? (
        <Card>
          <p className="text-sm text-slate-600">
            Chưa có chương trình nào đang hoạt động để báo cáo.
          </p>
        </Card>
      ) : (
        <ReportClient
          availablePrograms={view.availablePrograms}
          selectedProgramIds={view.selectedProgramIds}
          table={view.table}
        />
      )}

      {adminUser?.role === "super_admin" ? (
        <Card>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link className="text-vam-green underline" href="/portfolio">
              Danh mục chương trình
            </Link>
            <Link className="text-vam-green underline" href="/operations/intelligence">
              Phân tích mùa
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
