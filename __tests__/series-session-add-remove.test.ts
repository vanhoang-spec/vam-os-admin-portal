/**
 * Sửa một cú bấm nhầm: chặn buổi trùng, và xoá buổi đã lỡ thêm.
 *
 * ---------------------------------------------------------------------------
 * CHUYỆN ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Link đăng ký của chuỗi Mentor Orientation hiện ra ba lựa chọn: buổi 1 ngày
 * 20/09, buổi 2 ngày 27/09, và buổi 3 cũng ngày 27/09 — cùng giờ, cùng phòng.
 * Người đăng ký không có cách nào biết hai buổi cuối khác nhau ở đâu, vì chúng
 * không khác nhau ở đâu cả.
 *
 * Hai lớp phòng, thử ở đây cả hai:
 *   1. Không cho thêm một buổi trùng khít với buổi đã có.
 *   2. Cho xoá buổi đã lỡ thêm — nhưng chỉ khi chưa ai đăng ký, vì đăng ký
 *      nghĩa là đã có vé nằm trong hộp thư người ta.
 *
 * Các ca dưới đây không cần database: chúng đọc CHÍNH CÁC LỆNH GHI mà hàm phát
 * ra, và khẳng định lệnh nào phải có, lệnh nào không được có.
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
  canOperateAnyScope: vi.fn(async () => true)
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  addSessionToSeries,
  removeSessionFromSeries,
  updateSessionTime
} from "@/lib/events";

const EVENT = "00000000-0000-4000-8000-0000000000aa";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const SERIES = "00000000-0000-4000-8000-0000000000cc";
const OTHER = "00000000-0000-4000-8000-0000000000dd";

const SERIES_COLUMNS = ["series_id", "series_index", "series_total"] as const;

/** 08:00 giờ Việt Nam ngày 20/09/2026, đúng dạng đang lưu trong bảng. */
const ANCHOR_START = "2026-09-20T01:00:00.000Z";

type Write = {
  table: string;
  kind: "update" | "insert" | "delete";
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

/**
 * Bản giả của client Supabase, đủ để ghi lại mọi lệnh mà hàm phát ra.
 *
 * `events` trả về `anchor` cho lệnh `.maybeSingle()` (nạp một dòng) và trả về
 * `siblings` cho lệnh được await thẳng (nạp cả chuỗi) — đúng hai kiểu gọi mà
 * hai hàm đang dùng.
 */
type OrderBy = { column: string; ascending: boolean };

/** Sắp như Postgres sắp: chuỗi so theo chuỗi, số so theo số, thiếu thì xuống cuối. */
function sortRows(rows: Array<Record<string, unknown>>, order: OrderBy) {
  const direction = order.ascending ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left[order.column];
    const b = right[order.column];
    if (a === b) return 0;
    if (a === undefined || a === null) return 1;
    if (b === undefined || b === null) return -1;
    if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
    return String(a).localeCompare(String(b)) * direction;
  });
}

