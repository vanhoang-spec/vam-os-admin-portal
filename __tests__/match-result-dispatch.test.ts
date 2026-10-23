/**
 * Gửi thư kết quả ghép cặp — chạy trên bản giả PostgREST, chỉ hàm gửi thư và danh tính được giả.
 *
 * Điều phải đúng: mentor và các mentee của họ đi cùng một lần bấm, không bao giờ cắt đôi; khoá gửi khi
 * thiếu điều kiện (fail-closed); hai lần bấm cùng lúc không gửi trùng; mã gốc của link không bao giờ
 * nằm trong database, chỉ hash; link trong thư mở được ngay; bị 429 thì dừng; người đã có thư trong sổ
 * thư thì chỉ chốt, không gửi lại (gửi lại là làm chết link của thư trước).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

const mocks = vi.hoisted(() => ({ mentee: vi.fn(), mentor: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.alumni-mentoring.edu.vn") }));
vi.mock("@/lib/email", () => ({ sendMatchResultMentee: mocks.mentee, sendMatchResultMentor: mocks.mentor }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { resendMatchResultAction, sendMatchResultAction, sendMatchResultBatchAction } from "@/app/actions/match-result";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";
import { hashBearerToken } from "@/lib/bearer-token";
import { getMatchProfilePage } from "@/lib/match-profile";
import { resendMatchResultNotice, runMatchResultDispatch, sendMatchResultGroupTest, sendMatchResultTest } from "@/lib/match-result-dispatch";
import { HANDBOOKS } from "@/lib/handbook";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const MT_A = "a0000000-0000-4000-8000-00000000000a";
const MT_B = "a0000000-0000-4000-8000-00000000000b";
const ME_1 = "e0000000-0000-4000-8000-000000000001";
const ME_2 = "e0000000-0000-4000-8000-000000000002";
const ME_3 = "e0000000-0000-4000-8000-000000000003";
const OLD = "2026-10-20T00:00:00Z";
const REAL_READY = { mentee: HANDBOOKS.mentee.ready, mentor: HANDBOOKS.mentor.ready };

const db = createFakeDb();
let client: ReturnType<typeof fakeClient>;

function seed() {
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: PROGRAM }];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM", name: "UEH Mentoring" }];
  db.tables.admin_scope_access = [{ id: "g1", user_id: "auth-core", program_id: null, season_id: SEASON, role: "operations", status: "active" }];
  db.tables.people = [
    { id: MT_A, full_name: "Anh Mentor A", email_primary: "a@example.test", phone_primary: "0900 000 001" },
    { id: MT_B, full_name: "Bình Mentor B", email_primary: "b@example.test" },
    { id: ME_1, full_name: "Mentee Một", email_primary: "m1@example.test" },
    { id: ME_2, full_name: "Mentee Hai", email_primary: "m2@example.test" },
    { id: ME_3, full_name: "Mentee Ba", email_primary: "m3@example.test" }
  ];
  db.tables.applications = [];
  db.tables.matches = [
    { id: "m1", season_id: SEASON, status: "active", mentor_person_id: MT_A, mentee_person_id: ME_1, matching_round: 1, created_at: OLD },
    { id: "m2", season_id: SEASON, status: "active", mentor_person_id: MT_A, mentee_person_id: ME_2, matching_round: 3, created_at: OLD },
    { id: "m3", season_id: SEASON, status: "active", mentor_person_id: MT_B, mentee_person_id: ME_3, matching_round: 2, created_at: OLD }
  ];
  db.tables.person_season_memberships = [];
  db.tables.match_result_notices = [];
  db.tables.match_result_holds = [];
  db.tables.match_profile_links = [];
  db.tables.match_result_settings = [
    { season_id: SEASON, kickoff_register_url: null, holds_confirmed_at: "2026-10-22T09:00:00Z" }
  ];
  db.tables.outbound_emails = [];
  db.tables.matching_industry_assignments = [];
  db.tables.mentor_profiles = [];
  db.tables.mentee_profiles = [];
  db.tables.application_reviews = [];
}

afterEach(() => {
  HANDBOOKS.mentee.ready = REAL_READY.mentee;
  HANDBOOKS.mentor.ready = REAL_READY.mentor;
});

const sentTo = () => [
  ...mocks.mentor.mock.calls.map((c) => `mentor:${c[0].toEmail}`),
  ...mocks.mentee.mock.calls.map((c) => `mentee:${c[0].toEmail}`)
].sort();
const notice = (personId: string, role: string) => db.tables.match_result_notices.find((n: any) => n.person_id === personId && n.role === role);
const tokensSent = () => [
  ...mocks.mentor.mock.calls.flatMap((c) => c[0].mentees.map((m: any) => m.token)),
  ...mocks.mentee.mock.calls.map((c) => c[0].mentorToken)
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Giả lập Handbook đã có file trên VAM OS; ca "chưa có file" tự tắt.
  HANDBOOKS.mentee.ready = true;
  HANDBOOKS.mentor.ready = true;
  db.reset();
  seed();
  client = fakeClient(db);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "admin-auth-core", role: "core_team", status: "active", auth_user_id: "auth-core", email: "btc@example.test", full_name: "Người BTC"
  } as any);
  mocks.mentee.mockResolvedValue({ ok: true, skipped: false });
  mocks.mentor.mockResolvedValue({ ok: true, skipped: false });
});

describe("1. khoá gửi (fail-closed)", () => {
  it("không có quyền vận hành mùa: không gửi, không ghi", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "x", role: "core_team", status: "active", auth_user_id: "auth-khac", email: "x@example.test" } as any);
    const r = await runMatchResultDispatch();
    expect(r.ok).toBe(false);
    expect(sentTo()).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it.each([
    ["chưa có file Handbook mentee trên VAM OS", () => (HANDBOOKS.mentee.ready = false), "Handbook mentee"],
    ["danh sách giữ lại chưa xác nhận", () => (db.tables.match_result_settings[0].holds_confirmed_at = null), "chưa được xác nhận"],
    ["chưa có dòng cài đặt", () => (db.tables.match_result_settings = []), "chưa được xác nhận"],
    ["đọc danh sách giữ lại lỗi", () => (db.errors.match_result_holds = { message: "down" }), "danh sách mentor giữ lại"],
    ["đọc cài đặt lỗi", () => (db.errors.match_result_settings = { message: "down" }), "cài đặt thư"]
  ])("%s: không gửi, không ghi", async (_label, breakIt, reason) => {
    breakIt();
    const r = await runMatchResultDispatch();
    expect(r.ok).toBe(false);
    expect(r.message).toContain(reason);
    expect(sentTo()).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("không đếm được thư 24 giờ: không gửi", async () => {
    db.errors.outbound_emails = { message: "down" };
    const r = await runMatchResultDispatch();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Không đếm được số thư");
    expect(sentTo()).toEqual([]);
    // Dừng TRƯỚC khi chiếm chỗ ai — không dựa vào lớp kiểm sổ thư phía sau.
    expect(db.writes).toEqual([]);
  });
});

describe("2. gửi theo nhóm mentor", () => {
  it("đủ hạn mức: mọi nhóm đi, mỗi người đúng một thư, mentor mang đủ link mentee", async () => {
    const r = await runMatchResultDispatch();
    expect(r.ok).toBe(true);
    expect(sentTo()).toEqual([
      "mentee:m1@example.test", "mentee:m2@example.test", "mentee:m3@example.test", "mentor:a@example.test", "mentor:b@example.test"
    ]);
    const a = mocks.mentor.mock.calls.find((c) => c[0].toEmail === "a@example.test")![0];
    expect(a.mentees.map((m: any) => m.name)).toEqual(["Mentee Hai", "Mentee Một"]);
  });

  it("chốt từng người: sent_at, đúng các cặp trong thư, nhả chỗ", async () => {
    await runMatchResultDispatch();
    expect(notice(MT_A, "mentor")).toMatchObject({ claimed_at: null, last_error: null, send_count: 1 });
    expect(notice(MT_A, "mentor").sent_at).toBeTruthy();
    expect([...notice(MT_A, "mentor").match_ids].sort()).toEqual(["m1", "m2"]);
    expect(notice(ME_3, "mentee").match_ids).toEqual(["m3"]);
  });

  it("hạn mức chỉ còn 3 thư: nhóm A (3 người) đi trọn, nhóm B chờ — không cắt đôi nhóm nào", async () => {
    db.tables.outbound_emails = Array.from({ length: 917 }, (_, i) => ({ id: `o${i}`, status: "sent", created_at: new Date().toISOString() }));
    const r = await runMatchResultDispatch();
    expect(sentTo()).toEqual(["mentee:m1@example.test", "mentee:m2@example.test", "mentor:a@example.test"]);
    expect(r.message).toContain("Còn 2 người chờ thư");
  });

  it("hạn mức chỉ còn 2 thư: nhóm A không vừa thì bỏ qua, nhóm B (2 người) đi", async () => {
    db.tables.outbound_emails = Array.from({ length: 918 }, (_, i) => ({ id: `o${i}`, status: "sent", created_at: new Date().toISOString() }));
    await runMatchResultDispatch();
    expect(sentTo()).toEqual(["mentee:m3@example.test", "mentor:b@example.test"]);
  });

  it("nhóm có cặp mới chưa đủ 30 phút: cả nhóm chờ, nhóm khác vẫn đi", async () => {
    db.tables.matches[1].created_at = new Date(Date.now() - 5 * 60_000).toISOString();
    await runMatchResultDispatch();
    expect(sentTo()).toEqual(["mentee:m3@example.test", "mentor:b@example.test"]);
  });

  it("mentor bị giữ: mentor và mentee của họ không nhận thư", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: null }];
    await runMatchResultDispatch();
    expect(sentTo()).toEqual(["mentee:m3@example.test", "mentor:b@example.test"]);
  });

  it("hết 45 giây sau nhóm đầu: nhóm sau được nhả chỗ, không gửi dở", async () => {
    let t = Date.parse("2026-10-22T10:00:00Z");
    const now = () => t;
    mocks.mentee.mockImplementation(async () => {
      t += 30_000;
      return { ok: true, skipped: false };
    });
    await runMatchResultDispatch({ now });
    expect(sentTo()).toEqual(["mentee:m1@example.test", "mentee:m2@example.test", "mentor:a@example.test"]);
    expect(notice(ME_3, "mentee").claimed_at).toBeNull();
    expect(notice(ME_3, "mentee").sent_at).toBeFalsy();
  });
});

describe("3. link hồ sơ", () => {
  it("chỉ hash nằm trong database — mã gốc không ở đâu trong mọi bảng", async () => {
    await runMatchResultDispatch();
    const tokens = tokensSent();
    expect(tokens).toHaveLength(6);
    const dump = JSON.stringify(db.tables);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(dump).not.toContain(t);
    }
    expect(db.tables.match_profile_links).toHaveLength(6);
    for (const l of db.tables.match_profile_links) expect(l.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mỗi mã trong thư khớp đúng dòng link của đúng chiều đúng cặp", async () => {
    await runMatchResultDispatch();
    const meCall = mocks.mentee.mock.calls.find((c) => c[0].toEmail === "m1@example.test")![0];
    const row = db.tables.match_profile_links.find((l: any) => l.token_hash === hashBearerToken(meCall.mentorToken));
    expect(row).toMatchObject({ match_id: "m1", subject_role: "mentor", viewer_person_id: ME_1, subject_person_id: MT_A });
  });

  it("link trong thư vừa gửi mở được ngay, mang SĐT của người đồng hành", async () => {
    await runMatchResultDispatch();
    const meCall = mocks.mentee.mock.calls.find((c) => c[0].toEmail === "m1@example.test")![0];
    const page = await getMatchProfilePage(meCall.mentorToken, client);
    expect(page.state).toBe("ok");
    if (page.state === "ok") expect(page.card.fields.find((f) => f.key === "phone")?.value).toBe("0900 000 001");
  });
});

describe("4. không gửi trùng", () => {
  it("hai lần bấm cùng lúc: mỗi người đúng một thư", async () => {
    await Promise.all([runMatchResultDispatch(), runMatchResultDispatch()]);
    expect(sentTo()).toEqual([
      "mentee:m1@example.test", "mentee:m2@example.test", "mentee:m3@example.test", "mentor:a@example.test", "mentor:b@example.test"
    ]);
  });

  it("bấm lại sau khi gửi xong: không ai nhận thư thứ hai", async () => {
    await runMatchResultDispatch();
    vi.clearAllMocks();
    const r = await runMatchResultDispatch();
    expect(sentTo()).toEqual([]);
    expect(r.message).toContain("Không còn ai chờ");
  });

  it("đã có thư 'sent' trong sổ thư cho dòng thông báo (lần trước gửi xong chưa kịp chốt): chỉ chốt, không gửi lại", async () => {
    db.tables.match_result_notices = [{ id: "n-me1", season_id: SEASON, person_id: ME_1, role: "mentee", claimed_at: null, sent_at: null, send_count: 0 }];
    db.tables.outbound_emails = [{ id: "o1", related_table: "match_result_notices", related_id: "n-me1", status: "sent", created_at: new Date().toISOString() }];
    const r = await runMatchResultDispatch();
    expect(sentTo()).not.toContain("mentee:m1@example.test");
    expect(notice(ME_1, "mentee").sent_at).toBeTruthy();
    expect(r.message).toContain("chỉ ghi nhận");
  });

  it("không đọc được sổ thư để kiểm: không gửi ai, nhả mọi chỗ đã chiếm", async () => {
    db.injectError = (req) => (req.table === "outbound_emails" && req.columns.includes("related_id") ? { message: "down" } : null);
    const r = await runMatchResultDispatch();
    expect(r.ok).toBe(false);
    expect(sentTo()).toEqual([]);
    expect(db.tables.match_result_notices.every((n: any) => n.claimed_at === null)).toBe(true);
  });
});

describe("5. lỗi gửi", () => {
  it("nhà cung cấp báo 429: dừng ngay, không chốt ai chưa gửi, nhả mọi chỗ", async () => {
    mocks.mentor.mockResolvedValue({ ok: false, skipped: false, reason: "rate", providerStatus: 429 });
    const r = await runMatchResultDispatch();
    expect(mocks.mentor).toHaveBeenCalledTimes(1);
    expect(mocks.mentee).not.toHaveBeenCalled();
    expect(r.message).toContain("chạm trần");
    expect(db.tables.match_result_notices.every((n: any) => n.claimed_at === null && !n.sent_at)).toBe(true);
  });

  it("một thư lỗi: ghi lỗi cho người đó, những người khác vẫn đi", async () => {
    mocks.mentee.mockImplementation(async (input: any) => (input.toEmail === "m2@example.test" ? { ok: false, skipped: false, reason: "hộp thư từ chối" } : { ok: true, skipped: false }));
    const r = await runMatchResultDispatch();
    expect(notice(ME_2, "mentee")).toMatchObject({ claimed_at: null, last_error: "hộp thư từ chối" });
    expect(notice(ME_2, "mentee").sent_at).toBeFalsy();
    expect(notice(ME_1, "mentee").sent_at).toBeTruthy();
    expect(r.message).toContain("1 thư lỗi");
  });
});

describe("6. gửi thử và gửi riêng", () => {
  it("gửi thử: hai thư (mentee + mentor) tới chính người bấm, không mã nào, không ghi gì", async () => {
    const r = await sendMatchResultTest();
    expect(r.ok).toBe(true);
    expect(sentTo()).toEqual(["mentee:btc@example.test", "mentor:btc@example.test"]);
    expect(tokensSent().every((t) => t === null)).toBe(true);
    expect(mocks.mentee.mock.calls[0][0].noticeId).toBeNull();
    expect(db.writes).toEqual([]);
  });

  it("gửi lại một người: mã mới, link thư trước hết hiệu lực, link mới mở được", async () => {
    await runMatchResultDispatch();
    const oldToken = mocks.mentee.mock.calls.find((c) => c[0].toEmail === "m1@example.test")![0].mentorToken;
    vi.clearAllMocks();
    mocks.mentee.mockResolvedValue({ ok: true, skipped: false });
    const r = await resendMatchResultNotice({ personId: ME_1, role: "mentee" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("hết hiệu lực");
    const newToken = mocks.mentee.mock.calls[0][0].mentorToken;
    expect(newToken).not.toBe(oldToken);
    expect((await getMatchProfilePage(oldToken, client)).state).toBe("invalid");
    expect((await getMatchProfilePage(newToken, client)).state).toBe("ok");
    expect(notice(ME_1, "mentee").send_count).toBe(2);
    expect(db.tables.match_profile_links.find((l: any) => l.match_id === "m1" && l.subject_role === "mentor").rotated_at).toBeTruthy();
  });

  it("gửi riêng người đang bị giữ: từ chối, không gửi", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: null }];
    const r = await resendMatchResultNotice({ personId: ME_1, role: "mentee" });
    expect(r.ok).toBe(false);
    expect(sentTo()).toEqual([]);
  });

  it("gửi riêng khi chưa đủ điều kiện gửi: từ chối", async () => {
    HANDBOOKS.mentor.ready = false;
    expect((await resendMatchResultNotice({ personId: MT_A, role: "mentor" })).ok).toBe(false);
    expect(sentTo()).toEqual([]);
  });
});

describe("7. form gửi", () => {
  it("thiếu dấu của bước xác nhận thứ hai: không gửi, không ghi", async () => {
    expect((await sendMatchResultAction(ROUND2_IDLE, new FormData())).status).toBe("error");
    const one = new FormData();
    one.set("personId", ME_1);
    one.set("role", "mentee");
    expect((await resendMatchResultAction(ROUND2_IDLE, one)).status).toBe("error");
    expect(sentTo()).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("có dấu xác nhận: gửi", async () => {
    const form = new FormData();
    form.set("confirmed", "yes");
    expect((await sendMatchResultAction(ROUND2_IDLE, form)).status).toBe("ok");
    expect(sentTo()).toHaveLength(5);
  });
});

describe("8. gửi thử thư của một nhóm mentor (xem trước cho team support)", () => {
  const STAFF = [
    { id: "s1", email: "support@example.test", status: "active" },
    { id: "s2", email: "da-nghi@example.test", status: "inactive" }
  ];

  it("theo họ tên: thư của mentor + thư của từng mentee, tới người bấm, đúng tên, không mã, không ghi gì", async () => {
    const r = await sendMatchResultGroupTest({ mentor: "anh mentor a" });
    expect(r.ok).toBe(true);
    expect(sentTo()).toEqual(["mentee:btc@example.test", "mentee:btc@example.test", "mentor:btc@example.test"]);
    const m = mocks.mentor.mock.calls[0][0];
    expect(m.mentorName).toBe("Anh Mentor A");
    expect(m.mentees.map((x: any) => x.name)).toEqual(["Mentee Hai", "Mentee Một"]);
    expect(m.testFor).toBe("mentor Anh Mentor A");
    expect(mocks.mentee.mock.calls.map((c) => [c[0].menteeName, c[0].mentorName, c[0].testFor])).toEqual([
      ["Mentee Hai", "Anh Mentor A", "mentee Mentee Hai"],
      ["Mentee Một", "Anh Mentor A", "mentee Mentee Một"]
    ]);
    expect(tokensSent().every((t) => t === null)).toBe(true);
    expect([...mocks.mentor.mock.calls, ...mocks.mentee.mock.calls].every((c) => c[0].noticeId === null)).toBe(true);
    expect(db.writes).toEqual([]);
    expect(r.message).toContain("Mentee Hai, Mentee Một");
  });

  it("theo email mentor", async () => {
    await sendMatchResultGroupTest({ mentor: "B@example.test" });
    expect(sentTo()).toEqual(["mentee:btc@example.test", "mentor:btc@example.test"]);
  });

  it("gửi tới một tài khoản nhân sự đang hoạt động", async () => {
    db.tables.admin_users = STAFF;
    const r = await sendMatchResultGroupTest({ mentor: "Bình Mentor B", toEmail: "Support@Example.test" });
    expect(r.ok).toBe(true);
    expect(sentTo()).toEqual(["mentee:support@example.test", "mentor:support@example.test"]);
  });

  it.each([
    ["email của một mentee thật", "m1@example.test"],
    ["email của chính mentor đó", "a@example.test"],
    ["tài khoản nhân sự đã nghỉ", "da-nghi@example.test"],
    ["email ngoài", "ai-do@gmail.com"],
    ["không phải email", "khong-phai-email"]
  ])("không bao giờ gửi tới %s", async (_label, toEmail) => {
    db.tables.admin_users = STAFF;
    const r = await sendMatchResultGroupTest({ mentor: "Anh Mentor A", toEmail });
    expect(r.ok).toBe(false);
    expect(sentTo()).toEqual([]);
  });

  it("không đọc được danh sách nhân sự: không gửi tới người khác (fail-closed)", async () => {
    db.errors.admin_users = { message: "down" };
    expect((await sendMatchResultGroupTest({ mentor: "Anh Mentor A", toEmail: "support@example.test" })).ok).toBe(false);
    expect(sentTo()).toEqual([]);
  });

  it("gửi cho chính mình thì không cần đọc danh sách nhân sự", async () => {
    db.errors.admin_users = { message: "down" };
    expect((await sendMatchResultGroupTest({ mentor: "Anh Mentor A" })).ok).toBe(true);
  });

  it("mentor đang bị giữ và lúc chưa đủ điều kiện gửi thật: vẫn xem trước được", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: null }];
    db.tables.match_result_settings = [];
    HANDBOOKS.mentee.ready = false;
    expect((await sendMatchResultGroupTest({ mentor: "Anh Mentor A" })).ok).toBe(true);
    expect(sentTo()).toHaveLength(3);
  });

  it("mentor không có hoặc không có quyền vận hành mùa: không gửi", async () => {
    expect((await sendMatchResultGroupTest({ mentor: "Không Ai Cả" })).ok).toBe(false);
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "x", role: "core_team", status: "active", auth_user_id: "auth-khac", email: "x@example.test" } as any);
    expect((await sendMatchResultGroupTest({ mentor: "Anh Mentor A" })).ok).toBe(false);
    expect(sentTo()).toEqual([]);
  });

  it("hạn mức 24 giờ không đủ cho cả nhóm: không gửi lẻ", async () => {
    db.tables.outbound_emails = Array.from({ length: 998 }, (_, i) => ({ id: `o${i}`, status: "sent", created_at: new Date().toISOString() }));
    expect((await sendMatchResultGroupTest({ mentor: "Anh Mentor A" })).ok).toBe(false);
    expect(sentTo()).toEqual([]);
  });
});

describe("9. gửi liên tục — phía máy chủ", () => {
  // Thư gửi thành công ghi vào sổ thư như thật, để hạn mức 24 giờ giảm dần giữa các lượt.
  const logSent = async (input: any) => {
    db.tables.outbound_emails.push({
      id: `o-${db.tables.outbound_emails.length}`,
      status: "sent",
      created_at: new Date().toISOString(),
      related_table: input.noticeId ? "match_result_notices" : null,
      related_id: input.noticeId
    });
    return { ok: true, skipped: false };
  };
  const fill = (n: number) => {
    db.tables.outbound_emails = Array.from({ length: n }, (_, i) => ({ id: `x${i}`, status: "sent", created_at: new Date().toISOString() }));
  };

  /** Đúng điều trang làm: gọi tới khi more = false, cộng dồn người lỗi vào danh sách bỏ qua. */
  async function loop() {
    const skip = new Set<string>();
    const results = [];
    for (let i = 0; i < 20; i++) {
      const r = await runMatchResultDispatch({ skip });
      results.push(r);
      for (const k of r.failedKeys ?? []) skip.add(k);
      if (!r.ok || !r.more) break;
    }
    return results;
  }

  beforeEach(() => {
    mocks.mentee.mockImplementation(logSent);
    mocks.mentor.mockImplementation(logSent);
  });

  it("đủ hạn mức: gửi tới khi hết người chờ, mỗi người đúng một thư, lượt cuối báo dừng", async () => {
    const results = await loop();
    expect(sentTo()).toHaveLength(5);
    expect(new Set(sentTo()).size).toBe(5);
    expect(results.at(-1)!.more).toBe(false);
    expect(results.at(-1)!.left).toBe(0);
  });

  it("hạn mức hôm nay chỉ đủ một nhóm: lượt 1 gửi nhóm A rồi báo gửi tiếp, lượt 2 thấy hết hạn mức và dừng", async () => {
    fill(917); // còn 3 thư: đúng nhóm A (mentor + 2 mentee)
    const results = await loop();
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ sent: 3, left: 2, more: true });
    expect(results[1].sent).toBe(0);
    expect(results[1].more).toBeFalsy();
    expect(results[1].message).toContain("hạn mức");
    expect(sentTo()).toEqual(["mentee:m1@example.test", "mentee:m2@example.test", "mentor:a@example.test"]);
  });

  it("một người lỗi: báo đúng người đó, lượt sau bỏ qua họ — không gửi lại họ ở mọi lượt", async () => {
    mocks.mentee.mockImplementation(async (input: any) =>
      input.toEmail === "m2@example.test" ? { ok: false, skipped: false, reason: "hộp thư từ chối" } : logSent(input)
    );
    const results = await loop();
    expect(results[0].failedKeys).toEqual([`mentee:${ME_2}`]);
    expect(mocks.mentee.mock.calls.filter((c) => c[0].toEmail === "m2@example.test")).toHaveLength(1);
    expect(results.at(-1)!.more).toBe(false);
    expect(notice(ME_3, "mentee").sent_at).toBeTruthy();
  });

  it("chỉ còn người vừa lỗi: không báo gửi tiếp (không quay vòng mãi)", async () => {
    mocks.mentor.mockResolvedValue({ ok: false, skipped: false, reason: "x" });
    mocks.mentee.mockResolvedValue({ ok: false, skipped: false, reason: "x" });
    const r = await runMatchResultDispatch();
    expect(r.sent).toBe(0);
    expect(r.more).toBe(false);
  });

  it("bị 429: báo dừng", async () => {
    mocks.mentor.mockResolvedValue({ ok: false, skipped: false, reason: "rate", providerStatus: 429 });
    expect((await runMatchResultDispatch()).more).toBe(false);
  });

  it("môi trường tắt gửi thư (mọi thư bị bỏ qua): báo dừng, không tính lỗi", async () => {
    mocks.mentor.mockResolvedValue({ ok: true, skipped: true, reason: "gate" });
    mocks.mentee.mockResolvedValue({ ok: true, skipped: true, reason: "gate" });
    const r = await runMatchResultDispatch();
    expect(r).toMatchObject({ sent: 0, failed: 0, more: false });
  });

  it("danh sách bỏ qua chỉ thu hẹp: khoá lạ không thêm ai, khoá đúng thì người đó không nhận", async () => {
    await runMatchResultDispatch({ skip: new Set([`mentee:${ME_1}`, "mentee:00000000-0000-4000-8000-000000000999"]) });
    expect(sentTo()).toEqual(["mentee:m2@example.test", "mentee:m3@example.test", "mentor:a@example.test", "mentor:b@example.test"]);
  });

  it("action: chỉ chạy khi trang gửi confirmed === true; mục lạ trong danh sách bỏ qua bị lờ đi", async () => {
    for (const input of [{}, { confirmed: "yes" }, { confirmed: 1 }]) {
      expect((await sendMatchResultBatchAction(input as any)).ok).toBe(false);
    }
    expect(sentTo()).toEqual([]);
    expect(db.writes).toEqual([]);
    const r = await sendMatchResultBatchAction({ confirmed: true, skip: ["rác", 42, `mentee:${ME_1}`] });
    expect(r.ok).toBe(true);
    expect(sentTo()).not.toContain("mentee:m1@example.test");
    expect(sentTo()).toHaveLength(4);
  });
});
