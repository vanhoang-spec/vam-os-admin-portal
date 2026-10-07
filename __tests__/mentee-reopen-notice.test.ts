import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  btc: { ok: true } as any,
  viewer: { ok: true } as any,
  actor: { id: "admin-1", email: "btc@example.test", full_name: "BTC Thử" } as any,
  invites: [] as any[],
  apps: [] as any[],
  booked: [] as any[],
  sentInWindow: 100 as number | null,
  context: { anyBookable: true, deadlineLabel: "x", daysLabel: "Chủ nhật 04/10/2026" } as any,
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
        then: (res: any, rej: any) => Promise.resolve({ error: null }).then(res, rej)
      };
      return b;
    }
  };
}

vi.mock("@/lib/mentee-session-admin", () => ({
  requireBtc: async () => (mocks.btc.ok ? { ok: true, client: makeClient(), seasonId: "season-12" } : mocks.btc),
  requireSessionViewer: async () => (mocks.viewer.ok ? { ok: true, client: makeClient(), seasonId: "season-12" } : mocks.viewer)
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: async () => mocks.actor }));
vi.mock("@/lib/email", () => ({ sendMenteeSessionReopen: mocks.send }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: async () => "https://os.example.test" }));
vi.mock("@/lib/mentee-invite-dispatch", () => ({
  countSentInWindow: async () => mocks.sentInWindow,
  readSessionContext: async () => mocks.context
}));
vi.mock("@/lib/paged-read", () => ({
  readAllPages: async () => ({ data: mocks.invites, error: null }),
  readAllPagesIn: async (_c: unknown, table: string) => ({
    data: table === "applications" ? mocks.apps : mocks.booked,
    error: null
  })
}));

import { buildMenteeSessionReopenEmail } from "@/lib/email-core";
import { bookingClosesAt, effectiveDeadlineMs, sessionState, type SessionRow } from "@/lib/mentee-interview-core";
import { DAILY_EMAIL_LIMIT, DISPATCH_RESERVE } from "@/lib/mentee-invite-dispatch-core";
import { pickReopenAudience } from "@/lib/mentee-reopen-notice-core";
import { getReopenNoticeStatus, sendReopenNotices, sendReopenNoticeTest } from "@/lib/mentee-reopen-notice";

const OPEN_UNTIL = "2026-10-03T13:00:00.000Z"; // 20:00 03/10 giờ Việt Nam
const BEFORE = "2026-10-02T15:00:00.000Z"; // 22:00 02/10

function person(id: string, extra: { notified?: boolean; status?: string; booked?: boolean; until?: string | null } = {}) {
  mocks.invites.push({
    id: `inv-${id}`, application_id: id, token: `tok-${id}`,
    booking_open_until: extra.until === undefined ? OPEN_UNTIL : extra.until,
    reopen_notified_at: extra.notified ? BEFORE : null
  });
  mocks.apps.push({
    id, full_name: `Bạn ${id}`, email_primary: `${id}@example.test`, status: extra.status ?? "invited_to_interview",
    role_applied: "mentee", source: "vam_os_form", season_id: "season-12"
  });
  if (extra.booked) mocks.booked.push({ id: `b-${id}`, application_id: id });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(BEFORE));
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.assign(mocks, {
    btc: { ok: true }, viewer: { ok: true }, invites: [], apps: [], booked: [], calls: [], log: [], taken: new Set(),
    sentInWindow: 100, context: { anyBookable: true, deadlineLabel: "x", daysLabel: "Chủ nhật 04/10/2026" }
  });
  mocks.send.mockReset();
  mocks.send.mockImplementation(async (input: any) => {
    mocks.log.push(`send:${input.applicationId ?? "test"}`);
    return { ok: true, skipped: false };
  });
});