function makeClient(options: {
  anchor: Record<string, unknown> | null;
  siblings?: Array<Record<string, unknown>>;
  /** Cả chuỗi như database trả về SAU lệnh chèn buổi mới. Không đặt thì dùng `siblings`. */
  siblingsAfterInsert?: Array<Record<string, unknown>>;
  registrations?: Array<Record<string, unknown>>;
}) {
  const writes: Write[] = [];
  let inserted = false;

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let current: Write | null = null;
    let orderBy: OrderBy | null = null;

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((column: string, value: unknown) => {
      current?.filters.push([column, value]);
      return chain;
    });
    chain.neq = vi.fn(() => chain);
    chain.in = vi.fn((column: string, value: unknown) => {
      current?.filters.push([column, value]);
      return chain;
    });
    chain.limit = vi.fn(() => chain);
    // `.order()` phải sắp thật, không được nuốt lặng.
    //
    // Việc đánh số lại chuỗi CHỈ đúng khi nó đọc theo thời gian. Một bản giả
    // trả về đúng thứ tự đã nạp vào bất kể sắp theo cột nào sẽ xanh y hệt cho
    // cả bản đọc theo `series_index` — tức là xanh cho cả bản đã hỏng.
    chain.order = vi.fn((column: string, options?: { ascending?: boolean }) => {
      orderBy = { column, ascending: options?.ascending !== false };
      return chain;
    });

    chain.update = vi.fn((payload: Record<string, unknown>) => {
      mode = "update";
      current = { table: name, kind: "update", payload, filters: [] };
      writes.push(current);
      return chain;
    });
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      mode = "insert";
      current = { table: name, kind: "insert", payload, filters: [] };
      writes.push(current);
      if (name === "events") inserted = true;
      return chain;
    });
    chain.delete = vi.fn(() => {
      mode = "delete";
      current = { table: name, kind: "delete", filters: [] };
      writes.push(current);
      return chain;
    });

    chain.maybeSingle = vi.fn(async () => {
      if (mode === "insert") return { data: { id: "new-session" }, error: null };
      if (mode !== "select") return { data: null, error: null };
      return { data: name === "events" ? options.anchor : null, error: null };
    });

    chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) => {
      if (mode !== "select") return Promise.resolve(resolve({ data: null, error: null }));
      const eventRows = inserted && options.siblingsAfterInsert ? options.siblingsAfterInsert : (options.siblings ?? []);
      const rows = name === "events" ? eventRows : (options.registrations ?? []);
      const data = orderBy ? sortRows(rows, orderBy) : rows;
      return Promise.resolve(resolve({ data, error: null }));
    };

    return chain;
  }

  return { from: vi.fn((name: string) => table(name)), writes };
}

function anchorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    season_id: SEASON,
    event_name: "Mentor Orientation",
    starts_at: ANCHOR_START,
    ends_at: "2026-09-20T04:30:00.000Z",
    location_name: "Phòng B1-502",
    location_address: "279 Nguyễn Tri Phương, P.5, Q.10",
    capacity_limit: 100,
    series_id: null,
    series_index: null,
    series_total: null,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "u1",
    email: "a@vam.org",
    full_name: "A",
    role: "admin",
    status: "active",
    auth_user_id: null
  } as never);
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scopeError: null } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
});

