/**
 * Khảo sát cuối buổi phía máy chủ: phiếu ghi ra sao, check out ghi vào đâu, và
 * thư khảo sát đi tới ai.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DỄ SAI NHẤT: PHIẾU KHÔNG ĐƯỢC ĐÁNH DẤU CHECK IN
 * ---------------------------------------------------------------------------
 * Máy quét đặt `attendance_status = 'checked_in'` cho MỌI lượt quét. Nếu đường
 * nộp phiếu làm y như vậy thì ai nộp phiếu cũng thành "đủ check in + check out",
 * kể cả người chưa từng tới hội trường — tức là hỏng đúng con số mà ban tổ chức
 * dùng để đề xuất điểm rèn luyện. Mục 2 canh chính điều đó.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng lib/event-survey.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scopeError: null })),
  canOperateSeason: vi.fn(async () => true)
}));
vi.mock("@/lib/events", () => ({
  isValidUuid: (value: unknown) =>
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
  requireEventAdmin: vi.fn(async () => ({ ok: true, admin: { id: "admin-1" } }))
}));
vi.mock("@/lib/email", () => ({
  resolveEmailBaseUrl: vi.fn((origin?: string | null) => origin ?? "https://os.example.org"),
  sendEventSurvey: vi.fn(async () => ({ ok: true, skipped: false }))
}));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));
vi.mock("@/lib/event-checkin", () => ({ listEventScans: vi.fn(async () => ({ scans: [], error: null })) }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canOperateSeason } from "@/lib/program-scope";
import { requireEventAdmin } from "@/lib/events";
import { sendEventSurvey } from "@/lib/email";
import { listEventScans } from "@/lib/event-checkin";
import { getEventSurveyOverview, runEventSurveySend, submitEventSurvey } from "@/lib/event-survey";
import { SURVEY_CHUNK } from "@/lib/event-survey-core";

// ── Bộ giả database ─────────────────────────────────────────────────────────

type Row = Record<string, any>;
type Filter = { op: "eq" | "neq" | "in" | "lt"; column: string; value: any };
type Write = { table: string; op: "insert" | "update" | "upsert"; values: any; filters: Filter[] };

const DUPLICATE = { code: "23505", message: "duplicate key value violates unique constraint" };

class FakeDb {
  tables: Record<string, Row[]> = {};
  writes: Write[] = [];
  failures = new Map<string, { code: string; message: string }>();
  private seq = 0;

  uuid() {
    this.seq += 1;
    return `00000000-0000-4000-9000-${String(this.seq).padStart(12, "0")}`;
  }

  rows(table: string) {
    return (this.tables[table] ??= []);
  }

  writesTo(table: string, op?: Write["op"]) {
    return this.writes.filter((write) => write.table === table && (!op || write.op === op));
  }
}

class Query {
  private op: "select" | "insert" | "update" | "upsert" = "select";
  private filters: Filter[] = [];
  private payload: any;
  private returning = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private max: number | null = null;
  private ignoreDuplicates = false;

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
  upsert(values: any, options?: { ignoreDuplicates?: boolean }) {
    this.op = "upsert";
    this.payload = values;
    this.ignoreDuplicates = options?.ignoreDuplicates === true;
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
  gt(column: string, value: any) {
    // Phân trang keyset đi qua đây; bộ giả trả đủ trong một trang nên chỉ cần lọc.
    this.filters.push({ op: "lt", column: `__gt__${column}`, value });
    return this;
  }
  lt(column: string, value: any) {
    this.filters.push({ op: "lt", column, value });
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
  range() {
    return this;
  }
  maybeSingle() {
    return this.run().then((result: any) => ({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error
    }));
  }
  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return this.run().then(resolve, reject);
  }

  private matches(row: Row) {
    return this.filters.every((filter) => {
      if (filter.column.startsWith("__gt__")) {
        const column = filter.column.slice(6);
        return String(row[column] ?? "") > String(filter.value);
      }
      const value = row[filter.column];
      if (filter.op === "eq") return value === filter.value;
      if (filter.op === "neq") return value !== filter.value;
      if (filter.op === "in") return filter.value.includes(value);
      return value != null && String(value) < String(filter.value);
    });
  }

  private async run(): Promise<{ data: any; error: any }> {
    await Promise.resolve();
    const rows = this.db.rows(this.table);
    const failureKey = `${this.table}:${this.op}`;
    const failure = this.db.failures.get(failureKey);
    if (failure) {
      this.db.failures.delete(failureKey);
      return { data: null, error: failure };
    }

    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload];
      this.db.writes.push({ table: this.table, op: this.op, values: this.payload, filters: [] });

      const inserted: Row[] = [];
      for (const item of list) {
        const clash = rows.find((row) => duplicate(this.table, row, item));
        if (clash) {
          if (this.op === "insert") return { data: null, error: DUPLICATE };
          if (this.ignoreDuplicates) continue;
          Object.assign(clash, item);
          continue;
        }
        const row = { id: this.db.uuid(), ...defaultsFor(this.table), ...item };
        rows.push(row);
        inserted.push({ ...row });
      }
      return { data: this.returning ? inserted : null, error: null };
    }

    if (this.op === "update") {
      const affected = rows.filter((row) => this.matches(row));
      for (const row of affected) Object.assign(row, this.payload);
      this.db.writes.push({ table: this.table, op: "update", values: this.payload, filters: [...this.filters] });
      return { data: this.returning ? affected.map((row) => ({ ...row })) : null, error: null };
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
    return { data: result, error: null };
  }
}

/**
 * Giá trị mặc định của cột, đúng như migration đặt.
 *
 * Bộ giả không có chúng thì dòng vừa xếp hàng mang `status: undefined`, phép lọc
 * `.eq("status", "queued")` không thấy nó, và test xanh cho một hàm không gửi gì
 * — đúng kiểu "bản giả nuốt lệnh" mà CLAUDE.md cảnh báo.
 */
