// @vitest-environment jsdom
/**
 * BTC 04/10/2026: "chưa thấy ghi rõ tên phòng. VD B1.504". Database lưu phòng bằng số
 * 1..n; tên thật lấy từ địa điểm của ca ("Phòng B1.503, B1.504, … — Cơ sở B, …").
 * Phòng số n = tên thứ n — Support chọn theo tên, mentor thấy đúng tên phòng phải tới.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { roomDeskLabel, roomLabel, roomNamesFromVenue, type OfflineDashboard } from "@/lib/mentee-offline-core";
import { buildMenteeProgress } from "@/lib/mentee-progress-core";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/mentee-offline", () => ({
  saveOfflineInterviewAction: vi.fn(), lookupOfflineTicketAction: vi.fn(), cancelMenteeBookingAction: vi.fn(), moveMenteeBookingAction: vi.fn()
}));
vi.mock("@/app/interviews/mentee-offline/qr-camera", () => ({ InterviewQrCamera: () => null }));

import { OfflineDashboardClient } from "@/app/interviews/mentee-offline/workflow";
import { ProgressBoard } from "@/app/interviews/tien-do-mentee/progress-board";

// Đúng câu địa điểm đang nằm trên production cho hai ngày.
const VENUE_B = "Phòng B1.503, B1.504, B1.506, B1.803, B1.805, B1.808 — Cơ sở B, 279 Nguyễn Tri Phương, Phường Diên Hồng, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/Cne2WL3a6LfXNZ2fA";
const VENUE_H_SANG = "Phòng H101, H104, H201 — Cơ sở H, 1A Hoàng Diệu, Phường Phú Nhuận, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/ydfX6wHU3eKVPgnp6";

const S = { id: "s", starts_at: "2026-10-04T01:00:00Z", ends_at: "2026-10-04T01:30:00Z", venue: VENUE_B, seat_limit: 28 };
type Op = NonNullable<OfflineDashboard["candidates"][number]["operation"]>;
const op = (extra: Partial<Op>): Op => ({
  checked_in_at: "2026-10-04T01:02:00Z", room: null, desk: null, interviewer_id: null, review_id: null, outcome: null,
  match_id: null, revision: 1, is_online: false, online_note: null, ...extra
});
const cand = (id: string, name: string, operation: Op | null) => ({
  id, name, phone: "0900000000", email: null, status: "interview_scheduled", sessionId: "s", bookedAt: "2026-10-01T00:00:00Z",
  rawPayload: null, answers: [] as Array<[string, string]>, reviews: [], operation
});
function data(extra: Partial<OfflineDashboard> = {}): OfflineDashboard {
  return {
    actorId: "sup", seasonId: "season", canOperate: true, rubric: null, sessions: [S],
    participants: [{ id: "m1", full_name: "Mentor Một", email: "m1@example.test", capacity: 2, activeMatches: 0 }],
    candidates: [
      cand("in", "Bình Đang PV", op({ room: 2, desk: 3, interviewer_id: "m1" })),
      cand("wait", "Chi Chờ Bàn", op({}))
    ],
    logs: [],
    ...extra
  };
}

afterEach(cleanup);

describe("tên phòng từ địa điểm của ca", () => {
  it("phòng số n là tên thứ n; khác ngày khác danh sách", () => {
    expect(roomNamesFromVenue(VENUE_B)).toEqual(["B1.503", "B1.504", "B1.506", "B1.803", "B1.805", "B1.808"]);
    expect(roomNamesFromVenue(VENUE_H_SANG)).toEqual(["H101", "H104", "H201"]);
    expect(roomLabel(2, VENUE_B)).toBe("B1.504");
    expect(roomLabel(6, VENUE_B)).toBe("B1.808");
    expect(roomLabel(2, VENUE_H_SANG)).toBe("H104");
    expect(roomDeskLabel(2, 3, VENUE_B)).toBe("Phòng B1.504 · Bàn 3");
  });

  it("không đoán bừa: địa điểm không theo khuôn \"Phòng …\" hoặc số vượt danh sách thì hiện số", () => {
    expect(roomNamesFromVenue("Cơ sở H")).toEqual([]);
    expect(roomNamesFromVenue(null)).toEqual([]);
    expect(roomLabel(2, "Cơ sở H")).toBe("2");
    expect(roomLabel(7, VENUE_B)).toBe("7");
    expect(roomDeskLabel(null, null, VENUE_B)).toBe("—");
    expect(roomLabel(undefined, VENUE_B)).toBe("—");
    // Câu mô tả chứ không phải danh sách phòng: không biến một mẩu câu thành "tên phòng".
    expect(roomLabel(1, "Phòng tập trung ở sảnh chính tòa nhà A, gần cổng số 2")).toBe("1");
  });

  it("địa điểm gõ dạng tổ hợp (NFD) vẫn đọc được", () => {
    expect(roomLabel(1, VENUE_B.normalize("NFD"))).toBe("B1.503");
  });
});

describe("màn hình phỏng vấn trực tiếp", () => {
  it("bảng hiện tên phòng của đúng bạn đã phân bàn", () => {
    render(<OfflineDashboardClient data={data()} />);
    const row = (name: string) => Array.from(document.querySelectorAll("tbody tr")).find((r) => r.textContent?.includes(name))!;
    expect(row("Bình Đang PV").textContent).toContain("Phòng B1.504 · Bàn 3");
    expect(row("Chi Chờ Bàn").textContent).not.toContain("Phòng");
  });

  it("hồ sơ đang mở ghi rõ phòng được phân, cho cả mentor không vận hành", () => {
    render(<OfflineDashboardClient data={data({ canOperate: false, actorId: "m1" })} initialApplication="in" />);
    expect(screen.getByTestId("assigned-room").textContent).toBe("Phòng B1.504 · Bàn 3");
  });

  it("ô chọn phòng của Support hiện tên phòng, gửi đi vẫn là số", () => {
    render(<OfflineDashboardClient data={data()} initialApplication="wait" />);
    const select = screen.getByRole("combobox", { name: "Phòng" }) as HTMLSelectElement;
    const options = Array.from(select.options).filter((o) => o.value);
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ["1", "B1.503"], ["2", "B1.504"], ["3", "B1.506"], ["4", "B1.803"], ["5", "B1.805"], ["6", "B1.808"]
    ]);
  });

  it("lịch sử thao tác ghi tên phòng", () => {
    const logs = [{
      id: "l1", application_id: "in", actor_name: "Support", candidate_name: "Bình Đang PV", action: "assign", reason: null,
      created_at: "2026-10-04T01:05:00Z", before_data: { operation: { room: 1, desk: 1 } }, after_data: { operation: { room: 2, desk: 3 } }
    }];
    render(<OfflineDashboardClient data={data({ logs })} />);
    expect(screen.getByText(/^Phòng\/bàn:/).textContent).toBe("Phòng/bàn: B1.503/1 → B1.504/3");
  });
});

describe("trang tiến độ", () => {
  it("cột Phòng / bàn hiện tên phòng", () => {
    const progress = buildMenteeProgress(data());
    const rows = progress.days[0].halves[0].sessions[0].rows;
    expect(rows.find((r) => r.id === "in")?.place).toBe("Phòng B1.504 · Bàn 3");
    expect(rows.find((r) => r.id === "wait")?.place).toBe("");
    render(<ProgressBoard progress={progress} todayKey="2026-10-04" />);
    const tr = document.querySelector('tbody tr[data-status="in_progress"]') as HTMLElement;
    expect(within(tr).getByText("Phòng B1.504 · Bàn 3")).toBeTruthy();
  });
});
