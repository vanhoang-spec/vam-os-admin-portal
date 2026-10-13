/**
 * @vitest-environment jsdom
 */
/**
 * Mentee đặc cách (Support team) — phần máy chủ và hai trang: trang BTC quản lý danh sách
 * (/applications/mentee-dac-cach) và trang người nhận bấm xác nhận (/xac-nhan-mentee/[token]).
 *
 * Điều phải đúng:
 *   - chỉ Core team trở lên CÓ quyền vận hành mùa mới thêm / gỡ / gửi thư được; thiếu quyền
 *     thì không một lệnh ghi và không một thư nào đi;
 *   - bộ gửi chỉ gửi cho người chưa xác nhận, chưa bị gỡ, có email, chưa nhận thư trong 20
 *     giờ; mỗi người đúng một thư, mang đúng link của chính họ;
 *   - trang người nhận chỉ hiện tên, không email; mở trang không ghi gì; bấm nút gọi đúng
 *     một hàm database với đúng mã;
 *   - trang BTC hiện đúng danh sách, đúng người được gợi ý, và ẩn nút khi chỉ được xem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});
const formActions: Array<{ action: any; dispatch: ReturnType<typeof vi.fn> }> = [];
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => {
      const dispatch = vi.fn();
      formActions.push({ action, dispatch });
      return [initial, dispatch];
    },
    useFormStatus: () => ({ pending: false })
  };
});
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn(() => { throw new Error("REDIRECT"); }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })), headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/lib/supabase", () => ({ supabase: null, supabaseUrl: "https://x.test", supabaseAnonKey: "anon" }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn(), getSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.test") }));
vi.mock("@/lib/email", () => ({ sendMenteeExemptionConfirm: vi.fn(async () => ({ ok: true, skipped: false })) }));

import MenteeExemptionPage from "@/app/applications/mentee-dac-cach/page";
import MenteeConfirmPage from "@/app/xac-nhan-mentee/[token]/page";
import { confirmMenteeExemptionAction } from "@/app/xac-nhan-mentee/[token]/actions";
import {
  addMenteeExemptionsAction,
  revokeMenteeExemptionAction,
  sendMenteeExemptionInvitesAction,
  sendMenteeExemptionTestAction
} from "@/app/actions/mentee-exemption";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendMenteeExemptionConfirm } from "@/lib/email";
import {
  addMenteeExemptions,
  confirmMenteeExemption,
  getExemptionBoard,
  getExemptionConfirmPage,
  revokeMenteeExemption,
  runMenteeExemptionDispatch,
  sendMenteeExemptionTest
} from "@/lib/mentee-exemption";
import { EXEMPTION_IDLE } from "@/lib/mentee-exemption-action-types";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const SEASON = "11111111-1111-4111-8111-111111111111";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const P = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const E = (n: number) => `eeeeeeee-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const T = (n: number) => `aaaaaaaa-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const NOW = Date.parse("2026-10-11T05:00:00Z");
const HOURS = 3600_000;

const db = createFakeDb();
let rpcCalls: Array<{ fn: string; args: any }> = [];
let rpcResult: (fn: string, args: any) => { data: any; error: any };

const CORE = { id: "admin-core", role: "core_team", status: "active", auth_user_id: "auth-core", email: "core@example.test", full_name: "Chị BTC" };

function exemption(n: number, personId: string, over: Record<string, unknown> = {}) {
  return {
    id: E(n), season_id: SEASON, person_id: personId, token: T(n), added_at: `2026-10-11T0${n}:00:00Z`,
    send_count: 0, first_sent_at: null, last_sent_at: null, claimed_at: null, last_error: null,
    confirmed_at: null, revoked_at: null, ...over
  };
}

function seed() {
  db.tables.seasons = [{ id: SEASON, code: "UEHM-S12", name: "S12", program_id: PROGRAM }];
  db.tables.programs = [{ id: PROGRAM, code: "UEHM" }];
  db.tables.admin_scope_access = [{ id: "g1", user_id: "auth-core", program_id: null, season_id: SEASON, role: "operations", status: "active" }];
  db.tables.people = [
    { id: P(1), full_name: "An Chưa Gửi", email_primary: "an@example.test" },
    { id: P(2), full_name: "Bình Đã Gửi", email_primary: "binh@example.test" },
    { id: P(3), full_name: "Cúc Đã Xác Nhận", email_primary: "cuc@example.test" },
    { id: P(4), full_name: "Dũng Bị Gỡ", email_primary: "dung@example.test" },
    { id: P(5), full_name: "Én Không Email", email_primary: null },
    { id: P(6), full_name: "Giang Gắn Tay", email_primary: "giang@example.test" },
    { id: P(7), full_name: "Hà Duyệt Tay", email_primary: "ha@example.test" },
    { id: P(8), full_name: "Khoa Đạt Phỏng Vấn", email_primary: "khoa@example.test" },
    { id: P(9), full_name: "Lan Tài Khoản Support", email_primary: "lan@example.test" }
  ];
  db.tables.mentee_exemptions = [
    exemption(1, P(1)),
    exemption(2, P(2), { send_count: 1, first_sent_at: new Date(NOW - 2 * HOURS).toISOString(), last_sent_at: new Date(NOW - 2 * HOURS).toISOString() }),
    exemption(3, P(3), { send_count: 1, last_sent_at: new Date(NOW - 30 * HOURS).toISOString(), confirmed_at: new Date(NOW - 26 * HOURS).toISOString() }),
    exemption(4, P(4), { revoked_at: new Date(NOW - HOURS).toISOString() }),
    exemption(5, P(5))
  ];
  db.tables.applications = [
    { id: "app-cuc", season_id: SEASON, person_id: P(3), email_primary: "cuc@example.test", status: "approved_as_mentee", role_applied: "mentee" },
    { id: "app-binh", season_id: SEASON, person_id: null, email_primary: "BINH@example.test", status: "interview_scheduled", role_applied: "mentee" },
    { id: "app-ha", season_id: SEASON, person_id: P(7), email_primary: "ha@example.test", status: "approved_as_mentee", role_applied: "mentee" },
    { id: "app-khoa", season_id: SEASON, person_id: P(8), email_primary: "khoa@example.test", status: "approved_as_mentee", role_applied: "mentee" },
    // Đơn mentor của cùng người và đơn mentee mùa khác: không liên quan.
    { id: "app-mentor", season_id: SEASON, person_id: P(6), email_primary: "giang@example.test", status: "approved_as_mentor", role_applied: "mentor" },
    { id: "app-old", season_id: "season-old", person_id: P(6), email_primary: "giang@example.test", status: "approved_as_mentee", role_applied: "mentee" }
  ];
  db.tables.person_season_memberships = [
    { id: "m6", season_id: SEASON, person_id: P(6), role: "mentee", status: "active" },
    { id: "m7", season_id: SEASON, person_id: P(7), role: "mentee", status: "active" },
    { id: "m8", season_id: SEASON, person_id: P(8), role: "mentee", status: "active" },
    { id: "m3", season_id: SEASON, person_id: P(3), role: "mentee", status: "active" }
  ];
  db.tables.mentee_interview_operations = [{ id: "app-khoa", outcome: "passed" }];
  db.tables.admin_users = [
    { id: "u-support", email: "lan@example.test", role: "support_team", status: "active" },
    { id: "u-support-off", email: "giang@example.test", role: "support_team", status: "inactive" },
    { id: "u-core", email: "ha@example.test", role: "core_team", status: "active" }
  ];
  db.tables.outbound_emails = [];
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  formActions.length = 0;
  db.reset();
  seed();
  rpcCalls = [];
  rpcResult = () => ({ data: { ok: true, results: [] }, error: null });
  const client = fakeClient(db, {
    rpc: (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return rpcResult(fn, args);
    }
  });
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as any);
  vi.mocked(getSupabaseServerClient).mockResolvedValue(client as any);
  vi.mocked(getCurrentAdminUser).mockResolvedValue(CORE as any);
  vi.mocked(sendMenteeExemptionConfirm).mockResolvedValue({ ok: true, skipped: false } as any);
});

const writesTo = (table: string) => db.writes.filter((w) => w.table === table);
const row = (n: number) => db.tables.mentee_exemptions.find((r) => r.id === E(n));
const asRole = (role: string) => vi.mocked(getCurrentAdminUser).mockResolvedValue({ ...CORE, role } as any);
const withoutScope = () => { db.tables.admin_scope_access = []; };

describe("bảng cho BTC", () => {
  it("đếm đúng theo bước, liệt kê theo tên, kèm trạng thái đơn mùa này của từng người", async () => {
    const result = await getExemptionBoard(NOW);
    if (!result.ok) throw new Error(result.message);
    const { data } = result;

    expect(data.counts).toEqual({ listed: 4, confirmed: 1, waiting: 1, notSent: 2, revoked: 1 });
    expect(data.items.map((i) => [i.name, i.state, i.applicationStatus])).toEqual([
      ["An Chưa Gửi", "not_sent", null],
      // Đơn nộp qua form mới chưa nối hồ sơ người: khớp theo email, không phân biệt hoa thường.
      ["Bình Đã Gửi", "sent", "interview_scheduled"],
      ["Cúc Đã Xác Nhận", "confirmed", "approved_as_mentee"],
      ["Dũng Bị Gỡ", "revoked", null],
      ["Én Không Email", "not_sent", null]
    ]);
    expect(data.canEdit).toBe(true);
    expect(data.seasonCode).toBe("UEHM-S12");
  });

  it("gợi ý đúng người có dấu hiệu, bỏ người đã qua phỏng vấn và người đã trong danh sách", async () => {
    const result = await getExemptionBoard(NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.candidates.map((c) => [c.name, c.signals])).toEqual([
      // Người từng bị gỡ được gợi ý lại (có tài khoản? không — không dấu hiệu nào) nên KHÔNG có ở đây.
      ["Giang Gắn Tay", ["membership_without_interview"]],
      ["Hà Duyệt Tay", ["approved_without_interview"]],
      ["Lan Tài Khoản Support", ["support_account"]]
    ]);
  });

  it("người đã bị gỡ mà vẫn có dấu hiệu thì được gợi ý lại — để BTC thêm lại được khi gỡ nhầm", async () => {
    db.tables.person_season_memberships.push({ id: "m4", season_id: SEASON, person_id: P(4), role: "mentee", status: "active" });
    const result = await getExemptionBoard(NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.candidates.map((c) => c.name)).toContain("Dũng Bị Gỡ");
    // Người đang trong danh sách (chưa bị gỡ) thì không, dù cũng có dấu hiệu.
    db.tables.person_season_memberships.push({ id: "m1", season_id: SEASON, person_id: P(1), role: "mentee", status: "active" });
    const again = await getExemptionBoard(NOW);
    if (!again.ok) throw new Error(again.message);
    expect(again.data.candidates.map((c) => c.name)).not.toContain("An Chưa Gửi");
  });

  it("tài khoản Support team đã tắt không tạo ra gợi ý; tài khoản Core team cũng không", async () => {
    const result = await getExemptionBoard(NOW);
    if (!result.ok) throw new Error(result.message);
    const giang = result.data.candidates.find((c) => c.name === "Giang Gắn Tay");
    expect(giang?.signals).not.toContain("support_account");
    expect(result.data.candidates.find((c) => c.name === "Hà Duyệt Tay")?.signals).toEqual(["approved_without_interview"]);
  });

  it("số người đang chờ thư: chưa gửi và có email — không tính người vừa nhận thư, đã xác nhận, đã gỡ, thiếu email", async () => {
    const result = await getExemptionBoard(NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.pending).toBe(1);
  });

  it("có vai trò nhưng thiếu quyền vận hành mùa: vẫn xem được, không sửa được", async () => {
    withoutScope();
    const result = await getExemptionBoard(NOW);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.canEdit).toBe(false);
    expect(result.data.items).toHaveLength(5);
  });

  it("đọc không ra dữ liệu thì báo lỗi, không dựng bảng rỗng trông như thật", async () => {
    db.errors.mentee_exemptions = { message: "boom" };
    expect(await getExemptionBoard(NOW)).toEqual({ ok: false, message: "Hệ thống đang bận, thử lại sau ít phút." });
  });

  // Mất một trong các bảng này thì phần GỢI Ý sai theo: thiếu bảng phỏng vấn là gợi ý đặc
  // cách cho người đã phỏng vấn; thiếu bảng đơn là coi ai cũng "chưa có đơn". Thà báo lỗi.
  it.each(["applications", "person_season_memberships", "mentee_interview_operations", "admin_users", "people"])(
    "đọc lỗi ở bảng %s cũng báo lỗi, không dựng bảng với gợi ý sai",
    async (table) => {
      db.errors[table] = { message: "boom" };
      expect(await getExemptionBoard(NOW)).toEqual({ ok: false, message: "Hệ thống đang bận, thử lại sau ít phút." });
    }
  );
});

describe("BTC thêm và gỡ người", () => {
  it("thêm: gọi đúng một hàm database với người đang bấm, mùa hiện tại và đúng các mã đã chọn", async () => {
    rpcResult = () => ({ data: { ok: true, results: [{ personId: P(6), code: "added" }, { personId: P(7), code: "application_closed" }] }, error: null });
    const result = await addMenteeExemptions([P(6), P(7), P(6), "không-phải-uuid", ""]);

    expect(rpcCalls).toEqual([{ fn: "vam117_add_mentee_exemptions", args: { p_actor: "admin-core", p_season: SEASON, p_people: [P(6), P(7)] } }]);
    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      "Đã thêm 1 người vào danh sách đặc cách. 1 người chưa thêm được: Hà Duyệt Tay — đơn mentee mùa này đã bị từ chối hoặc đã rút."
    );
  });

  it("không chọn ai, hoặc chỉ gửi mã rác: không gọi database", async () => {
    expect((await addMenteeExemptions([])).ok).toBe(false);
    expect((await addMenteeExemptions(["x", "123"])).ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    ["Support team", () => asRole("support_team")],
    ["mentor chấm hồ sơ", () => asRole("reviewer")],
    ["Core team thiếu quyền vận hành mùa", () => withoutScope()],
    ["chưa đăng nhập", () => vi.mocked(getCurrentAdminUser).mockResolvedValue(null as any)]
  ])("%s không thêm, không gỡ, không gửi được — không lệnh ghi, không thư nào đi", async (_label, arrange) => {
    arrange();
    const refused = "Bạn không có quyền quản lý danh sách đặc cách của mùa này.";
    expect(await addMenteeExemptions([P(6)])).toEqual({ ok: false, message: refused });
    expect(await revokeMenteeExemption(E(1))).toEqual({ ok: false, message: refused });
    expect((await runMenteeExemptionDispatch({ now: () => NOW })).message).toBe(refused);
    expect((await sendMenteeExemptionTest(NOW)).message).toBe(refused);

    expect(rpcCalls).toEqual([]);
    expect(db.writes).toEqual([]);
    expect(sendMenteeExemptionConfirm).not.toHaveBeenCalled();
  });

  it("gỡ: gọi đúng hàm với đúng dòng; mã sai hình dạng thì không gọi", async () => {
    expect(await revokeMenteeExemption("abc")).toEqual({ ok: false, message: "Dữ liệu không hợp lệ — tải lại trang rồi thử lại." });
    expect(rpcCalls).toEqual([]);

    const result = await revokeMenteeExemption(E(1));
    expect(rpcCalls).toEqual([{ fn: "vam117_revoke_mentee_exemption", args: { p_actor: "admin-core", p_season: SEASON, p_id: E(1) } }]);
    expect(result.ok).toBe(true);
  });

  it("gỡ người đã xác nhận: nói rõ vì sao không gỡ được, không báo lỗi chung chung", async () => {
    rpcResult = () => ({ data: null, error: { message: "ALREADY_CONFIRMED" } });
    const result = await revokeMenteeExemption(E(3));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã xác nhận tham gia rồi");
  });

  it("action: gỡ và gửi thật đòi dấu xác nhận của bước hai; thiếu thì không làm gì", async () => {
    const form = (entries: Record<string, string>) => {
      const data = new FormData();
      for (const [k, v] of Object.entries(entries)) data.set(k, v);
      return data;
    };
    expect(await revokeMenteeExemptionAction(EXEMPTION_IDLE, form({ exemptionId: E(1) }))).toEqual({ status: "error", message: "Cần bấm xác nhận trước khi gỡ." });
    expect(await sendMenteeExemptionInvitesAction(EXEMPTION_IDLE, form({}))).toEqual({ status: "error", message: "Cần bấm xác nhận trước khi gửi." });
    expect(rpcCalls).toEqual([]);
    expect(sendMenteeExemptionConfirm).not.toHaveBeenCalled();

    expect((await revokeMenteeExemptionAction(EXEMPTION_IDLE, form({ exemptionId: E(1), confirmed: "yes" }))).status).toBe("ok");
    expect(rpcCalls.map((c) => c.fn)).toEqual(["vam117_revoke_mentee_exemption"]);
  });

  it("action thêm: đọc mọi ô personId đã tick trong biểu mẫu", async () => {
    rpcResult = () => ({ data: { ok: true, results: [{ personId: P(6), code: "added" }, { personId: P(9), code: "added" }] }, error: null });
    const data = new FormData();
    data.append("personId", P(6));
    data.append("personId", P(9));
    const state = await addMenteeExemptionsAction(EXEMPTION_IDLE, data);
    expect(rpcCalls[0].args.p_people).toEqual([P(6), P(9)]);
    expect(state).toEqual({ status: "ok", message: "Đã thêm 2 người vào danh sách đặc cách." });
  });
});

describe("gửi thư mời xác nhận", () => {
  const dispatch = () => runMenteeExemptionDispatch({ now: () => NOW });

  it("chỉ người chưa nhận thư và có email được gửi — đúng một thư, đúng link của chính họ", async () => {
    const result = await dispatch();

    expect(sendMenteeExemptionConfirm).toHaveBeenCalledTimes(1);
    expect(sendMenteeExemptionConfirm).toHaveBeenCalledWith({
      toEmail: "an@example.test", recipientName: "An Chưa Gửi", seasonLabel: expect.any(String),
      token: T(1), exemptionId: E(1), requestOrigin: "https://os.test"
    });
    expect(result).toEqual({ ok: true, message: "Đã gửi 1 thư mời xác nhận.", sent: 1, failed: 0 });
    expect(row(1)).toMatchObject({ send_count: 1, first_sent_at: new Date(NOW).toISOString(), last_sent_at: new Date(NOW).toISOString(), claimed_at: null, last_error: null });
    // Không ai khác bị chạm.
    expect(row(2).send_count).toBe(1);
    expect(row(3).send_count).toBe(1);
    expect(row(4).send_count).toBe(0);
    expect(row(5).send_count).toBe(0);
  });

  it("bấm lại ngay sau đó: không ai nhận thư thứ hai", async () => {
    await dispatch();
    vi.mocked(sendMenteeExemptionConfirm).mockClear();
    const again = await dispatch();
    expect(sendMenteeExemptionConfirm).not.toHaveBeenCalled();
    expect(again).toEqual({ ok: true, message: "Không còn ai chờ thư mời xác nhận.", sent: 0, failed: 0 });
  });

  it("sau 20 giờ: người chưa xác nhận được nhắc, giữ nguyên mốc thư đầu; người đã xác nhận không nhận thêm", async () => {
    const firstSent = new Date(NOW - 21 * HOURS).toISOString();
    Object.assign(row(2), { first_sent_at: firstSent, last_sent_at: firstSent });
    Object.assign(row(1), { send_count: 1, first_sent_at: new Date(NOW - HOURS).toISOString(), last_sent_at: new Date(NOW - HOURS).toISOString() });

    await dispatch();

    expect(vi.mocked(sendMenteeExemptionConfirm).mock.calls.map(([input]) => input.toEmail)).toEqual(["binh@example.test"]);
    expect(row(2)).toMatchObject({ send_count: 2, first_sent_at: firstSent, last_sent_at: new Date(NOW).toISOString() });
    expect(row(3).send_count).toBe(1);
  });

  it("claim trước khi gửi: dòng đang được một lượt gửi khác giữ thì bỏ qua", async () => {
    row(1).claimed_at = new Date(NOW - 60_000).toISOString();
    const result = await dispatch();
    expect(sendMenteeExemptionConfirm).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    // Claim của lượt kia còn nguyên.
    expect(row(1).claimed_at).toBe(new Date(NOW - 60_000).toISOString());
  });

  it("claim treo quá 10 phút của một lượt đã chết được nhả rồi gửi tiếp", async () => {
    row(1).claimed_at = new Date(NOW - 11 * 60_000).toISOString();
    const result = await dispatch();
    expect(result.sent).toBe(1);
    expect(row(1).claimed_at).toBeNull();
  });

  it("lệnh claim mang điều kiện 'chưa ai giữ'; lệnh chốt mang đúng dấu claim của lượt này", async () => {
    await dispatch();
    const updates = writesTo("mentee_exemptions");
    const claim = updates.find((w) => w.rows[0].claimed_at === new Date(NOW).toISOString());
    expect(claim?.filters).toContain('"kind":"isNull","column":"claimed_at"');
    expect(claim?.filters).toContain(E(1));
    const finalize = updates.find((w) => w.rows[0].send_count === 1);
    expect(finalize?.filters).toContain(`"column":"claimed_at","value":"${new Date(NOW).toISOString()}"`);
    expect(finalize?.filters).toContain(`"column":"id","value":"${E(1)}"`);
  });

  it("gửi lỗi: không tăng số lần gửi, ghi lý do, nhả claim để lần sau gửi lại", async () => {
    vi.mocked(sendMenteeExemptionConfirm).mockResolvedValue({ ok: false, skipped: false, reason: "Hộp thư từ chối" } as any);
    const result = await dispatch();
    expect(result).toMatchObject({ ok: true, sent: 0, failed: 1 });
    expect(result.message).toContain("1 thư lỗi");
    expect(row(1)).toMatchObject({ send_count: 0, last_sent_at: null, claimed_at: null, last_error: "Hộp thư từ chối" });
  });

  it("môi trường tắt gửi thư: không tính là lỗi, không đốt lượt", async () => {
    vi.mocked(sendMenteeExemptionConfirm).mockResolvedValue({ ok: true, skipped: true, reason: "tắt" } as any);
    const result = await dispatch();
    expect(result).toMatchObject({ sent: 0, failed: 0 });
    expect(row(1)).toMatchObject({ send_count: 0, last_sent_at: null, claimed_at: null });
  });

  it("nhà cung cấp báo 429: dừng ngay, nhả những người chưa gửi", async () => {
    db.tables.people.push({ id: P(10), full_name: "Minh Thứ Hai", email_primary: "minh@example.test" });
    db.tables.mentee_exemptions.push(exemption(6, P(10)));
    vi.mocked(sendMenteeExemptionConfirm).mockResolvedValueOnce({ ok: false, skipped: false, reason: "429", providerStatus: 429 } as any);

    const result = await dispatch();

    expect(sendMenteeExemptionConfirm).toHaveBeenCalledTimes(1);
    expect(result.message).toContain("chạm trần");
    expect(row(1).claimed_at).toBeNull();
    expect(row(6).claimed_at).toBeNull();
    expect(row(6).send_count).toBe(0);
  });

  it("đã chạm phần hạn mức thư 24 giờ: không gửi, không claim", async () => {
    db.tables.outbound_emails = Array.from({ length: 920 }, (_, i) => ({ id: `o${i}`, status: "sent", created_at: new Date(NOW - HOURS).toISOString() }));
    const result = await dispatch();
    expect(sendMenteeExemptionConfirm).not.toHaveBeenCalled();
    expect(result.message).toContain("hạn mức");
    expect(writesTo("mentee_exemptions")).toEqual([]);
  });

  it("hạn mức chỉ còn chỗ cho một thư: gửi đúng một, người còn lại chờ lượt sau — theo thứ tự được thêm", async () => {
    db.tables.people.push({ id: P(10), full_name: "Minh Thứ Hai", email_primary: "minh@example.test" });
    db.tables.mentee_exemptions.push(exemption(6, P(10)));
    // 1.000 − 80 chừa lại − 919 đã gửi = còn đúng 1 thư cho lượt này.
    db.tables.outbound_emails = Array.from({ length: 919 }, (_, i) => ({ id: `o${i}`, status: "sent", created_at: new Date(NOW - HOURS).toISOString() }));

    const result = await dispatch();

    expect(vi.mocked(sendMenteeExemptionConfirm).mock.calls.map(([input]) => input.toEmail)).toEqual(["an@example.test"]);
    expect(result.message).toBe("Đã gửi 1 thư mời xác nhận. Còn 1 người chờ thư — bấm lại để gửi tiếp.");
    expect(row(6)).toMatchObject({ send_count: 0, claimed_at: null });
  });

  it("gửi thử: tới chính người bấm, không mang link thật, không chạm dòng nào", async () => {
    const result = await sendMenteeExemptionTest(NOW);
    expect(sendMenteeExemptionConfirm).toHaveBeenCalledWith({
      toEmail: "core@example.test", recipientName: "Chị BTC", seasonLabel: expect.any(String), token: null, exemptionId: null
    });
    expect(result).toEqual({ ok: true, message: "Đã gửi thư thử tới core@example.test.", sent: 1, failed: 0 });
    expect(db.writes).toEqual([]);
    expect((await sendMenteeExemptionTestAction(EXEMPTION_IDLE, new FormData())).status).toBe("ok");
  });
});

describe("trang người nhận /xac-nhan-mentee/[token]", () => {
  const renderConfirm = async (token: string) => render(<>{await MenteeConfirmPage({ params: Promise.resolve({ token }) })}</>).container;

  it("link hợp lệ: chào đúng tên, có đúng một nút xác nhận, không lộ email — và mở trang không ghi gì", async () => {
    const page = await renderConfirm(T(1));

    expect(page.querySelector("h1")?.textContent).toBe("Chào An Chưa Gửi");
    const ready = within(page).getByTestId("confirm-ready");
    expect(within(ready).getAllByRole("button").map((b) => b.textContent)).toEqual(["Xác nhận tham gia"]);
    expect(ready.textContent).toContain("mà không cần qua vòng phỏng vấn");
    expect(page.textContent).not.toContain("an@example.test");
    expect(rpcCalls).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("biểu mẫu không mang mã trong ô ẩn: mã đi qua tham số đã bind của action", async () => {
    const page = await renderConfirm(T(1));
    const form = within(page).getByTestId("confirm-form");
    expect(form.querySelectorAll("input")).toHaveLength(0);
    expect(page.innerHTML).not.toContain(T(1));
  });

  it.each([
    ["đã xác nhận", T(3), "confirm-already", "Bạn đã xác nhận tham gia"],
    ["đã bị gỡ", T(4), "confirm-blocked", "thu hồi"],
    ["mã không có trong danh sách", T(99), "confirm-blocked", "Đường dẫn không đúng"],
    ["mã sai hình dạng", "abc", "confirm-blocked", "Đường dẫn không đúng"]
  ])("link %s: không có nút xác nhận", async (_label, token, testId, text) => {
    const page = await renderConfirm(token);
    expect(within(page).getByTestId(testId).textContent).toContain(text);
    expect(within(page).queryByRole("button")).toBeNull();
    expect(within(page).queryByTestId("confirm-form")).toBeNull();
  });

  it("link sai không gọi tên ai", async () => {
    expect((await getExemptionConfirmPage(T(99))).name).toBeNull();
    expect((await renderConfirm("abc")).querySelector("h1")?.textContent).toBe("Xác nhận tham gia Mentee");
  });

  it("bấm xác nhận: gọi đúng một hàm database với đúng mã, trả lời theo mã kết quả", async () => {
    rpcResult = () => ({ data: { ok: true, code: "confirmed" }, error: null });
    const state = await confirmMenteeExemptionAction(T(1), EXEMPTION_IDLE, new FormData());
    expect(rpcCalls).toEqual([{ fn: "vam117_confirm_mentee_exemption", args: { p_token: T(1) } }]);
    expect(state.status).toBe("ok");
    expect(state.message).toContain("ghi nhận");
  });

  it.each([
    ["already_confirmed", true, "đã xác nhận trước đó"],
    ["revoked", false, "thu hồi"],
    ["invalid_token", false, "Đường dẫn không đúng"],
    ["needs_btc", false, "chưa có gì bị thay đổi"]
  ])("kết quả %s được nói bằng lời", async (code, ok, text) => {
    rpcResult = () => ({ data: { ok, code, reason: "application_closed" }, error: null });
    const result = await confirmMenteeExemption(T(1));
    expect(result.ok).toBe(ok);
    expect(result.message).toContain(text);
    // Lý do kỹ thuật không lọt ra màn hình của người nhận.
    expect(result.message).not.toContain("application_closed");
  });

  it("mã sai hình dạng không tới được database; database lỗi thì báo bận, không báo thành công", async () => {
    expect((await confirmMenteeExemption("abc")).ok).toBe(false);
    expect(rpcCalls).toEqual([]);
    rpcResult = () => ({ data: null, error: { message: "boom" } });
    expect(await confirmMenteeExemption(T(1))).toEqual({ ok: false, message: "Hệ thống đang bận, thử lại sau ít phút." });
  });

  it("nút trên trang nối với action xác nhận đã bind đúng mã của trang", async () => {
    rpcResult = () => ({ data: { ok: true, code: "confirmed" }, error: null });
    await renderConfirm(T(2));
    const bound = formActions[formActions.length - 1].action as (prev: unknown, form: FormData) => Promise<unknown>;
    await bound(EXEMPTION_IDLE, new FormData());
    expect(rpcCalls).toEqual([{ fn: "vam117_confirm_mentee_exemption", args: { p_token: T(2) } }]);
  });
});

describe("trang BTC /applications/mentee-dac-cach", () => {
  // Trang tự lấy giờ hiện tại để quyết định ai "đang chờ thư" (thư gần nhất cũ hơn 20 giờ
  // thì gửi lại được), còn dữ liệu mẫu thì gắn với NOW. Đồng hồ phải đứng ở NOW: không thì
  // bộ test xanh đúng ngày viết rồi tự đỏ sau 20 giờ — đã xảy ra, đỏ từ 12/10/2026 và chỉ
  // lộ ra khi ghép main ngày 13/10. Chỉ giả Date; setTimeout để thật cho testing-library.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: NOW }); });
  afterEach(() => { vi.useRealTimers(); });

  const renderPage = async () => render(<>{await MenteeExemptionPage()}</>).container;

  it("hiện bốn con số, danh sách đúng thứ tự và đúng trạng thái từng dòng", async () => {
    const page = await renderPage();
    const kpis = within(page).getByTestId("exemption-kpis").textContent ?? "";
    expect(kpis).toContain("Trong danh sách4");
    expect(kpis).toContain("Đã xác nhận1");
    expect(kpis).toContain("Đã gửi thư, chờ xác nhận1");
    expect(kpis).toContain("Chưa gửi thư2");

    const rows = Array.from(within(page).getByTestId("exemption-list").querySelectorAll("tbody tr"));
    expect(rows.map((r) => [r.querySelector("td")?.textContent, r.getAttribute("data-state")])).toEqual([
      ["An Chưa Gửi", "not_sent"], ["Bình Đã Gửi", "sent"], ["Cúc Đã Xác Nhận", "confirmed"], ["Dũng Bị Gỡ", "revoked"], ["Én Không Email", "not_sent"]
    ]);
    // Cột đơn nói rõ bấm xác nhận sẽ làm gì với từng người.
    expect(rows[0].textContent).toContain("Chưa có đơn — khi xác nhận, hệ thống tạo một đơn đặc cách");
    expect(rows[1].textContent).toContain("khi xác nhận, đơn được duyệt");
    expect(rows[2].textContent).toContain("Đã duyệt");
  });

  it("nút gỡ chỉ có ở người chưa xác nhận và chưa bị gỡ", async () => {
    const page = await renderPage();
    const rows = Array.from(within(page).getByTestId("exemption-list").querySelectorAll("tbody tr"));
    const hasRevoke = rows.map((r) => Boolean(r.querySelector("[data-testid='exemption-revoke']")));
    expect(hasRevoke).toEqual([true, true, false, false, true]);
  });

  it("gỡ là hai bước ngay trên trang: bấm lần đầu chỉ mở câu hỏi, form bước hai mang đúng dòng và dấu xác nhận", async () => {
    const page = await renderPage();
    const first = within(page).getByTestId("exemption-list").querySelector("tbody tr") as HTMLElement;
    expect(first.querySelector("form")).toBeNull();

    fireEvent.click(within(first).getByRole("button", { name: "Gỡ khỏi danh sách" }));

    const form = first.querySelector("form") as HTMLFormElement;
    expect(form.textContent).toContain("Gỡ An Chưa Gửi khỏi danh sách?");
    const data = new FormData(form);
    expect(data.get("exemptionId")).toBe(E(1));
    expect(data.get("confirmed")).toBe("yes");
    fireEvent.click(within(first).getByRole("button", { name: "Giữ lại" }));
    expect(first.querySelector("form")).toBeNull();
  });

  it("gợi ý: mặc định không tick ai, nút thêm bị khoá cho tới khi BTC tick", async () => {
    const page = await renderPage();
    const picker = within(page).getByTestId("exemption-candidates");
    const boxes = within(picker).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => [b.value, b.checked])).toEqual([[P(6), false], [P(7), false], [P(9), false]]);
    const add = within(picker).getByRole("button", { name: /^Thêm \d+ người đã chọn vào danh sách$/ }) as HTMLButtonElement;
    expect(add.textContent).toBe("Thêm 0 người đã chọn vào danh sách");
    expect(add.disabled).toBe(true);

    fireEvent.click(boxes[1]);
    expect(add.textContent).toBe("Thêm 1 người đã chọn vào danh sách");
    expect(add.disabled).toBe(false);
    expect(new FormData(picker as HTMLFormElement).getAll("personId")).toEqual([P(7)]);

    fireEvent.click(within(picker).getByRole("button", { name: "Chọn tất cả" }));
    expect(new FormData(picker as HTMLFormElement).getAll("personId")).toEqual([P(6), P(7), P(9)]);
    fireEvent.click(within(picker).getByRole("button", { name: "Bỏ chọn" }));
    expect(new FormData(picker as HTMLFormElement).getAll("personId")).toEqual([]);
  });

  it("gợi ý nói rõ vì sao từng người được gợi ý", async () => {
    const page = await renderPage();
    const rows = Array.from(within(page).getByTestId("exemption-candidates").querySelectorAll("tbody tr"));
    expect(rows.map((r) => r.getAttribute("data-person"))).toEqual([P(6), P(7), P(9)]);
    expect(rows[0].textContent).toContain("Được gắn tay tư cách mentee mùa này, chưa có đơn");
    expect(rows[1].textContent).toContain("Đơn mentee được duyệt tay, không có phiếu phỏng vấn");
    expect(rows[2].textContent).toContain("Có tài khoản vai trò Support team");
  });

  it("gửi thư là hai bước: bấm lần đầu chỉ hỏi lại con số, form bước hai mới mang dấu xác nhận", async () => {
    const page = await renderPage();
    const panel = within(page).getByTestId("exemption-send");
    expect(panel.textContent).toContain("Đang chờ thư: 1 người");
    expect(panel.querySelector("input[name='confirmed']")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Gửi thư mời xác nhận (tối đa 1 thư)" }));

    expect(panel.textContent).toContain("Gửi 1 thư mời xác nhận tới người thật?");
    expect((panel.querySelector("input[name='confirmed']") as HTMLInputElement).value).toBe("yes");
    fireEvent.click(within(panel).getByRole("button", { name: "Huỷ" }));
    expect(panel.querySelector("input[name='confirmed']")).toBeNull();
  });

  it("không ai chờ thư thì không có nút gửi thật, chỉ có lời giải thích", async () => {
    Object.assign(row(1), { send_count: 1, last_sent_at: new Date(Date.now() - HOURS).toISOString() });
    const page = await renderPage();
    const panel = within(page).getByTestId("exemption-send");
    expect(within(panel).queryByRole("button", { name: /Gửi thư mời xác nhận/ })).toBeNull();
    expect(panel.textContent).toContain("Không có ai đang chờ thư");
    // Gửi thử vẫn dùng được.
    expect(within(panel).getByRole("button", { name: "Gửi thử cho tôi" })).toBeTruthy();
  });

  it("Core team thiếu quyền vận hành mùa: xem được danh sách, không có nút nào để ghi", async () => {
    withoutScope();
    const page = await renderPage();
    expect(within(page).getByTestId("exemption-readonly").textContent).toContain("chỉ để xem");
    expect(within(page).getByTestId("exemption-list").querySelectorAll("tbody tr")).toHaveLength(5);
    expect(within(page).queryByTestId("exemption-send")).toBeNull();
    expect(within(page).queryByTestId("exemption-candidates")).toBeNull();
    expect(page.querySelector("[data-testid='exemption-revoke']")).toBeNull();
    expect(within(page).getByTestId("exemption-candidates-readonly").textContent).toContain("Giang Gắn Tay");
    expect(page.querySelectorAll("button, form")).toHaveLength(0);
  });

  it.each(["support_team", "reviewer", "viewer"])("vai trò %s không xem được trang — không tên, không email nào hiện ra", async (role) => {
    asRole(role);
    const page = await renderPage();
    expect(page.textContent).toContain("Trang này dành cho ban tổ chức");
    expect(page.textContent).not.toContain("An Chưa Gửi");
    expect(page.textContent).not.toContain("@example.test");
    expect(db.requests.filter((r) => r.table === "mentee_exemptions")).toEqual([]);
  });

  it("chưa đăng nhập thì bị đưa về trang đăng nhập", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as any);
    await expect(MenteeExemptionPage()).rejects.toThrow("REDIRECT");
  });

  it("danh sách trống và không còn gợi ý: nói rõ, không vẽ bảng rỗng", async () => {
    db.tables.mentee_exemptions = [];
    db.tables.person_season_memberships = [];
    db.tables.applications = [];
    db.tables.admin_users = [];
    const page = await renderPage();
    expect(within(page).queryByTestId("exemption-list")).toBeNull();
    expect(page.textContent).toContain("Danh sách đang trống");
    expect(page.textContent).toContain("Không còn ai để gợi ý");
  });
});
