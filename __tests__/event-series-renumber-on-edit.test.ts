/**
 * Sửa một buổi bằng form "Sửa sự kiện" thì số thứ tự buổi của cả chuỗi phải chạy
 * lại theo thời gian.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * 14/09/2026, chuỗi Mentor Orientation: buổi 20/09 là "Buổi 1". Ban tổ chức dời
 * nó sang 04/10 bằng form "Sửa sự kiện". Form, link đăng ký và file xuất vẫn gọi
 * 04/10 là "Buổi 1" và 27/09 là "Buổi 2" — hai buổi có nội dung khác nhau, nên
 * người đăng ký đọc số là chọn nhầm buổi.
 *
 * Ô đổi giờ trong danh sách buổi vốn đã đánh số lại; form "Sửa sự kiện" thì không.
 *
 * Các ca dưới đây đọc CHÍNH CÁC LỆNH GHI mà `updateEvent` phát ra.
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

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canAccessSeason, canOperateAnyScope, canOperateSeason, getAdminScopeContext, getAllowedSeasonIds } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { updateEvent } from "@/lib/events";

const SESSION_1 = "00000000-0000-4000-8000-0000000000a1";
const SESSION_2 = "00000000-0000-4000-8000-0000000000a2";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const SERIES = "00000000-0000-4000-8000-0000000000cc";
const ACTOR = "00000000-0000-4000-8000-0000000000dd";

/** Buổi 1 trước khi dời: 20/09/2026 08:00 giờ Việt Nam. */
const BEFORE_MOVE = {
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
  series_total: 2
};

