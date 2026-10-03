// @vitest-environment jsdom
/**
 * Tiến độ phỏng vấn mentor Mùa 12 cho BTC (03/10/2026).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildMentorProgress, mentorProgressStatus, type MentorProgressInput } from "@/lib/mentor-progress-core";

const mocks = vi.hoisted(() => ({
  admin: null as any, scopeError: false, canOperate: true, reads: [] as string[],
  tables: {} as Record<string, any[]>
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.admin }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: async () => ({ scopeError: mocks.scopeError }),
  canOperateSeason: async () => mocks.canOperate
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    from: () => { const b: any = { select: () => b, eq: () => b, single: async () => ({ data: { id: "s12" }, error: null }) }; return b; }
  })
}));
vi.mock("@/lib/paged-read", () => ({
  readAllPages: async (table: string) => { mocks.reads.push(table); return { data: mocks.tables[table] ?? [], error: null }; },
  readAllPagesIn: async (_c: unknown, table: string) => { mocks.reads.push(table); return { data: mocks.tables[table] ?? [], error: null }; }
}));

import { getMentorProgress } from "@/lib/mentor-progress";
import { MentorProgressBoard } from "@/app/interviews/tien-do-mentor/mentor-progress-board";

const NOW = Date.parse("2026-10-03T03:30:00Z"); // 10:30 giờ VN
const base = (extra: Partial<MentorProgressInput>): MentorProgressInput => ({
  applicationId: "a", name: "Mentor", email: "m@example.test", phone: "0901", appStatus: "interview_scheduled",
  booking: null, cancelledBookings: 0, review: null, invite: null, ...extra
});
const slot = (iso: string, interviewer = "Core A") => ({ slotStartsAt: iso, interviewer });
const review = (status: string, extra: Partial<NonNullable<MentorProgressInput["review"]>> = {}) =>
  ({ status, reviewer: "Core B", recommendation: null, totalScore: null, submittedAt: null, ...extra });

describe("trạng thái", () => {
  it.each([
    ["phiếu đã nộp → xong", base({ review: review("submitted") }), "done"],
    ["đơn đã có kết quả sau PV → xong", base({ appStatus: "ready_for_final_decision" }), "done"],
    ["lịch hẹn tương lai → đã đặt", base({ booking: slot("2026-10-03T05:00:00Z") }), "scheduled"],
    ["đang trong giờ hẹn 60 phút → đang PV", base({ booking: slot("2026-10-03T03:00:00Z") }), "in_progress"],
    ["quá giờ hẹn chưa có phiếu → qua giờ", base({ booking: slot("2026-10-03T01:00:00Z") }), "awaiting_result"],
    ["quá giờ nhưng phiếu đang làm → đang PV", base({ booking: slot("2026-10-03T01:00:00Z"), review: review("in_progress") }), "in_progress"],
    ["core team nhận trực tiếp, phiếu chưa làm → đã phân", base({ appStatus: "interview_in_progress", review: review("assigned") }), "assigned"],
    ["đủ điều kiện, chưa lịch, chưa phiếu → chưa đặt", base({ appStatus: "invited_to_interview" }), "not_booked"],
    ["vòng hồ sơ", base({ appStatus: "screening_assigned" }), "pending_screening"],
    ["không phù hợp, chưa phỏng vấn → dừng", base({ appStatus: "rejected_or_not_fit" }), "stopped"],
    ["rút hồ sơ", base({ appStatus: "withdrawn" }), "withdrawn"]
  ])("%s", (_label, input, expected) => {
    expect(mentorProgressStatus(input, NOW)).toBe(expected);
  });
});

describe("gom nhóm và đếm", () => {
  const inputs = [
    base({ applicationId: "1", name: "Bình", booking: slot("2026-10-03T05:00:00Z") }),
    base({ applicationId: "2", name: "An", booking: slot("2026-10-02T12:00:00Z"), appStatus: "approved_as_mentor", review: review("submitted", { recommendation: "approve_recommended", totalScore: 22 }) }),
    base({ applicationId: "3", name: "Chi", appStatus: "invited_to_interview", invite: { sendCount: 3, lastSentAt: "2026-10-02T02:00:00Z" } }),
    base({ applicationId: "4", name: "Dung", appStatus: "ready_for_final_decision", review: review("submitted") })
  ];
  it("nhóm theo ngày hẹn (giờ VN), nhóm không lịch đứng cuối; kết quả tách theo trạng thái đơn", () => {
    const p = buildMentorProgress(inputs, NOW);
    expect(p.groups.map((g) => g.key)).toEqual(["2026-10-02", "2026-10-03", "khong-lich"]);
    expect(p.counts).toMatchObject({ total: 4, done: 2, scheduled: 1, not_booked: 1 });
    expect(p.resultCounts).toEqual(expect.arrayContaining([["Đã duyệt — Mentor", 1], ["Sẵn sàng ra quyết định cuối", 1]]));
    const an = p.groups[0].rows[0];
    expect(an.resultLabel).toContain("Đã duyệt — Mentor");
    expect(an.resultLabel).toContain("22/25");
    const chi = p.groups[2].rows.find((r) => r.name === "Chi")!;
    expect(chi.detail).toContain("3/4 thư mời/nhắc");
  });

  it("bảng: lọc 'Qua giờ, chưa có phiếu' và tìm theo người phỏng vấn", () => {
    const p = buildMentorProgress([
      ...inputs,
      base({ applicationId: "5", name: "Em Quá Giờ", booking: slot("2026-10-03T01:00:00Z", "Core Zed") })
    ], NOW);
    render(<MentorProgressBoard progress={p} />);
    fireEvent.click(screen.getByRole("button", { name: "Qua giờ, chưa có phiếu" }));
    expect(Array.from(document.querySelectorAll("tbody tr")).map((r) => r.getAttribute("data-status"))).toEqual(["awaiting_result"]);
    fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
    fireEvent.change(screen.getByLabelText("Tìm mentor / người phỏng vấn"), { target: { value: "core zed" } });
    expect(Array.from(document.querySelectorAll("tbody tr")).map((r) => r.textContent)).toEqual([expect.stringContaining("Em Quá Giờ")]);
    cleanup();
  });
});

describe("đọc dữ liệu + cổng quyền", () => {
  beforeEach(() => {
    mocks.admin = { id: "u", role: "support_team" };
    mocks.scopeError = false;
    mocks.canOperate = true;
    mocks.reads = [];
    mocks.tables = {
      applications: [
        { id: "renew", full_name: "Gia hạn", status: "approved_as_mentor", source: "s12_mentor_renewal" },
        { id: "invited", full_name: "Được mời", status: "invited_to_interview", source: "vam_os_form" },
        { id: "screen-reject", full_name: "Rớt hồ sơ", status: "rejected_or_not_fit", source: "vam_os_form" },
        { id: "booked", full_name: "Có lịch", status: "interview_scheduled", source: "vam_os_form" },
        { id: "direct", full_name: "Trực tiếp", status: "ready_for_final_decision", source: "vam_os_form" }
      ],
      interview_slot_invites: [{ application_id: "invited", send_count: 2, last_sent_at: null }],
      interview_bookings: [
        { application_id: "booked", status: "booked", slot_starts_at: "2026-10-05T02:00:00Z", interviewer_admin_user_id: "core-1" },
        { application_id: "booked", status: "cancelled_by_mentor", slot_starts_at: "2026-10-01T02:00:00Z", interviewer_admin_user_id: "core-1" }
      ],
      application_reviews: [
        { application_id: "direct", status: "submitted", reviewer_admin_user_id: "core-2", updated_at: "2026-10-01" },
        // Mentor gia hạn lỡ có phiếu vòng phỏng vấn: vẫn KHÔNG được tính (họ không qua phỏng vấn).
        { application_id: "renew", status: "submitted", reviewer_admin_user_id: "core-2", updated_at: "2026-10-01" }
      ],
      admin_users: [{ id: "core-1", full_name: "Core Một" }, { id: "core-2", full_name: "Core Hai" }]
    };
  });
  afterEach(cleanup);

  it("chỉ tính mentor đã vào vòng phỏng vấn; bỏ mentor gia hạn và người rớt từ vòng hồ sơ", async () => {
    const r = await getMentorProgress(NOW);
    if (!r.ok) throw new Error(r.message);
    const rows = r.progress.groups.flatMap((g) => g.rows);
    expect(rows.map((x) => x.name).sort()).toEqual(["Có lịch", "Trực tiếp", "Được mời"].sort());
    const booked = rows.find((x) => x.name === "Có lịch")!;
    expect(booked).toMatchObject({ status: "scheduled", interviewer: "Core Một", cancelledBookings: 1 });
    expect(rows.find((x) => x.name === "Trực tiếp")).toMatchObject({ status: "done", interviewer: "Core Hai" });
  });

  it("mentor phỏng vấn (reviewer) bị từ chối, không đọc bảng nào", async () => {
    mocks.admin = { id: "u", role: "reviewer" };
    expect((await getMentorProgress(NOW)).ok).toBe(false);
    expect(mocks.reads).toEqual([]);
  });

  it("không có quyền vận hành mùa, hoặc không đọc được phạm vi: từ chối, không đọc hồ sơ", async () => {
    mocks.canOperate = false;
    expect((await getMentorProgress(NOW)).ok).toBe(false);
    mocks.canOperate = true;
    mocks.scopeError = true;
    expect((await getMentorProgress(NOW)).ok).toBe(false);
    expect(mocks.reads).toEqual([]);
  });
});
