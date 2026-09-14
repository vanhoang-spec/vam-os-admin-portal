/**
 * Hàm ghi sự kiện lưu các lần quét mã QR theo đường ghi hẹp.
 *
 * Đọc CHÍNH LỆNH GHI mà `createEvent` / `updateEvent` phát ra. Hai cách hỏng
 * không ai thấy:
 *   - một lượt sửa không có phần thiết lập ghi đè các lần quét BTC đã đặt;
 *   - một danh sách sai vẫn được lưu một nửa.
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
import { createEvent, updateEvent } from "@/lib/events";

const EVENT_ID = "00000000-0000-4000-8000-0000000000a1";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const ACTOR = "00000000-0000-4000-8000-0000000000dd";

/** Sự kiện đang có trên database, BTC đã đặt hai lần quét. */
const BEFORE = {
  id: EVENT_ID,
  season_id: SEASON,
  event_name: "Ngày hội Mentor",
  event_type: "training",
  starts_at: "2026-10-04T01:00:00+00:00",
  event_format: "offline",
  status: "active",
  legacy_event_temp_id: null,
  series_id: null,
  series_index: null,
  series_total: null,
  checkin_steps: ["entrance", "checkout"]
};

/** Những ô form sự kiện luôn gửi. */
const FORM = {
  event_name: "Ngày hội Mentor",
  event_type: "training",
  season_code: "UEHM-S12",
  starts_at: "2026-10-04T08:00",
  ends_at: "2026-10-04T11:30",
  event_format: "offline",
  location_name: "Phòng B1-502",
  location_address: "279 Nguyễn Tri Phương, P.5, Q.10",
  online_join_url: ""
};

type Write = { table: string; op: "update" | "insert"; payload: Record<string, unknown> };

function use(before: Record<string, unknown>) {
  const writes: Write[] = [];

  const from = (table: string) => {
    let write: Write | null = null;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
      update: (payload: Record<string, unknown>) => {
        write = { table, op: "update", payload };
        writes.push(write);
        return chain;
      },
      insert: (payload: Record<string, unknown>) => {
        write = { table, op: "insert", payload };
        writes.push(write);
        return chain;
      },
      maybeSingle: async () => {
        if (write && table === "events") return { data: { ...before, ...write.payload }, error: null };
        if (table === "seasons") return { data: { id: SEASON, code: "UEHM-S12" }, error: null };
        return { data: table === "events" ? before : null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(write ? { data: null, error: null } : { data: [], error: null }).then(resolve, reject)
    };
    return chain;
  };

  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({
    from,
    rpc: vi.fn(async () => ({ data: null, error: null }))
  } as never);

  return {
    eventInserts: () => writes.filter((write) => write.table === "events" && write.op === "insert"),
    eventUpdates: () => writes.filter((write) => write.table === "events" && write.op === "update")
  };
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

describe("tạo sự kiện", () => {
  it("không gửi phần thiết lập: một lần Check in, đúng mặc định của cột", async () => {
    const fake = use(BEFORE);

    const result = await createEvent({ ...FORM } as never);

    expect(result.ok).toBe(true);
    expect(fake.eventInserts()).toHaveLength(1);
    expect(fake.eventInserts()[0].payload.checkin_steps).toEqual(["entrance"]);
  });

  it("lưu đúng các lần quét BTC chọn — sự kiện chỉ cần Check out", async () => {
    const fake = use(BEFORE);

    await createEvent({ ...FORM, checkin_steps: ["checkout"] } as never);

    expect(fake.eventInserts()[0].payload.checkin_steps).toEqual(["checkout"]);
  });

  it("một ô sai: không tạo sự kiện nào, nói đúng ô nào", async () => {
    const fake = use(BEFORE);

    const result = await createEvent({ ...FORM, checkin_steps: ["entrance", "booth_program"] } as never);

    expect(result).toMatchObject({ ok: false, message: "Quét lần 2 chưa chọn mục hợp lệ." });
    expect(fake.eventInserts()).toEqual([]);
  });
});

describe("sửa sự kiện", () => {
  it("không gửi phần thiết lập: lệnh lưu không chạm vào các lần quét đang có", async () => {
    const fake = use(BEFORE);

    const result = await updateEvent({ id: EVENT_ID, ...FORM } as never);

    expect(result.ok).toBe(true);
    const save = fake.eventUpdates().find((write) => "starts_at" in write.payload);
    expect(save).toBeTruthy();
    expect(save?.payload).not.toHaveProperty("checkin_steps");
  });

  it("gửi danh sách mới: lưu đúng thứ tự", async () => {
    const fake = use(BEFORE);

    await updateEvent({ id: EVENT_ID, ...FORM, checkin_steps: ["entrance", "talkshow", "checkout"] } as never);

    const save = fake.eventUpdates().find((write) => "starts_at" in write.payload);
    expect(save?.payload.checkin_steps).toEqual(["entrance", "talkshow", "checkout"]);
  });

  it.each([
    [[], "Cần ít nhất một lần quét mã QR."],
    [new Array(21).fill("talkshow"), "Tối đa 20 lần quét mã QR cho một sự kiện."],
    [["entrance", "Check out"], "Quét lần 2 chưa chọn mục hợp lệ."]
  ])("danh sách %j: từ chối, không lưu gì của lượt này", async (steps, message) => {
    const fake = use(BEFORE);

    const result = await updateEvent({ id: EVENT_ID, ...FORM, checkin_steps: steps } as never);

    expect(result).toMatchObject({ ok: false, message });
    expect(fake.eventUpdates()).toEqual([]);
  });
});
