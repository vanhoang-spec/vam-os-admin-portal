// @vitest-environment jsdom
/**
 * BTC 04/10/2026: trong cùng một ca, ai check-in trước đứng trước (cùng giờ thì theo
 * tên); và hiện tài khoản Support/BTC nào đã check-in cho từng bạn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { compareByArrival, sortCandidatesByArrival, type OfflineDashboard } from "@/lib/mentee-offline-core";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), staff: [] as any[], staffReads: [] as string[][] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/mentee-offline", () => ({
  saveOfflineInterviewAction: vi.fn(), lookupOfflineTicketAction: vi.fn(), cancelMenteeBookingAction: vi.fn(), moveMenteeBookingAction: vi.fn()
}));
vi.mock("@/app/interviews/mentee-offline/qr-camera", () => ({ InterviewQrCamera: () => null }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => ({ id: "sup-1", role: "support_team" }) }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    rpc: mocks.rpc,
    from: () => { const b: any = { select: () => b, eq: () => b, single: async () => ({ data: { id: "season" }, error: null }) }; return b; }
  })
}));
vi.mock("@/lib/paged-read", () => ({
  readAllPagesIn: async (_c: unknown, table: string, _col: string, ids: string[]) => {
    if (table === "admin_users") mocks.staffReads.push(ids);
    return { data: mocks.staff, error: null };
  }
}));

import { OfflineDashboardClient } from "@/app/interviews/mentee-offline/workflow";
import { getOfflineDashboard } from "@/lib/mentee-offline";

const S1 = { id: "s1", starts_at: "2026-10-04T01:00:00Z", ends_at: "2026-10-04T01:30:00Z", venue: "B1.503", seat_limit: 28 };
const S0 = { id: "s0", starts_at: "2026-10-04T00:30:00Z", ends_at: "2026-10-04T01:00:00Z", venue: "B1.503", seat_limit: 28 };
type Op = NonNullable<OfflineDashboard["candidates"][number]["operation"]>;
const op = (checked: string | null, by: string | null = null, byName: string | null = null): Op => ({
  checked_in_at: checked, checked_in_by: by, checked_in_by_name: byName, room: null, desk: null, interviewer_id: null,
  review_id: null, outcome: null, match_id: null, revision: 1, is_online: false, online_note: null
});
const cand = (id: string, name: string, sessionId: string, operation: Op | null) => ({
  id, name, phone: "0900000000", email: null, status: "interview_scheduled", sessionId, bookedAt: "2026-10-01T00:00:00Z",
  rawPayload: null, answers: [] as Array<[string, string]>, reviews: [], operation
});

afterEach(cleanup);

describe("thứ tự đến", () => {
  it("ai check-in trước đứng trước; cùng giờ theo tên; chưa đến xếp sau theo tên", () => {
    const list = [
      { name: "Vy", checkedInAt: null },
      { name: "Bình", checkedInAt: "2026-10-04T01:05:00Z" },
      { name: "An", checkedInAt: null },
      { name: "Chi", checkedInAt: "2026-10-04T01:00:00Z" },
      { name: "Ánh", checkedInAt: "2026-10-04T01:05:00Z" }
    ].sort(compareByArrival);
    expect(list.map((x) => x.name)).toEqual(["Chi", "Ánh", "Bình", "An", "Vy"]);
  });

  it("danh sách: ca sớm trước, trong ca theo giờ check-in", () => {
    const sorted = sortCandidatesByArrival([
      cand("b", "B 8:05", "s1", op("2026-10-04T01:05:00Z")),
      cand("z", "Z ca sớm", "s0", op(null)),
      cand("a", "A 8:00", "s1", op("2026-10-04T01:00:00Z")),
      cand("c", "C chưa đến", "s1", null)
    ], [S1, S0]);
    expect(sorted.map((c) => c.id)).toEqual(["z", "a", "b", "c"]);
  });
});

describe("màn hình phỏng vấn", () => {
  function data(): OfflineDashboard {
    return {
      actorId: "sup-1", seasonId: "season", canOperate: true, logs: [], rubric: null, sessions: [S1], participants: [],
      candidates: [
        cand("late", "Bình Đến Sau", "s1", op("2026-10-04T01:05:00Z", "sup-2", "Support Hai")),
        cand("none", "An Chưa Đến", "s1", null),
        cand("early", "Chi Đến Trước", "s1", op("2026-10-04T01:00:00Z", "sup-1", "Support Một"))
      ]
    };
  }

  it("bảng xếp theo giờ check-in, hiện giờ đến và tài khoản đã check-in", () => {
    render(<OfflineDashboardClient data={data()} />);
    const rows = Array.from(document.querySelectorAll("tbody tr")).map((r) => r.textContent ?? "");
    expect(rows.map((t) => t.split("0900000000")[0])).toEqual(["Chi Đến Trước", "Bình Đến Sau", "An Chưa Đến"]);
    expect(rows[0]).toContain("Đã đến 08:00");
    expect(rows[0]).toContain("Check-in: Support Một");
    expect(rows[1]).toContain("Đã đến 08:05");
    expect(rows[1]).toContain("Check-in: Support Hai");
    expect(rows[2]).toContain("Chưa đến");
    expect(rows[2]).not.toContain("Check-in:");
  });
});

describe("máy chủ gắn tên người check-in", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.staffReads = [];
    mocks.staff = [{ id: "sup-2", full_name: "Support Hai", email: "s2@example.test" }, { id: "sup-3", full_name: null, email: "s3@example.test" }];
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "vam104_offline_dashboard"
        ? { data: { canOperate: true, logs: [], sessions: [S1], participants: [], candidates: [
            cand("a", "A", "s1", op("2026-10-04T01:00:00Z", "sup-2")),
            cand("b", "B", "s1", op("2026-10-04T01:01:00Z", "sup-3")),
            cand("c", "C", "s1", null)
          ] }, error: null }
        : { data: { rubric: null }, error: null }
    );
  });

  it("đọc đúng các tài khoản đã check-in và gắn tên (không có tên thì dùng email)", async () => {
    const r = await getOfflineDashboard();
    if (!r.ok) throw new Error(r.message);
    expect(mocks.staffReads).toEqual([["sup-2", "sup-3"]]);
    const by = Object.fromEntries(r.data.candidates.map((c) => [c.id, c.operation?.checked_in_by_name ?? null]));
    expect(by).toEqual({ a: "Support Hai", b: "s3@example.test", c: null });
  });
});
