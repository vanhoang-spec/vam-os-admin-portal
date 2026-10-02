/**
 * Gửi thư xác nhận lịch cho mentor (lib/mentor-interview-confirmation.ts).
 *
 * Thư tới hàng chục người thật một lúc nên khoá chính các lệnh GỬI, không chỉ
 * giá trị trả về: ai không qua cổng thì không một lần đọc sheet nào; không đọc
 * được quyền hay sổ thư thì không thư nào đi; người đã nhận thư đợt này không
 * nhận lại; hạn mức và Brevo 429 dừng vòng gửi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SEASON = "22222222-2222-4222-8222-222222222222";
const LINK = "https://docs.google.com/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk/edit?gid=77";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  canOperate: vi.fn(),
  send: vi.fn(),
  quota: vi.fn(),
  rpc: vi.fn(),
  authIndex: vi.fn(),
  recovery: vi.fn(),
  setupUrl: vi.fn(),
  grant: vi.fn(),
  pool: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  queries: [] as Array<{ table: string; filters: Array<[string, string, unknown]> }>
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.actor }));
vi.mock("@/lib/email-templates", () => ({ getMailSeason: async () => ({ ok: true, id: SEASON, code: "UEHM-S12" }) }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: async () => ({ scopeError: null }),
  canOperateSeason: mocks.canOperate
}));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: async () => "https://os.alumni-mentoring.edu.vn" }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: mocks.send, passwordSetupUrl: mocks.setupUrl }));
vi.mock("@/lib/enable-reviewer", () => ({
  loadAuthSignInIndex: mocks.authIndex,
  createRecoveryToken: mocks.recovery,
  enableMentorAsReviewer: mocks.grant
}));
vi.mock("@/lib/data", () => ({ getReviewerPool: mocks.pool }));
vi.mock("@/lib/mentee-invite-dispatch", () => ({ countSentInWindow: mocks.quota }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const q = { table, filters: [] as Array<[string, string, unknown]> };
      mocks.queries.push(q);
      const builder: any = {
        select: () => builder,
        eq: (col: string, v: unknown) => { q.filters.push(["eq", col, v]); return builder; },
        in: (col: string, v: unknown) => { q.filters.push(["in", col, v]); return builder; },
        then: (resolve: (v: unknown) => unknown) => resolve(mocks.tables[table] ?? { data: [], error: null })
      };
      return builder;
    }
  })
}));

import {
  grantInterviewAccessFromSheet,
  previewMentorConfirmations,
  sendMentorConfirmations,
  sendMentorConfirmationTest
} from "@/lib/mentor-interview-confirmation";
import { DAILY_EMAIL_LIMIT, DISPATCH_RESERVE } from "@/lib/mentee-invite-dispatch-core";

const q = (cells: string[]) => cells.map((c) => `"${c}"`).join(",");
const CSV = [
  q(["STT", "Họ và tên", "Email", "Số điện thoại", "Đợt 1 Sáng 4/10", "Chiều 4/10", "Sáng 3/10", "Chiều 3/10", "Note"]),
  q(["1", "Sẵn Sàng", "ready@example.test", "0901000001", "FALSE", "FALSE", "TRUE", "FALSE", ""]),
  q(["2", "Đã Nhận", "sent@example.test", "0901000002", "TRUE", "FALSE", "FALSE", "FALSE", ""]),
  q(["3", "Chưa Quyền", "noaccess@example.test", "0901000003", "TRUE", "TRUE", "FALSE", "FALSE", ""]),
  q(["4", "Thứ Hai", "ready2@example.test", "0901000004", "FALSE", "TRUE", "FALSE", "TRUE", ""]),
  q(["5", "Không Buổi", "none@example.test", "0901000005", "FALSE", "FALSE", "FALSE", "FALSE", ""])
].join("\n");

const SESSIONS = [
  { id: "anchor-s3", starts_at: "2026-10-03T01:00:00Z", ends_at: "2026-10-03T01:30:00Z", venue: "Phòng H101 — Cơ sở H. Bản đồ: https://maps.app.goo.gl/h" },
  { id: "c3", starts_at: "2026-10-03T06:30:00Z", ends_at: "2026-10-03T07:00:00Z", venue: "Phòng H001 — Cơ sở H" },
  { id: "s4", starts_at: "2026-10-04T01:00:00Z", ends_at: "2026-10-04T01:30:00Z", venue: "Phòng B1-503 — Cơ sở B" },
  { id: "c4", starts_at: "2026-10-04T06:30:00Z", ends_at: "2026-10-04T07:00:00Z", venue: "Phòng B1-802 — Cơ sở B" }
];

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T03:00:00Z"));
  vi.clearAllMocks();
  mocks.queries.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.actor.mockResolvedValue({ id: "admin-1", role: "admin", email: "Admin@Example.test" });
  mocks.canOperate.mockResolvedValue(true);
  mocks.quota.mockResolvedValue(10);
  mocks.send.mockResolvedValue({ ok: true, skipped: false });
  mocks.rpc.mockResolvedValue({
    data: [
      { email: "ready@example.test", full_name: "Sẵn Sàng" },
      { email: "sent@example.test", full_name: "Đã Nhận" },
      { email: "Ready2@example.test", full_name: "Thứ Hai" }
    ],
    error: null
  });
  // ready2 có tài khoản nhưng CHƯA từng đăng nhập → thư thật mang link đặt mật khẩu.
  mocks.authIndex.mockResolvedValue(new Map([
    ["ready@example.test", { id: "auth-ready", signedIn: true }],
    ["sent@example.test", { id: "auth-sent", signedIn: true }],
    ["ready2@example.test", { id: "auth-ready2", signedIn: false }]
  ]));
  mocks.recovery.mockResolvedValue("tok-ready2");
  mocks.setupUrl.mockImplementation(({ tokenHash }: { tokenHash: string }) => `https://os.alumni-mentoring.edu.vn/reset-password#token_hash=${tokenHash}&type=recovery`);
  mocks.grant.mockResolvedValue({ ok: true, message: "Đã cấp quyền Interviewer cho đúng mùa." });
  mocks.pool.mockResolvedValue({
    data: [
      { person_id: "p-noaccess", email_primary: "noaccess@example.test", full_name: "Chưa Quyền" },
      { person_id: "p-other", email_primary: "other@example.test", full_name: "Người Khác" }
    ],
    error: null
  });
  mocks.tables = {
    intake_batches: { data: [{ id: "batch-s12" }], error: null },
    interview_sessions: { data: SESSIONS, error: null },
    people: { data: [], error: null },
    outbound_emails: { data: [{ to_email: "sent@example.test" }], error: null }
  };
  // Mỗi lần gọi một Response mới: body chỉ đọc được một lần.
  fetchMock.mockImplementation(async () => new Response(CSV, { status: 200, headers: { "content-type": "text/csv; charset=utf-8" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("1. cổng — không qua thì không đọc gì, không gửi gì", () => {
  it.each(["core_team", "support_team", "reviewer"])("vai trò %s bị từ chối trước khi đọc sheet", async (role) => {
    mocks.actor.mockResolvedValue({ id: "x", role, email: "x@example.test" });
    expect((await previewMentorConfirmations(LINK)).ok).toBe(false);
    expect((await sendMentorConfirmations(LINK, "2")).sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("không vận hành mùa: từ chối", async () => {
    mocks.canOperate.mockResolvedValue(false);
    expect((await previewMentorConfirmations(LINK)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("link không phải Google Sheets: không gọi mạng", async () => {
    const res = await previewMentorConfirmations("https://evil.test/data.csv");
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("server chỉ gọi đúng địa chỉ xuất CSV tự dựng", async () => {
    await previewMentorConfirmations(LINK);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://docs.google.com/spreadsheets/d/1xei5xJX45v-5rn3-mHuEpG5nYzuk/gviz/tq?tqx=out:csv&gid=77");
  });
});

describe("2. đọc — hỏng chỗ nào thì dừng, không đoán", () => {
  it("sheet không công khai (Google trả trang HTML): báo lỗi chia sẻ", async () => {
    fetchMock.mockResolvedValue(new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const res = await previewMentorConfirmations(LINK);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toContain("Bất kỳ ai có đường liên kết");
  });
  it("không đọc được danh sách quyền phỏng vấn: không thư nào đi", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await previewMentorConfirmations(LINK)).ok).toBe(false);
    const res = await sendMentorConfirmations(LINK, "2");
    expect(res.sent).toBe(0);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("không đọc được sổ thư: không thư nào đi (đoán \"chưa ai nhận\" là gửi trùng)", async () => {
    mocks.tables.outbound_emails = { data: null, error: { message: "boom" } };
    const res = await sendMentorConfirmations(LINK, "2");
    expect(res.ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sổ thư đọc đúng loại thư và đúng mốc đợt (ca đầu tiên)", async () => {
    await previewMentorConfirmations(LINK);
    const ob = mocks.queries.find((x) => x.table === "outbound_emails")!;
    expect(ob.filters).toEqual(expect.arrayContaining([
      ["eq", "kind", "general_announcement"],
      ["eq", "related_table", "interview_sessions"],
      ["eq", "related_id", "anchor-s3"]
    ]));
  });
});

describe("3. xem trước", () => {
  it("phân loại đúng từng người; thư mẫu ưu tiên người cần link đặt mật khẩu (dạng thư cần soát kỹ nhất)", async () => {
    const res = await previewMentorConfirmations(LINK);
    if (!res.ok) throw new Error(res.message);
    const status = Object.fromEntries(res.plan.recipients.map((r) => [r.email, r.status]));
    expect(status).toEqual({
      "ready@example.test": "ready",
      "sent@example.test": "already_sent",
      "noaccess@example.test": "no_access",
      "ready2@example.test": "ready",
      "none@example.test": "no_blocks"
    });
    expect(res.sample?.to).toBe("ready2@example.test");
    expect(res.sample?.body).toContain("Kính gửi Anh/Chị Mentor Thứ Hai,");
  });
});

describe("4. gửi thật", () => {
  it("chỉ người sẵn sàng; đúng loại thư, đúng địa chỉ tài khoản, ghi sổ theo mốc đợt", async () => {
    const res = await sendMentorConfirmations(LINK, "2");
    expect(res).toMatchObject({ ok: true, sent: 2, failed: [], remaining: 0 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    const calls = mocks.send.mock.calls.map(([arg]) => arg);
    expect(calls.map((c) => c.toEmail)).toEqual(["ready@example.test", "ready2@example.test"]);
    for (const c of calls) {
      expect(c.kind).toBe("general_announcement");
      expect(c.relation).toEqual({ table: "interview_sessions", id: "anchor-s3" });
      expect(c.subject).toBe("UEH MENTORING | THƯ XÁC NHẬN ĐĂNG KÝ LỊCH PHỎNG VẤN MENTEE MÙA 12");
    }
    // Thư của người thứ hai chỉ kể buổi của chính người đó.
    expect(calls[1].body).toContain("Thứ Bảy 03/10/2026 — buổi chiều");
    expect(calls[1].body).toContain("Chủ nhật 04/10/2026 — buổi chiều");
    expect(calls[1].body).not.toContain("buổi sáng");
  });
  it("gõ sai số người: không thư nào đi", async () => {
    const res = await sendMentorConfirmations(LINK, "3");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("2");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("chạm hạn mức hoặc không đếm được thư đã gửi: không thư nào đi", async () => {
    mocks.quota.mockResolvedValue(DAILY_EMAIL_LIMIT - DISPATCH_RESERVE);
    expect((await sendMentorConfirmations(LINK, "2")).sent).toBe(0);
    mocks.quota.mockResolvedValue(null);
    expect((await sendMentorConfirmations(LINK, "2")).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("hạn mức chỉ còn 1: gửi đúng 1, báo còn lại", async () => {
    mocks.quota.mockResolvedValue(DAILY_EMAIL_LIMIT - DISPATCH_RESERVE - 1);
    const res = await sendMentorConfirmations(LINK, "2");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(res.remaining).toBe(1);
  });
  it("Brevo báo 429: dừng ngay sau thư lỗi", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false, skipped: false, providerStatus: 429 });
    const res = await sendMentorConfirmations(LINK, "2");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(res.failed).toEqual(["ready@example.test"]);
  });
  it("môi trường tắt gửi thư: dừng, không báo là đã gửi", async () => {
    mocks.send.mockResolvedValue({ ok: false, skipped: true });
    const res = await sendMentorConfirmations(LINK, "2");
    expect(res.ok).toBe(false);
    expect(res.sent).toBe(0);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});

describe("5. bản thử", () => {
  it("đi tới chính người bấm, tiêu đề [THỬ], không ghi theo mốc đợt (không tính là đã gửi)", async () => {
    const res = await sendMentorConfirmationTest(LINK);
    expect(res.ok).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [arg] = mocks.send.mock.calls[0];
    expect(arg.toEmail).toBe("admin@example.test");
    expect(arg.subject.startsWith("[THỬ] ")).toBe(true);
    expect(arg.relation).toBeUndefined();
  });
});

describe("6. link đặt mật khẩu — chỉ trong thư THẬT gửi chính mentor", () => {
  it("người chưa từng đăng nhập: thư thật có link của đúng tài khoản đó; người đã đăng nhập: không có dòng link", async () => {
    await sendMentorConfirmations(LINK, "2");
    expect(mocks.recovery).toHaveBeenCalledTimes(1);
    expect(mocks.recovery).toHaveBeenCalledWith(expect.anything(), "ready2@example.test", "auth-ready2");
    const bodies = Object.fromEntries(mocks.send.mock.calls.map(([a]) => [a.toEmail, a.body]));
    expect(bodies["ready2@example.test"]).toContain("- Đặt mật khẩu lần đầu: https://os.alumni-mentoring.edu.vn/reset-password#token_hash=tok-ready2&type=recovery");
    expect(bodies["ready@example.test"]).not.toContain("Đặt mật khẩu lần đầu");
  });
  it("xem trước và bản thử: chữ giữ chỗ, KHÔNG tạo link thật (bản thử đi tới hộp thư người bấm)", async () => {
    const preview = await previewMentorConfirmations(LINK);
    expect(preview.ok && preview.sample?.to).toBe("ready2@example.test");
    expect(preview.ok && preview.sample?.body).toContain("[link đặt mật khẩu riêng của mentor — chỉ có trong thư gửi thật]");
    await sendMentorConfirmationTest(LINK);
    expect(mocks.send.mock.calls[0][0].toEmail).toBe("admin@example.test");
    expect(mocks.send.mock.calls[0][0].body).not.toContain("token_hash");
    expect(mocks.recovery).not.toHaveBeenCalled();
  });
  it("không tạo được link: vẫn gửi (thư đã hướng dẫn Đặt lại mật khẩu) và báo lại", async () => {
    mocks.recovery.mockResolvedValue(null);
    const res = await sendMentorConfirmations(LINK, "2");
    expect(res.sent).toBe(2);
    expect(res.message).toContain("không kèm được link");
  });
  it("không đọc được danh bạ đăng nhập: dừng, không thư nào đi", async () => {
    mocks.authIndex.mockRejectedValue(new Error("auth down"));
    const res = await sendMentorConfirmations(LINK, "2");
    expect(res.ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("7. cấp quyền từ sheet — không gửi thư riêng, chỉ mentor của đợt tuyển", () => {
  it("chỉ người chưa có quyền VÀ là mentor của đợt; notify:false; đúng mùa, đúng vai trò", async () => {
    const res = await grantInterviewAccessFromSheet(LINK);
    expect(mocks.grant).toHaveBeenCalledTimes(1);
    expect(mocks.grant).toHaveBeenCalledWith({ personId: "p-noaccess", seasonId: SEASON, participationRole: "interviewer", notify: false });
    expect(mocks.pool).toHaveBeenCalledWith({ intakeBatchId: "batch-s12" });
    expect(res.granted).toEqual(["noaccess@example.test"]);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("không phải mentor của đợt: không cấp, báo tên", async () => {
    mocks.pool.mockResolvedValue({ data: [{ person_id: "p-other", email_primary: "other@example.test", full_name: "Người Khác" }], error: null });
    const res = await grantInterviewAccessFromSheet(LINK);
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(res.notMentor).toEqual(["Chưa Quyền <noaccess@example.test>"]);
  });
  it("không đọc được danh sách mentor của đợt: không cấp ai", async () => {
    mocks.pool.mockResolvedValue({ data: [], error: "boom" });
    expect((await grantInterviewAccessFromSheet(LINK)).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("vai trò không phải quản trị viên: không đọc sheet, không cấp", async () => {
    mocks.actor.mockResolvedValue({ id: "x", role: "core_team", email: "x@example.test" });
    expect((await grantInterviewAccessFromSheet(LINK)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.grant).not.toHaveBeenCalled();
  });
});