describe("chặn buổi trùng khít", () => {
  it("trùng giờ với chính buổi đang mở thì bị chặn, và KHÔNG ghi gì cả", async () => {
    const fake = makeClient({ anchor: anchorRow(), siblings: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    // Đúng 08:00 ngày 20/09 — chính là giờ của buổi đang mở.
    const result = await addSessionToSeries({
      eventId: EVENT,
      starts_at: "2026-09-20T08:00"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("cùng địa điểm");
    // Chặn mà vẫn ghi thì tệ hơn không chặn: chuỗi bị nâng tổng cho một buổi
    // không bao giờ được tạo.
    expect(fake.writes).toEqual([]);
  });

  it("trùng giờ với một buổi khác trong chuỗi thì bị chặn", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2 }),
      siblings: [
        { id: EVENT, starts_at: ANCHOR_START, location_name: "Phòng B1-502", location_address: "279 Nguyễn Tri Phương, P.5, Q.10" },
        { id: OTHER, starts_at: "2026-09-27T01:00:00.000Z", location_name: "Phòng B1-502", location_address: "279 Nguyễn Tri Phương, P.5, Q.10" }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    // 08:00 ngày 27/09 — đúng buổi 2 đã có.
    const result = await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    expect(result.ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it("khoảng cách vài phút thôi thì vẫn cho thêm — chỉ chặn khi TRÙNG KHÍT", async () => {
    const fake = makeClient({ anchor: anchorRow(), siblings: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-20T08:30" });

    expect(result.ok).toBe(true);
    expect(fake.writes.some((write) => write.kind === "insert")).toBe(true);
  });

  it("cùng giờ nhưng khác phòng thì cho thêm — hai lớp song song là chuyện có thật", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2, location_name: "Phòng B1-502" }),
      siblings: [
        { id: EVENT, starts_at: "2026-09-27T09:00:00.000Z", location_name: "Phòng B1-502", location_address: "279 Nguyễn Tri Phương, P.5, Q.10" },
        // Cùng giờ với buổi sắp thêm, nhưng ở phòng khác.
        { id: OTHER, starts_at: "2026-09-27T01:00:00.000Z", location_name: "Phòng B1-503", location_address: "279 Nguyễn Tri Phương, P.5, Q.10" }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    expect(result.ok).toBe(true);
  });

  it("khác nhau mỗi khoảng trắng và chữ hoa thì vẫn tính là một chỗ", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2 }),
      siblings: [
        {
          id: OTHER,
          starts_at: "2026-09-27T01:00:00.000Z",
          location_name: "  phòng   b1-502 ",
          location_address: "279 NGUYỄN TRI PHƯƠNG, P.5, Q.10"
        }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    expect(result.ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });
});

describe("thêm một buổi diễn ra sớm hơn các buổi đã có", () => {
  const VENUE = { location_name: "Phòng B1-502", location_address: "279 Nguyễn Tri Phương, P.5, Q.10" };

  it("buổi mới thành Buổi 1, các buổi sau lùi số — và lời báo nói đúng số của buổi vừa thêm", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2, starts_at: "2026-09-27T01:00:00.000Z" }),
      siblings: [
        { id: EVENT, starts_at: "2026-09-27T01:00:00.000Z", series_index: 1, series_total: 2, ...VENUE },
        { id: OTHER, starts_at: "2026-10-04T01:00:00.000Z", series_index: 2, series_total: 2, ...VENUE }
      ],
      // Buổi mới được chèn với số cuối (3/3), đúng như lệnh chèn đang làm.
      siblingsAfterInsert: [
        { id: EVENT, starts_at: "2026-09-27T01:00:00.000Z", series_index: 1, series_total: 3 },
        { id: OTHER, starts_at: "2026-10-04T01:00:00.000Z", series_index: 2, series_total: 3 },
        { id: "new-session", starts_at: "2026-09-20T01:00:00.000Z", series_index: 3, series_total: 3 }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    // Chốt thêm một buổi 20/09 — sớm hơn cả hai buổi đang có.
    const result = await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-20T08:00" });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Đã thêm buổi 1.");

    const insertAt = fake.writes.findIndex((write) => write.kind === "insert");
    const renumbers = fake.writes
      .slice(insertAt + 1)
      .filter((write) => write.kind === "update" && "series_index" in (write.payload ?? {}));
    expect(renumbers.map((write) => [write.filters.find(([column]) => column === "id")?.[1], write.payload])).toEqual([
      ["new-session", { series_index: 1, series_total: 3 }],
      [EVENT, { series_index: 2, series_total: 3 }],
      [OTHER, { series_index: 3, series_total: 3 }]
    ]);
  });

  it("buổi mới diễn ra sau cùng thì giữ số cuối, và không ghi thêm số thứ tự nào", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2, starts_at: "2026-09-20T01:00:00.000Z" }),
      siblings: [
        { id: EVENT, starts_at: "2026-09-20T01:00:00.000Z", series_index: 1, series_total: 2, ...VENUE },
        { id: OTHER, starts_at: "2026-09-27T01:00:00.000Z", series_index: 2, series_total: 2, ...VENUE }
      ],
      siblingsAfterInsert: [
        { id: EVENT, starts_at: "2026-09-20T01:00:00.000Z", series_index: 1, series_total: 3 },
        { id: OTHER, starts_at: "2026-09-27T01:00:00.000Z", series_index: 2, series_total: 3 },
        { id: "new-session", starts_at: "2026-10-04T01:00:00.000Z", series_index: 3, series_total: 3 }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await addSessionToSeries({ eventId: EVENT, starts_at: "2026-10-04T08:00" });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Đã thêm buổi 3.");
    const insertAt = fake.writes.findIndex((write) => write.kind === "insert");
    expect(fake.writes.slice(insertAt + 1).filter((write) => "series_index" in (write.payload ?? {}))).toEqual([]);
  });
});

