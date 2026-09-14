/**
 * lib/ai/executive-report-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dựng đầu vào của "Báo cáo Ban điều hành" từ các con số màn hình vận hành đang dùng.
 *
 * Module thuần. Hai điều nó giữ:
 *   1. CHỈ SỐ ĐẾM. Kiểu đầu vào không có chỗ nào chứa tên, email hay mã người — thứ
 *      rời khỏi VAM OS để sang DeepSeek chỉ là nhãn cố định trong file này và con số.
 *   2. Không đọc được là KHÔNG ĐỌC ĐƯỢC, không phải 0. Một nguồn lỗi mà hiện thành 0
 *      thì AI sẽ viết "tháng này không có recap nào" — một cảnh báo sai trình lên Ban
 *      điều hành, nghe hoàn toàn hợp lý.
 */

import type { ExecutiveReportInput, ReportMetric, ReportSection } from "./prompts";

export type RecruitmentCounts = { applicationCount: unknown; matchCount: unknown; activeMatchCount: unknown };

export type MonthlyCounts = {
  selectedMonth: unknown;
  recapCount: unknown;
  activeMenteeCount: unknown;
  activeMentorCount: unknown;
  mentorWithoutRecapCount: unknown;
  eventTrainingCount: unknown;
  eventAttendanceCount: unknown;
  followUpCount: unknown;
};

export type WorkflowCounts = {
  openActionCount: unknown;
  overdueActionCount: unknown;
  followUpOpenCount: unknown;
  followUpResolvedCount: unknown;
  dataIssueOpenCount: unknown;
  correctionsThisMonth: unknown;
};

export type SeasonTotals = {
  openApplications: unknown;
  activeMentors: unknown;
  activeMentees: unknown;
  activeMatches: unknown;
  upcomingEvents: unknown;
  dataIssues: unknown;
  overdueTasks: unknown;
};

/** Mỗi nguồn là null khi đọc lỗi. */
export type ExecutiveReportSources = {
  recruitment: RecruitmentCounts | null;
  monthly: MonthlyCounts | null;
  workflow: WorkflowCounts | null;
  season: SeasonTotals | null;
};

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "2026-09" → "09/2026". Không phải mốc thời gian, nên không đi qua lib/utils. */
export function monthLabel(value: unknown): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? "").trim());
  return match ? `${match[2]}/${match[1]}` : null;
}

function section(title: string, source: object | null, rows: Array<[string, unknown]>): ReportSection {
  if (!source) return { title, unavailable: true, metrics: [] };
  const metrics: ReportMetric[] = rows.map(([label, value]) => ({ label, value: count(value) }));
  return { title, unavailable: false, metrics };
}

export function buildExecutiveReportInput(
  sources: ExecutiveReportSources,
  meta: { seasonCode: string; seasonLabel: string; generatedAt: string }
): ExecutiveReportInput {
  const { recruitment, monthly, workflow, season } = sources;
  const month = monthly ? monthLabel(monthly.selectedMonth) : null;

  return {
    generatedAt: meta.generatedAt,
    seasonCode: meta.seasonCode,
    seasonLabel: meta.seasonLabel,
    sections: [
      section("Tuyển sinh và ghép cặp", recruitment, [
        ["Hồ sơ ứng tuyển trong mùa", recruitment?.applicationCount],
        ["Cặp ghép trong mùa", recruitment?.matchCount],
        ["Cặp ghép đang hoạt động", recruitment?.activeMatchCount]
      ]),
      section(month ? `Nhịp mentoring tháng ${month}` : "Nhịp mentoring trong tháng", monthly, [
        ["Recap hợp lệ trong tháng", monthly?.recapCount],
        ["Mentee có recap trong tháng", monthly?.activeMenteeCount],
        ["Mentor có recap trong tháng", monthly?.activeMentorCount],
        ["Mentor đang ghép cặp nhưng chưa có recap tháng này", monthly?.mentorWithoutRecapCount],
        ["Mentee đang ghép cặp không có recap cả tháng này lẫn tháng trước", monthly?.followUpCount],
        ["Sự kiện trong tháng", monthly?.eventTrainingCount],
        ["Lượt tham dự sự kiện trong tháng", monthly?.eventAttendanceCount]
      ]),
      section("Việc vận hành", workflow, [
        ["Việc đang mở", workflow?.openActionCount],
        ["Việc quá hạn", workflow?.overdueActionCount],
        ["Theo dõi mentee đang mở", workflow?.followUpOpenCount],
        ["Theo dõi mentee đã xử lý", workflow?.followUpResolvedCount],
        ["Vấn đề dữ liệu đang mở", workflow?.dataIssueOpenCount],
        ["Lần sửa dữ liệu trong tháng", workflow?.correctionsThisMonth]
      ]),
      section("Toàn mùa", season, [
        ["Hồ sơ ứng tuyển chưa chốt", season?.openApplications],
        ["Mentor đang hoạt động", season?.activeMentors],
        ["Mentee đang hoạt động", season?.activeMentees],
        ["Cặp ghép đang hoạt động", season?.activeMatches],
        ["Sự kiện sắp diễn ra", season?.upcomingEvents],
        ["Vấn đề dữ liệu", season?.dataIssues],
        ["Việc quá hạn", season?.overdueTasks]
      ])
    ]
  };
}

/** Còn ít nhất một nguồn đọc được thì mới đáng gọi AI. */
export function hasAnyReportData(input: ExecutiveReportInput): boolean {
  return input.sections.some((item) => !item.unavailable);
}
