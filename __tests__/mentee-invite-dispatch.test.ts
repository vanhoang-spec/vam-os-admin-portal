/**
 * __tests__/mentee-invite-dispatch.test.ts
 *
 * Bộ gửi thư mời mentee chọn ca — thứ gửi thư thật cho 334 người.
 *
 * ---------------------------------------------------------------------------
 * BA ĐIỀU ĐÁNG CANH
 * ---------------------------------------------------------------------------
 * 1. KHÔNG GỬI VÀO MỘT LƯỚI CA RỖNG. Ca chưa có ghế là ca đóng; thư mời trỏ vào
 *    một trang toàn "chưa mở" là 334 cuộc gọi.
 * 2. KHÔNG ĂN VÀO PHẦN HẠN MỨC CHỪA CHO THƯ XÁC NHẬN. Gói 300 thư/ngày dùng
 *    chung; người vừa nhận thư mời và đặt ca ngay phải nhận được thư xác nhận.
 * 3. ĐÚNG NGƯỜI, ĐÚNG MỘT LẦN. Người chỉ mới chấm xong, người đã có ca, người
 *    đã nhận thư — không ai trong số đó nhận thư mời.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBtc: vi.fn(),
  readAllPages: vi.fn(),
  readAllPagesIn: vi.fn(),
  sendMenteeSessionInvite: vi.fn(),
  getPublicOrigin: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mentee-session-admin", () => ({ requireBtc: mocks.requireBtc }));
vi.mock("@/lib/paged-read", () => ({
  readAllPages: mocks.readAllPages,
  readAllPagesIn: mocks.readAllPagesIn
}));
vi.mock("@/lib/email", () => ({ sendMenteeSessionInvite: mocks.sendMenteeSessionInvite }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: mocks.getPublicOrigin }));

import { runMenteeInviteDispatch } from "@/lib/mentee-invite-dispatch";
import { DAILY_EMAIL_LIMIT, DISPATCH_RESERVE } from "@/lib/mentee-invite-dispatch-core";

type Row = Record<string, any>;
type Write = { table: string; op: "upsert" | "update"; payload: any; filters: Array<[string, string, unknown]> };

const SEASON_ID = "season-s12";
let tables: Record<string, Row[]>;
let writes: Write[];
/** Số thư cả hệ thống đã gửi trong 24 giờ. null = đếm lỗi. */
let quotaCount: number | null;
let tokenSeq = 0;

function session(over: Partial<Row> = {}): Row {
  // Năm 2099: phép tính "ca còn mở" đọc đồng hồ thật, và bài test không được
  // đỏ vào ngày 04/10/2026 chỉ vì ca đã qua.
  return {
    id: "ses-1",
    starts_at: "2099-10-03T01:00:00.000Z",
    ends_at: "2099-10-03T01:30:00.000Z",
    seat_limit: 25,
    venue: "Phòng A",
    booking_closes_at: "2099-09-30T16:59:59.000Z",
    status: "open",
    ...over
  };
}

function mentee(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    full_name: `Bạn ${id}`,
    email_primary: `${id}@example.test`,
    status: "invited_to_interview",
    source: "vam_os_form",
    role_applied: "mentee",
    ...over
  };
}

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let op: "update" | null = null;
      let selectAfterUpdate = false;
      const chain: any = {
        select(_cols?: string) {
          if (op === "update") selectAfterUpdate = true;
          return chain;
        },
        in(col: string, vals: unknown) {
          filters.push(["in", col, vals]);
          return chain;
        },
        gte(col: string, v: unknown) {
          filters.push(["gte", col, v]);
          return chain;
        },
        lt(col: string, v: unknown) {
          filters.push(["lt", col, v]);
          return chain;
        },
        is(col: string, v: unknown) {
          filters.push(["is", col, v]);
          return chain;
        },
        eq(col: string, v: unknown) {
          filters.push(["eq", col, v]);
          return chain;
        },
        upsert(payload: Row[]) {
          writes.push({ table, op: "upsert", payload, filters });
          // Mô phỏng đúng việc database làm: cấp dòng mời cho người chưa có,
          // KHÔNG đụng dòng đã có (ignoreDuplicates).
          for (const row of payload) {
            if (!tables.mentee_interview_invites.some((i) => i.application_id === row.application_id)) {
              tokenSeq += 1;
              tables.mentee_interview_invites.push({
                id: `inv-${row.application_id}`,
                application_id: row.application_id,
                token: `tok-${tokenSeq}`,
                send_count: 0,
                claimed_at: null,
                created_at: `2026-09-26T00:00:${String(tokenSeq).padStart(2, "0")}.000Z`,
                last_error: null
              });
            }
          }
          return Promise.resolve({ error: null });
        },
        update(payload: Row) {
          op = "update";
          writes.push({ table, op: "update", payload, filters });
          return chain;
        },
        then(resolve: (value: unknown) => void) {
          if (table === "outbound_emails") {
            return resolve(
              quotaCount === null ? { count: null, error: { message: "đếm lỗi" } } : { count: quotaCount, error: null }
            );
          }
          if (op === "update" && selectAfterUpdate) {
            const ids = (filters.find((f) => f[0] === "in" && f[1] === "id")?.[2] as string[]) ?? [];
            return resolve({ data: ids.map((id) => ({ id })), error: null });
          }
          return resolve({ error: null });
        }
      };
      return chain;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  writes = [];
  quotaCount = 0;
  tokenSeq = 0;
  tables = {
    interview_sessions: [session()],
    applications: [],
    mentee_interview_bookings: [],
    mentee_interview_invites: []
  };

  mocks.requireBtc.mockResolvedValue({ ok: true, client: fakeClient(), seasonId: SEASON_ID });
  mocks.readAllPages.mockImplementation(async (table: string) => ({ data: tables[table] ?? [], error: null }));
  mocks.readAllPagesIn.mockImplementation(
    async (_client: unknown, table: string, column: string, values: string[]) => ({
      data: (tables[table] ?? []).filter((row) => values.includes(String(row[column]))),
      error: null
    })
  );
  mocks.sendMenteeSessionInvite.mockResolvedValue({ ok: true, skipped: false });
  mocks.getPublicOrigin.mockResolvedValue("https://os.alumni-mentoring.edu.vn");
});

