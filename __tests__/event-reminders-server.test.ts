/**
 * "Gửi remind" phía máy chủ: ai được gửi, không ai nhận hai thư, và báo đúng.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DỄ SAI NHẤT: GỬI HAI LẦN
 * ---------------------------------------------------------------------------
 * Người vận hành bấm Yes rồi mở thêm một tab, hoặc mạng chập và họ bấm "Gửi
 * tiếp". Một thư chỉ được đi sau khi dòng của người nhận được CHIẾM bằng một
 * lệnh ghi có điều kiện — bộ giả database ở đây thi hành đúng điều kiện đó, và
 * nhả lượt giữa các lệnh để hai lần gọi chen nhau như ngoài đời.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng lib/event-reminders.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scopeError: null })),
  canOperateSeason: vi.fn(async () => true),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn(),
  canOperateAnyScope: vi.fn(() => true)
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email", () => ({
  resolveEmailBaseUrl: vi.fn((origin?: string | null) => origin ?? "https://os.example.org"),
  sendEventRegistrationConfirmation: vi.fn(async () => ({ ok: true, skipped: false })),
  sendEventScheduleChange: vi.fn(async () => ({ ok: true, skipped: false })),
  sendEventReminder: vi.fn(async () => ({ ok: true, skipped: false }))
}));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));
vi.mock("@/lib/event-checkin", () => ({
  ensureCheckinCode: vi.fn(async () => ({ code: "NEWC0DE234", shortCode: "K7M2", error: null }))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendEventReminder } from "@/lib/email";
import { ensureCheckinCode } from "@/lib/event-checkin";
import {
  cancelEventReminder,
  continueEventReminder,
  getLatestEventReminder,
  retryFailedEventReminder,
  startEventReminder
} from "@/lib/event-reminders";
import { REMINDER_CHUNK, REMINDER_DATE_INVALID, REMINDER_DATE_MISMATCH } from "@/lib/event-reminder-core";

// ── Bộ giả database ─────────────────────────────────────────────────────────

type Row = Record<string, any>;
type Filter = { op: "eq" | "neq" | "in" | "lt" | "gt"; column: string; value: any };
type Write = { table: string; op: "insert" | "update"; values: any; filters: Filter[]; affected: Row[] };

class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: Write[] = [];
  reads: Array<{ table: string; filters: Filter[] }> = [];
  failures = new Map<string, { code: string; message: string }>();
  private seq = 0;

  uuid() {
    this.seq += 1;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  rows(table: string) {
    return (this.tables[table] ??= []);
  }

  writesTo(table: string, op?: "insert" | "update") {
    return this.writes.filter((write) => write.table === table && (!op || write.op === op));
  }
}

const RUNNING_CONFLICT = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "event_reminder_runs_one_running_uidx"'
};

class Query {
  private op: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private payload: any;
  private returning = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  insert(values: any) {
    this.op = "insert";
    this.payload = values;
    return this;
  }
  update(values: any) {
    this.op = "update";
    this.payload = values;
    return this;
  }
  eq(column: string, value: any) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: any) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }
  in(column: string, values: any[]) {
    this.filters.push({ op: "in", column, value: [...values] });
    return this;
  }
  lt(column: string, value: any) {
    this.filters.push({ op: "lt", column, value });
    return this;
  }
  gt(column: string, value: any) {
    this.filters.push({ op: "gt", column, value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(value: number) {
    this.max = value;
    return this;
  }
  maybeSingle() {
    return this.run().then((result) => ({
      data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      error: result.error
    }));
  }
  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return this.run().then(resolve, reject);
  }

  private matches(row: Row) {
    return this.filters.every((filter) => {
      const value = row[filter.column];
      if (filter.op === "eq") return value === filter.value;
      if (filter.op === "neq") return value !== filter.value;
      if (filter.op === "in") return filter.value.includes(value);
      if (filter.op === "lt") return value != null && String(value) < String(filter.value);
      return value != null && String(value) > String(filter.value);
    });
  }

  private async run(): Promise<{ data: any; error: any }> {
    // Nhả lượt trước mỗi lệnh, để hai lần gọi chạy song song chen nhau thật.
    await Promise.resolve();
    const rows = this.db.rows(this.table);
    const failureKey = `${this.table}:${this.op}`;
    const failure = this.db.failures.get(failureKey);
    if (failure) {
      this.db.failures.delete(failureKey);
      return { data: null, error: failure };
    }

    if (this.op === "insert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      if (this.table === "event_reminder_runs") {
        for (const item of list) {
          if (item.status === "running" && rows.some((row) => row.event_id === item.event_id && row.status === "running")) {
            return { data: null, error: RUNNING_CONFLICT };
          }
        }
      }
      const inserted = list.map((item: Row) => {
        const row = { id: this.db.uuid(), created_at: new Date().toISOString(), ...item };
        rows.push(row);
        return { ...row };
      });
      this.db.writes.push({ table: this.table, op: "insert", values: this.payload, filters: [], affected: inserted });
      return { data: this.returning ? inserted : null, error: null };
    }

    if (this.op === "update") {
      const affected = rows.filter((row) => this.matches(row));
      if (this.table === "event_reminder_runs" && this.payload.status === "running") {
        for (const row of affected) {
          if (rows.some((other) => other !== row && other.event_id === row.event_id && other.status === "running")) {
            return { data: null, error: RUNNING_CONFLICT };
          }
        }
      }
      for (const row of affected) Object.assign(row, this.payload);
      const copies = affected.map((row) => ({ ...row }));
      this.db.writes.push({ table: this.table, op: "update", values: this.payload, filters: [...this.filters], affected: copies });
      return { data: this.returning ? copies : null, error: null };
    }

    let result = rows.filter((row) => this.matches(row)).map((row) => ({ ...row }));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result.sort((left, right) => {
        const comparison = String(left[column] ?? "").localeCompare(String(right[column] ?? ""));
        return ascending ? comparison : -comparison;
      });
    }
    if (this.max !== null) result = result.slice(0, this.max);
    this.db.reads.push({ table: this.table, filters: [...this.filters] });
    return { data: result, error: null };
  }
}

function clientFor(db: FakeDb) {
  return { from: (table: string) => new Query(db, table) };
}

// ── Dữ liệu mẫu ─────────────────────────────────────────────────────────────

const NOW = "2026-09-14T03:00:00.000Z";
const EVENT_ID = "00000000-0000-4000-b000-000000000001";
const SEASON_ID = "00000000-0000-4000-b000-0000000000aa";
const ADMIN_ID = "00000000-0000-4000-b000-0000000000dd";
const TYPED = "20/09/2026";

function regId(n: number) {
  return `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
}

function seedEvent(db: FakeDb, overrides: Row = {}) {
  db.tables.events = [
    {
      id: EVENT_ID,
      season_id: SEASON_ID,
      event_name: "Mentor Orientation",
      status: "active",
      starts_at: "2026-09-20T01:00:00.000Z",
      ends_at: "2026-09-20T04:30:00.000Z",
      event_format: "offline",
      location_name: "Phòng B1-502",
      location_address: "279 Nguyễn Tri Phương",
      location_map_url: null,
      online_join_url: null,
      qr_checkin_enabled: true,
      event_description: null,
      ...overrides
    }
  ];
  db.tables.admin_users = [{ id: ADMIN_ID, full_name: "Người vận hành", email: "ops@example.org" }];
}

function registration(n: number, overrides: Row = {}): Row {
  return {
    id: regId(n),
    event_id: EVENT_ID,
    full_name: `Người ${n}`,
    email: `nguoi${n}@example.com`,
    registration_status: "registered",
    attendance_status: "pending",
    checkin_code: `CODE${String(n).padStart(6, "0")}`,
    short_code: "AB23",
    ...overrides
  };
}

function seedRegistrations(db: FakeDb, rows: Row[]) {
  db.tables.event_registrations = rows;
}

const ORIGINAL_ENV = { ...process.env };
let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.VAM_OS_EMAIL_ENABLED = "true";
  process.env.VERCEL_ENV = "production";
  process.env.VAM_OS_EMAIL_PROVIDER = "brevo";
  process.env.BREVO_API_KEY = "xkeysib-test";
  process.env.VAM_OS_EMAIL_FROM = "UEH Mentoring <hello@example.org>";

  db = new FakeDb();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(clientFor(db) as never);
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: ADMIN_ID,
    email: "ops@example.org",
    full_name: "Người vận hành",
    role: "admin",
    status: "active"
  } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(sendEventReminder).mockResolvedValue({ ok: true, skipped: false } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const key of ["VAM_OS_EMAIL_ENABLED", "VERCEL_ENV", "VAM_OS_EMAIL_PROVIDER", "BREVO_API_KEY", "VAM_OS_EMAIL_FROM"]) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

function reminderWrites() {
  return [...db.writesTo("event_reminder_runs"), ...db.writesTo("event_reminder_recipients")];
}

async function startedRun(count: number, extra: Row[] = []) {
  seedEvent(db);
  seedRegistrations(db, [...Array.from({ length: count }, (_, index) => registration(index + 1)), ...extra]);
  const started = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });
  expect(started.ok).toBe(true);
  return String(started.runId);
}

function sentRegistrationIds() {
  return vi.mocked(sendEventReminder).mock.calls.map((call) => call[0].registrationId);
}

// ── 1. Bắt đầu một lượt ─────────────────────────────────────────────────────

describe("1. bắt đầu: mọi phép kiểm chạy TRƯỚC khi ghi", () => {
  it("ngày nhập lại sai: từ chối, không lập lượt nào, không gửi thư nào", async () => {
    seedEvent(db);
    seedRegistrations(db, [registration(1)]);

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: "27/09/2026" });

    expect(result).toEqual({ ok: false, message: REMINDER_DATE_MISMATCH });
    expect(reminderWrites()).toEqual([]);
    expect(sendEventReminder).not.toHaveBeenCalled();
  });

  it("ngày sai định dạng: từ chối, không ghi", async () => {
    seedEvent(db);
    seedRegistrations(db, [registration(1)]);

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: "20-09-2026" });

    expect(result).toEqual({ ok: false, message: REMINDER_DATE_INVALID });
    expect(reminderWrites()).toEqual([]);
  });

  it("không có quyền vận hành mùa của buổi: từ chối trước khi đọc danh sách đăng ký", async () => {
    seedEvent(db);
    seedRegistrations(db, [registration(1)]);
    vi.mocked(canOperateSeason).mockResolvedValue(false);

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không có quyền");
    expect(db.reads.some((read) => read.table === "event_registrations")).toBe(false);
    expect(reminderWrites()).toEqual([]);
  });

  it.each([
    ["đã huỷ", { status: "cancelled" }, "đã huỷ"],
    ["đã bắt đầu", { starts_at: "2026-09-13T01:00:00.000Z" }, "đã bắt đầu"],
    ["trực tuyến thiếu link họp", { event_format: "online" }, "chưa có link họp"]
  ])("buổi %s: chặn, không ghi", async (_label, overrides, expected) => {
    seedEvent(db, overrides);
    seedRegistrations(db, [registration(1)]);

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });

    expect(result.ok).toBe(false);
    expect(result.message).toContain(expected);
    expect(reminderWrites()).toEqual([]);
  });

  it("cổng thư đang tắt: không lập lượt — một lượt toàn thư lỗi là lời báo sai", async () => {
    seedEvent(db);
    seedRegistrations(db, [registration(1)]);
    delete process.env.VAM_OS_EMAIL_ENABLED;

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("tắt gửi thư");
    expect(reminderWrites()).toEqual([]);
  });

  it("không ai đang giữ chỗ: từ chối, không lập lượt rỗng", async () => {
    seedEvent(db);
    seedRegistrations(db, [
      registration(1, { registration_status: "waitlisted" }),
      registration(2, { registration_status: "cancelled" })
    ]);

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });

    expect(result.ok).toBe(false);
    expect(reminderWrites()).toEqual([]);
  });

  it("chốt đúng người đang giữ chỗ, ghi ngày đã nhập và người bấm, ghi nhật ký — chưa gửi thư nào", async () => {
    seedEvent(db);
    seedRegistrations(db, [
      registration(1, { registration_status: "registered" }),
      registration(2, { registration_status: "confirmed" }),
      registration(3, { registration_status: "pending_review" }),
      registration(4, { registration_status: "waitlisted" }),
      registration(5, { registration_status: "rejected" }),
      registration(6, { registration_status: "cancelled" }),
      registration(7, { registration_status: "confirmed", attendance_status: "checked_in" }),
      registration(8, { registration_status: "registered", email: "" }),
      // Đăng ký của buổi khác không được lọt vào.
      registration(9, { event_id: "00000000-0000-4000-b000-000000000999" })
    ]);

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });

    expect(result.ok).toBe(true);
    expect(result.total).toBe(3);
    expect(result.counts).toEqual({ queued: 3, sending: 0, sent: 0, failed: 0, skipped: 0 });

    const [runInsert] = db.writesTo("event_reminder_runs", "insert");
    expect(runInsert.values).toMatchObject({
      event_id: EVENT_ID,
      created_by: ADMIN_ID,
      confirmed_event_date: "2026-09-20",
      status: "running",
      recipient_count: 3
    });

    const queued = db.rows("event_reminder_recipients");
    expect(queued.map((row) => row.registration_id).sort()).toEqual([regId(1), regId(2), regId(3)]);
    expect(queued.every((row) => row.status === "queued" && row.run_id === result.runId)).toBe(true);

    const audit = db.writesTo("admin_audit_log", "insert")[0];
    expect(audit.values).toMatchObject({ action_type: "send_event_reminder", actor_admin_user_id: ADMIN_ID });
    expect(audit.values.after_data).toMatchObject({ run_id: result.runId, recipient_count: 3 });

    expect(sendEventReminder).not.toHaveBeenCalled();
  });

  it("buổi đang có lượt chạy dở: từ chối lượt thứ hai, không chèn thêm người nhận nào", async () => {
    await startedRun(2);
    const recipientsBefore = db.rows("event_reminder_recipients").length;

    const second = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });

    expect(second.ok).toBe(false);
    expect(second.message).toContain("chưa gửi xong");
    expect(db.rows("event_reminder_recipients")).toHaveLength(recipientsBefore);
    expect(db.rows("event_reminder_runs")).toHaveLength(1);
  });

  it("chèn danh sách hỏng: dừng lượt, không để ai nằm trong hàng đợi", async () => {
    seedEvent(db);
    seedRegistrations(db, [registration(1), registration(2)]);
    db.failures.set("event_reminder_recipients:insert", { code: "XX000", message: "boom" });

    const result = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });

    expect(result.ok).toBe(false);
    expect(db.rows("event_reminder_runs")[0]).toMatchObject({ status: "cancelled" });
    expect(db.rows("event_reminder_runs")[0].finished_at).toBeTruthy();
  });
});

// ── 2. Gửi tiếp ─────────────────────────────────────────────────────────────

describe("2. gửi tiếp: theo lô, không ai nhận hai thư", () => {
  it("mỗi lần gọi gửi tối đa một lô, đánh dấu từng người, và chốt lượt khi hết", async () => {
    const runId = await startedRun(REMINDER_CHUNK + 2);

    const first = await continueEventReminder({ runId });
    expect(first.ok).toBe(true);
    expect(first.chunk).toMatchObject({ sent: REMINDER_CHUNK, failed: 0, skipped: 0 });
    expect(first.done).toBe(false);
    expect(first.counts).toMatchObject({ sent: REMINDER_CHUNK, queued: 2 });

    const second = await continueEventReminder({ runId });
    expect(second.done).toBe(true);
    expect(second.counts).toMatchObject({ sent: REMINDER_CHUNK + 2, queued: 0, sending: 0 });
    expect(db.rows("event_reminder_runs")[0]).toMatchObject({ status: "completed" });

    expect(sendEventReminder).toHaveBeenCalledTimes(REMINDER_CHUNK + 2);
    expect(new Set(sentRegistrationIds()).size).toBe(REMINDER_CHUNK + 2);
  });

  it("hai lần gọi chạy song song (hai tab): mỗi người đúng một thư", async () => {
    const runId = await startedRun(REMINDER_CHUNK + 5);

    await Promise.all([continueEventReminder({ runId }), continueEventReminder({ runId })]);
    await Promise.all([continueEventReminder({ runId }), continueEventReminder({ runId })]);
    await continueEventReminder({ runId });

    const ids = sentRegistrationIds();
    expect(ids).toHaveLength(REMINDER_CHUNK + 5);
    expect(new Set(ids).size).toBe(REMINDER_CHUNK + 5);
  });

  it("chỉ gửi cho những dòng mà lệnh chiếm trả về — không gửi theo danh sách vừa đọc", async () => {
    const runId = await startedRun(3);
    // Một lần gọi khác chiếm mất người số 1 ngay trước lệnh chiếm của lần này.
    const target = db.rows("event_reminder_recipients").find((row) => row.registration_id === regId(1))!;
    const original = Query.prototype.update;
    let hijacked = false;
    Query.prototype.update = function (this: any, values: any) {
      if (!hijacked && values?.status === "sending") {
        hijacked = true;
        target.status = "sending";
        target.attempted_at = new Date().toISOString();
      }
      return original.call(this, values);
    };
    try {
      await continueEventReminder({ runId });
    } finally {
      Query.prototype.update = original;
    }

    expect(sentRegistrationIds()).not.toContain(regId(1));
    expect(sentRegistrationIds().sort()).toEqual([regId(2), regId(3)]);
  });

  it("người huỷ đăng ký sau khi chốt danh sách: bỏ qua, không gửi", async () => {
    const runId = await startedRun(2);
    db.rows("event_registrations").find((row) => row.id === regId(2))!.registration_status = "cancelled";

    const result = await continueEventReminder({ runId });

    expect(sentRegistrationIds()).toEqual([regId(1)]);
    expect(result.chunk).toMatchObject({ sent: 1, skipped: 1 });
    const skipped = db.rows("event_reminder_recipients").find((row) => row.registration_id === regId(2))!;
    expect(skipped.status).toBe("skipped");
  });

  it("cổng thư chặn lúc gửi (skipped): tính là LỖI, không tính là đã gửi", async () => {
    const runId = await startedRun(1);
    vi.mocked(sendEventReminder).mockResolvedValueOnce({ ok: true, skipped: true, reason: "VAM_OS_EMAIL_ENABLED chưa bật" } as never);

    const result = await continueEventReminder({ runId });

    expect(result.chunk).toMatchObject({ sent: 0, failed: 1 });
    expect(result.counts).toMatchObject({ sent: 0, failed: 1 });
    expect(db.rows("event_reminder_recipients")[0].error).toContain("Không gửi");
  });

  it("nhà cung cấp từ chối: ghi lỗi kèm lý do", async () => {
    const runId = await startedRun(1);
    vi.mocked(sendEventReminder).mockResolvedValueOnce({ ok: false, skipped: false, reason: "Brevo 429" } as never);

    await continueEventReminder({ runId });

    expect(db.rows("event_reminder_recipients")[0]).toMatchObject({ status: "failed", error: "Brevo 429" });
  });

  it("quá giờ giữa lô: dừng gửi, trả phần chưa gửi về hàng đợi", async () => {
    const runId = await startedRun(REMINDER_CHUNK + 2);
    vi.mocked(sendEventReminder).mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(Date.now() + 50_000));
      return { ok: true, skipped: false } as never;
    });

    const result = await continueEventReminder({ runId });

    expect(sendEventReminder).toHaveBeenCalledTimes(1);
    expect(result.chunk).toMatchObject({ sent: 1, released: REMINDER_CHUNK - 1 });
    expect(result.counts).toMatchObject({ sent: 1, sending: 0, queued: REMINDER_CHUNK + 1 });
  });

  it("dòng kẹt ở 'đang gửi' quá lâu: chốt thành lỗi, KHÔNG gửi lại tự động", async () => {
    const runId = await startedRun(2);
    const stuck = db.rows("event_reminder_recipients").find((row) => row.registration_id === regId(1))!;
    stuck.status = "sending";
    stuck.attempted_at = new Date(Date.parse(NOW) - 20 * 60_000).toISOString();

    await continueEventReminder({ runId });

    expect(stuck.status).toBe("failed");
    expect(sentRegistrationIds()).toEqual([regId(2)]);
  });

  it("mất quyền vận hành mùa giữa chừng: từ chối, không chiếm, không gửi", async () => {
    const runId = await startedRun(2);
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    const updatesBefore = db.writesTo("event_reminder_recipients", "update").length;

    const result = await continueEventReminder({ runId });

    expect(result.ok).toBe(false);
    expect(db.writesTo("event_reminder_recipients", "update")).toHaveLength(updatesBefore);
    expect(sendEventReminder).not.toHaveBeenCalled();
  });

  it("buổi bị huỷ giữa chừng: dừng, không gửi thêm", async () => {
    const runId = await startedRun(2);
    db.rows("events")[0].status = "cancelled";

    const result = await continueEventReminder({ runId });

    expect(result.ok).toBe(false);
    expect(sendEventReminder).not.toHaveBeenCalled();
    expect(db.rows("event_reminder_recipients").every((row) => row.status === "queued")).toBe(true);
  });

  it("thông tin MỚI NHẤT: sửa phòng giữa hai lô thì lô sau mang phòng mới", async () => {
    const runId = await startedRun(REMINDER_CHUNK + 1);
    await continueEventReminder({ runId });
    db.rows("events")[0].location_name = "Hội trường A";

    await continueEventReminder({ runId });

    const calls = vi.mocked(sendEventReminder).mock.calls.map((call) => call[0]);
    expect(calls[0].placeLabel).toContain("Phòng B1-502");
    expect(calls[calls.length - 1].placeLabel).toContain("Hội trường A");
  });

  it("vé: có mã thì đính QR; chưa có mã thì cấp một lần; sự kiện không dùng QR thì không đụng tới vé", async () => {
    const runId = await startedRun(0, [registration(1), registration(2, { checkin_code: null, short_code: null })]);

    await continueEventReminder({ runId });

    const calls = vi.mocked(sendEventReminder).mock.calls.map((call) => call[0]);
    const withCode = calls.find((call) => call.registrationId === regId(1))!;
    const issued = calls.find((call) => call.registrationId === regId(2))!;
    expect(withCode.ticketUrl).toBe("https://os.example.org/ve/CODE000001");
    expect(withCode.qrPngBase64).toBeTruthy();
    expect(issued.ticketUrl).toBe("https://os.example.org/ve/NEWC0DE234");
    expect(ensureCheckinCode).toHaveBeenCalledTimes(1);
    expect(ensureCheckinCode).toHaveBeenCalledWith(regId(2));

    vi.clearAllMocks();
    vi.mocked(sendEventReminder).mockResolvedValue({ ok: true, skipped: false } as never);
    db = new FakeDb();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(clientFor(db) as never);
    seedEvent(db, { qr_checkin_enabled: false });
    seedRegistrations(db, [registration(1, { checkin_code: null })]);
    const started = await startEventReminder({ eventId: EVENT_ID, typedDate: TYPED });
    await continueEventReminder({ runId: String(started.runId) });

    const noQr = vi.mocked(sendEventReminder).mock.calls[0][0];
    expect(noQr).toMatchObject({ qrCheckin: false, ticketUrl: null, qrPngBase64: null });
    expect(ensureCheckinCode).not.toHaveBeenCalled();
  });

  it("người đang chờ duyệt: thư nói rõ đăng ký đang chờ xác nhận", async () => {
    const runId = await startedRun(0, [registration(1, { registration_status: "pending_review" })]);

    await continueEventReminder({ runId });

    expect(vi.mocked(sendEventReminder).mock.calls[0][0].pendingApproval).toBe(true);
  });
});

// ── 3. Gửi lại, dừng, và đọc lượt gần nhất ─────────────────────────────────

describe("3. gửi lại người lỗi và dừng lượt", () => {
  it("gửi lại: người lỗi về hàng đợi, lượt đã xong mở lại, ghi nhật ký — người đã nhận không nhận lại", async () => {
    const runId = await startedRun(3);
    vi.mocked(sendEventReminder)
      .mockResolvedValueOnce({ ok: true, skipped: false } as never)
      .mockResolvedValueOnce({ ok: false, skipped: false, reason: "Brevo 429" } as never)
      .mockResolvedValueOnce({ ok: true, skipped: false } as never);
    const firstPass = await continueEventReminder({ runId });
    expect(firstPass.done).toBe(true);
    expect(db.rows("event_reminder_runs")[0].status).toBe("completed");

    const retried = await retryFailedEventReminder({ runId });
    expect(retried.ok).toBe(true);
    expect(db.rows("event_reminder_runs")[0]).toMatchObject({ status: "running", finished_at: null });
    expect(db.writesTo("admin_audit_log", "insert").map((write) => write.values.action_type)).toContain("retry_event_reminder");

    vi.mocked(sendEventReminder).mockClear();
    const again = await continueEventReminder({ runId });
    expect(again.done).toBe(true);
    expect(sentRegistrationIds()).toEqual([regId(2)]);
  });

  it("gửi lại khi buổi đã có một lượt khác đang chạy: từ chối, không đụng hàng đợi", async () => {
    const runId = await startedRun(1);
    vi.mocked(sendEventReminder).mockResolvedValueOnce({ ok: false, skipped: false, reason: "x" } as never);
    await continueEventReminder({ runId });
    db.rows("event_reminder_runs").push({ id: db.uuid(), event_id: EVENT_ID, status: "running" });

    const result = await retryFailedEventReminder({ runId });

    expect(result.ok).toBe(false);
    expect(db.rows("event_reminder_recipients")[0].status).toBe("failed");
  });

  it("không gửi lại từ một lượt đã dừng", async () => {
    const runId = await startedRun(1);
    await cancelEventReminder({ runId });

    const result = await retryFailedEventReminder({ runId });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã dừng");
  });

  it("dừng lượt: người chưa gửi thành bỏ qua, người đã nhận giữ nguyên, ghi nhật ký", async () => {
    const runId = await startedRun(REMINDER_CHUNK + 3);
    await continueEventReminder({ runId });

    const stopped = await cancelEventReminder({ runId });

    expect(stopped.ok).toBe(true);
    expect(stopped.counts).toMatchObject({ sent: REMINDER_CHUNK, skipped: 3, queued: 0 });
    expect(db.rows("event_reminder_runs")[0].status).toBe("cancelled");
    expect(db.writesTo("admin_audit_log", "insert").map((write) => write.values.action_type)).toContain("cancel_event_reminder");

    vi.mocked(sendEventReminder).mockClear();
    const after = await continueEventReminder({ runId });
    expect(after.done).toBe(true);
    expect(sendEventReminder).not.toHaveBeenCalled();
  });

  it("đọc lượt gần nhất: trạng thái, tiến độ, người bấm", async () => {
    const runId = await startedRun(2);
    await continueEventReminder({ runId });

    const latest = await getLatestEventReminder(EVENT_ID);

    expect(latest.error).toBeNull();
    expect(latest.run).toMatchObject({
      id: runId,
      status: "completed",
      createdByName: "Người vận hành",
      confirmedDate: "2026-09-20",
      total: 2
    });
    expect(latest.run?.counts.sent).toBe(2);
  });

  it("đọc lịch sử hỏng: báo lỗi, KHÔNG nói 'chưa gửi lần nào'", async () => {
    seedEvent(db);
    db.failures.set("event_reminder_runs:select", { code: "42P01", message: "relation does not exist" });

    const latest = await getLatestEventReminder(EVENT_ID);

    expect(latest.run).toBeNull();
    expect(latest.error).toContain("Không đọc được");
  });
});
