// @vitest-environment jsdom
/**
 * Tiến độ phỏng vấn mentee cho BTC (03/10/2026): ai đăng ký ca nào, sáng hay
 * chiều, ai đã xong và kết quả, ai đang phỏng vấn, ai chờ phân bàn, ai chưa đến.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type OfflineDashboard } from "@/lib/mentee-offline-core";
import { buildMenteeProgress, halfOf, progressStatus } from "@/lib/mentee-progress-core";

const mocks = vi.hoisted(() => ({ admin: null as any, dashboard: null as any }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.admin }));
vi.mock("@/lib/mentee-offline", () => ({ getOfflineDashboard: async () => mocks.dashboard }));

import { ProgressBoard } from "@/app/interviews/tien-do-mentee/progress-board";
import MenteeProgressPage from "@/app/interviews/tien-do-mentee/page";

type Op = NonNullable<OfflineDashboard["candidates"][number]["operation"]>;
const op = (extra: Partial<Op>): Op => ({
  checked_in_at: null, room: null, desk: null, interviewer_id: null, review_id: null, outcome: null, match_id: null,
  revision: 1, is_online: false, online_note: null, ...extra
});
function candidate(id: string, name: string, sessionId: string, operation: Op | null, status = "interview_scheduled") {
  return { id, name, phone: `090${id.padStart(7, "0")}`, email: null, status, sessionId, bookedAt: "2026-09-30T00:00:00Z", rawPayload: null, answers: [], reviews: [], operation };
}
const DATA: Pick<OfflineDashboard, "sessions" | "participants" | "candidates"> = {
  sessions: [
    { id: "s0800", starts_at: "2026-10-03T01:00:00Z", ends_at: "2026-10-03T01:30:00Z", venue: "Cơ sở H", seat_limit: 18 },
    { id: "s1330", starts_at: "2026-10-03T06:30:00Z", ends_at: "2026-10-03T07:00:00Z", venue: "Cơ sở H", seat_limit: 18 },
    { id: "s0804", starts_at: "2026-10-04T01:00:00Z", ends_at: "2026-10-04T01:30:00Z", venue: "Cơ sở B", seat_limit: 28 }
  ],
  participants: [{ id: "m1", full_name: "Mentor Một", email: "m1@example.test", capacity: 1, activeMatches: 0 }],
  candidates: [
    candidate("1", "An Đạt", "s0800", op({ checked_in_at: "2026-10-03T00:55:00Z", room: 1, desk: 1, interviewer_id: "m1", outcome: "passed" })),
    candidate("2", "Bình Đang", "s0800", op({ checked_in_at: "2026-10-03T01:02:00Z", room: 1, desk: 2, interviewer_id: "m1" })),
    candidate("3", "Chi Chờ", "s0800", op({ checked_in_at: "2026-10-03T01:05:00Z" })),
    candidate("4", "Dũng Chưa", "s0800", null),
    candidate("5", "Én Rút", "s0800", null, "withdrawn"),
    candidate("6", "Giang Chiều", "s1330", op({ checked_in_at: "2026-10-03T06:20:00Z", room: 2, desk: 1, interviewer_id: "khac", outcome: "rejected" })),
    candidate("7", "Hà Chủ Nhật", "s0804", null)
  ]
};

beforeEach(() => {
  mocks.admin = { id: "u", role: "support_team", email: "s@example.test" };
  mocks.dashboard = { ok: true, data: { ...DATA, canOperate: true, actorId: "u", seasonId: "season", rubric: null, logs: [] } };
});
afterEach(cleanup);

describe("phần thuần", () => {
  it("trạng thái: có kết quả → xong; có người PV → đang; check-in → chờ phân bàn; còn lại → chưa đến; rút → đã rút", () => {
    const by = Object.fromEntries(DATA.candidates.map((c) => [c.name, progressStatus(c)]));
    expect(by).toEqual({
      "An Đạt": "done", "Bình Đang": "in_progress", "Chi Chờ": "waiting", "Dũng Chưa": "not_arrived",
      "Én Rút": "withdrawn", "Giang Chiều": "done", "Hà Chủ Nhật": "not_arrived"
    });
  });

  it("buổi sáng là ca bắt đầu trước 12:00 giờ Việt Nam", () => {
    expect(halfOf("2026-10-03T04:30:00Z")).toBe("sang"); // 11:30
    expect(halfOf("2026-10-03T05:00:00Z")).toBe("chieu"); // 12:00
  });

  it("gom theo ngày → buổi → ca; đếm đúng; chờ phân bàn đứng đầu ca; tên người phỏng vấn", () => {
    const p = buildMenteeProgress(DATA);
    expect(p.days.map((d) => d.dateKey)).toEqual(["2026-10-03", "2026-10-04"]);
    const sat = p.days[0];
    expect(sat.halves.map((h) => h.key)).toEqual(["sang", "chieu"]);
    expect(sat.halves[0].counts).toMatchObject({ total: 5, done: 1, passed: 1, in_progress: 1, waiting: 1, not_arrived: 1, withdrawn: 1 });
    expect(sat.halves[1].counts).toMatchObject({ total: 1, done: 1, rejected: 1 });
    expect(p.counts).toMatchObject({ total: 7, done: 2, passed: 1, rejected: 1, in_progress: 1, waiting: 1, not_arrived: 2 });
    const rows = sat.halves[0].sessions[0].rows;
    expect(rows.map((r) => r.name)).toEqual(["Chi Chờ", "Bình Đang", "Dũng Chưa", "An Đạt", "Én Rút"]);
    expect(rows.find((r) => r.name === "Bình Đang")).toMatchObject({ interviewer: "Mentor Một", room: 1, desk: 2 });
    expect(rows.find((r) => r.name === "An Đạt")?.outcomeLabel).toBe("Đạt làm mentee");
    expect(sat.halves[1].sessions[0].rows[0].interviewer).toBe("Người phỏng vấn khác");
  });
});

describe("bảng tiến độ", () => {
  const progress = buildMenteeProgress(DATA);
  const tile = (label: string) => within(screen.getByTestId("progress-tiles")).getByText(label).nextSibling?.textContent;

  it("mặc định mở ngày hôm nay; ô số tính theo ngày + buổi đang chọn", () => {
    render(<ProgressBoard progress={progress} todayKey="2026-10-03" />);
    expect(tile("Đăng ký")).toBe("6");
    expect(screen.queryByText("Hà Chủ Nhật")).toBeNull();
    fireEvent.change(screen.getByLabelText("Buổi"), { target: { value: "chieu" } });
    expect(tile("Đăng ký")).toBe("1");
    expect(tile("Không chọn")).toBe("1");
    expect(screen.queryByText("An Đạt")).toBeNull();
    expect(screen.getByText("Giang Chiều")).toBeTruthy();
  });

  it("lọc trạng thái và tìm tên; tên mentee mở đúng hồ sơ ở màn hình phỏng vấn", () => {
    render(<ProgressBoard progress={progress} todayKey="2026-10-03" />);
    fireEvent.click(screen.getByRole("button", { name: "Đang phỏng vấn" }));
    const shown = Array.from(document.querySelectorAll("tbody tr")).map((r) => r.getAttribute("data-status"));
    expect(shown).toEqual(["in_progress"]);
    expect(screen.getByRole("link", { name: "Bình Đang" }).getAttribute("href")).toBe("/interviews/mentee-offline?application=2");
    fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
    fireEvent.change(screen.getByLabelText("Tìm mentee"), { target: { value: "dũng" } });
    expect(Array.from(document.querySelectorAll("tbody tr")).map((r) => r.textContent)).toEqual([expect.stringContaining("Dũng Chưa")]);
  });

  it("ngày không có trong lịch thì mở cả hai ngày", () => {
    render(<ProgressBoard progress={progress} todayKey="2026-10-10" />);
    expect(tile("Đăng ký")).toBe("7");
  });
});

describe("cổng quyền của trang", () => {
  it("mentor phỏng vấn (reviewer) bị từ chối — không đọc dữ liệu", async () => {
    mocks.admin = { id: "u", role: "reviewer" };
    mocks.dashboard = null;
    render(await MenteeProgressPage());
    expect(screen.getByText(/dành cho BTC/)).toBeTruthy();
    expect(screen.queryByTestId("progress-tiles")).toBeNull();
  });

  it("support chưa có quyền vận hành mùa bị từ chối; lỗi đọc dữ liệu cũng từ chối", async () => {
    mocks.dashboard = { ok: true, data: { ...mocks.dashboard.data, canOperate: false } };
    render(await MenteeProgressPage());
    expect(screen.getByText(/chưa có quyền vận hành/)).toBeTruthy();
    expect(screen.queryByTestId("progress-tiles")).toBeNull();
    cleanup();
    mocks.dashboard = { ok: false, message: "Không đọc được dữ liệu." };
    render(await MenteeProgressPage());
    expect(screen.getByText("Không đọc được dữ liệu.")).toBeTruthy();
  });

  it("support có quyền vận hành thấy bảng tiến độ", async () => {
    render(await MenteeProgressPage());
    expect(screen.getByTestId("progress-tiles")).toBeTruthy();
  });
});