describe("xoá buổi thêm nhầm", () => {
  it("buổi đã có người đăng ký thì KHÔNG xoá", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 3, series_total: 3 }),
      registrations: [{ id: "r1" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await removeSessionFromSeries({ eventId: EVENT });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Huỷ sự kiện");
    // Điểm cốt lõi: dòng vẫn còn nguyên. Những tấm vé đã gửi đi vẫn trỏ vào nó.
    expect(fake.writes.some((write) => write.kind === "delete")).toBe(false);
  });

  it("buổi chưa ai đăng ký thì xoá, và đánh số lại các buổi còn lại", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 3, series_total: 3 }),
      registrations: [],
      // Hai buổi còn lại sau khi xoá.
      siblings: [
        { id: "b1", starts_at: ANCHOR_START },
        { id: "b2", starts_at: "2026-09-27T01:00:00.000Z" }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await removeSessionFromSeries({ eventId: EVENT });

    expect(result.ok).toBe(true);
    expect(fake.writes.some((write) => write.kind === "delete")).toBe(true);

    const renumbers = fake.writes.filter(
      (write) => write.table === "events" && write.kind === "update"
    );
    expect(renumbers).toHaveLength(2);
    // Số thứ tự chạy liền 1, 2 — không để lại "Buổi 1, Buổi 3" cho người đọc
    // tưởng mình bỏ lỡ mất một buổi.
    expect(renumbers[0].payload).toEqual({ series_index: 1, series_total: 2 });
    expect(renumbers[1].payload).toEqual({ series_index: 2, series_total: 2 });
    expect(renumbers[0].filters).toContainEqual(["id", "b1"]);
    expect(renumbers[1].filters).toContainEqual(["id", "b2"]);
  });

  it("mỗi lệnh ghi số thứ tự đều kèm luôn tổng, không bao giờ ghi một mình", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 2, series_total: 3 }),
      registrations: [],
      siblings: [
        { id: "b1", starts_at: ANCHOR_START },
        { id: "b2", starts_at: "2026-09-27T01:00:00.000Z" }
      ]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await removeSessionFromSeries({ eventId: EVENT });

    // `events_series_shape_check` xét theo TỪNG DÒNG. Các dòng còn lại đã mang
    // sẵn `series_id`, nên ghi index kèm total là đủ nhất quán — nhưng ghi
    // index một mình thì có lúc `series_index > series_total`.
    for (const write of fake.writes) {
      if (write.table !== "events" || write.kind !== "update") continue;
      const payload = write.payload ?? {};
      if ("series_index" in payload && payload.series_index !== null) {
        expect(payload, JSON.stringify(payload)).toHaveProperty("series_total");
        expect(Number(payload.series_index)).toBeLessThanOrEqual(Number(payload.series_total));
      }
    }
  });

  it("còn đúng một buổi thì nó rời chuỗi hẳn — ba cột về null trong CÙNG một lệnh", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 2, series_total: 2 }),
      registrations: [],
      siblings: [{ id: "b1", starts_at: ANCHOR_START }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await removeSessionFromSeries({ eventId: EVENT });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("buổi đơn lẻ");

    const update = fake.writes.find(
      (write) => write.table === "events" && write.kind === "update"
    );
    // Một "chuỗi một buổi" là một sự kiện đơn lẻ đang đeo nhãn sai.
    expect(update?.payload).toEqual({
      series_id: null,
      series_index: null,
      series_total: null
    });
    for (const column of SERIES_COLUMNS) {
      expect(update?.payload, column).toHaveProperty(column);
    }
  });

  it("sự kiện đơn lẻ không có gì để xoá khỏi chuỗi", async () => {
    const fake = makeClient({ anchor: anchorRow(), registrations: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await removeSessionFromSeries({ eventId: EVENT });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("không thuộc chuỗi");
    expect(fake.writes.some((write) => write.kind === "delete")).toBe(false);
  });

  it("ID không hợp lệ thì dừng trước khi chạm database", async () => {
    const fake = makeClient({ anchor: anchorRow() });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await removeSessionFromSeries({ eventId: "không-phải-uuid" });

    expect(result.ok).toBe(false);
    // Không chỉ "không ghi gì" — mà còn KHÔNG HỎI GÌ. Một ID rác không đáng
    // một vòng đi về database.
    expect(fake.from).not.toHaveBeenCalled();
  });
});

