// @vitest-environment jsdom
/**
 * BTC 04/10/2026: bỏ khoá bàn / người phỏng vấn (migration 20261004110000). Thay vào đó
 * form phân bàn NHẮC ai đang ở bàn này / với mentor này mà chưa có kết quả — trong cùng
 * ngày — và vẫn cho lưu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { openAtDeskAndMentor, type OfflineDashboard } from "@/lib/mentee-offline-core";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/mentee-offline", () => ({
  saveOfflineInterviewAction: vi.fn(), lookupOfflineTicketAction: vi.fn(), cancelMenteeBookingAction: vi.fn(), moveMenteeBookingAction: vi.fn()
}));
vi.mock("@/app/interviews/mentee-offline/qr-camera", () => ({ InterviewQrCamera: () => null }));

import { OfflineDashboardClient } from "@/app/interviews/mentee-offline/workflow";

const VENUE = "Phòng B1.503, B1.504, B1.506, B1.803, B1.805, B1.808 — Cơ sở B";
const S0900 = { id: "s0900", starts_at: "2026-10-04T02:00:00Z", ends_at: "2026-10-04T02:30:00Z", venue: VENUE, seat_limit: 28 };
const S0930 = { id: "s0930", starts_at: "2026-10-04T02:30:00Z", ends_at: "2026-10-04T03:00:00Z", venue: VENUE, seat_limit: 28 };
// Thứ Bảy, cùng phòng 2 bàn 3 — khác NGÀY nên không phải người đang ngồi đó.
const S0310 = { id: "s0310", starts_at: "2026-10-03T02:00:00Z", ends_at: "2026-10-03T02:30:00Z", venue: VENUE, seat_limit: 18 };

type Op = NonNullable<OfflineDashboard["candidates"][number]["operation"]>;
const op = (extra: Partial<Op>): Op => ({
  checked_in_at: "2026-10-04T02:05:00Z", room: null, desk: null, interviewer_id: null, review_id: null, outcome: null,
  match_id: null, revision: 1, is_online: false, online_note: null, ...extra
});
const cand = (id: string, name: string, sessionId: string, operation: Op | null, status = "interview_scheduled") => ({
  id, name, phone: "0900000000", email: null, status, sessionId, bookedAt: "2026-10-01T00:00:00Z",
  rawPayload: null, answers: [] as Array<[string, string]>, reviews: [], operation
});
function data(): OfflineDashboard {
  return {
    actorId: "sup", seasonId: "season", canOperate: true, rubric: null, logs: [], sessions: [S0900, S0930, S0310],
    participants: [
      { id: "m1", full_name: "Mentor Một", email: "m1@example.test", capacity: 2, activeMatches: 0 },
      { id: "m2", full_name: "Mentor Hai", email: "m2@example.test", capacity: 2, activeMatches: 0 }
    ],
    candidates: [
      cand("new", "Mai Mới Đến", "s0930", op({})),
      // Ca TRƯỚC, cùng ngày, cùng bàn, mentor chưa nộp phiếu → phải nhắc.
      cand("open", "Phương Chưa Chấm", "s0900", op({ room: 2, desk: 3, interviewer_id: "m1" })),
      // Đã có kết quả → bàn trống, không nhắc.
      cand("done", "An Đã Chấm", "s0900", op({ room: 2, desk: 3, interviewer_id: "m1", outcome: "passed" })),
      // Đã rút → không nhắc.
      cand("gone", "Én Đã Rút", "s0900", op({ room: 2, desk: 3, interviewer_id: "m1" }), "withdrawn"),
      // Khác ngày → không nhắc.
      cand("sat", "Thứ Bảy", "s0310", op({ room: 2, desk: 3, interviewer_id: "m1", checked_in_at: "2026-10-03T02:05:00Z" })),
      // Cùng mentor, bàn khác → chỉ nhắc ở dòng mentor.
      cand("other", "Vy Bàn Khác", "s0930", op({ room: 1, desk: 1, interviewer_id: "m1" }))
    ]
  };
}

afterEach(cleanup);

describe("ai đang ở bàn / với mentor mà chưa có kết quả", () => {
  it("chỉ tính người khác, cùng ngày, chưa có kết quả, chưa rút", () => {
    expect(openAtDeskAndMentor(data(), "new", { room: 2, desk: 3, interviewerId: "m1" })).toEqual({
      atDesk: ["Phương Chưa Chấm"],
      withMentor: ["Phương Chưa Chấm", "Vy Bàn Khác"]
    });
  });

  it("chưa chọn đủ phòng + bàn thì không nhắc bàn; mentor khác thì không nhắc mentor", () => {
    expect(openAtDeskAndMentor(data(), "new", { room: 2, desk: null, interviewerId: "m2" })).toEqual({ atDesk: [], withMentor: [] });
  });

  it("không tính chính mình", () => {
    expect(openAtDeskAndMentor(data(), "open", { room: 2, desk: 3, interviewerId: "m1" }).atDesk).toEqual([]);
  });
});

describe("form phân bàn", () => {
  it("chọn bàn / mentor đang có người chưa chấm → hiện lời nhắc, nút lưu vẫn bấm được", () => {
    render(<OfflineDashboardClient data={data()} initialApplication="new" />);
    expect(screen.queryByTestId("assign-busy-note")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Phòng" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Bàn" }), { target: { value: "3" } });
    const note = () => screen.getByTestId("assign-busy-note").textContent ?? "";
    expect(note()).toContain("Bàn này đang có 1 bạn chưa có kết quả: Phương Chưa Chấm.");
    expect(note()).not.toContain("Mentor này");
    fireEvent.change(screen.getByRole("combobox", { name: "Người phỏng vấn" }), { target: { value: "m1" } });
    expect(note()).toContain("Mentor này đang có 2 bạn chưa có kết quả: Phương Chưa Chấm, Vy Bàn Khác.");
    expect((screen.getByRole("button", { name: "Lưu phân bàn" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Bàn" }), { target: { value: "4" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Người phỏng vấn" }), { target: { value: "m2" } });
    expect(screen.queryByTestId("assign-busy-note")).toBeNull();
  });
});