describe("hạn hiệu lực của một người", () => {
  const row: SessionRow = {
    id: "s1", startsAtIso: "2026-10-04T01:00:00.000Z", endsAtIso: "2026-10-04T01:30:00.000Z",
    seatLimit: 10, venue: null, bookingClosesAtIso: "2026-10-02T10:00:00.000Z", status: "open"
  };

  it("hạn riêng chỉ nới, không siết", () => {
    expect(effectiveDeadlineMs(row.bookingClosesAtIso, OPEN_UNTIL)).toBe(Date.parse(OPEN_UNTIL));
    expect(effectiveDeadlineMs(row.bookingClosesAtIso, "2026-10-01T00:00:00.000Z")).toBe(Date.parse(row.bookingClosesAtIso));
    expect(effectiveDeadlineMs(row.bookingClosesAtIso, null)).toBe(Date.parse(row.bookingClosesAtIso));
    expect(effectiveDeadlineMs(row.bookingClosesAtIso, "rác")).toBe(Date.parse(row.bookingClosesAtIso));
  });

  it("ca hết hạn chung vẫn mở với người có hạn riêng — đúng như GREATEST trong vam101", () => {
    expect(sessionState(row, 0, BEFORE)).toBe("deadline_passed");
    expect(sessionState(row, 0, BEFORE, OPEN_UNTIL)).toBe("open");
    expect(sessionState(row, 10, BEFORE, OPEN_UNTIL)).toBe("full");
    expect(sessionState(row, 0, "2026-10-03T13:00:01.000Z", OPEN_UNTIL)).toBe("deadline_passed");
  });

  it("dòng 'Hạn đăng ký' nói hạn của chính người đó", () => {
    expect(bookingClosesAt([row])).toBe(row.bookingClosesAtIso);
    expect(bookingClosesAt([row], OPEN_UNTIL)).toBe(OPEN_UNTIL);
    expect(bookingClosesAt([row], "2026-10-01T00:00:00.000Z")).toBe(row.bookingClosesAtIso);
  });
});

describe("ai nhận thư mở lại", () => {
  it("chỉ người hạn riêng còn hiệu lực, đủ điều kiện, chưa có ca", () => {
    person("a");
    person("b", { booked: true });
    person("c", { status: "withdrawn" });
    person("d", { until: "2026-10-02T14:00:00.000Z" });
    person("e", { notified: true });
    const picked = pickReopenAudience({
      invites: mocks.invites.map((r) => ({ id: r.id, applicationId: r.application_id, token: r.token, openUntil: r.booking_open_until, notifiedAt: r.reopen_notified_at })),
      applicants: mocks.apps.map((a) => ({ id: a.id, fullName: a.full_name, email: a.email_primary, status: a.status, roleApplied: a.role_applied, source: a.source, seasonId: a.season_id })),
      bookedApplicationIds: new Set(["b"]),
      seasonId: "season-12",
      nowIso: BEFORE
    });
    expect(picked.map((r) => [r.applicationId, r.notified])).toEqual([["a", false], ["e", true]]);
  });
});

describe("thư mở lại", () => {
  it("nói rõ hạn mới, 2 câu hỏi bắt buộc, link riêng — không nhắc lại hạn cũ", () => {
    const mail = buildMenteeSessionReopenEmail({
      candidateName: "Lan", seasonLabel: "Mùa 12", interviewDaysLabel: "Chủ nhật 04/10/2026",
      bookingUrl: "https://os.example.test/dat-ca/tok", deadlineLabel: "20:00 ngày 03/10/2026", hotlineZalo: "0919144638"
    });
    expect(mail.subject).toContain("Mở lại chọn ca phỏng vấn đến 20:00 ngày 03/10/2026");
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("https://os.example.test/dat-ca/tok");
      expect(part).toContain("bắt buộc");
      expect(part).toContain("20:00 ngày 03/10/2026");
      expect(part).not.toContain("17:00");
      // Đợt 2 gửi cả cho người đã chọn ca đợt 1 mà vắng (07/10/2026): câu mở đầu không
      // được khẳng định “bạn chưa chọn ca”.
      expect(part).toContain("chưa kịp chọn ca, chưa tham dự được ca đã chọn, hoặc ca bạn đã chọn vừa bị ban tổ chức đóng do thay đổi phòng");
      expect(part).not.toContain("thấy bạn chưa chọn ca");
    }
  });
});

