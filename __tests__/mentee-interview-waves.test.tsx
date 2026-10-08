// @vitest-environment jsdom
/**
 * Đợt phỏng vấn mentee (BTC 07/10/2026): đợt 1 03–04/10, đợt 2 10–11/10. Màn hình
 * phỏng vấn trực tiếp chỉ hiện một đợt; phòng/bàn đọc theo địa điểm của ca; trang
 * chọn ca của mentee không còn kéo theo những ngày đã qua.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { OfflineDashboard } from "@/lib/mentee-offline-core";
import { roomDeskBounds } from "@/lib/mentee-offline-core";
import { upcomingDays, type MenteeSessionDay } from "@/lib/mentee-interview-core";
import {
  MENTEE_INTERVIEW_WAVE_LINKS,
  dashboardForWave,
  interviewWaves,
  pickCurrentWave,
  waveOfSession
} from "@/lib/mentee-interview-waves";

const mocks = vi.hoisted(() => ({ dashboard: null as any, clientProps: null as any, bookingPage: null as any }));
vi.mock("@/lib/mentee-offline", () => ({ getOfflineDashboard: async () => mocks.dashboard }));
vi.mock("@/lib/mentee-interview", () => ({
  getMenteeSessionPageData: async () => mocks.bookingPage,
  bookMenteeSession: vi.fn(),
  changeMenteeSession: vi.fn(),
  saveMenteePrepAnswers: vi.fn()
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// useFormState cần Server Action thật — cùng cách các bộ test form khác của dự án.
vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: unknown) => [initial, action],
  useFormStatus: () => ({ pending: false })
}));
// Thẻ check-in dựng mã QR bất đồng bộ — không phải thứ bộ test này soát.
vi.mock("@/app/dat-ca/[token]/interview-ticket", () => ({ InterviewTicket: () => <div data-testid="ticket" /> }));
vi.mock("@/app/interviews/mentee-offline/workflow", () => ({
  OfflineDashboardClient: (props: any) => {
    mocks.clientProps = props;
    return <p data-testid="client">{props.data.candidates.map((c: any) => c.name).join(", ")}</p>;
  }
}));

import OfflineInterviewPage from "@/app/interviews/mentee-offline/page";
import MenteeSessionBookingPage from "@/app/dat-ca/[token]/page";

const SAT_VENUE_1 = "Phòng H101, H104, H201 — Cơ sở H, 1A Hoàng Diệu, Phường Phú Nhuận, Thành phố Hồ Chí Minh. Bản đồ: https://maps.app.goo.gl/x";
const SUN_VENUE_1 = "Phòng B1.503, B1.504, B1.506, B1.803, B1.805, B1.808 — Cơ sở B, 279 Nguyễn Tri Phương, Phường Diên Hồng, Thành phố Hồ Chí Minh.";
// Đúng câu migration 20261007100000 ghi cho Chủ nhật 11/10.
const SUN_VENUE_2 = "Phòng B1-502, B1-503, B1-504, B1-506, B1-802, B1-803 — Cơ sở B, 279 Nguyễn Tri Phương, Phường Diên Hồng, TP. Hồ Chí Minh (địa chỉ cũ: 279 Nguyễn Tri Phương, P.5, Q.10, TP.HCM). Check-in tại phòng B1-502. Bản đồ: https://maps.app.goo.gl/Cne2WL3a6LfXNZ2fA";

const SESSIONS = [
  { id: "s03", starts_at: "2026-10-03T01:00:00Z", ends_at: "2026-10-03T01:30:00Z", venue: SAT_VENUE_1, seat_limit: 18 },
  { id: "s04", starts_at: "2026-10-04T01:00:00Z", ends_at: "2026-10-04T01:30:00Z", venue: SUN_VENUE_1, seat_limit: 28 },
  { id: "s10", starts_at: "2026-10-10T01:00:00Z", ends_at: "2026-10-10T01:30:00Z", venue: null, seat_limit: 18 },
  { id: "s11", starts_at: "2026-10-11T06:30:00Z", ends_at: "2026-10-11T07:00:00Z", venue: SUN_VENUE_2, seat_limit: 28 }
];

function candidate(id: string, name: string, sessionId: string) {
  return { id, name, phone: null, email: null, status: "interview_scheduled", sessionId, bookedAt: "2026-10-01T00:00:00Z", rawPayload: null, answers: [], reviews: [], operation: null };
}

const DASHBOARD: OfflineDashboard = {
  actorId: "u", seasonId: "season", canOperate: true, rubric: null,
  sessions: SESSIONS,
  participants: [],
  candidates: [candidate("a1", "An Đợt Một", "s03"), candidate("a2", "Bình Đợt Hai", "s11"), candidate("a3", "Chi Đợt Hai", "s10")],
  logs: [
    { id: "l1", application_id: "a1", actor_name: "BTC", candidate_name: "An Đợt Một", action: "checkin", reason: null, created_at: "2026-10-03T01:05:00Z", before_data: null, after_data: null },
    { id: "l2", application_id: "a2", actor_name: "BTC", candidate_name: "Bình Đợt Hai", action: "move", reason: "x", created_at: "2026-10-07T01:05:00Z", before_data: null, after_data: null }
  ]
};

const WAVES = interviewWaves(SESSIONS);

afterEach(() => {
  cleanup();
  mocks.clientProps = null;
});

describe("đợt", () => {
  it("03–04/10 là đợt 1, 10–11/10 là đợt 2; khoá trùng các mục con trên menu", () => {
    expect(WAVES.map((w) => [w.key, w.label, w.sessionIds])).toEqual([
      ["2026-10-03", "Đợt 1 · 03–04/10/2026", ["s03", "s04"]],
      ["2026-10-10", "Đợt 2 · 10–11/10/2026", ["s10", "s11"]]
    ]);
    expect(MENTEE_INTERVIEW_WAVE_LINKS.map((l) => l.key)).toEqual(WAVES.map((w) => w.key));
  });

  it("màn hình vận hành mặc định là đợt đang diễn ra hoặc sắp tới", () => {
    expect(pickCurrentWave(WAVES, "2026-10-04")?.key).toBe("2026-10-03");
    expect(pickCurrentWave(WAVES, "2026-10-07")?.key).toBe("2026-10-10");
    expect(pickCurrentWave(WAVES, "2026-10-11")?.key).toBe("2026-10-10");
    expect(pickCurrentWave(WAVES, "2026-10-20")?.key).toBe("2026-10-10");
    expect(pickCurrentWave(WAVES, "2026-10-07", "2026-10-03")?.key).toBe("2026-10-03");
    expect(pickCurrentWave(WAVES, "2026-10-07", "sai")?.key).toBe("2026-10-10");
    expect(waveOfSession(WAVES, "s04")?.key).toBe("2026-10-03");
  });

  it("dữ liệu một đợt: chỉ ca, mentee, nhật ký của đợt đó; form Đổi ca vẫn có mọi ca", () => {
    const d = dashboardForWave(DASHBOARD, WAVES[1]);
    expect(d.sessions.map((s) => s.id)).toEqual(["s10", "s11"]);
    expect(d.candidates.map((c) => c.id)).toEqual(["a2", "a3"]);
    expect(d.logs.map((l) => l.id)).toEqual(["l2"]);
    expect(d.moveTargets?.map((s) => s.id)).toEqual(["s03", "s04", "s10", "s11"]);
  });
});

describe("phòng/bàn theo chính ca — cùng luật với trigger database", () => {
  it("đợt 1 ra đúng như cũ", () => {
    expect(roomDeskBounds(SAT_VENUE_1, 18)).toEqual({ rooms: 3, desks: 6 });
    expect(roomDeskBounds(SUN_VENUE_1, 28)).toEqual({ rooms: 6, desks: 5 });
  });

  it("đợt 2: Chủ nhật 6 phòng B1-502…B1-803 × 5 bàn; Thứ Bảy chưa có địa điểm → 6 phòng × 3 bàn", () => {
    expect(roomDeskBounds(SUN_VENUE_2, 28)).toEqual({ rooms: 6, desks: 5 });
    expect(roomDeskBounds(null, 18)).toEqual({ rooms: 6, desks: 3 });
  });

  it("thiếu số chỗ → 6 bàn; địa điểm không theo khuôn “Phòng …” → 6 phòng", () => {
    expect(roomDeskBounds(SAT_VENUE_1, null)).toEqual({ rooms: 3, desks: 6 });
    expect(roomDeskBounds("Hội trường A, tầng 2", 30)).toEqual({ rooms: 6, desks: 5 });
  });
});

describe("trang chọn ca của mentee", () => {
  it("bỏ những ngày mà mọi ca đã qua", () => {
    const day = (dateKey: string, states: string[]) =>
      ({ dateKey, label: dateKey, sessions: states.map((state, i) => ({ id: `${dateKey}-${i}`, state })) }) as unknown as MenteeSessionDay;
    const days = [day("2026-10-03", ["past", "past"]), day("2026-10-10", ["past", "open"]), day("2026-10-11", ["full", "open"])];
    expect(upcomingDays(days).map((d) => d.dateKey)).toEqual(["2026-10-10", "2026-10-11"]);
  });
});

describe("câu đầu trang chọn ca", () => {
  const view = (id: string, state: string) => ({
    id, startsAtIso: "2026-10-11T01:00:00Z", timeLabel: "08:00 – 08:30", seatLimit: state === "open" ? 28 : null,
    taken: 0, remaining: state === "open" ? 28 : null, state, note: null
  });

  it("chỉ nêu ngày còn ca đặt được — Thứ Bảy đang tạm khoá (chưa có số chỗ) không được nêu", async () => {
    mocks.bookingPage = {
      ok: true, state: "eligible", candidateName: "Lan", anyBookable: true, totalRemaining: 28,
      deadlineLabel: "17:00 ngày 09/10/2026", hotlineZalo: "0919144638", support: { name: "BTC", phone: "0" }, prepAnswers: [],
      days: [
        { dateKey: "2026-10-10", label: "Thứ Bảy 10/10/2026", sessions: [view("s10", "not_configured")] },
        { dateKey: "2026-10-11", label: "Chủ nhật 11/10/2026", sessions: [view("s11", "open")] }
      ]
    };
    render(await MenteeSessionBookingPage({ params: Promise.resolve({ token: "tok" }) }));
    const intro = screen.getByText(/Phỏng vấn trực tiếp tại UEH/);
    expect(intro.textContent).toContain("ngày Chủ nhật 11/10/2026.");
    expect(intro.textContent).not.toContain("Thứ Bảy 10/10");
    expect(intro.textContent).not.toContain("03 và 04/10");
  });

  // Đúng câu migration 20261008153000 ghi cho 7 ca chiều Thứ Bảy 10/10.
  const ONLINE_VENUE =
    "PHỎNG VẤN ONLINE — Bạn tham gia nhóm Zalo https://zalo.me/g/i2ppr7x3cj6kxchwtj16 trước giờ ca. Support Team điều phối theo ca; tới lượt, mentor sẽ gửi link phòng phỏng vấn online cho bạn.";
  const booked = (venue: string | null) => ({
    ok: true, state: "booked", candidateName: "Lan",
    booking: { sessionId: "s10p", sessionLabel: "Thứ Bảy 10/10/2026, 13:30 – 14:00 (giờ Việt Nam)", venue, checkinToken: "chk" },
    days: [{ dateKey: "2026-10-11", label: "Chủ nhật 11/10/2026", sessions: [view("s11", "open")] }],
    canChange: false, deadlineLabel: null, hotlineZalo: "0919144638", support: { name: "BTC", phone: "0" }, prepAnswers: []
  });

  it("ca online (chiều 10/10): link nhóm Zalo bấm được, đầu trang không còn nói 'trực tiếp tại UEH'", async () => {
    mocks.bookingPage = booked(ONLINE_VENUE);
    render(await MenteeSessionBookingPage({ params: Promise.resolve({ token: "tok" }) }));
    const venue = screen.getByTestId("booking-venue");
    const link = within(venue).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://zalo.me/g/i2ppr7x3cj6kxchwtj16");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(venue.textContent).toContain("PHỎNG VẤN ONLINE");
    expect(venue.textContent).toContain("trước giờ ca. Support Team điều phối theo ca");
    expect(screen.getByText(/Ca phỏng vấn của bạn là phỏng vấn online\./)).toBeTruthy();
    expect(screen.queryByText(/Phỏng vấn trực tiếp tại UEH/)).toBeNull();
  });

  it("ca trực tiếp: đầu trang giữ câu cũ; link bản đồ trong địa điểm cũng bấm được; chữ 'javascript:' vẫn là chữ", async () => {
    mocks.bookingPage = booked(`${SUN_VENUE_2} javascript:alert(1)`);
    render(await MenteeSessionBookingPage({ params: Promise.resolve({ token: "tok" }) }));
    const venue = screen.getByTestId("booking-venue");
    expect(within(venue).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["https://maps.app.goo.gl/Cne2WL3a6LfXNZ2fA"]);
    expect(venue.textContent).toContain("Check-in tại phòng B1-502.");
    expect(screen.getByText(/Phỏng vấn trực tiếp tại UEH/)).toBeTruthy();
  });
});

describe("màn hình Phỏng vấn mentee trực tiếp", () => {
  it("?dot= đợt 2: tiêu đề đọc từ ca của đợt, chỉ mentee đợt 2, có nút chuyển đợt", async () => {
    mocks.dashboard = { ok: true, data: DASHBOARD };
    render(await OfflineInterviewPage({ searchParams: Promise.resolve({ dot: "2026-10-10" }) }));
    const header = screen.getByRole("heading", { name: "Phỏng vấn mentee trực tiếp" }).parentElement!;
    expect(header.textContent).toContain("Đợt 2 · 10–11/10/2026");
    expect(header.textContent).toContain("Thứ Bảy 10/10: chưa có địa điểm, tối đa 18 mentee/ca");
    expect(header.textContent).toContain("Chủ nhật 11/10: 6 phòng, tối đa 28 mentee/ca");
    expect(header.textContent).not.toContain("03–04/10");
    expect(screen.getByTestId("client").textContent).toBe("Bình Đợt Hai, Chi Đợt Hai");
    const tabs = within(screen.getByTestId("wave-tabs"));
    expect(tabs.getByRole("link", { name: "Đợt 2 · 10–11/10/2026" }).getAttribute("aria-current")).toBe("page");
    expect(tabs.getByRole("link", { name: "Đợt 1 · 03–04/10/2026" }).getAttribute("href")).toBe("/interviews/mentee-offline?dot=2026-10-03");
  });

  it("đường dẫn mở thẳng một hồ sơ rơi đúng đợt của hồ sơ đó", async () => {
    mocks.dashboard = { ok: true, data: DASHBOARD };
    render(await OfflineInterviewPage({ searchParams: Promise.resolve({ application: "a1" }) }));
    expect(screen.getByTestId("client").textContent).toBe("An Đợt Một");
    expect(mocks.clientProps.initialApplication).toBe("a1");
  });
});
