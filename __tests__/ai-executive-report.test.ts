/**
 * Báo cáo Ban điều hành: thứ rời VAM OS sang DeepSeek chỉ là nhãn cố định và con
 * số — và một nguồn đọc lỗi không bao giờ hiện thành 0.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRestrictedDashboardSummary: vi.fn(),
  getOperationsData: vi.fn(),
  getOperationsWorkflowData: vi.fn(),
  getProgramWorkspaceSummary: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", () => ({
  getRestrictedDashboardSummary: mocks.getRestrictedDashboardSummary,
  getOperationsData: mocks.getOperationsData,
  getOperationsWorkflowData: mocks.getOperationsWorkflowData
}));
vi.mock("@/lib/portfolio", () => ({ getProgramWorkspaceSummary: mocks.getProgramWorkspaceSummary }));

import { loadExecutiveReportInput } from "@/lib/ai/executive-report";
import { buildExecutiveReportInput, hasAnyReportData, monthLabel, type ExecutiveReportSources } from "@/lib/ai/executive-report-core";

const META = { seasonCode: "UEHM-S12", seasonLabel: "Mùa 12", generatedAt: "14/09/2026 09:00" };
const SEASON_ID = "00000000-0000-4000-8000-0000000000aa";

const SOURCES: ExecutiveReportSources = {
  recruitment: { applicationCount: 540, matchCount: 210, activeMatchCount: 198 },
  monthly: {
    selectedMonth: "2026-09",
    recapCount: 120,
    activeMenteeCount: 110,
    activeMentorCount: 95,
    mentorWithoutRecapCount: 20,
    eventTrainingCount: 2,
    eventAttendanceCount: 180,
    followUpCount: 14
  },
  workflow: { openActionCount: 9, overdueActionCount: 3, followUpOpenCount: 5, followUpResolvedCount: 7, dataIssueOpenCount: 4, correctionsThisMonth: 11 },
  season: { openApplications: 12, activeMentors: 101, activeMentees: 199, activeMatches: 198, upcomingEvents: 2, dataIssues: null, overdueTasks: 3 }
};

const ALLOWED_KEYS = new Set(["generatedAt", "seasonCode", "seasonLabel", "sections", "title", "unavailable", "metrics", "label", "value"]);

function allKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => allKeys(item, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      allKeys(child, found);
    }
  }
  return found;
}

describe("buildExecutiveReportInput", () => {
  it("dựng bốn mục với đúng con số, tháng ghi dạng MM/YYYY", () => {
    const input = buildExecutiveReportInput(SOURCES, META);
    expect(input.sections.map((section) => section.title)).toEqual([
      "Tuyển sinh và ghép cặp",
      "Nhịp mentoring tháng 09/2026",
      "Việc vận hành",
      "Toàn mùa"
    ]);
    expect(input.sections[0].metrics).toEqual([
      { label: "Hồ sơ ứng tuyển trong mùa", value: 540 },
      { label: "Cặp ghép trong mùa", value: 210 },
      { label: "Cặp ghép đang hoạt động", value: 198 }
    ]);
    expect(input.sections[1].metrics.find((metric) => metric.label.startsWith("Mentor đang ghép cặp"))?.value).toBe(20);
    expect(input.sections[3].metrics.find((metric) => metric.label === "Vấn đề dữ liệu")?.value).toBeNull();
  });

  it("nguồn đọc lỗi thành KHÔNG ĐỌC ĐƯỢC, không có chỉ số nào, không thành 0", () => {
    const input = buildExecutiveReportInput({ ...SOURCES, workflow: null, monthly: null }, META);
    expect(input.sections[1]).toEqual({ title: "Nhịp mentoring trong tháng", unavailable: true, metrics: [] });
    expect(input.sections[2]).toEqual({ title: "Việc vận hành", unavailable: true, metrics: [] });
    expect(hasAnyReportData(input)).toBe(true);
  });

  it("giá trị không phải số hữu hạn thành null, kể cả chuỗi số", () => {
    const input = buildExecutiveReportInput(
      { ...SOURCES, recruitment: { applicationCount: "540", matchCount: Number.NaN, activeMatchCount: undefined } },
      META
    );
    expect(input.sections[0].metrics.map((metric) => metric.value)).toEqual([null, null, null]);
  });

  it("không mang theo bất kỳ trường nào ngoài nhãn cố định và con số, kể cả khi nguồn có tên người", () => {
    const leaky = {
      ...SOURCES,
      workflow: {
        ...SOURCES.workflow!,
        followUpQueue: [{ full_name: "Nguyễn Văn An", email_primary: "an@example.com", phone_primary: "0901234567" }]
      },
      season: { ...SOURCES.season!, programs: [{ programName: "Tên lạ", mentors: [{ full_name: "Trần Thị Bình" }] }] }
    } as unknown as ExecutiveReportSources;
    const input = buildExecutiveReportInput(leaky, META);
    const json = JSON.stringify(input);
    expect(json).not.toMatch(/Nguyễn Văn An|an@example\.com|0901234567|Trần Thị Bình|Tên lạ/);
    expect(Array.from(allKeys(input)).filter((key) => !ALLOWED_KEYS.has(key))).toEqual([]);
  });

  it("không nguồn nào đọc được thì không đáng gọi AI", () => {
    const input = buildExecutiveReportInput({ recruitment: null, monthly: null, workflow: null, season: null }, META);
    expect(hasAnyReportData(input)).toBe(false);
  });

  it("monthLabel chỉ nhận YYYY-MM", () => {
    expect(monthLabel("2026-09")).toBe("09/2026");
    expect(monthLabel("2026-9")).toBeNull();
    expect(monthLabel(null)).toBeNull();
  });
});

describe("loadExecutiveReportInput", () => {
  const context = {
    currentProgramId: "program-1",
    selectedSeasonId: SEASON_ID,
    selectedSeasonCode: "UEHM-S12",
    availableSeasons: [],
    effectiveScope: { allowedSeasonIds: [SEASON_ID] }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getRestrictedDashboardSummary.mockResolvedValue({ seasonCount: 1, matchCount: 210, activeMatchCount: 198, applicationCount: 540, error: null });
    mocks.getOperationsData.mockResolvedValue({ kpis: { data: SOURCES.monthly, error: null } });
    mocks.getOperationsWorkflowData.mockResolvedValue({ data: { summary: SOURCES.workflow, followUpQueue: [{ full_name: "Nguyễn Văn An" }] }, error: null });
    mocks.getProgramWorkspaceSummary.mockResolvedValue({ totals: SOURCES.season, programs: [], warnings: [] });
  });

  it("đọc đúng mùa ở cả bốn nguồn", async () => {
    const input = await loadExecutiveReportInput(context as never, "Mùa 12", "program_scoped");
    expect(mocks.getRestrictedDashboardSummary).toHaveBeenCalledWith(context.effectiveScope);
    expect(mocks.getOperationsData).toHaveBeenCalledWith(context.effectiveScope, "UEHM-S12");
    expect(mocks.getOperationsWorkflowData).toHaveBeenCalledWith("UEHM-S12");
    expect(mocks.getProgramWorkspaceSummary).toHaveBeenCalledWith(
      expect.objectContaining({ selectedProgramId: "program-1", selectedSeasonId: SEASON_ID, accessMode: "program_scoped" })
    );
    expect(input.sections.every((section) => !section.unavailable)).toBe(true);
    expect(JSON.stringify(input)).not.toContain("Nguyễn Văn An");
  });

  it("một nguồn ném lỗi hoặc trả error thì chỉ mục đó thành không đọc được", async () => {
    mocks.getOperationsData.mockResolvedValue({ kpis: { data: SOURCES.monthly, error: "hỏng" } });
    mocks.getOperationsWorkflowData.mockResolvedValue({ data: null, error: "rpc lỗi" });
    mocks.getProgramWorkspaceSummary.mockRejectedValue(new Error("service role"));
    const input = await loadExecutiveReportInput(context as never, "Mùa 12", "global");
    expect(input.sections.map((section) => section.unavailable)).toEqual([false, true, true, true]);
  });
});