/**
 * Đổi giờ một buổi riêng lẻ.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO CÓ ĐƯỜNG NÀY
 * ---------------------------------------------------------------------------
 * Mỗi buổi là một dòng sự kiện riêng, nên về lý thì mở trang của buổi đó ra là
 * sửa được. Nhưng trên màn hình chuỗi không có chỗ nào nói ra điều đó: người
 * vận hành nhìn thấy đúng một ô ngày giờ — ô "thêm buổi mới" — và kết luận
 * rằng chỉ sửa được buổi sau.
 *
 * Ô sửa giờ nằm ngay trong danh sách các buổi, nên nó cần một đường ghi hẹp
 * đúng bằng thứ nó sửa: `updateEvent` nhận cả biểu mẫu và ghi lại gần như mọi
 * cột, mà ở đây phần còn lại của biểu mẫu không có mặt.
 */
describe("đổi giờ một buổi", () => {
  it("chỉ ghi giờ, không đụng cột nào khác", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2 }),
      siblings: [
        { id: EVENT, starts_at: ANCHOR_START },
        { id: OTHER, starts_at: "2026-09-27T01:00:00.000Z" }
      ],
      registrations: []
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await updateSessionTime({
      eventId: EVENT,
      starts_at: "2026-09-20T07:00",
      ends_at: "2026-09-20T13:00"
    });

    expect(result.ok).toBe(true);

    const timeWrite = fake.writes.find(
      (write) => write.kind === "update" && "starts_at" in (write.payload ?? {})
    );
    // Đúng hai cột. Gửi kèm bất cứ cột nào khác là mở đường cho một ô không ai
    // chạm tới ghi đè lên giá trị đang đúng.
    expect(Object.keys(timeWrite?.payload ?? {}).sort()).toEqual(["ends_at", "starts_at"]);
    expect(timeWrite?.filters).toContainEqual(["id", EVENT]);
  });

  it("giờ được hiểu theo giờ Việt Nam", async () => {
    const fake = makeClient({ anchor: anchorRow(), registrations: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await updateSessionTime({
      eventId: EVENT,
      starts_at: "2026-09-20T07:00",
      ends_at: "2026-09-20T13:00"
    });

    const timeWrite = fake.writes.find(
      (write) => write.kind === "update" && "starts_at" in (write.payload ?? {})
    );
    // 07:00 giờ Việt Nam là 00:00Z; 13:00 là 06:00Z.
    expect(timeWrite?.payload?.starts_at).toBe("2026-09-20T00:00:00.000Z");
    expect(timeWrite?.payload?.ends_at).toBe("2026-09-20T06:00:00.000Z");
  });

  it("giờ kết thúc trước giờ bắt đầu thì không ghi gì", async () => {
    const fake = makeClient({ anchor: anchorRow(), registrations: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await updateSessionTime({
      eventId: EVENT,
      starts_at: "2026-09-20T13:00",
      ends_at: "2026-09-20T07:00"
    });

    expect(result.ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it("dời vào đúng giờ và đúng chỗ của một buổi khác thì bị chặn", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2 }),
      siblings: [
        {
          id: EVENT,
          starts_at: ANCHOR_START,
          location_name: "Phòng B1-502",
          location_address: "279 Nguyễn Tri Phương, P.5, Q.10"
        },
        {
          id: OTHER,
          starts_at: "2026-09-27T01:00:00.000Z",
          location_name: "Phòng B1-502",
          location_address: "279 Nguyễn Tri Phương, P.5, Q.10"
        }
      ],
      registrations: []
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    // Một cánh cửa khoá không giúp gì khi cửa bên cạnh vẫn mở: chặn lúc thêm
    // buổi mà không chặn lúc đổi giờ thì vẫn ra được hai buổi trùng khít.
    const result = await updateSessionTime({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("cùng địa điểm");
    expect(fake.writes).toEqual([]);
  });

  it("giữ nguyên giờ cũ của CHÍNH buổi đó thì không tính là trùng", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2 }),
      siblings: [
        {
          id: EVENT,
          starts_at: ANCHOR_START,
          location_name: "Phòng B1-502",
          location_address: "279 Nguyễn Tri Phương, P.5, Q.10"
        },
        {
          id: OTHER,
          starts_at: "2026-09-27T01:00:00.000Z",
          location_name: "Phòng B1-502",
          location_address: "279 Nguyễn Tri Phương, P.5, Q.10"
        }
      ],
      registrations: []
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    // Sửa mỗi giờ kết thúc, giữ nguyên giờ bắt đầu. Buổi này trùng với chính
    // nó — một phép so sánh cẩu thả sẽ chặn người ta sửa buổi của họ.
    const result = await updateSessionTime({
      eventId: EVENT,
      starts_at: "2026-09-20T08:00",
      ends_at: "2026-09-20T12:00"
    });

    expect(result.ok).toBe(true);
  });

  it("đổi giờ xong thì cả chuỗi được đánh số lại theo thời gian", async () => {
    const fake = makeClient({
      anchor: anchorRow({ series_id: SERIES, series_index: 1, series_total: 2 }),
      // Cố tình nạp vào SAI thứ tự thời gian, và cho buổi được dời mang
      // `series_index` nhỏ hơn. Nếu phép đánh số lại đọc theo `series_index`
      // thay vì theo thời gian thì nó giữ nguyên thứ tự sai này.
      siblings: [
        { id: EVENT, series_index: 1, starts_at: "2026-10-04T01:00:00.000Z" },
        { id: "b-sau", series_index: 2, starts_at: "2026-09-27T01:00:00.000Z" }
      ],
      registrations: []
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    // Dời buổi 1 sang tháng 10 thì nó thành buổi cuối. Không đánh số lại thì
    // danh sách hiện "Buổi 1" nằm sau "Buổi 2".
    await updateSessionTime({ eventId: EVENT, starts_at: "2026-10-04T08:00" });

    const renumbers = fake.writes.filter((write) => "series_index" in (write.payload ?? {}));
    expect(renumbers).toHaveLength(2);
    expect(renumbers[0].payload).toEqual({ series_index: 1, series_total: 2 });
    expect(renumbers[0].filters).toContainEqual(["id", "b-sau"]);
    expect(renumbers[1].payload).toEqual({ series_index: 2, series_total: 2 });
    expect(renumbers[1].filters).toContainEqual(["id", EVENT]);
  });

  it("sự kiện đơn lẻ vẫn đổi được giờ, và không đánh số chuỗi nào cả", async () => {
    const fake = makeClient({ anchor: anchorRow(), registrations: [] });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await updateSessionTime({ eventId: EVENT, starts_at: "2026-09-20T09:00" });

    expect(result.ok).toBe(true);
    expect(fake.writes.some((write) => "series_index" in (write.payload ?? {}))).toBe(false);
  });

  it("buổi đã có người đăng ký thì vẫn đổi được, nhưng phải nói ra", async () => {
    const fake = makeClient({
      anchor: anchorRow(),
      registrations: [{ id: "r1" }, { id: "r2" }, { id: "r3" }]
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await updateSessionTime({ eventId: EVENT, starts_at: "2026-09-20T09:00" });

    // Dời lịch là chuyện có thật, nên không chặn. Nhưng ba người đang giữ thư
    // xác nhận ghi giờ cũ, và hệ thống không tự báo cho họ — chỗ duy nhất
    // chuyện này được nói ra là ngay đây.
    expect(result.ok).toBe(true);
    expect(result.message).toContain("3 người");
  });

  it("ID không hợp lệ thì dừng trước khi chạm database", async () => {
    const fake = makeClient({ anchor: anchorRow() });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    const result = await updateSessionTime({
      eventId: "không-phải-uuid",
      starts_at: "2026-09-20T09:00"
    });

    expect(result.ok).toBe(false);
    expect(fake.from).not.toHaveBeenCalled();
  });
});