const sentTo = () => mocks.sendMenteeSessionInvite.mock.calls.map((call) => call[0].applicationId).sort();

describe("1. cổng quyền", () => {
  it("không qua cổng thì không đọc, không ghi, không gửi", async () => {
    mocks.requireBtc.mockResolvedValue({ ok: false, message: "Bạn không có quyền cấu hình ca phỏng vấn." });
    tables.applications = [mentee("a1")];

    const result = await runMenteeInviteDispatch();

    expect(result.ok).toBe(false);
    expect(writes).toHaveLength(0);
    expect(mocks.sendMenteeSessionInvite).not.toHaveBeenCalled();
  });
});

describe("2. không gửi vào một lưới ca rỗng", () => {
  it("mọi ca chưa có ghế → từ chối, không cấp mã link, không gửi", async () => {
    tables.interview_sessions = [session({ seat_limit: null })];
    tables.applications = [mentee("a1")];

    const result = await runMenteeInviteDispatch();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Chưa có ca nào đặt được");
    expect(writes).toHaveLength(0);
    expect(mocks.sendMenteeSessionInvite).not.toHaveBeenCalled();
  });

  it("mọi ca đã đóng → từ chối", async () => {
    tables.interview_sessions = [session({ status: "closed" })];
    tables.applications = [mentee("a1")];

    const result = await runMenteeInviteDispatch();

    expect(result.ok).toBe(false);
    expect(mocks.sendMenteeSessionInvite).not.toHaveBeenCalled();
  });

  it("một ca còn ghế là đủ để gửi", async () => {
    tables.interview_sessions = [session({ id: "s1", seat_limit: null }), session({ id: "s2", starts_at: "2099-10-03T01:30:00.000Z", ends_at: "2099-10-03T02:00:00.000Z" })];
    tables.applications = [mentee("a1")];

    const result = await runMenteeInviteDispatch();

    expect(result.sent).toBe(1);
  });
});

describe("3. không ăn vào phần hạn mức chừa cho thư xác nhận", () => {
  it("đã chạm phần của thư mời → không gửi thư nào, và nói rõ vì sao", async () => {
    quotaCount = DAILY_EMAIL_LIMIT - DISPATCH_RESERVE;
    tables.applications = [mentee("a1")];

    const result = await runMenteeInviteDispatch();

    expect(result.sent).toBe(0);
    expect(result.message).toContain("chừa cho thư xác nhận");
    expect(mocks.sendMenteeSessionInvite).not.toHaveBeenCalled();
  });

  it("không đếm được thư đã gửi → không gửi mù", async () => {
    quotaCount = null;
    tables.applications = [mentee("a1")];

    const result = await runMenteeInviteDispatch();

    expect(result.ok).toBe(false);
    expect(mocks.sendMenteeSessionInvite).not.toHaveBeenCalled();
  });

  it("còn chỗ cho 20 thư thì chỉ gửi 20, dù có 30 người chờ", async () => {
    quotaCount = DAILY_EMAIL_LIMIT - DISPATCH_RESERVE - 20;
    tables.applications = Array.from({ length: 30 }, (_, i) => mentee(`a${String(i).padStart(2, "0")}`));

    const result = await runMenteeInviteDispatch();

    expect(result.sent).toBe(20);
    expect(mocks.sendMenteeSessionInvite).toHaveBeenCalledTimes(20);
  });
});

