/**
 * Trang chọn ca của một mentee được mở lại (hạn riêng) — tầng đọc dữ liệu thật
 * (getMenteeSessionPageData), database giả.
 *
 * Bản giả CHỈ trả những cột câu select xin: nếu mã quên xin booking_open_until
 * thì trang sẽ thấy null y như trên production, và ca này đỏ.
 */
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: {} as Record<string, any>, lists: {} as Record<string, any[]> }));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    from(table: string) {
      const st: { cols: string[]; next: boolean } = { cols: [], next: false };
      const pick = (row: any) => (row ? Object.fromEntries(st.cols.filter((c) => c in row).map((c) => [c, row[c]])) : null);
      const b: any = {
        select: (cols: string) => { st.cols = cols.split(",").map((c) => c.trim()); return b; },
        eq: () => b, in: () => b, order: () => b, limit: () => b, range: () => b,
        gt: () => { st.next = true; return b; },
        maybeSingle: async () => ({ data: pick(mocks.rows[table]), error: null }),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: st.next ? [] : (mocks.lists[table] ?? []).map(pick), error: null }).then(res, rej)
      };
      return b;
    }
  })
}));

import { getMenteeSessionPageData } from "@/lib/mentee-interview";
import { formatDate, formatTime } from "@/lib/utils";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600_000).toISOString();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.rows = {
    mentee_interview_invites: { id: "inv-1", application_id: "app-1", checkin_token: "ck", booking_open_until: null },
    applications: {
      id: "app-1", status: "invited_to_interview", full_name: "Lan", role_applied: "mentee",
      source: "vam_os_form", season_id: "s12", raw_payload: {}
    },
    mentee_interview_bookings: null
  };
  mocks.lists = {
    interview_sessions: [
      { id: "ca-1", starts_at: inDays(2), ends_at: inDays(2.02), seat_limit: 10, venue: "Phòng B1", booking_closes_at: inDays(-0.1), status: "open" }
    ],
    mentee_interview_bookings: []
  };
});

it("không có hạn riêng: hạn chung đã qua thì không còn ca nào chọn được", async () => {
  const data = await getMenteeSessionPageData(TOKEN);
  expect(data).toMatchObject({ ok: true, state: "eligible", anyBookable: false });
});

it("có hạn riêng: ca mở lại, dòng hạn nói hạn MỚI của chính bạn đó", async () => {
  const until = inDays(1);
  mocks.rows.mentee_interview_invites.booking_open_until = until;
  const data = await getMenteeSessionPageData(TOKEN);
  expect(data).toMatchObject({ ok: true, state: "eligible", anyBookable: true });
  if (!data.ok || data.state !== "eligible") throw new Error("state");
  expect(data.deadlineLabel).toBe(`${formatTime(until)} ngày ${formatDate(until)}`);
  expect(data.days[0].sessions[0].state).toBe("open");
});
