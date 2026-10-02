/**
 * Sửa email + gửi lại thư mời chọn ca cho MỘT ứng viên mentee.
 *
 * Khoá chính các lệnh ghi: chỉ cột email_primary, chỉ khi email trong database
 * vẫn là email người bấm thấy, lịch sử ghi TRƯỚC khi sửa; hồ sơ đã đặt ca / sai
 * bước / ca đã đóng thì không thư nào đi và không ô nào bị sửa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeApplicantEmail, resendRefusal, withinCooldown } from "@/lib/mentee-invite-resend-core";

const APP = "3eca7f2d-0bcf-4033-823d-a017dc07c4d3";
const SEASON = "11111111-1111-4111-8111-111111111111";
const WRONG = "hiepbui.31241026720@st.ueh.edu";
const RIGHT = "hiepbui.31241026720@st.ueh.edu.vn";

const mocks = vi.hoisted(() => ({
  btc: vi.fn(),
  actor: vi.fn(),
  send: vi.fn(),
  context: vi.fn(),
  quota: vi.fn(),
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  writes: [] as Array<{ table: string; op: string; payload: unknown; filters: Array<[string, unknown]> }>
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.actor }));
vi.mock("@/lib/mentee-session-admin", () => ({ requireBtc: mocks.btc }));
vi.mock("@/lib/email", () => ({ sendMenteeSessionInvite: mocks.send }));
vi.mock("@/lib/mentee-invite-dispatch", () => ({ readSessionContext: mocks.context, countSentInWindow: mocks.quota }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: async () => "https://os.alumni-mentoring.edu.vn" }));

function client() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op = "select";
      let payload: unknown = null;
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
        insert: (p: unknown) => { op = "insert"; payload = p; mocks.writes.push({ table, op, payload, filters }); return b; },
        update: (p: unknown) => { op = "update"; payload = p; mocks.writes.push({ table, op, payload, filters }); return b; },
        maybeSingle: () => Promise.resolve(mocks.tables[`${table}:single`] ?? { data: null, error: null }),
        then: (res: (v: unknown) => unknown) =>
          res(op === "select" ? mocks.tables[table] ?? { data: [], error: null } : mocks.tables[`${table}:${op}`] ?? { data: [{ id: "x" }], error: null })
      };
      return b;
    }
  };
}

import { correctEmailAndResendMenteeInvite } from "@/lib/mentee-invite-resend";

const NOW = Date.parse("2026-10-02T06:30:00Z");
const run = (over: Record<string, unknown> = {}) =>
  correctEmailAndResendMenteeInvite({ applicationId: APP, newEmail: RIGHT, expectedEmail: WRONG, nowMs: NOW, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.btc.mockResolvedValue({ ok: true, client: client(), seasonId: SEASON });
  mocks.actor.mockResolvedValue({ id: "admin-1", role: "admin" });
  mocks.context.mockResolvedValue({ anyBookable: true, deadlineLabel: "17:00 ngày 02/10/2026", daysLabel: "Thứ Bảy 03/10/2026 và Chủ nhật 04/10/2026" });
  mocks.quota.mockResolvedValue(100);
  mocks.send.mockResolvedValue({ ok: true, skipped: false });
  mocks.tables = {
    "applications:single": { data: { id: APP, full_name: "Bùi Thị Thúy Hiệp", email_primary: WRONG, role_applied: "mentee", status: "invited_to_interview", source: "vam_os_form", season_id: SEASON }, error: null },
    "mentee_interview_invites:single": { data: { id: "inv-1", token: "tok-123", send_count: 1, last_sent_at: "2026-09-30T18:02:10Z" }, error: null },
    "mentee_interview_bookings:single": { data: null, error: null }
  };
});

describe("1. đúng đường: ghi lịch sử → sửa đúng một ô → gửi thư vào email mới", () => {
  it("thứ tự và nội dung các lệnh ghi", async () => {
    const res = await run();
    expect(res).toEqual({ ok: true, message: `Đã sửa email thành ${RIGHT} và gửi lại thư mời chọn ca (hạn đặt 17:00 ngày 02/10/2026).` });
    expect(mocks.writes.map((w) => `${w.table}:${w.op}`)).toEqual(["admin_audit_log:insert", "applications:update", "mentee_interview_invites:update"]);
    const [audit, appUpdate, inviteUpdate] = mocks.writes;
    expect(audit.payload).toMatchObject({ actor_admin_user_id: "admin-1", before_data: { email_primary: WRONG }, after_data: { email_primary: RIGHT } });
    // Đường ghi hẹp: CHỈ email_primary, chỉ khi email cũ vẫn còn nguyên.
    expect(appUpdate.payload).toEqual({ email_primary: RIGHT });
    expect(appUpdate.filters).toEqual([["id", APP], ["email_primary", WRONG]]);
    expect(inviteUpdate.payload).toMatchObject({ send_count: 2, last_error: null });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ toEmail: RIGHT, bookingToken: "tok-123", applicationId: APP, candidateName: "Bùi Thị Thúy Hiệp" }));
  });
  it("email không đổi: không ghi lịch sử, không sửa hồ sơ, chỉ gửi lại", async () => {
    const res = await run({ newEmail: WRONG.toUpperCase() });
    expect(res.ok).toBe(true);
    expect(mocks.writes.map((w) => w.table)).toEqual(["mentee_interview_invites"]);
  });
});

describe("2. chặn — không ô nào bị sửa, không thư nào đi", () => {
  const nothing = () => {
    expect(mocks.writes).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
  };
  it("không qua cổng BTC", async () => {
    mocks.btc.mockResolvedValue({ ok: false, message: "Bạn không có quyền cấu hình ca phỏng vấn." });
    expect((await run()).ok).toBe(false);
    nothing();
  });
  it("email mới sai dạng (thiếu đuôi tên miền)", async () => {
    expect((await run({ newEmail: "abc@st" })).ok).toBe(false);
    nothing();
  });
  it("email trong database đã đổi khác cái người bấm thấy", async () => {
    expect((await run({ expectedEmail: "khac@example.test" })).message).toContain("vừa được đổi");
    nothing();
  });
  it("đã đặt ca", async () => {
    mocks.tables["mentee_interview_bookings:single"] = { data: { id: "b1" }, error: null };
    expect((await run()).message).toContain("đã đặt ca");
    nothing();
  });
  it("không ở bước mời phỏng vấn", async () => {
    (mocks.tables["applications:single"].data as Record<string, unknown>).status = "rejected";
    expect((await run()).ok).toBe(false);
    nothing();
  });
  it("hết hạn đặt ca / không còn ca trống", async () => {
    mocks.context.mockResolvedValue({ anyBookable: false, deadlineLabel: "", daysLabel: "" });
    expect((await run()).message).toContain("hết hạn");
    nothing();
  });
  it("không ghi được lịch sử: không sửa email, không gửi", async () => {
    mocks.tables["admin_audit_log:insert"] = { data: null, error: { message: "boom" } };
    expect((await run()).message).toContain("lịch sử");
    expect(mocks.writes.map((w) => w.table)).toEqual(["admin_audit_log"]);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sửa không trúng dòng nào (ai đó vừa đổi): không gửi", async () => {
    mocks.tables["applications:update"] = { data: [], error: null };
    expect((await run()).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("cùng địa chỉ vừa gửi chưa tới 10 phút: chặn bấm đúp", async () => {
    (mocks.tables["mentee_interview_invites:single"].data as Record<string, unknown>).last_sent_at = "2026-10-02T06:25:00Z";
    expect((await run({ newEmail: WRONG })).ok).toBe(false);
    nothing();
  });
});

describe("3. phần thuần", () => {
  it("email", () => {
    expect(normalizeApplicantEmail("  Hiep@ST.UEH.edu.VN ")).toBe("hiep@st.ueh.edu.vn");
    expect(normalizeApplicantEmail("a@b")).toBeNull();
    expect(normalizeApplicantEmail("a b@c.vn")).toBeNull();
  });
  it("điều kiện gửi lại", () => {
    const ok = { roleApplied: "mentee", status: "invited_to_interview", source: "vam_os_form", inCurrentSeason: true, hasActiveBooking: false, hasInvite: true };
    expect(resendRefusal(ok)).toBeNull();
    expect(resendRefusal({ ...ok, roleApplied: "mentor" })).not.toBeNull();
    expect(resendRefusal({ ...ok, inCurrentSeason: false })).not.toBeNull();
    expect(resendRefusal({ ...ok, hasInvite: false })).toContain("chưa có link");
  });
  it("chặn bấm đúp chỉ khi email không đổi", () => {
    expect(withinCooldown("2026-10-02T06:25:00Z", false, NOW)).toBe(true);
    expect(withinCooldown("2026-10-02T06:25:00Z", true, NOW)).toBe(false);
    expect(withinCooldown("2026-10-02T06:10:00Z", false, NOW)).toBe(false);
  });
});
