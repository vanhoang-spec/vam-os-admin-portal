/**
 * Thêm buổi vào chuỗi — không lệnh nào được ghi một PHẦN của bộ ba.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * Bấm "Thêm buổi" trên một sự kiện đơn lẻ và nhận lại "Không thể thực hiện tác
 * vụ."
 *
 * `events_series_shape_check` bắt `series_id`, `series_index`, `series_total`
 * đi cùng nhau hoặc cùng vắng. Bản đầu nâng `series_total` lên 2 TRƯỚC, trong
 * khi hai cột kia vẫn null — vi phạm ngay chính ràng buộc đã viết ra để giữ
 * cho không có buổi nào hiện "buổi 3/?".
 *
 * Ràng buộc làm đúng việc của nó. Thứ sai là thứ tự ghi.
 *
 * Ca test dưới đây không cần database: nó đọc CHÍNH CÁC LỆNH GHI mà hàm phát
 * ra, và khẳng định không lệnh nào chạm tới một phần của bộ ba.
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
import { addSessionToSeries } from "@/lib/events";

const EVENT = "00000000-0000-4000-8000-0000000000aa";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const SERIES = "00000000-0000-4000-8000-0000000000cc";

const SERIES_COLUMNS = ["series_id", "series_index", "series_total"] as const;

/** Mọi lệnh update/insert mà hàm phát ra, theo thứ tự. */
type Write = { kind: "update" | "insert"; payload: Record<string, unknown> };

function client(anchor: Record<string, unknown>, siblings: Array<{ id: string }>) {
  const writes: Write[] = [];

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    let mode: "select" | "update" | "insert" = "select";

    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.in = vi.fn(() => chain);
    // Thêm buổi xong thì đánh số lại cả chuỗi theo thời gian, và lệnh đọc đó có sắp xếp.
    chain.order = vi.fn(() => chain);
    chain.update = vi.fn((payload: Record<string, unknown>) => {
      mode = "update";
      writes.push({ kind: "update", payload });
      return chain;
    });
    chain.insert = vi.fn((payload: Record<string, unknown>) => {
      mode = "insert";
      writes.push({ kind: "insert", payload });
      return chain;
    });
    chain.maybeSingle = vi.fn(async () => {
      if (mode === "insert") return { data: { id: "new-session" }, error: null };
      if (mode === "update") return { data: null, error: null };
      return { data: name === "events" ? anchor : null, error: null };
    });
    // `update(...).in(...)` được await thẳng, không qua maybeSingle.
    chain.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: mode === "select" ? siblings : null, error: null }));

    return chain;
  }

  return { from: vi.fn((name: string) => table(name)), writes };
}

function anchorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT,
    season_id: SEASON,
    event_name: "Mentor Orientation",
    starts_at: "2026-09-20T01:00:00.000Z",
    ends_at: "2026-09-20T04:30:00.000Z",
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

describe("bộ ba cột chuỗi luôn đi cùng nhau", () => {
  it("sự kiện đơn lẻ: KHÔNG lệnh nào ghi một phần của bộ ba", () => {
    // Đây là ca tái hiện lỗi. Bản cũ phát ra `{ series_total: 2 }` một mình.
    const fake = client(anchorRow(), []);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    return addSessionToSeries({
      eventId: EVENT,
      starts_at: "2026-09-27T08:00",
      ends_at: "2026-09-27T11:30"
    }).then(() => {
      expect(fake.writes.length).toBeGreaterThan(0);
      for (const write of fake.writes) {
        const touched = SERIES_COLUMNS.filter((column) => column in write.payload);
        if (touched.length === 0) continue;
        expect(touched.sort(), JSON.stringify(write.payload)).toEqual([...SERIES_COLUMNS].sort());
      }
    });
  });

  it("sự kiện đơn lẻ nhận số thứ tự 1 và tổng 2, trong cùng một lệnh", async () => {
    const fake = client(anchorRow(), []);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    const attach = fake.writes.find(
      (write) => write.kind === "update" && "series_index" in write.payload
    );
    expect(attach).toBeTruthy();
    expect(attach?.payload.series_index).toBe(1);
    expect(attach?.payload.series_total).toBe(2);
    expect(attach?.payload.series_id).toBeTruthy();
  });

  it("buổi mới nhận số thứ tự cuối và cùng tổng", async () => {
    const fake = client(anchorRow(), []);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    const insert = fake.writes.find((write) => write.kind === "insert");
    expect(insert?.payload.series_index).toBe(2);
    expect(insert?.payload.series_total).toBe(2);
    // `series_index <= series_total` — chính ràng buộc đã bị phá.
    expect(Number(insert?.payload.series_index)).toBeLessThanOrEqual(
      Number(insert?.payload.series_total)
    );
  });

  it("chuỗi đã có: nâng riêng tổng là hợp lệ, vì hai cột kia đã có sẵn", async () => {
    const fake = client(anchorRow({ series_id: SERIES, series_index: 1, series_total: 2 }), [
      { id: EVENT },
      { id: "b2" }
    ]);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await addSessionToSeries({ eventId: EVENT, starts_at: "2026-10-04T08:00" });

    const bump = fake.writes.find(
      (write) => write.kind === "update" && "series_total" in write.payload
    );
    expect(bump?.payload).toEqual({ series_total: 3 });

    const insert = fake.writes.find((write) => write.kind === "insert");
    expect(insert?.payload.series_index).toBe(3);
    expect(insert?.payload.series_id).toBe(SERIES);
  });
});

describe("buổi mới chép cấu hình, bỏ thứ thuộc riêng một dòng", () => {
  it("giữ sức chứa và tên, bỏ id và mã tham chiếu", async () => {
    const fake = client(anchorRow({ legacy_event_temp_id: "UEHM-S12-MO1" }), []);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    const insert = fake.writes.find((write) => write.kind === "insert");
    expect(insert?.payload.capacity_limit).toBe(100);
    expect(insert?.payload.event_name).toBe("Mentor Orientation");
    expect(insert?.payload).not.toHaveProperty("id");
    // Mã tham chiếu là mã của MỘT sự kiện; hai dòng cùng mang một mã là hai
    // dòng không phân biệt được.
    expect(insert?.payload.legacy_event_temp_id).toBeUndefined();
  });

  it("giờ buổi mới là giờ được gõ, hiểu theo giờ Việt Nam", async () => {
    const fake = client(anchorRow(), []);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake as never);

    await addSessionToSeries({ eventId: EVENT, starts_at: "2026-09-27T08:00" });

    const insert = fake.writes.find((write) => write.kind === "insert");
    expect(insert?.payload.starts_at).toBe("2026-09-27T01:00:00.000Z");
  });
});