describe("gửi thư mở lại", () => {
  it("chỉ gửi người chưa nhận; đánh dấu TỪNG người ngay trước khi gửi, với điều kiện còn trống", async () => {
    person("a");
    person("b");
    person("e", { notified: true });
    const result = await sendReopenNotices();
    expect(result).toMatchObject({ ok: true, sent: 2, failed: 0 });
    expect(mocks.log).toEqual(["claim:inv-a", "send:a", "claim:inv-b", "send:b"]);
    const claims = mocks.calls.filter((c) => c.values && "reopen_notified_at" in c.values && c.values.reopen_notified_at);
    expect(claims).toHaveLength(2);
    for (const c of claims) expect(c.filters).toContainEqual(["is", "reopen_notified_at", null]);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: "a@example.test", bookingToken: "tok-a", applicationId: "a", deadlineLabel: "20:00 ngày 03/10/2026",
      interviewDaysLabel: "Chủ nhật 04/10/2026"
    }));
  });

  it("người đã bị lượt khác giành thì KHÔNG gửi trùng", async () => {
    person("a");
    mocks.taken.add("inv-a");
    expect(await sendReopenNotices()).toMatchObject({ sent: 0 });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("gửi hỏng thì xoá dấu (đúng dấu của lượt này) để lượt sau gửi lại", async () => {
    person("a");
    mocks.send.mockResolvedValueOnce({ ok: false, skipped: false, reason: "hộp thư đầy" });
    expect(await sendReopenNotices()).toMatchObject({ ok: false, sent: 0, failed: 1 });
    const release = mocks.calls.find((c) => c.values && c.values.reopen_notified_at === null);
    expect(release.values.last_error).toBe("hộp thư đầy");
    expect(release.filters).toContainEqual(["eq", "id", "inv-a"]);
    expect(release.filters.find((f: any) => f[1] === "reopen_notified_at")?.[0]).toBe("eq");
  });

  it("nhà cung cấp báo 429 thì dừng, không gửi người kế tiếp", async () => {
    person("a");
    person("b");
    mocks.send.mockResolvedValueOnce({ ok: false, skipped: false, reason: "429", providerStatus: 429 });
    expect(await sendReopenNotices()).toMatchObject({ sent: 0, failed: 1 });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("không có quyền BTC thì không đọc, không ghi, không gửi", async () => {
    person("a");
    mocks.btc = { ok: false, message: "Bạn không có quyền cấu hình ca phỏng vấn." };
    expect(await sendReopenNotices()).toMatchObject({ ok: false, message: "Bạn không có quyền cấu hình ca phỏng vấn." });
    expect(mocks.calls).toEqual([]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("không còn ca nào đặt được trước hạn mới thì không gửi", async () => {
    person("a");
    mocks.context = { anyBookable: false, deadlineLabel: "", daysLabel: "" };
    expect((await sendReopenNotices()).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("chạm phần hạn mức chung thì không gửi; không đếm được thư thì cũng không", async () => {
    person("a");
    mocks.sentInWindow = DAILY_EMAIL_LIMIT - DISPATCH_RESERVE;
    expect((await sendReopenNotices()).ok).toBe(false);
    mocks.sentInWindow = null;
    expect((await sendReopenNotices()).ok).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("gửi thử: tới chính người bấm, KHÔNG kèm link thật của ai, không đánh dấu ai", async () => {
    person("a");
    expect(await sendReopenNoticeTest()).toMatchObject({ ok: true });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "btc@example.test", bookingToken: null, applicationId: null }));
    expect(mocks.calls.filter((c) => c.values)).toEqual([]);
  });

  it("màn hình: đếm người chờ/đã nhận, thư mẫu không chứa link thật", async () => {
    person("a");
    person("e", { notified: true });
    person("b", { booked: true });
    const status = await getReopenNoticeStatus();
    expect(status).toMatchObject({ ok: true, total: 2, pending: 1, notified: 1, deadlineLabel: "20:00 ngày 03/10/2026" });
    if (!status.ok) throw new Error("status");
    expect(status.preview?.text).not.toContain("tok-");
  });
});
