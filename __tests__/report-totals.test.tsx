// @vitest-environment jsdom
/**
 * Dòng tổng của các bảng báo cáo (BTC 09/10/2026: bảng nhiều dòng phải có dòng hoặc
 * cột tổng). Ba trang dựng bằng SimpleTable — Báo cáo tháng, Phân tích mùa, Đối soát
 * recap ở Tổng quan — được vẽ thật với dữ liệu giả ở ranh giới lib/data; bảng nằm ở
 * đâu thì tìm theo tiêu đề cột / tiêu đề thẻ của chính nó, không tìm chung cả trang.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  admin: null as any,
  operations: null as any,
  intelligence: null as any,
  dashboard: null as any
}));

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((to: string) => {
    throw new Error("REDIRECT:" + to);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock("@/components/charts", () => ({ BarSummary: () => null, DonutSummary: () => null }));
vi.mock("@/components/my-work-card", () => ({ MyWorkCard: () => null }));
vi.mock("@/app/operations/intelligence/export-buttons", () => ({ CsvExportButton: () => null }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.admin }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: async () => ({ scopeError: null, globalRole: "super_admin", isSuperAdmin: true, programScopes: [] }),
  getScopeFilter: async () => undefined,
  canOperateAnyScope: () => true
}));
vi.mock("@/lib/season-context", () => ({
  SeasonAccessDeniedError: class extends Error {},
  resolveSeasonContext: async () => ({ effectiveScope: undefined, selectedSeasonCode: "UEHM-S12" })
}));
vi.mock("@/lib/data", () => ({
  getOperationsData: async () => mocks.operations,
  getFounderIntelligenceDashboard: async () => ({ data: mocks.intelligence, error: null }),
  getDashboardData: async () => mocks.dashboard,
  getRestrictedDashboardSummary: vi.fn(),
  keyById: (rows: Array<{ id: string }>) => new Map(rows.map((row) => [row.id, row]))
}));

import { SimpleTable } from "@/components/ui";
import { percentOneDecimal, sumBy } from "@/lib/report-totals-core";
import MonthlyOperationsPage from "@/app/operations/monthly/page";
import FounderIntelligencePage from "@/app/operations/intelligence/page";
import DashboardPage from "@/app/page";

const ok = <T,>(data: T) => ({ data, error: null });

afterEach(cleanup);
beforeEach(() => {
  mocks.admin = { id: "a", role: "super_admin", email: "btc@example.test" };
});

/** Ô của dòng tổng trong bảng có tiêu đề cột `header`. */
function totalCellsByHeader(container: HTMLElement, header: string): string[] | null {
  const th = Array.from(container.querySelectorAll("th")).find((el) => el.textContent === header);
  if (!th) throw new Error(`không thấy cột ${header}`);
  const foot = th.closest("table")!.querySelector("tfoot");
  return foot ? Array.from(foot.querySelectorAll("td")).map((td) => td.textContent ?? "") : null;
}

/** Ô của dòng tổng trong thẻ có tiêu đề `title`. */
function totalCellsByTitle(container: HTMLElement, title: string): string[] | null {
  const heading = Array.from(container.querySelectorAll("h3")).find((el) => el.textContent === title);
  if (!heading) throw new Error(`không thấy thẻ ${title}`);
  const card = heading.closest("section")!;
  const table = card.querySelector("table");
  if (!table) throw new Error(`thẻ ${title} không có bảng`);
  const foot = table.querySelector("tfoot");
  return foot ? Array.from(foot.querySelectorAll("td")).map((td) => td.textContent ?? "") : null;
}

describe("phần thuần", () => {
  it("sumBy: cộng số và chuỗi số; ô rỗng, chữ, NaN bỏ qua chứ không làm hỏng cả tổng", () => {
    const rows = [{ v: 3 }, { v: "4" }, { v: null }, { v: undefined }, { v: "" }, { v: "Chưa có recap" }, { v: Number.NaN }, { v: -2 }];
    expect(sumBy(rows, (r) => r.v)).toBe(5);
    expect(sumBy([], () => 1)).toBe(0);
  });

  it("percentOneDecimal làm tròn một chữ số như RPC phân tích mùa; mẫu 0 là không có tỷ lệ", () => {
    // Số thật 09/10/2026: 637/933 mentee active, 438/571 mentor active, 15/637 có recap (RPC in 2.4).
    expect(percentOneDecimal(637, 933)).toBe(68.3);
    expect(percentOneDecimal(438, 571)).toBe(76.7);
    expect(percentOneDecimal(15, 637)).toBe(2.4);
    expect(percentOneDecimal(2, 3)).toBe(66.7);
    expect(percentOneDecimal(0, 5)).toBe(0);
    expect(percentOneDecimal(3, 0)).toBeNull();
  });
});