function defaultsFor(table: string): Row {
  if (table === "event_survey_recipients") return { status: "queued", attempted_at: null, error: null };
  if (table === "event_survey_responses") return { submitted_at: "2026-09-19T12:00:00.000Z" };
  if (table === "event_scans") return { scanned_at: "2026-09-19T12:00:00.000Z" };
  return {};
}

/** Các ràng buộc duy nhất mà bộ giả phải thi hành để test nói đúng sự thật. */
function duplicate(table: string, row: Row, candidate: Row): boolean {
  if (table === "event_survey_responses") {
    return row.event_id === candidate.event_id && row.email_norm === candidate.email_norm;
  }
  if (table === "event_survey_recipients") {
    return row.event_id === candidate.event_id && row.registration_id === candidate.registration_id;
  }
  if (table === "event_scans") {
    return row.registration_id === candidate.registration_id && row.station === candidate.station;
  }
  return false;
}

function clientFor(db: FakeDb) {
  return { from: (table: string) => new Query(db, table) };
}

// ── Dữ liệu mẫu ─────────────────────────────────────────────────────────────

const EVENT_ID = "00000000-0000-4000-b000-000000000001";
const SEASON_ID = "00000000-0000-4000-b000-0000000000aa";
const TOKEN = "00000000-0000-4000-c000-000000000001";

