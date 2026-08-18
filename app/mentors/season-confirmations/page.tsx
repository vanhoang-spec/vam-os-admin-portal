import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { resolveEmailBaseUrl } from "@/lib/email";
import { listMentorSeasonConfirmations } from "@/lib/mentor-confirmations";
import { canRecordMentorConfirmation } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import { SeasonConfirmationsClient } from "./season-confirmations-client";

/**
 * Season participation roster: who is continuing, how many mentees they take,
 * and who still has to be chased by phone.
 *
 * Read access follows the season scope; every write is re-checked inside
 * lib/mentor-confirmations.ts, so this guard only decides what to render.
 */
export const dynamic = "force-dynamic";

function getRequestOrigin() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function SeasonConfirmationsPage({
  searchParams
}: {
  searchParams?: { season?: string | string[]; source?: string | string[] };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canRecordMentorConfirmation(adminUser.role)) redirect("/mentors");

  const scopeContext = await getAdminScopeContext();
  const canOperate = canOperateAnyScope(scopeContext);

  const seasonCode = param(searchParams?.season) || SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
  const sourceSeasonCode = param(searchParams?.source) || SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE;

  const baseUrl = resolveEmailBaseUrl(getRequestOrigin());
  const result = await listMentorSeasonConfirmations({ seasonIdOrCode: seasonCode, baseUrl });

  const seasonLabel = result.season?.name || result.season?.code || seasonCode;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Xác nhận mentor — ${seasonLabel}`}
        description="Mentor tự xác nhận qua đường dẫn cá nhân gửi bằng email; những người chưa phản hồi sẽ được gọi điện và ghi nhận tay tại đây."
      />

      {result.error ? <ErrorBox message={result.error} /> : null}

      {!canOperate ? (
        <Card>
          <p className="text-sm text-slate-600">
            Bạn đang xem ở chế độ chỉ đọc. Để ghi nhận xác nhận, bạn cần quyền vận hành (operations)
            cho mùa này — liên hệ super admin để được cấp phạm vi.
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Đã xác nhận tiếp tục" value={result.summary.confirmed} tone="success" />
        <KpiCard label="Không tiếp tục" value={result.summary.declined} />
        <KpiCard label="Chưa phản hồi" value={result.summary.pending} tone="warning" />
        <KpiCard
          label="Tổng số mentee có thể nhận"
          value={result.summary.totalCapacity}
          helper={`Đã phản hồi ${result.summary.respondedPct}% trên ${result.summary.total} mentor`}
        />
      </div>

      {!baseUrl ? (
        <Card>
          <p className="text-sm text-amber-800">
            Chưa cấu hình <code>VAM_OS_PUBLIC_BASE_URL</code>, nên đường dẫn cá nhân đang dựa vào địa
            chỉ của phiên truy cập hiện tại. Hãy đặt biến này trước khi gửi email hàng loạt.
          </p>
        </Card>
      ) : null}

      <SeasonConfirmationsClient
        rows={result.rows}
        seasonCode={result.season?.code ?? seasonCode}
        sourceSeasonCode={sourceSeasonCode}
        baseUrl={baseUrl}
        canOperate={canOperate}
      />

      <Card>
        <h2 className="text-sm font-semibold text-vam-ink">Sau khi mentor xác nhận</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Mentor đã xác nhận sẽ xuất hiện trong{" "}
          <Link href="/matches" className="text-vam-green underline">
            ghép cặp
          </Link>{" "}
          của mùa này, với hạn mức đúng bằng số mentee họ đã chọn. Mentor chưa phản hồi hoặc từ chối
          sẽ không được ghép.
        </p>
      </Card>
    </div>
  );
}
