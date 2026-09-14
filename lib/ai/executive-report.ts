import "server-only";

import { getOperationsData, getOperationsWorkflowData, getRestrictedDashboardSummary } from "@/lib/data";
import { getProgramWorkspaceSummary } from "@/lib/portfolio";
import type { ResolvedSeasonContext } from "@/lib/season-context";
import { formatDateTime } from "@/lib/utils";
import { buildExecutiveReportInput, type ExecutiveReportSources } from "./executive-report-core";
import type { ExecutiveReportInput } from "./prompts";

/**
 * Nạp số liệu cho "Báo cáo Ban điều hành".
 *
 * Dùng lại ĐÚNG các hàm mà trang tổng quan, /operations và /operations/tasks đang
 * dùng, nên con số AI đọc khớp con số trên màn hình — không có nguồn sự thật thứ hai.
 *
 * Chỗ gọi phải kiểm quyền TRƯỚC (canRunAiExecutiveReport + canReadSeason): các hàm dưới
 * đọc bằng service role.
 */

async function settle<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`[AI] báo cáo Ban điều hành: không đọc được ${label}`, error);
    return null;
  }
}

export async function loadExecutiveReportInput(
  context: ResolvedSeasonContext,
  seasonLabel: string,
  accessMode: "global" | "program_scoped"
): Promise<ExecutiveReportInput> {
  const [recruitment, monthly, workflow, season] = await Promise.all([
    settle("tuyển sinh và ghép cặp", async () => {
      const result = await getRestrictedDashboardSummary(context.effectiveScope);
      if (result.error) throw new Error(String(result.error));
      return {
        applicationCount: result.applicationCount,
        matchCount: result.matchCount,
        activeMatchCount: result.activeMatchCount
      };
    }),
    settle("nhịp mentoring", async () => {
      const result = await getOperationsData(context.effectiveScope, context.selectedSeasonCode);
      if (result.kpis.error) throw new Error(String(result.kpis.error));
      return result.kpis.data;
    }),
    settle("việc vận hành", async () => {
      const result = await getOperationsWorkflowData(context.selectedSeasonCode);
      if (result.error || !result.data) throw new Error(String(result.error ?? "không có dữ liệu"));
      return result.data.summary;
    }),
    settle("số liệu toàn mùa", async () => {
      const result = await getProgramWorkspaceSummary({
        selectedProgramId: context.currentProgramId,
        selectedProgramCode: "",
        selectedSeasonId: context.selectedSeasonId,
        selectedSeasonCode: context.selectedSeasonCode,
        selectedIntakeBatchId: null,
        accessMode
      });
      return result.totals;
    })
  ]);

  const sources: ExecutiveReportSources = { recruitment, monthly, workflow, season };
  return buildExecutiveReportInput(sources, {
    seasonCode: context.selectedSeasonCode,
    seasonLabel,
    generatedAt: formatDateTime(new Date())
  });
}
