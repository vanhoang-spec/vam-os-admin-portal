// @vitest-environment jsdom
/**
 * Báo cáo phỏng vấn mentee theo đợt (BTC 06/10/2026): (a) Đạt / (b) Không đạt /
 * (c) Cần BTC xem xét theo năm học, ngành; điểm theo người phỏng vấn; nhóm được
 * mentor chọn ngay so với còn lại. Báo cáo chỉ tính MỘT đợt — đợt sau không cộng dồn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { OfflineDashboard } from "@/lib/mentee-offline-core";
import {
  buildInterviewReport,
  crossTab,
  formatScore,
  interviewWaves,
  pickWave,
  reportRowsFrom,
  waveDateLabel,
  type ReportRow
} from "@/lib/mentee-interview-report-core";
import { notesDrift, notesForWave } from "@/lib/mentee-interview-report-notes";

const mocks = vi.hoisted(() => ({ admin: null as any, data: null as any }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.admin }));
vi.mock("@/lib/mentee-offline", () => ({ getInterviewReportData: async () => mocks.data }));

import { ReportView } from "@/app/interviews/bao-cao-mentee/report-view";
import MenteeInterviewReportPage from "@/app/interviews/bao-cao-mentee/page";

type Candidate = OfflineDashboard["candidates"][number];
type Op = NonNullable<Candidate["operation"]>;

const SESSIONS = [
  { id: "sat", starts_at: "2026-10-03T01:00:00Z", ends_at: "2026-10-03T01:30:00Z", venue: null, seat_limit: 20 },
  { id: "sun", starts_at: "2026-10-04T06:30:00Z", ends_at: "2026-10-04T07:00:00Z", venue: null, seat_limit: 20 },
  // Cuối tuần sau: đợt 2, KHÔNG được lọt vào báo cáo đợt 1.
  { id: "next", starts_at: "2026-10-10T01:00:00Z", ends_at: "2026-10-10T01:30:00Z", venue: null, seat_limit: 20 }
];

const op = (extra: Partial<Op>): Op => ({
  checked_in_at: "2026-10-03T01:05:00Z", room: null, desk: null, interviewer_id: null, review_id: null, outcome: null,
  match_id: null, revision: 1, is_online: false, online_note: null, ...extra
});

function scores(values: [number, number, number, number]) {
  return [
    { key: "need", label: "Nhu cầu Mentoring", weight: 30, score: values[0], note: "x" },
    { key: "learn", label: "Sẵn sàng học hỏi", weight: 20, score: values[1], note: "x" },
    { key: "own", label: "Chủ động", weight: 25, score: values[2], note: "x" },
    { key: "commit", label: "Cam kết", weight: 25, score: values[3], note: "x" }
  ];
}

function review(id: string, reviewerId: string, reviewerName: string, weighted: number, extra: Record<string, unknown> = {}) {
  return {
    id, reviewer_admin_user_id: reviewerId, reviewerName, review_round: "interview", status: "submitted",
    score_motivation: null, score_goal_clarity: null, score_commitment: null, score_fit: null, score_communication: null,
    total_score: null, recommendation: null, reviewer_note: "Lời mentor", weighted_score: String(weighted),
    interview_scores: scores([4, 4, 4, 4]), expectation_alignment: "aligned", take_choice: null, ...extra
  } as any;
}

function candidate(id: string, sessionId: string, payload: Record<string, unknown>, operation: Op | null, reviews: any[] = [], status = "interview_scheduled"): Candidate {
  return {
    id, name: `Mentee Bí Mật ${id}`, phone: `0900000${id.padStart(3, "0")}`, email: null, status, sessionId,
    bookedAt: "2026-09-30T00:00:00Z", rawPayload: payload, answers: [], reviews, operation
  };
}

const CANDIDATES: Candidate[] = [
  // c1: Đạt, mentor R1 nhận ngay, cặp còn hiệu lực.
  candidate("1", "sat", { year_of_study: "1", target_industry: "finance_banking" },
    op({ outcome: "passed", review_id: "r1", match_id: "m-active" }),
    [review("r0", "screen", "Người chấm hồ sơ", 1), review("r1", "R1", "Mentor An", 4.2, { take_choice: "take", interview_scores: scores([5, 4, 4, 4]) })]),
  // c2: Đạt, đã chọn "Có" nhưng cặp sau đó bị BTC huỷ — không còn là "được chọn".
  candidate("2", "sat", { year_of_study: "2", target_industry: "consulting" },
    op({ outcome: "passed", review_id: "r2", match_id: "m-dropped" }),
    [review("r2", "R1", "Mentor An", 3.8, { take_choice: "take", expectation_alignment: "needs_clarification" })]),
  // c3: Đạt, đề xuất mentor khác nhận.
  candidate("3", "sun", { year_of_study: "1", target_industry: "undecided" },
    op({ outcome: "passed", review_id: "r3" }),
    [review("r3", "R2", "Mentor Bình", 3.5, { take_choice: "recommend_other", interview_scores: scores([3, 4, 3, 4]) })]),
  // c4: Không đạt; mã ngành lạ vẫn phải được đếm.
  candidate("4", "sun", { year_of_study: "1", target_industry: "aviation" },
    op({ outcome: "rejected", review_id: "r4" }),
    [review("r4", "R2", "Mentor Bình", 2.2, { expectation_alignment: "concern", interview_scores: scores([2, 2, 2, 3]) })]),
  // c5: Cần BTC xem xét; không khai ngành.
  candidate("5", "sun", { year_of_study: "3" },
    op({ outcome: "needs_review", review_id: "r5" }),
    [review("r5", "R1", "Mentor An", 3.0, { take_choice: "undecided" })]),
  // c6: đã đến, đang phỏng vấn — chưa có kết quả.
  candidate("6", "sun", { year_of_study: "2" }, op({ interviewer_id: "R2", review_id: "r6" }), [review("r6", "R2", "Mentor Bình", 0)]),
  // c7: không đến.
  candidate("7", "sat", { year_of_study: "4" }, null),
  // c8: đã rút.
  candidate("8", "sat", { year_of_study: "4" }, null, [], "withdrawn"),
  // c9: đợt 2 — có kết quả nhưng không thuộc đợt 1.
  candidate("9", "next", { year_of_study: "1", target_industry: "finance_banking" },
    op({ outcome: "passed", review_id: "r9", checked_in_at: "2026-10-10T01:05:00Z" }), [review("r9", "R3", "Mentor Chi", 5)])
];

const ACTIVE = new Set(["m-active"]);
const ROWS = reportRowsFrom(CANDIDATES, ACTIVE);
const WAVES = interviewWaves(SESSIONS);
const WAVE1 = WAVES[0];

beforeEach(() => {
  mocks.admin = { id: "u", role: "core_team", email: "c@example.test" };
  mocks.data = { ok: true, data: { canOperate: true, sessions: SESSIONS, rows: ROWS } };
});
afterEach(cleanup);

describe("dòng báo cáo", () => {
  it("trạng thái giống trang tiến độ: có kết quả / đang chờ / không đến / đã rút", () => {
    expect(ROWS.map((r) => r.status)).toEqual(["result", "result", "result", "result", "result", "pending", "not_arrived", "withdrawn", "result"]);
  });

  it("'được chọn' chỉ khi cặp ghép CÒN hiệu lực — cặp bấm nhầm đã huỷ không tính", () => {
    expect(ROWS.map((r) => r.taken)).toEqual([true, false, false, false, false, false, false, false, false]);
  });

  it("lấy điểm và người chấm từ đúng phiếu phỏng vấn, không phải phiếu vòng hồ sơ", () => {
    expect(ROWS[0]).toMatchObject({ interviewerId: "R1", interviewerName: "Mentor An", weightedScore: 4.2, yearOfStudy: "1", targetIndustry: "finance_banking" });
    expect(ROWS[0].criteria.map((c) => c.score)).toEqual([5, 4, 4, 4]);
  });

  it("không mang tên, SĐT của mentee", () => {
    expect(JSON.stringify(ROWS)).not.toMatch(/Mentee Bí Mật|0900000/);
  });
});

describe("đợt phỏng vấn", () => {
  it("ngày liền nhau là một đợt; cuối tuần sau là đợt mới", () => {
    expect(WAVES.map((w) => [w.key, w.label, w.sessionIds])).toEqual([
      ["2026-10-03", "Đợt 1 · 03–04/10/2026", ["sat", "sun"]],
      ["2026-10-10", "Đợt 2 · 10/10/2026", ["next"]]
    ]);
  });

  it("nhãn ngày qua tháng, qua năm", () => {
    expect(waveDateLabel(["2026-10-31", "2026-11-01"])).toBe("31/10–01/11/2026");
    expect(waveDateLabel(["2026-12-31", "2027-01-01"])).toBe("31/12/2026–01/01/2027");
  });

  it("mặc định là đợt gần nhất đã có kết quả; ?dot= chọn đợt khác; mã lạ thì về mặc định", () => {
    const noResultsYet = ROWS.filter((r) => r.sessionId !== "next");
    expect(pickWave(WAVES, noResultsYet)?.key).toBe("2026-10-03");
    expect(pickWave(WAVES, ROWS)?.key).toBe("2026-10-10");
    expect(pickWave(WAVES, ROWS, "2026-10-03")?.key).toBe("2026-10-03");
    expect(pickWave(WAVES, noResultsYet, "khong-co")?.key).toBe("2026-10-03");
  });
});

describe("báo cáo một đợt", () => {
  const report = buildInterviewReport(ROWS, WAVE1);

  it("tổng: chỉ tính đợt 1, tách không đến / chưa có kết quả / đã rút", () => {
    expect(report.totals).toEqual({
      booked: 8, attended: 6, notArrived: 1, withdrawn: 1, pending: 1, results: 5,
      passed: 3, rejected: 1, needs_review: 1, taken: 1, online: 0, interviewers: 2, mentorsTaking: 1
    });
  });

  it("năm học: tỷ lệ trong CỘT, dòng theo thứ tự form", () => {
    expect(report.byYear.columns.map((c) => [c.key, c.total])).toEqual([["passed", 3], ["rejected", 1], ["needs_review", 1]]);
    expect(report.byYear.rows.map((r) => [r.label, r.cells.map((c) => c.count), r.total])).toEqual([
      ["Năm 1", [2, 1, 0], 3],
      ["Năm 2", [1, 0, 0], 1],
      ["Năm 3", [0, 0, 1], 1]
    ]);
    expect(report.byYear.rows[0].cells[0].share).toBeCloseTo(2 / 3);
    expect(report.byYear.rows[0].cells[1].share).toBe(1);
  });

  it("ngành: mã lạ vẫn đếm (hiện nguyên mã), không khai thì 'Chưa khai' đứng cuối", () => {
    expect(report.byIndustry.rows.map((r) => r.label)).toEqual([
      "Tài chính / Ngân hàng", "Tư vấn / Chiến lược", "Chưa xác định rõ", "aviation", "Chưa khai"
    ]);
    const sum = report.byIndustry.rows.reduce((s, r) => s + r.total, 0);
    expect(sum).toBe(report.totals.results);
  });

  it("điểm theo người phỏng vấn: trung bình chung và theo nhóm, gom theo id", () => {
    const [an, binh] = report.interviewers.rows;
    expect(an).toMatchObject({ name: "Mentor An", forms: 3, taken: 1 });
    expect(an.avg).toBeCloseTo((4.2 + 3.8 + 3.0) / 3);
    expect(an.byGroup.passed).toEqual({ count: 2, avg: 4 });
    expect(an.byGroup.rejected).toEqual({ count: 0, avg: null });
    expect(binh).toMatchObject({ name: "Mentor Bình", forms: 2 });
    expect(binh.avg).toBeCloseTo(2.85);
    expect(report.interviewers.all.forms).toBe(5);
  });

  it("hai người phỏng vấn trùng tên vẫn là hai dòng — gom theo tài khoản, không theo tên", () => {
    const sameName = reportRowsFrom([
      candidate("21", "sat", {}, op({ outcome: "passed", review_id: "a" }), [review("a", "X1", "Nguyễn Văn A", 4)]),
      candidate("22", "sat", {}, op({ outcome: "rejected", review_id: "b" }), [review("b", "X2", "Nguyễn Văn A", 2)])
    ], ACTIVE);
    const table = buildInterviewReport(sameName, WAVE1).interviewers.rows;
    expect(table.map((r) => [r.id, r.forms, r.avg])).toEqual([["X1", 1, 4], ["X2", 1, 2]]);
  });

  it("điểm từng tiêu chí theo nhóm", () => {
    expect(report.scores.rejected.criteria.map((c) => c.avg)).toEqual([2, 2, 2, 3]);
    expect(report.scores.passed.weighted).toBeCloseTo((4.2 + 3.8 + 3.5) / 3);
  });

  it("nhóm (a): chọn ngay so với còn lại; mục C của nhóm còn lại", () => {
    expect(report.taken.byYear.rows.map((r) => [r.label, r.cells.map((c) => c.count)])).toEqual([
      ["Năm 1", [1, 1]],
      ["Năm 2", [0, 1]]
    ]);
    expect(report.taken.scores.taken.criteria[0].avg).toBe(5);
    expect(report.taken.restChoices.rows.map((r) => [r.key, r.total])).toEqual([["recommend_other", 1], ["take", 1]]);
  });

  it("crossTab đếm một dòng vào mọi cột nó thuộc về", () => {
    const tab = crossTab(ROWS.slice(0, 2), [
      { key: "all", label: "Tất cả", filter: () => true },
      { key: "taken", label: "Chọn", filter: (r: ReportRow) => r.taken }
    ], () => "x", []);
    expect(tab.rows[0].cells.map((c) => c.count)).toEqual([2, 1]);
  });

  it("điểm định dạng kiểu Việt Nam", () => {
    expect(formatScore(3.975)).toBe("3,98");
    expect(formatScore(null)).toBe("—");
  });
});

describe("phần nhận xét", () => {
  it("báo khi số phiếu đã khác lúc phân tích; không đổi thì im lặng", () => {
    const notes = { writtenOn: "06/10/2026", basis: { passed: 3, rejected: 1, needs_review: 1, taken: 1 } };
    expect(notesDrift(notes, { passed: 3, rejected: 1, needs_review: 1, taken: 1 })).toBeNull();
    expect(notesDrift(notes, { passed: 4, rejected: 1, needs_review: 1, taken: 1 })).toContain("hiện có 6 phiếu");
  });
});

describe("trang", () => {
  it("ghi rõ đợt và ngày, nói rõ không cộng dồn đợt sau", () => {
    render(<ReportView report={buildInterviewReport(ROWS, WAVE1)} waves={WAVES} notes={null} generatedAt="2026-10-06T03:00:00Z" />);
    const banner = screen.getByTestId("wave-banner");
    expect(banner.textContent).toContain("Đợt 1 · 03–04/10/2026");
    expect(banner.textContent).toContain("Thứ Bảy 03/10/2026 và Chủ nhật 04/10/2026");
    expect(banner.textContent).toContain("không cộng dồn");
    expect(banner.textContent).toContain("06/10/2026 10:00");
    // Có đợt 2 thì có lối sang đợt 2, và đợt đang xem được đánh dấu.
    expect(within(banner).getByRole("link", { name: "Đợt 2 · 10/10/2026" }).getAttribute("href")).toBe("/interviews/bao-cao-mentee?dot=2026-10-10");
    expect(within(banner).getByRole("link", { name: "Đợt 1 · 03–04/10/2026" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("notes-missing")).toBeTruthy();
  });

  it("lưới một cột không rộng hơn khung chứa — bảng nhiều cột không đẩy cả trang tràn ngang (06/10/2026)", () => {
    render(<ReportView report={buildInterviewReport(ROWS, WAVE1)} waves={WAVES} notes={null} generatedAt="2026-10-06T03:00:00Z" />);
    const root = screen.getByTestId("report-root");
    expect(root.className).toContain("grid-cols-[minmax(0,1fr)]");
    // Sáu mục báo cáo là con trực tiếp của trang; ô số liệu (KpiCard) cũng là <section> nhưng nằm sâu hơn.
    const sections = Array.from(root.querySelectorAll(":scope > section"));
    expect(sections.length).toBe(6);
    for (const section of sections) expect(section.className).toContain("grid-cols-[minmax(0,1fr)]");
    // Ô tìm của bảng người phỏng vấn nằm trong một lưới con — lưới đó cũng phải khoá cột.
    const table = screen.getByTestId("interviewer-table");
    let el: HTMLElement | null = table.parentElement;
    while (el && el !== root && !el.className.includes("gap-2")) el = el.parentElement;
    expect(el?.className).toContain("grid-cols-[minmax(0,1fr)]");
  });

  it("bảng người phỏng vấn: một dòng mỗi người, điểm theo nhóm; không hiện tên mentee", () => {
    const { container } = render(<ReportView report={buildInterviewReport(ROWS, WAVE1)} waves={WAVES} notes={null} generatedAt="2026-10-06T03:00:00Z" />);
    const rows = within(screen.getByTestId("interviewer-table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector("td")?.textContent)).toEqual(["Mentor An", "Mentor Bình"]);
    expect(rows[0].textContent).toContain("4,00 · 2 phiếu");
    expect(container.textContent).not.toMatch(/Mentee Bí Mật|Mentor Chi/);
  });

  it("hiện phần nhận xét và câu báo bản chụp đã cũ", () => {
    const notes = {
      waveKey: "2026-10-03", writtenOn: "06/10/2026", method: "Đọc toàn bộ phiếu.",
      basis: { passed: 2, rejected: 1, needs_review: 1, taken: 1 },
      groups: {
        passed: [{ title: "Mẫu hình chung", patterns: [{ title: "Có nhu cầu rõ", detail: "Nói được vấn đề.", count: "2/2", quotes: ["muốn đổi ngành"] }] }],
        rejected: [{ title: "Mẫu hình chung", bullets: ["Mơ hồ"] }],
        needs_review: [{ title: "Mẫu hình chung", themes: [{ label: "Cần mentor đúng ngành", count: "1/1" }] }]
      },
      takenVsRest: [{ title: "Khác biệt", bullets: ["Cùng ngành với mentor"] }]
    };
    render(<ReportView report={buildInterviewReport(ROWS, WAVE1)} waves={WAVES} notes={notes} generatedAt="2026-10-06T03:00:00Z" />);
    expect(screen.getByText("Có nhu cầu rõ")).toBeTruthy();
    expect(screen.getByText("“muốn đổi ngành”")).toBeTruthy();
    expect(screen.getByText("Cùng ngành với mentor")).toBeTruthy();
    expect(screen.getByTestId("notes-drift").textContent).toContain("hiện có 5 phiếu");
  });

  it("mentor phỏng vấn (reviewer) không xem được", async () => {
    mocks.admin = { id: "u", role: "reviewer", email: "r@example.test" };
    render(await MenteeInterviewReportPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Trang này dành cho BTC (Core team, Support team).")).toBeTruthy();
    expect(screen.queryByTestId("wave-banner")).toBeNull();
  });

  it("chưa có quyền vận hành mùa thì không xem được", async () => {
    mocks.data = { ok: true, data: { canOperate: false, sessions: SESSIONS, rows: ROWS } };
    render(await MenteeInterviewReportPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/chưa có quyền vận hành mùa/)).toBeTruthy();
    expect(screen.queryByTestId("wave-banner")).toBeNull();
  });

  it("?dot= chọn đợt; support_team xem được", async () => {
    mocks.admin = { id: "u", role: "support_team", email: "s@example.test" };
    render(await MenteeInterviewReportPage({ searchParams: Promise.resolve({ dot: "2026-10-03" }) }));
    expect(screen.getByTestId("wave-banner").textContent).toContain("Đợt 1 · 03–04/10/2026");
    expect(screen.getByTestId("totals").textContent).toContain("Hồ sơ đã đặt lịch8");
  });
});

describe("phân tích đợt 1 (03–04/10/2026)", () => {
  const notes = notesForWave("2026-10-03");

  it("có đủ ba nhóm và phần so sánh, ghi đúng số phiếu đã đọc", () => {
    expect(notes).not.toBeNull();
    expect(notes!.basis).toEqual({ passed: 265, rejected: 55, needs_review: 50, taken: 46 });
    for (const g of ["passed", "rejected", "needs_review"] as const) {
      expect(notes!.groups[g].some((s) => (s.patterns?.length ?? 0) >= 4)).toBe(true);
    }
    expect(notes!.takenVsRest.length).toBeGreaterThan(0);
  });

  it("trích dẫn ngắn, không mang số điện thoại hay email", () => {
    const sections = [...notes!.groups.passed, ...notes!.groups.rejected, ...notes!.groups.needs_review, ...notes!.takenVsRest];
    const quotes = sections.flatMap((s) => (s.patterns ?? []).flatMap((p) => p.quotes ?? []));
    expect(quotes.length).toBeGreaterThan(10);
    for (const q of quotes) {
      expect(q.split(/ +/).length).toBeLessThanOrEqual(30);
      expect(q).not.toMatch(/[0-9]{8,}|@/);
    }
  });
});