function regId(n: number) {
  return `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
}

const PHIEU = {
  full_name: "Nguyễn Văn A",
  email: "a@example.com",
  phone: "0905376392",
  student_id: "31221020000",
  impression: "Phần chia sẻ của anh mentor.",
  question: "Khi nào có kết quả ghép cặp ạ?"
};

function seed(db: FakeDb, options: { steps?: string[]; linkActive?: boolean } = {}) {
  db.tables.events = [
    {
      id: EVENT_ID,
      season_id: SEASON_ID,
      event_name: "Mentee Orientation Mùa 12",
      status: "active",
      starts_at: "2026-09-19T10:00:00.000Z",
      ends_at: "2026-09-19T12:00:00.000Z",
      checkin_steps: options.steps ?? ["entrance"],
      survey_send_at: null
    }
  ];
  db.tables.event_links = [
    {
      id: "link-1",
      event_id: EVENT_ID,
      link_type: "survey",
      token: TOKEN,
      is_active: options.linkActive !== false,
      opens_at: null,
      closes_at: null,
      events: db.tables.events[0]
    }
  ];
  db.tables.event_registrations = [
    {
      id: regId(1),
      event_id: EVENT_ID,
      full_name: "Nguyễn Văn A",
      email: "a@example.com",
      phone: "0905376392",
      registration_status: "registered",
      attendance_status: "checked_in"
    },
    {
      id: regId(2),
      event_id: EVENT_ID,
      full_name: "Trần Thị B",
      email: "b@example.com",
      phone: "0912345678",
      registration_status: "registered",
      attendance_status: "pending"
    }
  ];
}

let db: FakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = new FakeDb();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(clientFor(db) as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true as never);
  vi.mocked(requireEventAdmin).mockResolvedValue({ ok: true, admin: { id: "admin-1" } } as never);
  vi.mocked(listEventScans).mockResolvedValue({ scans: [], error: null } as never);
  vi.mocked(sendEventSurvey).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("1. nộp phiếu", () => {
  it("ghi phiếu và khớp đúng người bằng email", async () => {
    seed(db);
    const result = await submitEventSurvey({ token: TOKEN, source: "qr", values: PHIEU });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(true);
    const responses = db.rows("event_survey_responses");
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({
      event_id: EVENT_ID,
      registration_id: regId(1),
      matched_by: "email",
      email_norm: "a@example.com",
      phone_norm: "0905376392",
      impression: PHIEU.impression,
      source: "qr"
    });
  });

  it("khớp bằng số điện thoại khi người ta gõ email khác lúc đăng ký", async () => {
    seed(db);
    const result = await submitEventSurvey({
      token: TOKEN,
      source: "email",
      values: { ...PHIEU, email: "a.khac@example.com" }
    });

    expect(result.matched).toBe(true);
    expect(db.rows("event_survey_responses")[0]).toMatchObject({
      registration_id: regId(1),
      matched_by: "phone"
    });
  });

  it("phiếu không hợp lệ thì KHÔNG ghi gì cả", async () => {
    seed(db);
    const result = await submitEventSurvey({ token: TOKEN, source: "qr", values: { ...PHIEU, impression: " " } });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(db.writes).toHaveLength(0);
  });

  it("link đã đóng thì từ chối, không ghi gì cả", async () => {
    seed(db, { linkActive: false });
    const result = await submitEventSurvey({ token: TOKEN, source: "qr", values: PHIEU });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("link_error");
    expect(db.rows("event_survey_responses")).toHaveLength(0);
    expect(db.rows("event_scans")).toHaveLength(0);
  });

  it("nộp lại là SỬA phiếu cũ, không sinh phiếu thứ hai", async () => {
    seed(db);
    await submitEventSurvey({ token: TOKEN, source: "qr", values: PHIEU });
    await submitEventSurvey({
      token: TOKEN,
      source: "qr",
      values: { ...PHIEU, impression: "Câu trả lời sửa lại." }
    });

    const responses = db.rows("event_survey_responses");
    expect(responses).toHaveLength(1);
    expect(responses[0].impression).toBe("Câu trả lời sửa lại.");
  });
});

describe("2. nộp phiếu là check out — và KHÔNG phải check in", () => {
  it("ghi một lượt quét ở trạm check out, không gắn người quét", async () => {
    seed(db, { steps: ["entrance", "checkout"] });
    await submitEventSurvey({ token: TOKEN, source: "qr", values: PHIEU });

    const scans = db.rows("event_scans");
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({
      event_id: EVENT_ID,
      registration_id: regId(1),
      station: "checkout",
      scanned_by: null
    });
  });

  it("KHÔNG đụng tới attendance_status của dòng đăng ký", async () => {
    seed(db);
    // Người chưa hề check in mà nộp phiếu: dòng của họ phải giữ nguyên "pending".
    await submitEventSurvey({
      token: TOKEN,
      source: "qr",
      values: { ...PHIEU, email: "b@example.com", phone: "0912345678" }
    });

    expect(db.writesTo("event_registrations")).toHaveLength(0);
    expect(db.rows("event_registrations")[1].attendance_status).toBe("pending");
  });

  it("nói cho người nộp biết họ chưa có lượt check in nào", async () => {
    seed(db);
    const result = await submitEventSurvey({
      token: TOKEN,
      source: "qr",
      values: { ...PHIEU, email: "b@example.com", phone: "0912345678" }
    });

    expect(result.matched).toBe(true);
    expect(result.checkedIn).toBe(false);
  });

  it("đã có lượt quét Check in thì báo đã check in", async () => {
    seed(db);
    db.rows("event_scans").push({
      id: "scan-1",
      event_id: EVENT_ID,
      registration_id: regId(1),
      station: "entrance"
    });

    const result = await submitEventSurvey({ token: TOKEN, source: "qr", values: PHIEU });
    expect(result.checkedIn).toBe(true);
  });

  it("nộp lại lần hai không sinh lượt check out thứ hai", async () => {
    seed(db);
    await submitEventSurvey({ token: TOKEN, source: "qr", values: PHIEU });
    await submitEventSurvey({ token: TOKEN, source: "qr", values: PHIEU });

    expect(db.rows("event_scans")).toHaveLength(1);
  });

  it("không khớp được ai thì lưu phiếu nhưng KHÔNG ghi lượt check out", async () => {
    seed(db);
    const result = await submitEventSurvey({
      token: TOKEN,
      source: "qr",
      values: { ...PHIEU, email: "la@example.com", phone: "0999999999" }
    });

    expect(result.ok).toBe(true);
    expect(result.matched).toBe(false);
    expect(db.rows("event_survey_responses")).toHaveLength(1);
    expect(db.rows("event_survey_responses")[0].registration_id).toBeNull();
    expect(db.rows("event_scans")).toHaveLength(0);
  });
});

describe("3. gửi thư khảo sát", () => {
  it("chỉ gửi cho người đã check in", async () => {
    seed(db);
    const result = await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });

    expect(result.ok).toBe(true);
    expect(sendEventSurvey).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEventSurvey).mock.calls[0][0]).toMatchObject({
      toEmail: "a@example.com",
      registrationId: regId(1)
    });
    expect(db.rows("event_survey_recipients")).toHaveLength(1);
    expect(db.rows("event_survey_recipients")[0].status).toBe("sent");
  });

  it("link trong thư mang dấu ?tu=thu", async () => {
    seed(db);
    await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });
    expect(vi.mocked(sendEventSurvey).mock.calls[0][0].surveyUrl).toBe(
      `https://os.example.org/khao-sat/${TOKEN}?tu=thu`
    );
  });

  it("nhóm rộng gửi cho cả người chưa check in", async () => {
    seed(db);
    await runEventSurveySend({ eventId: EVENT_ID, audience: "all_registered" });
    expect(sendEventSurvey).toHaveBeenCalledTimes(2);
  });

  it("gọi lần hai không gửi lại cho người đã nhận", async () => {
    seed(db);
    await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });
    await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });

    expect(sendEventSurvey).toHaveBeenCalledTimes(1);
    expect(db.rows("event_survey_recipients")).toHaveLength(1);
  });

  it("người check in muộn được đón ở lần gọi sau — danh sách không chốt một lần", async () => {
    seed(db);
    await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });

    db.rows("event_registrations")[1].attendance_status = "checked_in";
    await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });

    expect(sendEventSurvey).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendEventSurvey).mock.calls[1][0].toEmail).toBe("b@example.com");
  });

  it("hai tab bấm cùng lúc: mỗi người vẫn chỉ nhận MỘT thư", async () => {
    seed(db);
    // Bộ giả nhả lượt trước mỗi lệnh, nên hai lần gọi chen nhau như ngoài đời.
    // Thứ giữ cho không ai nhận hai thư là lệnh CHIẾM có điều kiện
    // (`queued → sending`), không phải may mắn về thứ tự.
    await Promise.all([
      runEventSurveySend({ eventId: EVENT_ID, audience: "all_registered" }),
      runEventSurveySend({ eventId: EVENT_ID, audience: "all_registered" })
    ]);

    const recipients = db.rows("event_survey_recipients");
    expect(recipients).toHaveLength(2);
    expect(sendEventSurvey).toHaveBeenCalledTimes(2);
    const addressed = vi.mocked(sendEventSurvey).mock.calls.map((call) => call[0].toEmail).sort();
    expect(addressed).toEqual(["a@example.com", "b@example.com"]);
  });

  it("cổng thư đang tắt KHÔNG được tính là đã gửi", async () => {
    seed(db);
    vi.mocked(sendEventSurvey).mockResolvedValue({ ok: true, skipped: true, reason: "cổng tắt" } as never);

    const result = await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });
    expect(db.rows("event_survey_recipients")[0].status).toBe("failed");
    expect(result.counts?.sent).toBe(0);
  });

  it("mỗi lần gọi gửi tối đa một lô", async () => {
    seed(db);
    const many = Array.from({ length: SURVEY_CHUNK + 4 }, (_, index) => ({
      id: regId(index + 10),
      event_id: EVENT_ID,
      full_name: `Người ${index}`,
      email: `nguoi${index}@example.com`,
      phone: null,
      registration_status: "registered",
      attendance_status: "checked_in"
    }));
    db.tables.event_registrations = many;

    await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });
    expect(sendEventSurvey).toHaveBeenCalledTimes(SURVEY_CHUNK);
  });

  it("chưa có link khảo sát thì từ chối, không gửi thư nào", async () => {
    seed(db);
    db.tables.event_links = [];

    const result = await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("link khảo sát");
    expect(sendEventSurvey).not.toHaveBeenCalled();
  });

  it("không có quyền vận hành trong mùa thì không gửi gì", async () => {
    seed(db);
    vi.mocked(canOperateSeason).mockResolvedValue(false as never);

    const result = await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });
    expect(result.ok).toBe(false);
    expect(sendEventSurvey).not.toHaveBeenCalled();
    expect(db.rows("event_survey_recipients")).toHaveLength(0);
  });

  it("chưa ai check in thì nói rõ, và mách đường đổi nhóm người nhận", async () => {
    seed(db);
    db.rows("event_registrations").forEach((row) => (row.attendance_status = "pending"));

    const result = await runEventSurveySend({ eventId: EVENT_ID, audience: "checked_in" });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Chưa có ai được check in");
    expect(sendEventSurvey).not.toHaveBeenCalled();
  });
});