describe("SimpleTable footer", () => {
  const columns = [
    { key: "name", label: "Tên" },
    { key: "a", label: "A" },
    { key: "b", label: "B" }
  ];
  const rows = [{ name: "x", a: 1, b: 2 }, { name: "y", a: 3, b: 4 }];

  it("dòng tổng nằm trong tfoot, ô theo đúng khoá cột; cột không có khoá để trống", () => {
    const { container } = render(<SimpleTable rows={rows} columns={columns} footer={{ name: "Tổng", b: 6 }} />);
    const foot = container.querySelector("tfoot")!;
    expect(foot.getAttribute("data-testid")).toBe("table-total");
    expect(Array.from(foot.querySelectorAll("td")).map((td) => td.textContent)).toEqual(["Tổng", "", "6"]);
    // Dòng tổng không lẫn vào tbody — ô tìm chỉ lọc tbody.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("không truyền footer thì không có tfoot; bảng rỗng thì chỉ có câu trống", () => {
    expect(render(<SimpleTable rows={rows} columns={columns} />).container.querySelector("tfoot")).toBeNull();
    cleanup();
    const empty = render(<SimpleTable rows={[]} columns={columns} footer={{ name: "Tổng" }} />).container;
    expect(empty.querySelector("table")).toBeNull();
  });
});

describe("Báo cáo tháng — Sự kiện trong tháng", () => {
  beforeEach(() => {
    const event = (id: string, name: string, day: string) => ({ id, season_id: "s12", event_name: name, event_type: "workshop", starts_at: `2026-10-${day}T02:00:00Z` });
    const part = (id: string, eventId: string, status: string) => ({ id, event_id: eventId, season_id: "s12", attendance_status: status });
    mocks.operations = {
      seasons: ok([{ id: "s12", code: "UEHM-S12" }]),
      recaps: ok([]),
      events: ok([event("e1", "Workshop CV", "03"), event("e2", "Talk ngành", "20"), event("e-old", "Tháng trước", "01")].map((e) =>
        e.id === "e-old" ? { ...e, starts_at: "2026-09-15T02:00:00Z" } : e
      )),
      eventParticipations: ok([
        part("p1", "e1", "attended"), part("p2", "e1", "attended"), part("p3", "e1", "absent_excused"), part("p4", "e1", "registered"),
        part("p5", "e2", "attended"), part("p6", "e2", "registered_absent"),
        // Sự kiện tháng khác: không được lọt vào tổng.
        part("p7", "e-old", "attended")
      ]),
      latestClosedMonth: ok([]),
      kpis: ok(null)
    };
  });

  it("dòng tổng cộng đúng các cột Đã tham gia / Vắng / Tổng của các sự kiện trong tháng", async () => {
    const { container } = render(<>{await MonthlyOperationsPage({ searchParams: Promise.resolve({ month: "2026-10" }) })}</>);
    // Cột "Tổng" (không phải "Hành động") vẫn có trong bảng; dòng tổng bám theo khoá cột.
    expect(totalCellsByHeader(container, "Vắng")).toEqual(["Tổng 2 sự kiện", "", "3", "2", "6", ""]);
    // Khớp với ô KPI ở đầu trang.
    expect(container.textContent).toContain("Tổng lượt tham gia");
  });
});

