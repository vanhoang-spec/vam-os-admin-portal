/**
 * Trang /matches/ket-qua và các đường ghi của nó, chạy trên bản giả PostgREST. Chỉ danh tính và ranh
 * giới module Next được giả.
 *
 * Điều phải đúng: chỉ Core team có quyền vận hành mùa mới đọc/ghi được; danh sách giữ lại là tất cả
 * hoặc không (một email không khớp thì không ghi email nào); mọi lần đổi danh sách gỡ dấu xác nhận;
 * nút xác nhận chỉ chốt đúng danh sách đang hiện; link trong thư chỉ nhận https; không đọc được danh
 * sách giữ lại thì khoá gửi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, useFormState: (_action: unknown, initial: unknown) => [initial, vi.fn()], useFormStatus: () => ({ pending: false }) };
});
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((destination: string) => {
    throw new Error("REDIRECT:" + destination);
  })
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import MatchResultPage from "@/app/matches/ket-qua/page";
import { confirmMatchResultHoldsAction } from "@/app/actions/match-result";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  addMatchResultHolds,
  confirmMatchResultHolds,
  getMatchResultData,
  removeMatchResultHold,
  saveMatchResultSettings
} from "@/lib/match-result";
import { holdsFingerprint } from "@/lib/match-result-core";
import { HANDBOOKS } from "@/lib/handbook";
import { ROUND2_IDLE } from "@/lib/matching-round2-action-types";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const MT_A = "a0000000-0000-4000-8000-00000000000a";
const MT_B = "a0000000-0000-4000-8000-00000000000b";
const MT_C = "a0000000-0000-4000-8000-00000000000c";
const ME_1 = "e0000000-0000-4000-8000-000000000001";
const ME_2 = "e0000000-0000-4000-8000-000000000002";
const ME_3 = "e0000000-0000-4000-8000-000000000003";
const ME_4 = "e0000000-0000-4000-8000-000000000004";
const OLD = "2026-10-20T00:00:00Z";

const db = createFakeDb();

function seed() {
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12", name: "UEH Mentoring Season 12", program_id: PROGRAM }];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM", name: "UEH Mentoring" }];
  db.tables.admin_scope_access = [{ id: "g1", user_id: "auth-core", program_id: null, season_id: SEASON, role: "operations", status: "active" }];
  db.tables.people = [
    { id: MT_A, full_name: "Anh Mentor A", email_primary: "a@example.test", phone_primary: "0900 000 001" },
    { id: MT_B, full_name: "Bình Mentor B", email_primary: "b@example.test" },
    { id: MT_C, full_name: "Cường Mentor C", email_primary: "chung@example.test" },
    { id: ME_1, full_name: "Mentee Một", email_primary: "m1@example.test" },
    { id: ME_2, full_name: "Mentee Hai", email_primary: "m2@example.test" },
    { id: ME_3, full_name: "Mentee Ba", email_primary: null },
    { id: ME_4, full_name: "Mentee Bốn", email_primary: "m4@example.test" }
  ];
  db.tables.applications = [
    { id: "ap-a", person_id: MT_A, season_id: SEASON, role_applied: "mentor", status: "approved_as_mentor", source: "vam_os_form", email_primary: "a@example.test", created_at: OLD, raw_payload: { title_current: "Giám đốc" } },
    { id: "ap-b", person_id: MT_B, season_id: SEASON, role_applied: "mentor", status: "approved_as_mentor", source: "vam_os_form", email_primary: "chung@example.test", created_at: OLD, raw_payload: {} },
    { id: "ap-c", person_id: MT_C, season_id: SEASON, role_applied: "mentor", status: "approved_as_mentor", source: "vam_os_form", email_primary: "c@example.test", created_at: OLD, raw_payload: {} },
    { id: "ap-3", person_id: ME_3, season_id: SEASON, role_applied: "mentee", status: "approved_as_mentee", source: "vam_os_form", email_primary: "M3@App.Example.test", created_at: OLD, raw_payload: {} }
  ];
  db.tables.matches = [
    { id: "m1", season_id: SEASON, status: "active", mentor_person_id: MT_A, mentee_person_id: ME_1, matching_round: 1, created_at: OLD },
    { id: "m2", season_id: SEASON, status: "active", mentor_person_id: MT_A, mentee_person_id: ME_2, matching_round: 3, created_at: OLD },
    { id: "m3", season_id: SEASON, status: "active", mentor_person_id: MT_B, mentee_person_id: ME_3, matching_round: null, created_at: OLD },
    { id: "m4", season_id: SEASON, status: "ended", mentor_person_id: MT_C, mentee_person_id: ME_4, matching_round: 2, created_at: OLD }
  ];
  db.tables.person_season_memberships = [];
  db.tables.match_result_notices = [];
  db.tables.match_result_holds = [];
  db.tables.match_result_settings = [];
  db.tables.matching_industry_assignments = [];
  db.tables.mentor_profiles = [];
  db.tables.mentee_profiles = [];
  db.tables.application_reviews = [];
}

function signIn(role: string, authUserId = "auth-core") {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: `admin-${authUserId}`, role, status: "active", auth_user_id: authUserId, email: `${authUserId}@example.test`
  } as any);
}

async function page(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await MatchResultPage({ searchParams: Promise.resolve(sp) }));
}

function rowOf(html: string, marker: string) {
  const start = html.indexOf(marker);
  if (start < 0) return null;
  return html.slice(start, html.indexOf("</tr>", start));
}

const writesTo = (table: string) => db.writes.filter((w) => w.table === table);
const REAL_READY = { mentee: HANDBOOKS.mentee.ready, mentor: HANDBOOKS.mentor.ready };
afterEach(() => {
  HANDBOOKS.mentee.ready = REAL_READY.mentee;
  HANDBOOKS.mentor.ready = REAL_READY.mentor;
});

beforeEach(() => {
  vi.clearAllMocks();
  // Handbook có file (giả lập); ca "chưa có file" tự tắt. afterEach trả về giá trị thật trong kho.
  HANDBOOKS.mentee.ready = true;
  HANDBOOKS.mentor.ready = true;
  db.reset();
  seed();
  const client = fakeClient(db);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
  signIn("core_team");
});

describe("quyền", () => {
  it.each(["support_team", "viewer", "reviewer"])("%s: không thấy trang, không đọc cặp nào", async (role) => {
    signIn(role, "auth-other");
    const html = await page();
    expect(html).toContain("Không có quyền truy cập");
    expect(db.requests.filter((r) => r.table === "matches")).toEqual([]);
  });

  it("Core team không có quyền vận hành mùa này: báo không có quyền, không đọc cặp", async () => {
    signIn("core_team", "auth-khac");
    const result = await getMatchResultData();
    expect(result).toMatchObject({ ok: false, denied: true });
    expect(db.requests.filter((r) => r.table === "matches")).toEqual([]);
  });

  it("mọi đường ghi từ chối người không có quyền vận hành mùa — và không ghi gì", async () => {
    signIn("core_team", "auth-khac");
    await saveMatchResultSettings({ kickoffRegisterUrl: "https://x.test/kick-off" });
    await addMatchResultHolds({ text: "a@example.test", reason: "" });
    await removeMatchResultHold({ mentorPersonId: MT_A });
    await confirmMatchResultHolds({ fingerprint: "" });
    expect(db.writes).toEqual([]);
  });
});

describe("trang", () => {
  it("mọi cặp đang hoạt động, mọi vòng; cặp đã kết thúc không có; mentor 2 mentee là MỘT dòng", async () => {
    const html = await page();
    const a = rowOf(html, `data-recipient="mentor:${MT_A}"`);
    expect(a).toContain("Mentee Một");
    expect(a).toContain("Mentee Hai");
    expect(a).toContain("Vòng 3");
    expect(html).toContain(`data-recipient="mentee:${ME_3}"`);
    expect(html).not.toContain(`data-recipient="mentor:${MT_C}"`);
    expect(html).not.toContain(`data-recipient="mentee:${ME_4}"`);
  });

  it("email dự phòng lấy từ đơn mùa này khi hồ sơ người chưa có", async () => {
    expect(rowOf(await page(), `data-recipient="mentee:${ME_3}"`)).toContain("m3@app.example.test");
  });

  it("chưa có file Handbook trên VAM OS và chưa xác nhận danh sách: khoá gửi, nói rõ cả ba", async () => {
    HANDBOOKS.mentee.ready = false;
    HANDBOOKS.mentor.ready = false;
    const html = await page();
    expect(html).toContain('data-testid="match-result-blocked"');
    expect(html).toContain("Chưa có file Handbook mentee trên VAM OS.");
    expect(html).toContain("Chưa có file Handbook mentor trên VAM OS.");
    expect(html).toContain("Danh sách mentor giữ lại chưa được xác nhận.");
    expect(html).not.toContain("Gửi thư kết quả (tối đa");
    expect(rowOf(html, 'data-handbook="mentee"')).toContain("chưa có file trên VAM OS");
  });

  it("Handbook có file: trang hiện đúng link trên VAM OS, không có ô nhập link Handbook", async () => {
    const html = await page();
    expect(html).toContain('href="/tai-lieu/handbook-mentee.pdf"');
    expect(html).toContain('href="/tai-lieu/handbook-mentor.pdf"');
    expect(html).not.toMatch(/name="(mentee|mentor)HandbookUrl"/);
  });

  it("đủ file Handbook và đã xác nhận: không còn lý do khoá, nút gửi mời gửi đúng lô kế tiếp (trọn từng nhóm mentor)", async () => {
    db.tables.match_result_settings = [{ season_id: SEASON, kickoff_register_url: null, holds_confirmed_at: "2026-10-22T09:00:00Z" }];
    const html = await page();
    expect(html).not.toContain('data-testid="match-result-blocked"');
    // A: mentor + 2 mentee, B: mentor + 1 mentee (ME_3 lấy email từ đơn) = 5 thư, 2 nhóm.
    expect(html).toContain("Gửi thư kết quả (tối đa 5 thư)");
    expect(html).toContain("Lần bấm kế tiếp: 5 thư (2 nhóm)");
  });

  it("mentor bị giữ: mentor và mentee của họ ở trạng thái giữ lại", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: "Training", created_at: OLD, removed_at: null }];
    const html = await page();
    expect(rowOf(html, `data-recipient="mentor:${MT_A}"`)).toContain('data-status="held"');
    expect(rowOf(html, `data-recipient="mentee:${ME_1}"`)).toContain('data-status="held"');
    expect(rowOf(html, `data-recipient="mentee:${ME_3}"`)).toContain('data-status="pending"');
    expect(rowOf(html, `data-hold="${MT_A}"`)).toContain("Anh Mentor A");
  });

  it("dòng giữ lại đã bỏ (removed_at) không còn giữ ai", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: "2026-10-22T08:00:00Z" }];
    const html = await page();
    expect(rowOf(html, `data-recipient="mentor:${MT_A}"`)).toContain('data-status="pending"');
    expect(html).not.toContain(`data-hold="${MT_A}"`);
  });

  it("không đọc được danh sách giữ lại: khoá gửi và mọi người bị giữ (fail-closed)", async () => {
    db.errors.match_result_holds = { message: "down" };
    const html = await page();
    expect(html).toContain("Không đọc được danh sách mentor giữ lại — tạm khoá gửi.");
    expect(html).not.toContain('data-status="pending"');
  });

  it("độ phủ chỉ tính khi bấm xem", async () => {
    await page();
    expect(db.requests.filter((r) => r.table === "mentor_profiles")).toEqual([]);
    const html = await page({ "do-phu": "1" });
    expect(html).toContain('data-testid="match-result-coverage"');
    expect(html).toMatch(/Chức danh hiện tại<\/td><td[^>]*>1\/2</);
  });

  it("xem trước thẻ của một người đang có cặp: đúng thẻ người đồng hành thấy, có SĐT", async () => {
    const html = await page({ xem: `mentor:${MT_A}` });
    expect(html).toContain('data-testid="match-result-preview"');
    expect(html).toContain('data-testid="match-profile-card"');
    expect(html).toContain("0900 000 001");
  });

  it("xem trước người không có cặp đang hoạt động, hoặc mã lạ: không hiện thẻ nào", async () => {
    for (const xem of [`mentor:${MT_C}`, "mentor:khong-phai-uuid", `admin:${MT_A}`]) {
      const html = await page({ xem });
      expect(html, xem).not.toContain('data-testid="match-profile-card"');
    }
  });
});

describe("link Kick-off", () => {
  it("chỉ nhận https: http bị từ chối, không ghi gì", async () => {
    const r = await saveMatchResultSettings({ kickoffRegisterUrl: "http://x.test/kick-off" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Kick-off");
    expect(db.writes).toEqual([]);
  });

  it("chỉ ghi cột Kick-off cùng người sửa — không đụng dấu xác nhận danh sách, không đụng cột Handbook cũ", async () => {
    const r = await saveMatchResultSettings({ kickoffRegisterUrl: " https://x.test/kick-off " });
    expect(r.ok).toBe(true);
    const [w] = writesTo("match_result_settings");
    expect(w.kind).toBe("upsert");
    expect(Object.keys(w.rows[0]).sort()).toEqual(["kickoff_register_url", "season_id", "updated_at", "updated_by"]);
    expect(w.rows[0]).toMatchObject({ season_id: SEASON, kickoff_register_url: "https://x.test/kick-off", updated_by: "admin-auth-core" });
  });

  it("để trống: lưu null (thư ghi “BTC sẽ cập nhật sau”)", async () => {
    await saveMatchResultSettings({ kickoffRegisterUrl: "" });
    expect(writesTo("match_result_settings")[0].rows[0].kickoff_register_url).toBeNull();
  });
});

describe("danh sách giữ lại", () => {
  it("email không khớp mentor nào: không ghi email nào, báo đúng email đó", async () => {
    const r = await addMatchResultHolds({ text: "a@example.test\nla@example.test", reason: "" });
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain("la@example.test");
    expect(r.message).toContain("Chưa ghi gì");
    expect(db.writes).toEqual([]);
  });

  it("email trùng hai mentor (hồ sơ người của C, đơn của B): báo cả hai tên, không ghi gì", async () => {
    const r = await addMatchResultHolds({ text: "chung@example.test", reason: "" });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Bình Mentor B");
    expect(r.message).toContain("Cường Mentor C");
    expect(db.writes).toEqual([]);
  });

  it("có mục không phải email: không ghi gì", async () => {
    const r = await addMatchResultHolds({ text: "a@example.test, khong-phai-email", reason: "" });
    expect(r.ok).toBe(false);
    expect(db.writes).toEqual([]);
  });

  it("khớp hết: ghi từng mentor với email đã nhập, lý do mặc định, người giữ; rồi gỡ dấu xác nhận", async () => {
    db.tables.match_result_settings = [{ season_id: SEASON, holds_confirmed_at: "2026-10-22T09:00:00Z", holds_confirmed_by: "admin-x" }];
    const r = await addMatchResultHolds({ text: "A@example.test; c@example.test", reason: "" });
    expect(r.ok).toBe(true);
    const inserts = writesTo("match_result_holds").filter((w) => w.kind === "insert");
    expect(inserts).toHaveLength(1);
    expect(inserts[0].rows).toEqual([
      { season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: "Nhóm mentor cần tham gia Training 15/11 — BTC gửi thư riêng.", created_by: "admin-auth-core" },
      { season_id: SEASON, mentor_person_id: MT_C, input_email: "c@example.test", reason: "Nhóm mentor cần tham gia Training 15/11 — BTC gửi thư riêng.", created_by: "admin-auth-core" }
    ]);
    const reset = writesTo("match_result_settings");
    expect(reset.map((w) => w.rows[0])).toEqual([{ season_id: SEASON, holds_confirmed_at: null, holds_confirmed_by: null }]);
  });

  it("mentor đã có trong danh sách: không ghi lại, không gỡ dấu xác nhận", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: null }];
    const r = await addMatchResultHolds({ text: "a@example.test", reason: "" });
    expect(r).toMatchObject({ ok: true });
    expect(db.writes).toEqual([]);
  });

  it("giữ lại một mentor đã từng bỏ giữ: sửa đúng dòng cũ (unique theo mùa + mentor), không chèn dòng mới", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: "2026-10-22T08:00:00Z" }];
    await addMatchResultHolds({ text: "a@example.test", reason: "Lý do mới" });
    const holdWrites = writesTo("match_result_holds");
    expect(holdWrites.map((w) => w.kind)).toEqual(["update"]);
    expect(holdWrites[0].rows[0]).toMatchObject({ removed_at: null, removed_by: null, reason: "Lý do mới" });
    expect(holdWrites[0].filters).toContain('"value":"h1"');
  });

  it("bỏ giữ: ghi removed_at/removed_by trên dòng đang giữ, không xoá; rồi gỡ dấu xác nhận", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: null }];
    const r = await removeMatchResultHold({ mentorPersonId: MT_A });
    expect(r.ok).toBe(true);
    const [w] = writesTo("match_result_holds");
    expect(w.kind).toBe("update");
    expect(Object.keys(w.rows[0]).sort()).toEqual(["removed_at", "removed_by"]);
    expect(w.filters).toContain('"kind":"isNull","column":"removed_at"');
    expect(db.writes.some((x) => x.kind === "delete")).toBe(false);
    expect(writesTo("match_result_settings").map((x) => x.rows[0])).toEqual([{ season_id: SEASON, holds_confirmed_at: null, holds_confirmed_by: null }]);
  });

  it("bỏ giữ người không còn trong danh sách: báo lỗi, không gỡ dấu xác nhận", async () => {
    const r = await removeMatchResultHold({ mentorPersonId: MT_A });
    expect(r.ok).toBe(false);
    expect(writesTo("match_result_settings")).toEqual([]);
  });

  it("xác nhận chỉ chốt đúng danh sách đang hiện: danh sách vừa đổi thì không ghi", async () => {
    db.tables.match_result_holds = [{ id: "h1", season_id: SEASON, mentor_person_id: MT_A, input_email: "a@example.test", reason: null, created_at: OLD, removed_at: null }];
    const stale = await confirmMatchResultHolds({ fingerprint: holdsFingerprint([]) });
    expect(stale.ok).toBe(false);
    expect(db.writes).toEqual([]);

    const ok = await confirmMatchResultHolds({ fingerprint: holdsFingerprint([MT_A]) });
    expect(ok.ok).toBe(true);
    const [w] = writesTo("match_result_settings");
    expect(Object.keys(w.rows[0]).sort()).toEqual(["holds_confirmed_at", "holds_confirmed_by", "season_id"]);
    expect(w.rows[0].holds_confirmed_by).toBe("admin-auth-core");
  });

  it("xác nhận danh sách RỖNG cũng là một quyết định hợp lệ", async () => {
    expect((await confirmMatchResultHolds({ fingerprint: holdsFingerprint([]) })).ok).toBe(true);
  });

  it("form xác nhận thiếu dấu của bước thứ hai: không ghi gì", async () => {
    const form = new FormData();
    form.set("fingerprint", "");
    const r = await confirmMatchResultHoldsAction(ROUND2_IDLE, form);
    expect(r.status).toBe("error");
    expect(db.writes).toEqual([]);
  });
});
