/**
 * Máy chủ của màn hình phỏng vấn mentee bản gọn (sự cố 11/10/2026).
 *
 * Soi chính các lệnh đọc mà máy chủ phát ra: màn hình phỏng vấn chỉ xin ứng viên của
 * ĐÚNG đợt sẽ hiện, trang Tiến độ xin bản không nhật ký, và hồ sơ chi tiết chỉ đi qua
 * hàm có cổng quyền.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Reply = { data: unknown; error: { message: string } | null };
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: { id: "admin-1" } as { id?: string } | null,
  tables: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  reads: [] as Array<{ table: string; columns: string; filters: Array<[string, unknown]>; end: string }>,
  staffReads: [] as string[][]
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.actor }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const read = { table, columns: "", filters: [] as Array<[string, unknown]>, end: "list" };
      const reply = (): Reply => mocks.tables[table] ?? { data: null, error: { message: `chưa khai bảng ${table}` } };
      const done = (end: string) => { read.end = end; mocks.reads.push(read); return Promise.resolve(reply()); };
      const b: any = {
        select: (columns: string) => { read.columns = columns; return b; },
        eq: (column: string, value: unknown) => { read.filters.push([column, value]); return b; },
        single: () => done("single"),
        maybeSingle: () => done("maybeSingle"),
        then: (resolve: (r: Reply) => unknown, reject: (e: unknown) => unknown) => done("list").then(resolve, reject)
      };
      return b;
    }
  })
}));
vi.mock("@/lib/paged-read", () => ({
  readAllPagesIn: async (_c: unknown, table: string, _col: string, idList: string[]) => {
    if (table === "admin_users") mocks.staffReads.push(idList);
    return { data: [{ id: "sup-2", full_name: "Support Hai", email: "s2@example.test" }], error: null };
  }
}));

import { getOfflineCandidateDetail, getOfflineDashboard } from "@/lib/mentee-offline";
import { detailCacheKey, takesElsewhere, type OfflineCandidate } from "@/lib/mentee-offline-core";
import { interviewWaves, resolveOfflineWave } from "@/lib/mentee-interview-waves";

const APP = "11111111-1111-4111-8111-111111111111";
// Đợt 1: 03–04/10 (s1, s2). Đợt 2: 10–11/10 (s3, s4). Giờ lưu là UTC; 01:00Z = 08:00 Việt Nam.
const SESSIONS = [
  { id: "s1", starts_at: "2026-10-03T01:00:00Z" },
  { id: "s2", starts_at: "2026-10-04T01:00:00Z" },
  { id: "s3", starts_at: "2026-10-10T01:00:00Z" },
  { id: "s4", starts_at: "2026-10-11T01:00:00Z" }
];
const BOARD = () => ({
  canOperate: true, sessions: SESSIONS, participants: [], logs: [{ id: "log-1" }],
  candidates: [
    { id: "a", name: "A", phone: null, email: null, status: "interview_scheduled", sessionId: "s3", bookedAt: "2026-10-06T00:00:00Z", takeSubmitted: false,
      operation: { checked_in_at: "2026-10-10T01:00:00Z", checked_in_by: "sup-2", room: null, desk: null, interviewer_id: null, review_id: null, outcome: null, match_id: null, revision: 1, is_online: false, online_note: null } },
    { id: "b", name: "B", phone: null, email: null, status: "interview_scheduled", sessionId: "s4", bookedAt: "2026-10-06T00:01:00Z", takeSubmitted: true, operation: null }
  ]
});
const call = (fn: string) => mocks.rpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1]);
const readsOf = (table: string) => mocks.reads.filter((r) => r.table === table);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T07:00:00Z")); // 14:00 ngày 11/10, giờ Việt Nam
  mocks.actor = { id: "admin-1" };
  mocks.reads = [];
  mocks.staffReads = [];
  mocks.tables = {
    seasons: { data: { id: "season-12" }, error: null },
    interview_sessions: { data: SESSIONS, error: null },
    mentee_interview_bookings: { data: { session_id: "s1" }, error: null }
  };
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (fn: string) =>
    fn === "vam118_offline_board" ? { data: BOARD(), error: null }
    : fn === "vam106_interview_guide" ? { data: { rubric: { id: "rubric-1" } }, error: null }
    : { data: null, error: { message: `không mong gọi ${fn}` } });
});
afterEach(() => { vi.useRealTimers(); });

describe("màn hình phỏng vấn: chỉ xin ứng viên của đợt sẽ hiện", () => {
  it("không chỉ định gì: đợt đang diễn ra (10–11/10), kèm nhật ký và phiếu chấm của mùa", async () => {
    const r = await getOfflineDashboard({ kind: "interview" });
    if (!r.ok) throw new Error(r.message);
    expect(call("vam118_offline_board")).toEqual([{ p_actor: "admin-1", p_season: "season-12", p_sessions: ["s3", "s4"], p_with_logs: true }]);
    expect(call("vam106_interview_guide")).toEqual([{ p_actor: "admin-1", p_season: "season-12", p_include_handbook: false }]);
    // Hàm cũ (11 MB) không còn được gọi từ màn hình này.
    expect(call("vam104_offline_dashboard")).toEqual([]);
    expect(readsOf("interview_sessions")).toEqual([{ table: "interview_sessions", columns: "id,starts_at", filters: [["season_id", "season-12"]], end: "list" }]);
    // Không có ?application= thì không tra ca của hồ sơ nào.
    expect(readsOf("mentee_interview_bookings")).toEqual([]);
    expect(r.data.rubric).toEqual({ id: "rubric-1" });
    expect(r.data.actorId).toBe("admin-1");
    expect(r.data.seasonId).toBe("season-12");
    expect(r.data.logs).toEqual([{ id: "log-1" }]);
  });

  it("giữa hai đợt: đợt sắp tới; mọi đợt đã qua: đợt cuối", async () => {
    vi.setSystemTime(new Date("2026-10-06T03:00:00Z"));
    await getOfflineDashboard({ kind: "interview" });
    vi.setSystemTime(new Date("2026-10-02T03:00:00Z"));
    await getOfflineDashboard({ kind: "interview" });
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    await getOfflineDashboard({ kind: "interview" });
    expect(call("vam118_offline_board").map((c) => c.p_sessions)).toEqual([["s3", "s4"], ["s1", "s2"], ["s3", "s4"]]);
  });

  it("“hôm nay” tính theo giờ Việt Nam: 18:00 UTC ngày 04/10 đã là 05/10 — đợt 1 đã qua", async () => {
    vi.setSystemTime(new Date("2026-10-04T16:59:00Z")); // 23:59 ngày 04/10
    await getOfflineDashboard({ kind: "interview" });
    vi.setSystemTime(new Date("2026-10-04T18:00:00Z")); // 01:00 ngày 05/10
    await getOfflineDashboard({ kind: "interview" });
    expect(call("vam118_offline_board").map((c) => c.p_sessions)).toEqual([["s1", "s2"], ["s3", "s4"]]);
  });

  it("?dot= chọn đợt, và thắng cả hồ sơ đang mở — khi đó không cần tra ca của hồ sơ", async () => {
    await getOfflineDashboard({ kind: "interview", dot: "2026-10-03", application: APP });
    expect(call("vam118_offline_board")[0].p_sessions).toEqual(["s1", "s2"]);
    expect(readsOf("mentee_interview_bookings")).toEqual([]);
  });

  it("?application= mở đợt của hồ sơ đó: tra đúng ca đang giữ trong mùa", async () => {
    await getOfflineDashboard({ kind: "interview", application: APP });
    expect(readsOf("mentee_interview_bookings")).toEqual([{
      table: "mentee_interview_bookings", columns: "session_id", end: "maybeSingle",
      filters: [["season_id", "season-12"], ["application_id", APP], ["status", "booked"]]
    }]);
    // Hồ sơ giữ ca s1 (đợt 1) dù hôm nay đang là đợt 2.
    expect(call("vam118_offline_board")[0].p_sessions).toEqual(["s1", "s2"]);
  });

  it("?application= không phải UUID (ai cũng gõ được đường dẫn): không đem đi hỏi database, mở đợt hiện tại", async () => {
    for (const application of ["guide", "", "1 or 1=1", `${APP}x`]) {
      await getOfflineDashboard({ kind: "interview", application });
    }
    expect(readsOf("mentee_interview_bookings")).toEqual([]);
    expect(call("vam118_offline_board").map((c) => c.p_sessions)).toEqual([["s3", "s4"], ["s3", "s4"], ["s3", "s4"], ["s3", "s4"]]);
  });

  it("không tra được ca của hồ sơ, hoặc hồ sơ không còn giữ ca: vẫn mở đợt hiện tại", async () => {
    mocks.tables.mentee_interview_bookings = { data: { session_id: "s1" }, error: { message: "timeout" } };
    await getOfflineDashboard({ kind: "interview", application: APP });
    mocks.tables.mentee_interview_bookings = { data: null, error: null };
    await getOfflineDashboard({ kind: "interview", application: APP });
    expect(call("vam118_offline_board").map((c) => c.p_sessions)).toEqual([["s3", "s4"], ["s3", "s4"]]);
  });

  it("không đọc được lịch ca: báo lỗi, KHÔNG tải danh sách (tải nhầm đợt là màn hình rỗng giữa buổi)", async () => {
    mocks.tables.interview_sessions = { data: null, error: { message: "timeout" } };
    const r = await getOfflineDashboard({ kind: "interview" });
    expect(r.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("mùa chưa có ca nào: không lọc (p_sessions null), màn hình vẫn mở", async () => {
    mocks.tables.interview_sessions = { data: [], error: null };
    const r = await getOfflineDashboard({ kind: "interview" });
    expect(r.ok).toBe(true);
    expect(call("vam118_offline_board")[0].p_sessions).toBeNull();
  });
});

describe("trang Tiến độ: bản gọn nhất", () => {
  it("mọi ca, không nhật ký, không đọc phiếu chấm, không đọc lịch ca riêng", async () => {
    const r = await getOfflineDashboard({ kind: "progress" });
    if (!r.ok) throw new Error(r.message);
    expect(call("vam118_offline_board")).toEqual([{ p_actor: "admin-1", p_season: "season-12", p_sessions: null, p_with_logs: false }]);
    expect(call("vam106_interview_guide")).toEqual([]);
    expect(readsOf("interview_sessions")).toEqual([]);
    expect(readsOf("mentee_interview_bookings")).toEqual([]);
    expect(r.data.rubric).toBeNull();
    expect(r.data.candidates.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("ứng viên của danh sách gọn", () => {
  it("không có `answers` (dấu hiệu hồ sơ chi tiết chưa tải), phiếu rỗng, giữ takeSubmitted, gắn tên người check-in", async () => {
    const r = await getOfflineDashboard({ kind: "interview" });
    if (!r.ok) throw new Error(r.message);
    const [a, b] = r.data.candidates;
    expect("answers" in a).toBe(false);
    expect(a.answers).toBeUndefined();
    expect(a.reviews).toEqual([]);
    expect(b.reviews).toEqual([]);
    expect([a.takeSubmitted, b.takeSubmitted]).toEqual([false, true]);
    expect(mocks.staffReads).toEqual([["sup-2"]]);
    expect(a.operation?.checked_in_by_name).toBe("Support Hai");
    expect(b.operation).toBeNull();
  });
});

describe("cổng — fail-closed", () => {
  it("chưa đăng nhập: không đọc gì cả", async () => {
    mocks.actor = null;
    expect((await getOfflineDashboard({ kind: "interview" })).ok).toBe(false);
    expect((await getOfflineCandidateDetail(APP)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reads).toEqual([]);
  });

  it("database từ chối (ACCESS_DENIED) hoặc lỗi: trả lỗi, không trả dữ liệu", async () => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "vam118_offline_board" ? { data: null, error: { message: "ACCESS_DENIED" } } : { data: { rubric: null }, error: null });
    const denied = await getOfflineDashboard({ kind: "interview" });
    expect(denied).toEqual({ ok: false, message: "Bạn chưa được cấp quyền phỏng vấn trong mùa này." });
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "vam118_offline_board" ? { data: BOARD(), error: null } : { data: null, error: { message: "RUBRIC_MISSING" } });
    expect((await getOfflineDashboard({ kind: "interview" })).ok).toBe(false);
  });
});

describe("hồ sơ chi tiết của một bạn", () => {
  const REVIEW = { id: "rv-1", review_round: "profile_screening", reviewerName: "Chấm Một", status: "submitted", reviewer_note: "Hồ sơ rõ" };
  beforeEach(() => {
    mocks.rpc.mockImplementation(async (fn: string) =>
      fn === "vam118_offline_candidate_detail"
        ? { data: { id: APP, rawPayload: { year_of_study: "Năm 3", mentoring_goals_text: "Tìm hướng nghề" }, reviews: [REVIEW] }, error: null }
        : { data: null, error: { message: `không mong gọi ${fn}` } });
  });

  it("gọi đúng hàm có cổng quyền, cho đúng hồ sơ và mùa; trả câu trả lời đã gắn nhãn + phiếu đầy đủ", async () => {
    const r = await getOfflineCandidateDetail(APP);
    if (!r.ok) throw new Error(r.message);
    expect(mocks.rpc.mock.calls).toEqual([["vam118_offline_candidate_detail", { p_actor: "admin-1", p_season: "season-12", p_application: APP }]]);
    expect(r.detail.reviews).toEqual([REVIEW]);
    const values = r.detail.answers.map(([, value]) => value);
    // Thứ tự do flattenRawPayload quyết định (theo tên khoá) — cùng hàm với màn hình cũ.
    expect(values).toEqual(["Tìm hướng nghề", "Năm 3"]);
    // Nhãn là chữ cho người đọc, không phải tên cột.
    for (const [label] of r.detail.answers) expect(label).not.toMatch(/_/);
  });

  it("đơn trống hoặc chưa có phiếu: mảng rỗng, không vỡ", async () => {
    mocks.rpc.mockResolvedValue({ data: { id: APP, rawPayload: null, reviews: null }, error: null });
    expect(await getOfflineCandidateDetail(APP)).toEqual({ ok: true, detail: { answers: [], reviews: [] } });
  });

  it("mã hồ sơ không phải UUID: không hỏi database", async () => {
    for (const id of ["guide", "", "../x", `${APP} `]) expect((await getOfflineCandidateDetail(id)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reads).toEqual([]);
  });

  it("lỗi nói đúng việc: bị chặn quyền, không còn ca, và lỗi đọc (không phải “Chưa lưu được”)", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ACCESS_DENIED" } });
    expect(await getOfflineCandidateDetail(APP)).toEqual({ ok: false, message: "Bạn chưa được cấp quyền phỏng vấn trong mùa này." });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "NO_BOOKING" } });
    expect(await getOfflineCandidateDetail(APP)).toEqual({ ok: false, message: "Bạn này chưa có ca phỏng vấn đang hiệu lực." });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "canceling statement due to statement timeout" } });
    const failed = await getOfflineCandidateDetail(APP);
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.message).toContain("Chưa tải được hồ sơ");
      expect(failed.message).not.toContain("Chưa lưu được");
    }
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await getOfflineCandidateDetail(APP)).ok).toBe(false);
  });
});

describe("phần thuần", () => {
  const op = (over: Partial<NonNullable<OfflineCandidate["operation"]>> = {}): NonNullable<OfflineCandidate["operation"]> => ({
    checked_in_at: "2026-10-11T01:00:00Z", room: 1, desk: 1, interviewer_id: "me", review_id: "rv", outcome: null, match_id: null,
    revision: 4, is_online: false, online_note: null, ...over
  });
  const cand = (id: string, over: Partial<OfflineCandidate> = {}): OfflineCandidate => ({
    id, name: id, phone: null, email: null, status: "interview_in_progress", sessionId: "s", bookedAt: "", reviews: [], operation: op(), ...over
  });
  const submittedTake = { id: "rv", review_round: "interview", reviewerName: "Me", status: "submitted", take_choice: "take" } as OfflineCandidate["reviews"][number];

  it("takesElsewhere: đếm hồ sơ KHÁC của chính người phỏng vấn này đã nộp “Có – Tôi muốn nhận”", () => {
    const list = [
      cand("self", { takeSubmitted: true }),
      cand("mine-take", { takeSubmitted: true }),
      cand("mine-no", { takeSubmitted: false }),
      cand("other-take", { takeSubmitted: true, operation: op({ interviewer_id: "someone-else" }) }),
      cand("unassigned", { takeSubmitted: true, operation: null })
    ];
    expect(takesElsewhere(list, "self", "me")).toBe(1);
    expect(takesElsewhere(list, "mine-no", "me")).toBe(2);
    expect(takesElsewhere(list, "self", "someone-else")).toBe(1);
  });

  it("takesElsewhere: dữ liệu còn kèm phiếu đầy đủ (không có takeSubmitted) thì đọc từ phiếu của lượt, đã nộp", () => {
    const list = [
      cand("self"),
      cand("take", { reviews: [submittedTake] }),
      cand("draft", { reviews: [{ ...submittedTake, status: "assigned" }] }),
      cand("old-review", { reviews: [{ ...submittedTake, id: "another-review" }] }),
      cand("other-choice", { reviews: [{ ...submittedTake, take_choice: "recommend_other" }] }),
      // takeSubmitted có mặt thì nó quyết định, kể cả khi là false.
      cand("flag-wins", { takeSubmitted: false, reviews: [submittedTake] })
    ];
    expect(takesElsewhere(list, "self", "me")).toBe(1);
  });

  it("detailCacheKey: chưa có kết quả thì check-in / phân bàn không đổi khoá; đã có kết quả thì mỗi lần lưu một khoá", () => {
    expect(detailCacheKey(cand("x", { operation: null }))).toBe("x:pending");
    expect(detailCacheKey(cand("x", { operation: op({ revision: 1 }) }))).toBe("x:pending");
    expect(detailCacheKey(cand("x", { operation: op({ revision: 2 }) }))).toBe("x:pending");
    expect(detailCacheKey(cand("x", { operation: op({ revision: 3, outcome: "passed" }) }))).toBe("x:3");
    expect(detailCacheKey(cand("x", { operation: op({ revision: 4, outcome: "passed" }) }))).toBe("x:4");
    expect(detailCacheKey(cand("y", { operation: op({ revision: 4, outcome: "rejected" }) }))).toBe("y:4");
  });

  it("resolveOfflineWave: ?dot= thắng, rồi tới đợt của hồ sơ đang mở, rồi đợt hiện tại", () => {
    const waves = interviewWaves(SESSIONS);
    const key = (pick: Parameters<typeof resolveOfflineWave>[1]) => resolveOfflineWave(waves, pick)?.key ?? null;
    expect(key({ todayKey: "2026-10-11" })).toBe("2026-10-10");
    expect(key({ todayKey: "2026-10-11", linkedSessionId: "s2" })).toBe("2026-10-03");
    expect(key({ todayKey: "2026-10-11", linkedSessionId: "s2", dot: "2026-10-10" })).toBe("2026-10-10");
    expect(key({ todayKey: "2026-10-11", dot: " 2026-10-03 " })).toBe("2026-10-03");
    // ?dot= lạ: không rơi về đợt của hồ sơ — người dùng đã chủ động chọn đợt — mà về đợt hiện tại.
    expect(key({ todayKey: "2026-10-11", linkedSessionId: "s2", dot: "khong-co" })).toBe("2026-10-10");
    expect(key({ todayKey: "2026-10-11", linkedSessionId: "ca-la" })).toBe("2026-10-10");
    expect(resolveOfflineWave([], { todayKey: "2026-10-11" })).toBeNull();
  });
});
