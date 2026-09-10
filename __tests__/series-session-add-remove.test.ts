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
import { addSessionToSeries, removeSessionFromSeries } from "@/lib/events";

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
function makeClient(options: {
  anchor: Record<string, unknown> | null;
  siblings?: Array<Record<string, unknown>>;
  registrations?: Array<Record<string, unknown>>;
}) {
  const writes: Write[] = [];

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    let mode: "select" | "update" | "insert" | "delete" = "select";
    let current: Write | null = null;

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
    chain.order = vi.fn(() => chain);

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
      const data = name === "events" ? (options.siblings ?? []) : (options.registrations ?? []);
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