/** Form "Sửa sự kiện" dời buổi sang 04/10/2026 08:00. */
const MOVE_TO_OCT_4 = {
  id: SESSION_1,
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

/** Cả chuỗi như database trả về SAU lệnh lưu — đúng hai dòng đang có trên production. */
const SERIES_AFTER_MOVE = [
  { id: SESSION_1, starts_at: "2026-10-04T01:00:00+00:00", series_index: 1, series_total: 2 },
  { id: SESSION_2, starts_at: "2026-09-27T01:00:00+00:00", series_index: 2, series_total: 2 }
];

type Write = { table: string; op: "update" | "insert"; payload: Record<string, unknown>; filters: Array<[string, unknown]> };
type SeriesQuery = { columns: string; filters: Array<[string, unknown]> };

function makeClient(opts: {
  before: Record<string, unknown>;
  seriesRows?: Array<Record<string, unknown>>;
  seriesError?: boolean;
  updateError?: { code: string; message: string } | null;
}) {
  const writes: Write[] = [];
  const seriesQueries: SeriesQuery[] = [];

  const from = (table: string) => {
    let write: Write | null = null;
    const query: SeriesQuery = { columns: "", filters: [] };
    const chain: any = {
      select: (columns = "*") => {
        if (!write) query.columns = columns;
        return chain;
      },
      eq: (column: string, value: unknown) => {
        (write ? write.filters : query.filters).push([column, value]);
        return chain;
      },
      neq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      update: (payload: Record<string, unknown>) => {
        write = { table, op: "update", payload, filters: [] };
        writes.push(write);
        return chain;
      },
      insert: (payload: Record<string, unknown>) => {
        write = { table, op: "insert", payload, filters: [] };
        writes.push(write);
        return chain;
      },
      maybeSingle: async () => {
        if (write && table === "events") {
          return opts.updateError ? { data: null, error: opts.updateError } : { data: { ...opts.before, ...write.payload }, error: null };
        }
        if (table === "seasons") return { data: { id: SEASON, code: "UEHM-S12" }, error: null };
        return { data: opts.before, error: null };
      },
      // Lệnh được await thẳng: đọc cả chuỗi, hoặc một lệnh ghi không cần kết quả.
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        if (write) return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        if (table === "events" && query.filters.some(([column]) => column === "series_id")) {
          seriesQueries.push(query);
          const result = opts.seriesError ? { data: null, error: { message: "đọc chuỗi hỏng" } } : { data: opts.seriesRows ?? [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve, reject);
      }
    };
    return chain;
  };

  const seriesWrites = () =>
    writes.filter((write) => write.table === "events" && write.op === "update" && "series_index" in write.payload);
  const idOf = (write: Write) => write.filters.find(([column]) => column === "id")?.[1];

  return { client: { from, rpc: vi.fn(async () => ({ data: null, error: null })) }, writes, seriesWrites, seriesQueries, idOf };
}

function use(opts: Parameters<typeof makeClient>[0]) {
  const fake = makeClient(opts);
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

describe("đúng ca 14/09: dời Buổi 1 sang sau Buổi 2 bằng form Sửa sự kiện", () => {
  it("27/09 thành Buổi 1, 04/10 thành Buổi 2 — và lời báo nói rõ buổi đang sửa giờ là buổi mấy", async () => {
    const fake = use({ before: BEFORE_MOVE, seriesRows: SERIES_AFTER_MOVE });

    const result = await updateEvent(MOVE_TO_OCT_4 as never);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("buổi này giờ là Buổi 2/2");
    expect((result.data as Record<string, unknown>).series_index).toBe(2);

    // Đọc đúng chuỗi của buổi đang sửa.
    expect(fake.seriesQueries).toHaveLength(1);
    expect(fake.seriesQueries[0].filters).toContainEqual(["series_id", SERIES]);

    expect(fake.seriesWrites().map((write) => [fake.idOf(write), write.payload])).toEqual([
      [SESSION_2, { series_index: 1, series_total: 2 }],
      [SESSION_1, { series_index: 2, series_total: 2 }]
    ]);
  });

  it("lệnh lưu của form không tự ghi số thứ tự — số chỉ đến từ bước đánh số lại", async () => {
    const fake = use({ before: BEFORE_MOVE, seriesRows: SERIES_AFTER_MOVE });

    await updateEvent(MOVE_TO_OCT_4 as never);

    const formSave = fake.writes.find((write) => write.table === "events" && write.op === "update" && "starts_at" in write.payload);
    expect(formSave).toBeTruthy();
    for (const column of ["series_id", "series_index", "series_total"]) {
      expect(formSave?.payload, column).not.toHaveProperty(column);
    }
    // Lưu trước, đánh số sau: đọc chuỗi trước lệnh lưu thì thấy giờ CŨ.
    const saveAt = fake.writes.indexOf(formSave!);
    const firstRenumberAt = fake.writes.indexOf(fake.seriesWrites()[0]);
    expect(firstRenumberAt).toBeGreaterThan(saveAt);
  });
});

describe("tự sửa chuỗi đã lệch từ trước", () => {
  it("lưu lại mà KHÔNG đổi ngày giờ vẫn sắp lại chuỗi — đúng dữ liệu đang có trên production", async () => {
    const fake = use({
      before: { ...BEFORE_MOVE, starts_at: "2026-10-04T01:00:00+00:00" },
      seriesRows: SERIES_AFTER_MOVE
    });

    const result = await updateEvent(MOVE_TO_OCT_4 as never);

    expect(result.ok).toBe(true);
    expect(fake.seriesWrites()).toHaveLength(2);
    expect(result.message).toContain("Buổi 2/2");
  });
});

describe("những lần lưu không được đụng tới thứ tự", () => {
  it("chuỗi đã đúng thứ tự: không ghi số thứ tự nào, lời báo như thường", async () => {
    const fake = use({
      before: { ...BEFORE_MOVE, starts_at: "2026-09-27T01:00:00+00:00" },
      seriesRows: [
        { id: SESSION_1, starts_at: "2026-09-27T01:00:00+00:00", series_index: 1, series_total: 2 },
        { id: SESSION_2, starts_at: "2026-10-04T01:00:00+00:00", series_index: 2, series_total: 2 }
      ]
    });

    const result = await updateEvent({ ...MOVE_TO_OCT_4, starts_at: "2026-09-27T08:00", ends_at: "2026-09-27T11:30" } as never);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Đã cập nhật sự kiện.");
    expect(fake.seriesWrites()).toEqual([]);
  });

  it("sự kiện đơn lẻ: không đọc chuỗi nào, không ghi số thứ tự", async () => {
    const fake = use({ before: { ...BEFORE_MOVE, series_id: null, series_index: null, series_total: null }, seriesRows: SERIES_AFTER_MOVE });

    const result = await updateEvent(MOVE_TO_OCT_4 as never);

    expect(result.ok).toBe(true);
    expect(result.message).toBe("Đã cập nhật sự kiện.");
    expect(fake.seriesQueries).toEqual([]);
    expect(fake.seriesWrites()).toEqual([]);
  });

  it("lưu hỏng thì không sắp lại gì cả", async () => {
    const fake = use({
      before: BEFORE_MOVE,
      seriesRows: SERIES_AFTER_MOVE,
      updateError: { code: "XX000", message: "database down" }
    });

    const result = await updateEvent(MOVE_TO_OCT_4 as never);

    expect(result.ok).toBe(false);
    expect(fake.seriesQueries).toEqual([]);
    expect(fake.seriesWrites()).toEqual([]);
  });

  it("không đọc được chuỗi: vẫn báo đã lưu, nhưng nói rõ là chưa sắp lại được", async () => {
    const fake = use({ before: BEFORE_MOVE, seriesError: true });

    const result = await updateEvent(MOVE_TO_OCT_4 as never);

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Chưa sắp lại được thứ tự các buổi");
    expect(fake.seriesWrites()).toEqual([]);
  });
});