describe("Phân tích mùa", () => {
  beforeEach(() => {
    mocks.intelligence = {
      definitions: { selectedMonth: "2026-10", activeMentor: "" },
      mentorProfile: {
        totalMentors: 8, activeMentors: 7, byIndustry: [], byFunction: [], byExperienceBand: [], byVamSeniority: [],
        overloadedMentors: [
          { mentorName: "Mentor A", industry: "x", currentTitle: "CEO", menteeCount: 4, capacityTarget: 2, recapCountCurrentMonth: 0 },
          { mentorName: "Mentor B", industry: "y", currentTitle: "CFO", menteeCount: 5, capacityTarget: null, recapCountCurrentMonth: 1 }
        ],
        inactiveMentorsWithMentees: []
      },
      menteeProfile: { totalMentees: 15, activeMentees: 8, silentMentees: 10, byMajor: [], byCareerInterest: [], byTargetIndustry: [], bySupportTeam: [] },
      matchingIntelligence: { mentorMenteeRatio: "1:1", matchesByIndustryAlignment: [], matchesByFunctionAlignment: [], mentorSupplyVsMenteeDemand: [] },
      activityBySegment: {
        activeMenteeRateByMajor: [
          { major: "Kế toán", mentees: 10, activeMentees: 7, activeRate: 70 },
          { major: "Marketing", mentees: 4, activeMentees: 1, activeRate: 25 },
          { major: "Chưa rõ", mentees: 1, activeMentees: 0, activeRate: 0 }
        ],
        recapRateBySupportTeam: [{ supportTeam: "Chưa rõ", activeMentees: 8, menteesWithRecap: 2, recapRate: 25 }],
        activeMentorRateByIndustry: [
          { industry: "Banking", mentors: 5, activeMentors: 4, activeRate: 80 },
          { industry: "Tech", mentors: 3, activeMentors: 3, activeRate: 100 }
        ],
        silentMenteeByCareerInterest: [
          { careerInterest: "Tài chính", silentMentees: 4 },
          { careerInterest: "Chưa rõ", silentMentees: "6" }
        ]
      },
      recommendedActions: []
    };
  });

  it("bảng tỷ lệ: tổng cộng tử và mẫu rồi mới chia — không lấy trung bình các tỷ lệ", async () => {
    const { container } = render(<>{await FounderIntelligencePage()}</>);
    // 8/15 = 53,3%. Trung bình ba tỷ lệ (70, 25, 0) sẽ ra 31,7% — sai vì các ngành có cỡ khác nhau.
    expect(totalCellsByTitle(container, "Tỷ lệ Mentee active theo ngành học")).toEqual(["Tổng 3 ngành học", "15", "8", "53.3%"]);
    expect(totalCellsByTitle(container, "Tỷ lệ Mentor active theo ngành")).toEqual(["Tổng 2 ngành", "8", "7", "87.5%"]);
  });

  it("bảng danh sách: cộng các cột số, ô số dạng chữ vẫn được cộng, ô trống không làm hỏng tổng", async () => {
    const { container } = render(<>{await FounderIntelligencePage()}</>);
    expect(totalCellsByTitle(container, "Mentor quá tải")).toEqual(["Tổng 2 mentor", "", "", "9", "2", "1"]);
    expect(totalCellsByTitle(container, "Mentee chưa có recap theo định hướng nghề nghiệp")).toEqual(["Tổng", "10"]);
  });

  it("bảng một dòng không in thêm dòng tổng (tổng của một dòng là chính nó); bảng rỗng vẫn là câu trống", async () => {
    const { container } = render(<>{await FounderIntelligencePage()}</>);
    expect(totalCellsByTitle(container, "Tỷ lệ recap theo Support Team")).toBeNull();
    const inactive = Array.from(container.querySelectorAll("h3")).find((h) => h.textContent === "Mentor inactive nhưng có mentee")!;
    expect(inactive.closest("section")!.querySelector("table")).toBeNull();
  });
});

describe("Tổng quan — Đối soát recap theo tháng", () => {
  const recap = (id: string, status: string, month: string | null) => ({
    id, season_id: "s12", status, meeting_month: month, meeting_date: month ? `${month}-10` : null,
    mentor_person_id: null, mentee_person_id: null, admin_notes: "", recap_source: ""
  });
  const dashboard = (recaps: unknown[]) => {
    mocks.dashboard = {
      people: ok([]), mentors: ok([]), mentees: ok([]), applications: ok([]), matches: ok([]), recaps: ok([]),
      seasons: ok([{ id: "s12", code: "UEHM-S12" }]),
      counts: { people: ok(0), mentors: ok(0), mentees: ok(0), applications: ok(0), matches: ok(0), activeMatches: ok(0) },
      duplicateEmails: ok(0), activeMissing: ok(0), latestClosedMonth: ok([])
    };
    mocks.operations = {
      seasons: ok([{ id: "s12", code: "UEHM-S12" }]), latestClosedMonth: ok([]), kpis: ok(null), recaps: ok(recaps), matches: ok([])
    };
  };

  it("dòng Tổng cộng các tháng trong bảng; phần chênh với ô KPI được nói ra", async () => {
    dashboard([
      recap("r1", "submitted", "2025-10"),
      recap("r2", "needs_review", "2025-10"),
      recap("r3", "submitted", "2025-11"),
      recap("r4", "excluded", "2025-11"), // bị loại: không tính ở đâu cả
      recap("r5", "submitted", null), // thiếu tháng gặp: có trong KPI, không có dòng tháng
      recap("r6", "submitted", "2024-05") // tháng ngoài khung của mùa
    ]);
    const { container } = render(<>{await DashboardPage({ searchParams: Promise.resolve({}) })}</>);
    expect(totalCellsByHeader(container, "Recap chính thức")).toEqual(["Tổng", "3"]);
    const gap = container.querySelector('[data-testid="monthly-recap-gap"]')!;
    expect(gap.textContent).toContain("là 5: 2 recap không có tháng gặp hoặc ghi tháng ngoài các tháng trên");
  });

  it("tổng khớp ô KPI thì không có câu chênh lệch", async () => {
    dashboard([recap("r1", "submitted", "2025-10"), recap("r3", "submitted", "2025-11")]);
    const { container } = render(<>{await DashboardPage({ searchParams: Promise.resolve({}) })}</>);
    expect(totalCellsByHeader(container, "Recap chính thức")).toEqual(["Tổng", "2"]);
    expect(container.querySelector('[data-testid="monthly-recap-gap"]')).toBeNull();
  });
});