describe("4. đúng người, đúng một lần", () => {
  it("chỉ gửi cho người BTC đã mời, chưa có ca, chưa nhận thư", async () => {
    tables.applications = [
      mentee("moi-1"),
      mentee("moi-2"),
      // Mới chấm xong, BTC chưa bấm mời — đây là 548 đơn, gồm cả người bị loại.
      mentee("chua-moi", { status: "screening_completed" }),
      // Đã có ca.
      mentee("co-ca", { status: "interview_scheduled" }),
      // Đang giữ chỗ dù trạng thái đơn chưa kịp đổi.
      mentee("dang-giu"),
      // Đã nhận thư mời lần trước.
      mentee("da-nhan"),
      mentee("mentor-1", { role_applied: "mentor" })
    ];
    tables.mentee_interview_bookings = [{ id: "b1", application_id: "dang-giu", session_id: "ses-1" }];
    tables.mentee_interview_invites = [
      { id: "inv-da-nhan", application_id: "da-nhan", token: "tok-cu", send_count: 1, claimed_at: null, created_at: "2026-09-25T00:00:00.000Z" }
    ];

    const result = await runMenteeInviteDispatch();

    expect(result.sent).toBe(2);
    expect(sentTo()).toEqual(["moi-1", "moi-2"]);
  });

  it("bấm lại lần hai không gửi thêm cho ai đã nhận thư", async () => {
    tables.applications = [mentee("a1")];

    await runMenteeInviteDispatch();
    // Mô phỏng database sau lượt đầu: người nhận đã có send_count 1.
    for (const invite of tables.mentee_interview_invites) invite.send_count = 1;
    mocks.sendMenteeSessionInvite.mockClear();

    const second = await runMenteeInviteDispatch();

    expect(second.sent).toBe(0);
    expect(mocks.sendMenteeSessionInvite).not.toHaveBeenCalled();
  });

  it("không đổi mã link của người đã có mã — mã cũ đang nằm trong hộp thư họ", async () => {
    tables.applications = [mentee("a1")];
    tables.mentee_interview_invites = [
      { id: "inv-a1", application_id: "a1", token: "tok-giu-nguyen", send_count: 0, claimed_at: null, created_at: "2026-09-25T00:00:00.000Z" }
    ];

    await runMenteeInviteDispatch();

    expect(mocks.sendMenteeSessionInvite.mock.calls[0][0].bookingToken).toBe("tok-giu-nguyen");
  });

  it("gửi xong thì ghi send_count = 1, lọc theo đúng claim của lượt này", async () => {
    tables.applications = [mentee("a1")];

    await runMenteeInviteDispatch();

    const finalize = writes.find((w) => w.op === "update" && w.payload.send_count === 1);
    expect(finalize).toBeDefined();
    expect(finalize!.filters.some(([kind, col]) => kind === "eq" && col === "claimed_at")).toBe(true);
  });
});

describe("5. dừng đúng lúc nhà cung cấp báo chạm trần", () => {
  it("429 thì dừng ngay, nhả claim của người chưa kịp gửi", async () => {
    tables.applications = [mentee("a1"), mentee("a2"), mentee("a3")];
    mocks.sendMenteeSessionInvite
      .mockResolvedValueOnce({ ok: true, skipped: false })
      .mockResolvedValueOnce({ ok: false, skipped: false, providerStatus: 429, reason: "429" });

    const result = await runMenteeInviteDispatch();

    expect(result.sent).toBe(1);
    expect(result.stopped429).toBe(true);
    // Người thứ ba KHÔNG bị gọi gửi sau khi đã chạm trần.
    expect(mocks.sendMenteeSessionInvite).toHaveBeenCalledTimes(2);
    const released = writes.find(
      (w) => w.op === "update" && w.payload.claimed_at === null && w.filters.some(([k, c]) => k === "in" && c === "id")
    );
    expect(released).toBeDefined();
  });

  it("cổng gửi tắt (môi trường thử) thì KHÔNG đốt lượt gửi của ai", async () => {
    tables.applications = [mentee("a1")];
    mocks.sendMenteeSessionInvite.mockResolvedValue({ ok: true, skipped: true, reason: "gate off" });

    await runMenteeInviteDispatch();

    expect(writes.some((w) => w.op === "update" && w.payload.send_count === 1)).toBe(false);
  });
});

describe("6. nội dung thư đọc từ chính các ca", () => {
  it("ngày phỏng vấn và hạn chọn ca lấy từ dữ liệu ca, không từ hằng số", async () => {
    tables.applications = [mentee("a1")];

    await runMenteeInviteDispatch();

    const call = mocks.sendMenteeSessionInvite.mock.calls[0][0];
    // 2099-10-03 01:00Z = 08:00 giờ Việt Nam ngày 03/10/2099.
    expect(call.interviewDaysLabel).toContain("03/10/2099");
    // 2099-09-30 16:59:59Z = 23:59 ngày 30/09/2099 giờ Việt Nam.
    expect(call.deadlineLabel).toContain("30/09/2099");
    expect(call.deadlineLabel).toContain("23:59");
  });
});
