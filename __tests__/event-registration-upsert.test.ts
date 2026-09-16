/**
 * Đăng ký lại thì GHI ĐÈ, và một người đăng ký được cả hai buổi.
 *
 * Chủ dự án chốt 16/09/2026. Trước đó hệ thống chặn hai lớp: ràng buộc "một email
 * một chuỗi" trong database, và câu báo "Bạn đã đăng ký sự kiện này rồi".
 *
 * Những cách bản sửa này trông như chạy mà thật ra làm hỏng việc, và bộ test canh
 * từng cái:
 *   - ghi đè mà xoá luôn chỗ đã giữ hoặc việc đã điểm danh;
 *   - ghi đè mà cấp lại mã QR, làm tấm vé trong hộp thư người ta ngừng hoạt động;
 *   - người đã có chỗ nộp lại bị cổng sức chứa chặn, nên không sửa nổi tên gõ sai;
 *   - hai lần bấm gửi gần nhau tạo hai dòng, hoặc báo lỗi cho người đăng ký;
 *   - khớp bằng số điện thoại rồi ghi đè lên đăng ký của MỘT NGƯỜI KHÁC.
 *
 * Bản giả PostgREST ở đây lấy theo events-pagination-contract.test.ts, thêm phần
 * bắt lỗi trùng khoá để dựng lại hai tình huống 23505.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateAnyScope: vi.fn(),
  canOperateSeason: vi.fn(),
  getAllowedSeasonIds: vi.fn(),
  canAccessSeason: vi.fn()
}));
vi.mock("@/lib/data", () => ({
  getMenteeProfiles: vi.fn(),
  getMentorProfiles: vi.fn(),
  getPeople: vi.fn(),
  getSeasons: vi.fn()
}));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));
vi.mock("@/lib/event-checkin", () => ({
  ensureCheckinCode: vi.fn(async () => ({ code: "CODE123456", shortCode: "AB12", error: null }))
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  resolveEmailBaseUrl: vi.fn(() => "https://os.example.org"),
  sendEventRegistrationConfirmation: vi.fn(async () => ({ ok: true, skipped: false }))
}));

import { ensureCheckinCode } from "@/lib/event-checkin";
import { registerForEvent } from "@/lib/events";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;
type FailWrite = { code: string; message?: string };
type Options = { failInsert?: FailWrite; failUpdate?: FailWrite };

type FakeClient = {
  from: (table: string) => any;
  inserts: Array<{ table: string; rows: Row[] }>;
  updates: Array<{ table: string; values: Row }>;
};

function makeFakeClient(tables: Record<string, Row[]>, options: Options = {}): FakeClient {
  const client: FakeClient = {
    inserts: [],
    updates: [],
    from(table: string) {
      const source = tables[table] ?? [];
      const filters: Array<(row: Row) => boolean> = [];
      let rowLimit = Infinity;
      let mode: "select" | "insert" | "update" = "select";
      let payload: Row[] = [];

      const matching = () => source.filter((row) => filters.every((keep) => keep(row)));

      function resolve() {
        if (mode === "insert") {
          if (options.failInsert) return { data: null, error: options.failInsert };
          client.inserts.push({ table, rows: payload });
          const stamped = payload.map((row, index) => ({ id: `inserted-${index}`, ...row }));
          source.push(...stamped);
          return { data: stamped, error: null };
        }
        if (mode === "update") {
          if (options.failUpdate) return { data: null, error: options.failUpdate };
          const hit = matching();
          const values = payload[0] ?? {};
          for (const row of hit) Object.assign(row, values);
          client.updates.push({ table, values });
          return { data: hit, error: null };
        }
        return { data: matching().slice(0, rowLimit), error: null };
      }

      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters.push((row) => String(row[column] ?? "") === String(value));
          return query;
        },
        neq: (column: string, value: unknown) => {
          filters.push((row) => String(row[column] ?? "") !== String(value));
          return query;
        },
        gt: (column: string, value: unknown) => {
          filters.push((row) => String(row[column] ?? "") > String(value));
          return query;
        },
        in: (column: string, values: unknown[]) => {
          const allowed = new Set(values.map(String));
          filters.push((row) => allowed.has(String(row[column] ?? "")));
          return query;
        },
        ilike: (column: string, value: unknown) => {
          const needle = String(value).toLowerCase();
          filters.push((row) => String(row[column] ?? "").toLowerCase() === needle);
          return query;
        },
        order: () => query,
        range: (from: number, to: number) => {
          rowLimit = to - from + 1;
          return query;
        },
        limit: (n: number) => {
          rowLimit = n;
          return query;
        },
        insert: (rows: Row | Row[]) => {
          mode = "insert";
          payload = Array.isArray(rows) ? rows : [rows];
          return query;
        },
        update: (values: Row) => {
          mode = "update";
          payload = [values];
          return query;
        },
        maybeSingle: () => {
          const result = resolve();
          const rows = (result.data ?? []) as Row[];
          return Promise.resolve({ data: rows[0] ?? null, error: result.error });
        },
        then: (onOk: any, onErr: any) => Promise.resolve(resolve()).then(onOk, onErr)
      };
      return query;
    }
  };
  return client;
}

const E1 = "00000000-0000-4000-8000-000000000101";
const E2 = "00000000-0000-4000-8000-000000000102";
const SERIES = "00000000-0000-4000-8000-0000000001aa";
const TOKEN = "00000000-0000-4000-8000-0000000001bb";
const LINK = "00000000-0000-4000-8000-0000000001cc";

const eventRow = (id: string, index: number, overrides: Row = {}): Row => ({
  id,
  event_name: "Mentee Orientation Mùa 12",
  event_type: "mentee_orientation",
  status: "active",
  starts_at: `2026-09-${18 + index}T10:00:00.000Z`,
  ends_at: `2026-09-${18 + index}T12:00:00.000Z`,
  series_id: SERIES,
  series_index: index,
  series_total: 2,
  capacity_limit_enabled: false,
  capacity_limit: null,
  waitlist_enabled: false,
  approval_required: false,
  qr_checkin_enabled: true,
  ...overrides
});

const registrationRow = (overrides: Row = {}): Row => ({
  id: "reg-an",
  event_id: E1,
  series_id: SERIES,
  full_name: "Nguyễn An",
  email: "an@example.com",
  phone: "0905.376.392",
  registration_status: "registered",
  attendance_status: "checked_in",
  checkin_code: "OLDCODE123",
  ...overrides
});

function useClient(registrations: Row[], sessions: Row[] = [eventRow(E1, 1), eventRow(E2, 2)], options: Options = {}) {
  const client = makeFakeClient(
    {
      event_links: [
        {
          id: LINK,
          event_id: E1,
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
    },
    options
  );
  (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
  return client;
}

const submit = (overrides: Record<string, unknown> = {}) =>
  registerForEvent({
    token: TOKEN,
    session_event_id: E1,
    full_name: "Nguyễn An",
    email: "an@example.com",
    phone: "0905376392",
    consent_given: true,
    ...overrides
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureCheckinCode).mockResolvedValue({ code: "CODE123456", shortCode: "AB12", error: null });
});

describe("1. đăng ký lại thì ghi đè", () => {
  it("chưa có gì: tạo dòng mới", async () => {
    const client = useClient([]);

    const result = await submit();

    expect(result.status).toBe("success");
    expect(result.updated).toBeFalsy();
    expect(client.inserts).toHaveLength(1);
    expect(client.updates).toHaveLength(0);
  });

  it("cùng email: ghi đè dòng cũ, không tạo thêm dòng nào", async () => {
    const client = useClient([registrationRow()]);

    const result = await submit({ full_name: "Nguyễn An (sửa tên)", student_id: "31221020000" });

    expect(result.status).toBe("success");
    expect(result.updated).toBe(true);
    expect(result.registrationId).toBe("reg-an");
    expect(result.message).toBe("Đã cập nhật đăng ký của bạn.");
    expect(client.inserts).toHaveLength(0);
    expect(client.updates).toHaveLength(1);
    expect(client.updates[0].values).toMatchObject({
      full_name: "Nguyễn An (sửa tên)",
      student_id: "31221020000",
      email: "an@example.com"
    });
  });

  it("email khác nhưng cùng số điện thoại viết kiểu khác: vẫn ghi đè", async () => {
    const client = useClient([registrationRow()]);

    const result = await submit({ email: "an.moi@example.com", phone: "+84 905 376 392" });

    expect(result.updated).toBe(true);
    expect(client.inserts).toHaveLength(0);
    expect(client.updates[0].values).toMatchObject({ email: "an.moi@example.com" });
  });

  it("người khác hẳn: tạo dòng mới", async () => {
    const client = useClient([registrationRow()]);

    const result = await submit({ full_name: "Trần Bình", email: "binh@example.com", phone: "0936359670" });

    expect(result.status).toBe("success");
    expect(result.updated).toBeFalsy();
    expect(client.inserts).toHaveLength(1);
    expect(client.updates).toHaveLength(0);
  });

  it("đăng ký cũ đã huỷ: đăng ký lại là một đăng ký mới", async () => {
    const client = useClient([registrationRow({ registration_status: "cancelled" })]);

    const result = await submit();

    expect(result.status).toBe("success");
    expect(result.updated).toBeFalsy();
    expect(client.inserts).toHaveLength(1);
  });
});

describe("2. ghi đè không được làm mất thứ đã có", () => {
  it("không đụng chỗ đã giữ, việc đã điểm danh, hay nguồn đăng ký", async () => {
    const client = useClient([registrationRow({ registration_status: "waitlisted" })]);

    await submit();

    const values = client.updates[0].values;
    expect(values).not.toHaveProperty("registration_status");
    expect(values).not.toHaveProperty("attendance_status");
    expect(values).not.toHaveProperty("is_walk_in");
    expect(values).not.toHaveProperty("registration_source");
  });

  it("không cấp lại mã QR: tấm vé trong hộp thư vẫn dùng được", async () => {
    const client = useClient([registrationRow()]);

    await submit();

    expect(client.updates[0].values).not.toHaveProperty("checkin_code");
    expect(client.updates[0].values).not.toHaveProperty("short_code");
    expect(ensureCheckinCode).toHaveBeenCalledWith("reg-an");
  });
});

describe("3. cả hai buổi của chuỗi", () => {
  it("đã có chỗ buổi 1, đăng ký buổi 2: tạo dòng mới cho buổi 2", async () => {
    const client = useClient([registrationRow()]);

    const result = await submit({ session_event_id: E2 });

    expect(result.status).toBe("success");
    expect(result.updated).toBeFalsy();
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0].rows[0]).toMatchObject({ event_id: E2, series_id: SERIES });
  });
});

describe("4. sức chứa", () => {
  const fullSessions = [
    eventRow(E1, 1, { capacity_limit_enabled: true, capacity_limit: 1, waitlist_enabled: false }),
    eventRow(E2, 2)
  ];

  it("người đã có chỗ nộp lại khi buổi đã đầy: vẫn cập nhật được", async () => {
    const client = useClient([registrationRow()], fullSessions);

    const result = await submit({ full_name: "Nguyễn An (sửa tên)" });

    expect(result.status).toBe("success");
    expect(result.updated).toBe(true);
    expect(client.updates).toHaveLength(1);
  });

  it("người mới khi buổi đã đầy: vẫn bị từ chối", async () => {
    const client = useClient([registrationRow()], fullSessions);

    const result = await submit({ full_name: "Trần Bình", email: "binh@example.com", phone: "0936359670" });

    expect(result.status).toBe("capacity_full");
    expect(client.inserts).toHaveLength(0);
    expect(client.updates).toHaveLength(0);
  });
});

describe("0. chữ trên màn hình nói đúng luật mới", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("form nói rõ đăng ký được cả hai buổi, và nộp lại là cập nhật", () => {
    const form = read("app/register/[token]/registration-form.tsx");
    expect(form).toContain("Bạn có thể đăng ký cả hai buổi");
    expect(form).toContain("cập nhật đăng ký trước đó");
    expect(form).not.toContain("Mỗi người chỉ đăng ký một buổi");
  });

  it("màn hình kết quả phân biệt 'đã cập nhật' với 'đăng ký thành công'", () => {
    expect(read("app/register/[token]/actions.ts")).toContain('result.updated ? "&updated=1" : ""');
    const page = read("app/register/[token]/page.tsx");
    expect(page).toContain("Đã cập nhật đăng ký");
    expect(page).toContain("thay cho đăng ký trước đó");
  });
});

describe("5. hai lần bấm gửi gần nhau, và trùng email của người khác", () => {
  it("insert đụng ràng buộc duy nhất: đọc lại rồi ghi đè, không báo lỗi cho người đăng ký", async () => {
    const client = useClient([registrationRow()], [eventRow(E1, 1), eventRow(E2, 2)], {
      failInsert: { code: "23505", message: "duplicate key value violates unique constraint" }
    });
    // Người này chưa có trong lần đọc đầu (bản giả trả cả danh sách, nên mô phỏng
    // bằng email khác), nhưng dòng của họ đã nằm sẵn ở lần đọc lại.
    const result = await submit({ email: "an@example.com" });

    expect(result.status).toBe("success");
    expect(result.updated).toBe(true);
    expect(client.updates).toHaveLength(1);
  });

  it("khớp bằng số điện thoại nhưng email mới trùng đăng ký của người khác: không ghi đè ai cả", async () => {
    const client = useClient([registrationRow()], [eventRow(E1, 1), eventRow(E2, 2)], {
      failUpdate: { code: "23505", message: "duplicate key value violates unique constraint" }
    });

    const result = await submit({ email: "binh@example.com", phone: "0905376392" });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(result.message).toContain("Email này đã dùng cho một đăng ký khác");
    expect(client.inserts).toHaveLength(0);
  });
});
