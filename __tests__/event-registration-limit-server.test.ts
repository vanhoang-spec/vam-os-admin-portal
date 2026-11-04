/**
 * Giới hạn số lần một email được đăng ký sự kiện (VAM00015) ở phía máy chủ ứng dụng:
 *   - tạo và sửa sự kiện GHI đúng hai cột giới hạn, và từ chối ô nhập sai TRƯỚC khi ghi gì;
 *   - sửa là đường ghi hẹp: lời gọi không mang ô này không được xoá giới hạn BTC đã đặt;
 *   - sửa một buổi của chuỗi, khi được chọn, áp giới hạn cho các buổi còn lại và chỉ ghi đúng hai cột đó;
 *   - đăng ký công khai bị trigger từ chối thì người đăng ký đọc một câu rõ ràng, không phải "lỗi hệ thống";
 *   - form tùy chỉnh gắn sự kiện cũng đổi lỗi trigger thành câu trả lời.
 *
 * Các ca đọc CHÍNH CÁC LỆNH GHI mà hàm phát ra (nếp của event-series-renumber-on-edit.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn(),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn(),
  canOperateAnyScope: vi.fn(() => true)
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));
vi.mock("@/lib/event-checkin", () => ({
  ensureCheckinCode: vi.fn(async () => ({ code: "CODE123456", shortCode: "AB12", error: null }))
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  resolveEmailBaseUrl: vi.fn(() => "https://os.example.org"),
  sendEventRegistrationConfirmation: vi.fn(async () => ({ ok: true, skipped: false }))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canAccessSeason, canOperateAnyScope, canOperateSeason, getAdminScopeContext, getAllowedSeasonIds } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createEvent, createEventSeries, registerForEvent, updateEvent } from "@/lib/events";
import { submitEventLinkedForm } from "@/lib/custom-form-event";

const SESSION_1 = "00000000-0000-4000-8000-0000000000a1";
const SESSION_2 = "00000000-0000-4000-8000-0000000000a2";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const SERIES = "00000000-0000-4000-8000-0000000000cc";
const ACTOR = "00000000-0000-4000-8000-0000000000dd";
const TOKEN = "00000000-0000-4000-8000-0000000001bb";
const LINK = "00000000-0000-4000-8000-0000000001cc";
const LIMIT_ERROR = { code: "P0001", message: "EVENT_REGISTRATION_LIMIT_REACHED", details: "scope=series; limit=1; count=1" };

type Row = Record<string, any>;
type Write = { table: string; op: "update" | "insert"; payload: Row; filters: Array<[string, unknown]> };

const SERIES_SESSION: Row = {
  id: SESSION_1,
  season_id: SEASON,
  event_name: "Mentor Orientation",
  event_type: "training",
  starts_at: "2026-09-20T01:00:00+00:00",
  event_format: "offline",
  status: "active",
  legacy_event_temp_id: null,
  series_id: SERIES,
  series_index: 1,
  series_total: 2,
  registration_limit_per_email: null,
  registration_limit_scope: "event"
};
const SINGLE_EVENT: Row = { ...SERIES_SESSION, series_id: null, series_index: null, series_total: null };

const FORM = {
  event_name: "Mentor Orientation",
  event_type: "training",
  season_code: "UEHM-S12",
  starts_at: "2026-10-04T08:00",
  ends_at: "2026-10-04T11:30",
  event_format: "offline",
  location_name: "Phòng B1-502",
  location_address: "279 Nguyễn Tri Phương, P.5, Q.10",
  online_join_url: ""
};

function makeEventsClient(before: Row, seriesRows: Row[] = []) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let write: Write | null = null;
    const filters: Array<[string, unknown]> = [];
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        (write ? write.filters : filters).push([column, value]);
        return chain;
      },
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      update: (payload: Row) => {
        write = { table, op: "update", payload, filters: [] };
        writes.push(write);
        return chain;
      },
      insert: (payload: Row) => {
        write = { table, op: "insert", payload, filters: [] };
        writes.push(write);
        return chain;
      },
      maybeSingle: async () => {
        if (write && table === "events") return { data: { ...before, ...write.payload }, error: null };
        if (table === "seasons") return { data: { id: SEASON, code: "UEHM-S12" }, error: null };
        return { data: before, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (write) return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        if (table === "events" && filters.some(([column]) => column === "series_id")) {
          return Promise.resolve({ data: seriesRows, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
    };
    return chain;
  };
  const eventWrites = () => writes.filter((write) => write.table === "events");
  const formSave = () => eventWrites().find((write) => write.op === "update" && "starts_at" in write.payload);
  const limitOnlyWrites = () =>
    eventWrites().filter(
      (write) => write.op === "update" && Object.keys(write.payload).every((key) => key.startsWith("registration_limit_"))
    );
  const inserts = () => eventWrites().filter((write) => write.op === "insert");
  return { client: { from, rpc: vi.fn(async () => ({ data: null, error: null })) }, writes, eventWrites, formSave, limitOnlyWrites, inserts };
}

function use(before: Row, seriesRows: Row[] = []) {
  const fake = makeEventsClient(before, seriesRows);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "core_team", status: "active" } as never);
  vi.mocked(getAdminScopeContext).mockResolvedValue({
    adminUser: { id: ACTOR, role: "core_team", status: "active" } as never,
    authUserId: "auth",
    globalRole: "core_team",
    isSuperAdmin: false,
    programScopes: [],
    scopeError: null
  } as never);
  vi.mocked(canOperateAnyScope).mockReturnValue(true as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true as never);
  vi.mocked(getAllowedSeasonIds).mockResolvedValue([SEASON] as never);
  vi.mocked(canAccessSeason).mockReturnValue(true as never);
});

describe("1. sửa sự kiện ghi đúng hai cột giới hạn", () => {
  it("buổi của chuỗi: nhập 1, phạm vi chuỗi → ghi 1 và series", async () => {
    const fake = use(SERIES_SESSION);
    const result = await updateEvent({ ...FORM, id: SESSION_1, registration_limit_per_email: "1", registration_limit_scope: "series" } as never);
    expect(result.ok).toBe(true);
    expect(fake.formSave()?.payload).toMatchObject({ registration_limit_per_email: 1, registration_limit_scope: "series" });
  });

  it("để trống: bỏ giới hạn (null) và phạm vi về event", async () => {
    const fake = use({ ...SERIES_SESSION, registration_limit_per_email: 1, registration_limit_scope: "series" });
    await updateEvent({ ...FORM, id: SESSION_1, registration_limit_per_email: "", registration_limit_scope: "series" } as never);
    expect(fake.formSave()?.payload).toMatchObject({ registration_limit_per_email: null, registration_limit_scope: "event" });
  });

  it("sự kiện lẻ: chọn phạm vi chuỗi tự về event và nhận số 1", async () => {
    const fake = use(SINGLE_EVENT);
    const result = await updateEvent({ ...FORM, id: SESSION_1, registration_limit_per_email: "1", registration_limit_scope: "series" } as never);
    expect(result.ok).toBe(true);
    expect(fake.formSave()?.payload).toMatchObject({ registration_limit_per_email: 1, registration_limit_scope: "event" });
  });

  it.each([
    ["0", "series", "số nguyên dương"],
    ["-3", "series", "số nguyên dương"],
    ["2.5", "series", "số nguyên dương"],
    ["abc", "series", "số nguyên dương"],
    ["5000", "series", "tối đa"],
    ["2", "event", "Một sự kiện"]
  ])("ô nhập sai (%s, %s): từ chối và KHÔNG ghi gì vào events", async (limit, scope, expected) => {
    const fake = use(SERIES_SESSION);
    const result = await updateEvent({ ...FORM, id: SESSION_1, registration_limit_per_email: limit, registration_limit_scope: scope } as never);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(expected);
    expect(fake.eventWrites()).toHaveLength(0);
  });

  it("đường ghi hẹp: lời gọi KHÔNG mang ô này thì không đụng giới hạn đã đặt", async () => {
    const fake = use({ ...SERIES_SESSION, registration_limit_per_email: 1, registration_limit_scope: "series" });
    await updateEvent({ ...FORM, id: SESSION_1 } as never);
    expect(fake.formSave()?.payload).not.toHaveProperty("registration_limit_per_email");
    expect(fake.formSave()?.payload).not.toHaveProperty("registration_limit_scope");
  });
});

describe("2. áp giới hạn cho cả chuỗi", () => {
  const sessions = [
    { id: SESSION_1, starts_at: "2026-10-04T01:00:00+00:00", series_index: 1, series_total: 2 },
    { id: SESSION_2, starts_at: "2026-10-11T01:00:00+00:00", series_index: 2, series_total: 2 }
  ];

  it("tick 'áp cho mọi buổi': thêm một lệnh ghi chỉ có hai cột giới hạn, lọc theo đúng chuỗi", async () => {
    const fake = use(SERIES_SESSION, sessions);
    const result = await updateEvent({
      ...FORM,
      id: SESSION_1,
      registration_limit_per_email: "1",
      registration_limit_scope: "series",
      registration_limit_apply_to_series: "true"
    } as never);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Giới hạn đăng ký đã áp cho mọi buổi của chuỗi.");
    const siblings = fake.limitOnlyWrites();
    expect(siblings).toHaveLength(1);
    expect(siblings[0].payload).toEqual({ registration_limit_per_email: 1, registration_limit_scope: "series" });
    expect(siblings[0].filters).toContainEqual(["series_id", SERIES]);
  });

  it("không tick: các buổi khác không bị đụng", async () => {
    const fake = use(SERIES_SESSION, sessions);
    await updateEvent({
      ...FORM,
      id: SESSION_1,
      registration_limit_per_email: "1",
      registration_limit_scope: "series",
      registration_limit_apply_to_series: "false"
    } as never);
    expect(fake.limitOnlyWrites()).toHaveLength(0);
  });

  it("tick mà ô nhập sai: từ chối từ đầu, không buổi nào bị ghi", async () => {
    const fake = use(SERIES_SESSION, sessions);
    const result = await updateEvent({
      ...FORM,
      id: SESSION_1,
      registration_limit_per_email: "0",
      registration_limit_scope: "series",
      registration_limit_apply_to_series: "true"
    } as never);
    expect(result.ok).toBe(false);
    expect(fake.eventWrites()).toHaveLength(0);
  });

  it("sự kiện lẻ: tick cũng không ghi sang buổi nào", async () => {
    const fake = use(SINGLE_EVENT);
    await updateEvent({
      ...FORM,
      id: SESSION_1,
      registration_limit_per_email: "1",
      registration_limit_scope: "series",
      registration_limit_apply_to_series: "true"
    } as never);
    expect(fake.limitOnlyWrites()).toHaveLength(0);
  });
});

describe("3. tạo sự kiện và tạo chuỗi", () => {
  it("tạo sự kiện lẻ: ghi giới hạn 1, phạm vi event", async () => {
    const fake = use(SINGLE_EVENT);
    const result = await createEvent({ ...FORM, registration_limit_per_email: "1", registration_limit_scope: "event" } as never);
    expect(result.ok).toBe(true);
    expect(fake.inserts()[0].payload).toMatchObject({ registration_limit_per_email: 1, registration_limit_scope: "event" });
  });

  it("không nhập gì: ghi null, phạm vi event (không giới hạn như trước nay)", async () => {
    const fake = use(SINGLE_EVENT);
    await createEvent({ ...FORM } as never);
    expect(fake.inserts()[0].payload).toMatchObject({ registration_limit_per_email: null, registration_limit_scope: "event" });
  });

  it("tạo chuỗi 3 buổi: MỌI buổi mang cùng giới hạn và phạm vi series", async () => {
    const fake = use(SERIES_SESSION);
    const result = await createEventSeries({
      ...FORM,
      registration_limit_per_email: "1",
      registration_limit_scope: "series",
      recurrence_frequency: "weekly",
      recurrence_interval: "1",
      recurrence_end_mode: "after_count",
      recurrence_count: "3"
    } as never);
    expect(result.ok).toBe(true);
    const inserts = fake.inserts();
    expect(inserts).toHaveLength(3);
    for (const insert of inserts) {
      expect(insert.payload).toMatchObject({ registration_limit_per_email: 1, registration_limit_scope: "series" });
    }
    // Cả ba buổi cùng một chuỗi: nếu mỗi buổi một series_id thì giới hạn theo chuỗi không đếm được gì.
    expect(new Set(inserts.map((insert) => insert.payload.series_id)).size).toBe(1);
  });

  it("tạo chuỗi mà ô nhập sai: MỘT lời báo, và không tạo buổi nào", async () => {
    const fake = use(SERIES_SESSION);
    const result = await createEventSeries({
      ...FORM,
      registration_limit_per_email: "-1",
      registration_limit_scope: "series",
      recurrence_frequency: "weekly",
      recurrence_interval: "1",
      recurrence_end_mode: "after_count",
      recurrence_count: "3"
    } as never);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("số nguyên dương");
    expect(result.message.match(/số nguyên dương/g)).toHaveLength(1);
    expect(fake.inserts()).toHaveLength(0);
  });

  it("tạo sự kiện lẻ với phạm vi chuỗi và số 2: từ chối, không ghi", async () => {
    const fake = use(SINGLE_EVENT);
    const result = await createEvent({ ...FORM, registration_limit_per_email: "2", registration_limit_scope: "series" } as never);
    expect(result.ok).toBe(false);
    expect(fake.inserts()).toHaveLength(0);
  });
});

describe("4. đăng ký công khai bị trigger từ chối", () => {
  const eventRow = (index: number, id: string): Row => ({
    ...SERIES_SESSION,
    id,
    series_index: index,
    event_name: "Mentee Orientation Mùa 12",
    starts_at: `2026-09-${18 + index}T10:00:00.000Z`,
    ends_at: `2026-09-${18 + index}T12:00:00.000Z`,
    capacity_limit_enabled: false,
    waitlist_enabled: false,
    approval_required: false,
    qr_checkin_enabled: true,
    registration_limit_per_email: 1,
    registration_limit_scope: "series"
  });

  function registrationClient(registrations: Row[], failure: { insert?: Row; update?: Row }) {
    const sessions = [eventRow(1, SESSION_1), eventRow(2, SESSION_2)];
    const inserts: Row[] = [];
    const tables: Record<string, Row[]> = {
      event_links: [
        {
          id: LINK,
          event_id: SESSION_1,
          token: TOKEN,
          link_type: "registration",
          is_active: true,
          opens_at: null,
          closes_at: null,
          covers_series: true,
          series_id: SERIES,
          events: sessions[0]
        }
      ],
      events: sessions,
      event_registrations: registrations,
      people: []
    };
    const from = (table: string) => {
      const source = tables[table] ?? [];
      const filters: Array<(row: Row) => boolean> = [];
      let mode: "select" | "insert" | "update" = "select";
      let rowLimit = Infinity;
      const matching = () => source.filter((row) => filters.every((keep) => keep(row)));
      const resolve = () => {
        if (mode === "insert") {
          if (failure.insert && table === "event_registrations") return { data: null, error: failure.insert };
          inserts.push({ table });
          return { data: [{ id: "new" }], error: null };
        }
        if (mode === "update") {
          if (failure.update && table === "event_registrations") return { data: null, error: failure.update };
          return { data: matching(), error: null };
        }
        return { data: matching().slice(0, rowLimit), error: null };
      };
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => (filters.push((row) => String(row[column] ?? "") === String(value)), query),
        neq: (column: string, value: unknown) => (filters.push((row) => String(row[column] ?? "") !== String(value)), query),
        gt: (column: string, value: unknown) => (filters.push((row) => String(row[column] ?? "") > String(value)), query),
        in: (column: string, values: unknown[]) => {
          const allowed = new Set(values.map(String));
          filters.push((row) => allowed.has(String(row[column] ?? "")));
          return query;
        },
        ilike: (column: string, value: unknown) => (filters.push((row) => String(row[column] ?? "").toLowerCase() === String(value).toLowerCase()), query),
        order: () => query,
        range: (from: number, to: number) => ((rowLimit = to - from + 1), query),
        limit: (n: number) => ((rowLimit = n), query),
        insert: () => ((mode = "insert"), query),
        update: () => ((mode = "update"), query),
        maybeSingle: () => {
          const result = resolve();
          const rows = (result.data ?? []) as Row[];
          return Promise.resolve({ data: rows[0] ?? null, error: result.error });
        },
        then: (onOk: any, onErr: any) => Promise.resolve(resolve()).then(onOk, onErr)
      };
      return query;
    };
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from, rpc: vi.fn() } as never);
    return { inserts };
  }

  const submit = (overrides: Row = {}) =>
    registerForEvent({
      token: TOKEN,
      session_event_id: SESSION_2,
      full_name: "Nguyễn An",
      email: "an@example.com",
      phone: "0905376392",
      consent_given: true,
      ...overrides
    });

  it("insert bị trigger chặn: trả limit_reached, câu nói rõ số lần và chuỗi, KHÔNG phải server_error", async () => {
    registrationClient([], { insert: LIMIT_ERROR });
    const result = await submit();
    expect(result.ok).toBe(false);
    expect(result.status).toBe("limit_reached");
    expect(result.message).toContain("1 lần");
    expect(result.message).toContain("chuỗi sự kiện");
    expect(result.eventName).toBe("Mentee Orientation Mùa 12");
  });

  it("lỗi insert KHÁC vẫn là lỗi hệ thống, không bị nuốt thành 'đủ lượt'", async () => {
    registrationClient([], { insert: { code: "XX000", message: "connection reset" } });
    const result = await submit();
    expect(result.status).toBe("server_error");
  });

  it("khớp số điện thoại rồi đổi sang email đã đủ lượt: update bị chặn cũng báo limit_reached", async () => {
    registrationClient(
      [
        {
          id: "reg-an",
          event_id: SESSION_2,
          series_id: SERIES,
          full_name: "Nguyễn An",
          email: "an.cu@example.com",
          phone: "0905376392",
          registration_status: "registered",
          attendance_status: "pending"
        }
      ],
      { update: LIMIT_ERROR }
    );
    const result = await submit({ email: "an.moi@example.com" });
    expect(result.status).toBe("limit_reached");
  });
});

describe("5. form tùy chỉnh gắn sự kiện", () => {
  it("hàm ghi đăng ký ném lỗi trigger: người điền nhận một câu rõ ràng, không bị đổ thành lỗi hệ thống", async () => {
    const eventRow = { ...SERIES_SESSION, status: "active", registration_limit_per_email: 1, registration_limit_scope: "series" };
    const client = {
      from: (table: string) => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          ilike: () => chain,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: table === "events" ? eventRow : null, error: null }),
          update: () => chain,
          insert: () => chain,
          then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject)
        };
        return chain;
      },
      rpc: vi.fn(async () => ({ data: null, error: LIMIT_ERROR }))
    };
    const result = await submitEventLinkedForm({
      client: client as never,
      form: { id: "f1", event_id: SESSION_1, title: "Đăng ký", registration_limit: null },
      fields: [{ id: "ten", type: "short_text", label: "Họ tên", required: true } as never],
      answers: { ten: "Nguyễn An" },
      email: "an@example.com",
      thanks: "Cảm ơn",
      nowMs: Date.parse("2026-11-03T10:00:00Z")
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("chuỗi sự kiện");
    expect(result.message).not.toContain("bận");
  });
});
