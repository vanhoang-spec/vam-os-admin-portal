import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { AI_PRIVACY_NOTICE, evaluateAiConfig } from "@/lib/ai/ai-core";
import { canRunAiExecutiveReport, canUseAiTools, canViewAiStatus } from "@/lib/permissions";
import { resolveSeasonContext } from "@/lib/season-context";
import { seasonLabel } from "@/lib/season-labels";
import { BrainstormTool, CanvaBriefTool, ContentTool, DocumentTool, ExecutiveReportTool, TrendTool } from "./ai-tools";

export const dynamic = "force-dynamic";
// Server action của trang chạy trong function của trang này. Xu hướng ngành có thể
// tốn 25 giây tìm web cộng 75 giây chờ DeepSeek (lib/ai/types.ts AI_TIMEOUT_MS).
export const maxDuration = 120;

async function resolveReportSeason(): Promise<{ code: string; name: string } | null> {
  try {
    const context = await resolveSeasonContext();
    const selected = context.availableSeasons.find((season) => season.id === context.selectedSeasonId);
    return { code: context.selectedSeasonCode, name: seasonLabel(context.selectedSeasonCode, selected?.name ?? null) };
  } catch (error) {
    // Không xác định được mùa thì chỉ thẻ báo cáo nói điều đó; năm công cụ còn lại
    // không đọc dữ liệu chương trình nên không có lý do gì phải tắt theo.
    console.error("[AI] trang /ai: không xác định được mùa cho báo cáo", error);
    return null;
  }
}

export default async function AiToolsPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canUseAiTools(adminUser.role)) redirect("/");

  const config = evaluateAiConfig(process.env);
  const canReport = canRunAiExecutiveReport(adminUser.role);
  const reportSeason = canReport ? await resolveReportSeason() : null;

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <PageHeader
          title="Công cụ AI"
          description="Trợ lý soạn ý tưởng, nội dung, brief thiết kế, văn bản và tổng hợp xu hướng ngành. Mọi kết quả phải được người dùng đọc lại trước khi dùng."
        />
        {canViewAiStatus(adminUser.role) ? (
          <Link href="/ai/status" className="-mt-4 inline-block text-sm font-medium text-vam-green hover:underline">
            Trạng thái kết nối DeepSeek và Tavily
          </Link>
        ) : null}
      </div>

      {!config.deepseek ? (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Công cụ AI chưa được cấu hình khoá API DeepSeek nên các nút chạy sẽ báo lỗi. Liên hệ quản trị viên.
        </p>
      ) : null}

      <p className="rounded-md border border-vam-line bg-vam-mint px-4 py-3 text-sm text-vam-ink">{AI_PRIVACY_NOTICE}</p>

      <BrainstormTool />
      <ContentTool />
      <CanvaBriefTool />
      {canReport ? (
        reportSeason ? (
          <ExecutiveReportTool seasonCode={reportSeason.code} seasonName={reportSeason.name} />
        ) : (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Báo cáo Ban điều hành: không xác định được mùa bạn được cấp quyền, nên chưa chạy được báo cáo.
          </p>
        )
      ) : null}
      <TrendTool webSearchOn={config.tavily} />
      <DocumentTool />
    </div>
  );
}
