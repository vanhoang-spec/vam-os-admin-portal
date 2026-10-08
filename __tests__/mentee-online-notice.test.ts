/**
 * Thư báo "ca của bạn chuyển sang PHỎNG VẤN ONLINE" (BTC 08/10/2026, chiều 10/10).
 *
 * Soát ba thứ dễ hỏng lặng lẽ: gửi nhầm người (ca trực tiếp, ca đã qua, hồ sơ đã rời
 * bước phỏng vấn), gửi trùng (đánh dấu TRƯỚC khi gửi, gửi hỏng thì xoá dấu), và thư thử
 * mang link riêng của một mentee thật tới hộp thư người bấm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  btc: { ok: true } as any,
  actor: { id: "admin-1", email: "btc@example.test", full_name: "BTC Thử" } as any,
  sessions: [] as any[],
  bookings: [] as any[],
  apps: [] as any[],
  invites: [] as any[],
  sentInWindow: 100 as number | null,
  send: vi.fn(),
  calls: [] as any[],
  log: [] as string[],
  taken: new Set<string>()
}));

function makeClient() {
  return {
    from(table: string) {
      const call: any = { table, values: null, filters: [] as any[] };
      mocks.calls.push(call);
      const b: any = {
        update: (v: any) => { call.values = v; return b; },
        eq: (c: string, v: any) => { call.filters.push(["eq", c, v]); return b; },
        is: (c: string, v: any) => { call.filters.push(["is", c, v]); return b; },
        select: () => {
          const id = call.filters.find((f: any) => f[1] === "id")?.[2];
          mocks.log.push(`claim:${id}`);
          return Promise.resolve({ data: mocks.taken.has(id) ? [] : [{ id }], error: null });
        },
        then: (res: any, rej: any) => {
          if (call.values && call.values.online_notified_at === null) mocks.log.push(`release:${call.filters.find((f: any) => f[1] === "id")?.[2]}`);
          return Promise.resolve({ error: null }).then(res, rej);
        }
      };
      return b;
    }
  };
}

vi.mock("@/lib/mentee-session-admin", () => ({
  requireBtc: async () => (mocks.btc.ok ? { ok: true, client: makeClient(), seasonId: "season-12" } : mocks.btc),
  requireSessionViewer: async () => ({ ok: true, client: makeClient(), seasonId: "season-12" })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.actor }));
vi.mock("@/lib/email", () => ({ sendTemplatedEmail: mocks.send }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: async () => "https://os.example.test" }));
vi.mock("@/lib/mentee-invite-dispatch", () => ({ countSentInWindow: async () => mocks.sentInWindow }));
vi.mock("@/lib/paged-read", () => ({
  readAllPages: async () => ({ data: mocks.sessions, error: null }),
  readAllPagesIn: async (_c: unknown, table: string) => ({
    data: table === "mentee_interview_bookings" ? mocks.bookings : table === "applications" ? mocks.apps : mocks.invites,
    error: null
  })
}));

import { DISPATCH_MAX_PER_RUN } from "@/lib/mentee-invite-dispatch-core";
import { buildOnlineNoticeEmail, pickOnlineAudience, venueGroupUrl } from "@/lib/mentee-online-notice-core";
import { getOnlineNoticeStatus, sendOnlineNotices, sendOnlineNoticeTest } from "@/lib/mentee-online-notice";

const ZALO = "https://zalo.me/g/i2ppr7x3cj6kxchwtj16";
// Đúng câu migration 20261008153000 ghi.
const ONLINE = `PHỎNG VẤN ONLINE — Bạn tham gia nhóm Zalo ${ZALO} trước giờ ca. Support Team điều phối theo ca; tới lượt, mentor sẽ gửi link phòng phỏng vấn online cho bạn.`;
const OFFLINE = "Phòng B1-502, B1-503 — Cơ sở B, 279 Nguyễn Tri Phương. Bản đồ: https://maps.app.goo.gl/bbbb";
const NOW = "2026-10-08T09:00:00.000Z";

function session(id: string, venue: string | null, start = "2026-10-10T06:30:00.000Z", end = "2026-10-10T07:00:00.000Z") {
  mocks.sessions.push({ id, starts_at: start, ends_at: end, venue });
}
function person(id: string, sessionId: string, extra: { notified?: boolean; status?: string; token?: string | null; email?: string; season?: string } = {}) {
  mocks.bookings.push({ id: `b-${id}`, application_id: id, session_id: sessionId });
  mocks.apps.push({
    id, full_name: `Bạn ${id}`, email_primary: extra.email ?? `${id}@example.test`, status: extra.status ?? "interview_scheduled",
    role_applied: "mentee", season_id: extra.season ?? "season-12"
  });
  mocks.invites.push({
    id: `inv-${id}`, application_id: id, token: extra.token === undefined ? `tok-${id}` : extra.token,
    online_notified_at: extra.notified ? "2026-10-08T08:00:00.000Z" : null
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.assign(mocks, {
    btc: { ok: true }, sessions: [], bookings: [], apps: [], invites: [], calls: [], log: [], taken: new Set(), sentInWindow: 100
  });
  mocks.send.mockReset();
  mocks.send.mockImplementation(async (input: any) => {
    mocks.log.push(`send:${input.relation?.id ?? "test"}`);
    return { ok: true, skipped: false };
  });
});

describe("ai nhận thư", () => {
  it("chỉ người đang giữ ca online chưa kết thúc, hồ sơ còn ở bước phỏng vấn, có link riêng và email", () => {
    session("on", ONLINE);
    session("off", OFFLINE, "2026-10-11T01:00:00.000Z", "2026-10-11T01:30:00.000Z");
    session("past", ONLINE, "2026-10-08T06:30:00.000Z", "2026-10-08T07:00:00.000Z");
    person("ok", "on");
    person("da-bao", "on", { notified: true });
    person("truc-tiep", "off");
    person("ca-da-qua", "past");
    person("da-co-ket-qua", "on", { status: "approved_as_mentee" });
    person("khong-token", "on", { token: null });
    person("khong-email", "on", { email: "" });
    person("mua-khac", "on", { season: "season-11" });
    const { recipients } = pickOnlineAudience({
      sessions: mocks.sessions.map((s) => ({ id: s.id, startsAtIso: s.starts_at, endsAtIso: s.ends_at, venue: s.venue })),
      bookings: mocks.bookings.map((b) => ({ applicationId: b.application_id, sessionId: b.session_id })),
      applicants: mocks.apps.map((a) => ({ id: a.id, fullName: a.full_name, email: a.email_primary, status: a.status, roleApplied: a.role_applied, seasonId: a.season_id })),
      invites: mocks.invites.map((i) => ({ id: i.id, applicationId: i.application_id, token: i.token, notifiedAt: i.online_notified_at })),
      seasonId: "season-12",
      nowIso: NOW
    });
    expect(recipients.map((r) => [r.applicationId, r.notified])).toEqual([
      ["da-bao", true],
      ["ok", false]
    ]);
    expect(recipients[1]).toMatchObject({ groupUrl: ZALO, sessionLabel: "Thứ Bảy 10/10/2026, 13:30 – 14:00 (giờ Việt Nam)" });
  });

  it("ca online mà địa điểm không có link nhóm: không gửi, và đếm để báo BTC", () => {
    const picked = pickOnlineAudience({
      sessions: [{ id: "s", startsAtIso: "2026-10-10T06:30:00.000Z", endsAtIso: "2026-10-10T07:00:00.000Z", venue: "PHỎNG VẤN ONLINE — BTC sẽ báo sau" }],
      bookings: [{ applicationId: "a", sessionId: "s" }],
      applicants: [{ id: "a", fullName: "A", email: "a@x.test", status: "interview_scheduled", roleApplied: "mentee", seasonId: "season-12" }],
      invites: [{ id: "i", applicationId: "a", token: "t", notifiedAt: null }],
      seasonId: "season-12",
      nowIso: NOW
    });
    expect(picked).toEqual({ recipients: [], sessionsWithoutLink: 1 });
  });

  it("link nhóm đọc từ địa điểm; chữ không phải http(s) thì không thành link", () => {
    expect(venueGroupUrl(ONLINE)).toBe(ZALO);
    expect(venueGroupUrl("PHỎNG VẤN ONLINE javascript:alert(1)")).toBe("");
    expect(venueGroupUrl(null)).toBe("");
  });
});

describe("nội dung thư", () => {
  it("giờ ca của chính bạn, link nhóm Zalo, cách vào phòng, link xem ca, hotline", () => {
    const mail = buildOnlineNoticeEmail({
      candidateName: "Lan", sessionLabel: "Thứ Bảy 10/10/2026, 14:00 – 14:30 (giờ Việt Nam)",
      groupUrl: ZALO, manageUrl: "https://os.example.test/dat-ca/tok", hotlineZalo: "0919144638"
    });
    expect(mail.subject).toContain("PHỎNG VẤN ONLINE");
    expect(mail.text).toContain("Chào bạn Lan,");
    expect(mail.text).toContain("vào Thứ Bảy 10/10/2026, 14:00 – 14:30 (giờ Việt Nam) được chuyển sang hình thức PHỎNG VẤN ONLINE");
    expect(mail.text).toContain(`Tham gia nhóm Zalo trước giờ ca: ${ZALO}`);
    expect(mail.text).toContain("mentor phỏng vấn sẽ gửi link phòng online cho bạn");
    expect(mail.text).toContain("https://os.example.test/dat-ca/tok");
    expect(mail.text).toContain("0919144638");
    expect(mail.text).not.toMatch(/trực tiếp|check-in|Cơ sở/i);
  });
});

describe("gửi", () => {
  beforeEach(() => {
    session("on", ONLINE);
    person("a1", "on");
    person("a2", "on");
    person("a3", "on", { notified: true });
  });

  it("trạng thái: tổng, chờ, đã nhận, thư mẫu không mang link của ai", async () => {
    const status = await getOnlineNoticeStatus();
    if (!status.ok) throw new Error(status.message);
    expect([status.total, status.pending, status.notified]).toEqual([3, 2, 1]);
    expect(status.preview?.text).toContain("(đường dẫn riêng của từng bạn)");
    expect(status.preview?.text).not.toContain("tok-");
  });

  it("đánh dấu TRƯỚC khi gửi, từng người; người đã nhận không nhận lại; thư nối về đơn, link đúng của người đó", async () => {
    const result = await sendOnlineNotices();
    expect(result).toMatchObject({ ok: true, sent: 2, failed: 0 });
    expect(mocks.log).toEqual(["claim:inv-a1", "send:a1", "claim:inv-a2", "send:a2"]);
    const claim = mocks.calls.find((c) => c.values?.online_notified_at && c.filters.some((f: any) => f[0] === "is"));
    expect(claim.filters).toContainEqual(["is", "online_notified_at", null]);
    const sentTo = mocks.send.mock.calls.map((c) => c[0]);
    expect(sentTo.map((m) => [m.toEmail, m.kind, m.relation])).toEqual([
      ["a1@example.test", "general_announcement", { table: "applications", id: "a1" }],
      ["a2@example.test", "general_announcement", { table: "applications", id: "a2" }]
    ]);
    expect(sentTo[0].body).toContain("https://os.example.test/dat-ca/tok-a1");
    expect(sentTo[0].body).not.toContain("tok-a2");
  });

  it("lượt bấm chồng đã giành người này: bỏ qua, không gửi", async () => {
    mocks.taken.add("inv-a1");
    const result = await sendOnlineNotices();
    expect(result.sent).toBe(1);
    expect(mocks.log).toEqual(["claim:inv-a1", "claim:inv-a2", "send:a2"]);
  });

  it("gửi hỏng: xoá dấu để lượt sau gửi lại; 429 thì dừng ngay", async () => {
    mocks.send.mockImplementationOnce(async (input: any) => {
      mocks.log.push(`send:${input.relation.id}`);
      return { ok: false, skipped: false, reason: "quota", providerStatus: 429 };
    });
    const result = await sendOnlineNotices();
    expect(result).toMatchObject({ ok: false, sent: 0, failed: 1 });
    expect(mocks.log).toEqual(["claim:inv-a1", "send:a1", "release:inv-a1"]);
    expect(result.message).toContain("chạm trần");
  });

  it("không đếm được thư đã gửi trong 24 giờ: không gửi gì", async () => {
    mocks.sentInWindow = null;
    const result = await sendOnlineNotices();
    expect(result.ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("mỗi lượt tối đa DISPATCH_MAX_PER_RUN thư", async () => {
    for (let i = 0; i < DISPATCH_MAX_PER_RUN + 5; i++) person(`x${i}`, "on");
    const result = await sendOnlineNotices();
    expect(result.sent).toBe(DISPATCH_MAX_PER_RUN);
    expect(result.message).toContain("bấm lại để gửi tiếp");
  });

  it("không phải BTC: từ chối, không đọc gì, không gửi gì", async () => {
    mocks.btc = { ok: false, message: "Bạn không có quyền cấu hình ca phỏng vấn." };
    expect((await sendOnlineNotices()).ok).toBe(false);
    expect((await sendOnlineNoticeTest()).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("thư thử đi tới người bấm, có chữ [THỬ], không mang link riêng của mentee nào, không đánh dấu ai", async () => {
    const result = await sendOnlineNoticeTest();
    expect(result.ok).toBe(true);
    const mail = mocks.send.mock.calls[0][0];
    expect(mail.toEmail).toBe("btc@example.test");
    expect(mail.subject.startsWith("[THỬ]")).toBe(true);
    expect(mail.body).not.toContain("tok-");
    expect(mail.relation).toBeUndefined();
    expect(mocks.log.filter((l) => l.startsWith("claim:"))).toEqual([]);
  });
});