describe("4. bảng số của ban tổ chức", () => {
  it("đếm người đủ CẢ check in lẫn check out", async () => {
    seed(db, { steps: ["entrance", "checkout"] });
    vi.mocked(listEventScans).mockResolvedValue({
      scans: [
        { registrationId: regId(1), station: "entrance", scannedAt: "2026-09-19T10:05:00.000Z" },
        { registrationId: regId(1), station: "checkout", scannedAt: "2026-09-19T11:50:00.000Z" },
        // Người thứ hai chỉ có check out (nộp phiếu mà chưa từng được quét vào).
        { registrationId: regId(2), station: "checkout", scannedAt: "2026-09-19T11:55:00.000Z" }
      ],
      error: null
    } as never);

    const overview = await getEventSurveyOverview(EVENT_ID);
    expect(overview.ok).toBe(true);
    expect(overview.checkedIn).toBe(1);
    expect(overview.completed).toBe(1);
  });

  it("đọc hỏng lịch sử quét thì báo lỗi, không trả về 0 như thật", async () => {
    seed(db);
    vi.mocked(listEventScans).mockResolvedValue({ scans: [], error: "hỏng" } as never);

    const overview = await getEventSurveyOverview(EVENT_ID);
    expect(overview.ok).toBe(false);
    expect(overview.message).toBeTruthy();
  });

  it("không có quyền thì không trả về con số nào", async () => {
    seed(db);
    vi.mocked(canOperateSeason).mockResolvedValue(false as never);

    const overview = await getEventSurveyOverview(EVENT_ID);
    expect(overview.ok).toBe(false);
    expect(overview.url).toBeNull();
  });
});
