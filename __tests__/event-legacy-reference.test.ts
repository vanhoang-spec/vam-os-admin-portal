/**
 * Mã tham chiếu sự kiện (`legacy_event_temp_id`): trùng thì nói rõ, không đổi thì
 * không đụng tới.
 *
 * ---------------------------------------------------------------------------
 * LỖI NÀY ĐÃ XẢY RA THẬT
 * ---------------------------------------------------------------------------
 * 13/09/2026, Mentee Orientation Mùa 12. Người vận hành thêm buổi 2, rồi sửa
 * địa điểm, giờ, sức chứa của buổi 2 và bấm lưu. Màn hình báo:
 *
 *   Không thể thực hiện tác vụ… (duplicate key value violates unique
 *   constraint "events_legacy_event_temp_id_key")
 *
 * Ba lần bấm, ba lần hỏng. Buổi 2 không có mã tham chiếu nào; trình duyệt đã
 * tự điền vào ô đó đúng mã mà chính người này gõ khi tạo buổi 1 hôm trước. Lời
 * báo không nói ô nào sai, và ô ấy lại nằm ngoài những gì họ vừa sửa.
 *
 * Cùng gốc, lỗi thứ hai: tạo chuỗi lặp chép mã cho MỌI buổi, nên buổi 2 trở đi
 * hỏng vì trùng mã.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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
import { createEvent, createEventSeries, updateEvent } from "@/lib/events";

const SESSION_1 = "00000000-0000-4000-8000-0000000000a1";
const SESSION_2 = "00000000-0000-4000-8000-0000000000a2";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const ACTOR = "00000000-0000-4000-8000-0000000000dd";
const CODE = "UEHM-S12-MENTEEORIENTATION";

const SESSION_2_ROW = {
  id: SESSION_2,
  season_id: SEASON,
  event_name: "Mentee Orientation Mùa 12",
  event_type: "training",
  starts_at: "2026-09-28T09:30:00+00:00",
  event_format: "online",
  status: "active",
  legacy_event_temp_id: null
};

/** Chủ thật của mã: buổi 1, 19/09/2026 17:00 giờ Việt Nam. */
const SESSION_1_OWNER = { id: SESSION_1, event_name: "Mentee Orientation Mùa 12", starts_at: "2026-09-19T10:00:00+00:00" };

const EDIT = {
  id: SESSION_2,
  event_name: "Mentee Orientation Mùa 12",
  event_type: "training",
  season_code: "UEHM-S12",
  starts_at: "2026-09-28T17:00",
  ends_at: "2026-09-28T20:30",
  event_format: "offline",
  location_name: "Phòng A.103 - UEH cơ sở A",
  location_address: "59C Nguyễn Đình Chiểu, Phường Xuân Hòa, TP. Hồ Chí Minh",
  online_join_url: ""
};

const CREATE = { ...EDIT, id: undefined, starts_at: "2026-10-05T17:00", ends_at: "2026-10-05T20:30" };

type Write = { table: string; op: "update" | "insert"; payload: Record<string, unknown> };

function makeClient(opts: {
  before?: Record<string, unknown>;
  owner?: Record<string, unknown> | null;
  lookupError?: boolean;
  writeError?: { code: string; message: string } | null;
} = {}) {
  const writes: Write[] = [];
  const lookups: Array<Array<[string, string, unknown]>> = [];
  const from = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let write: Write | null = null;
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => { filters.push(["eq", column, value]); return chain; },
      neq: (column: string, value: unknown) => { filters.push(["neq", column, value]); return chain; },
      limit: async () => {
        lookups.push([...filters]);
        if (opts.lookupError) return { data: null, error: { message: "lookup down" } };
        return { data: opts.owner ? [opts.owner] : [], error: null };
      },
      update: (payload: Record<string, unknown>) => { write = { table, op: "update", payload }; writes.push(write); return chain; },
      insert: (payload: Record<string, unknown>) => { write = { table, op: "insert", payload }; writes.push(write); return chain; },
      maybeSingle: async () => {
        if (write && table === "events") {
          return opts.writeError
            ? { data: null, error: opts.writeError }
            : { data: { id: `${SESSION_2}`, ...write.payload }, error: null };
        }
        if (table === "seasons") return { data: { id: SEASON, code: "UEHM-S12" }, error: null };
        return { data: opts.before ?? SESSION_2_ROW, error: null };
      }
    };
    return chain;
  };
  const eventWrites = () => writes.filter((row) => row.table === "events");
  return { client: { from, rpc: vi.fn(async () => ({ data: null, error: null })) }, eventWrites, lookups };
}

function use(opts: Parameters<typeof makeClient>[0] = {}) {
  const fake = makeClient(opts);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);
  return fake;
}

const DUPLICATE = { code: "23505", message: 'duplicate key value violates unique constraint "events_legacy_event_temp_id_key"' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "core_team", status: "active" } as never);
  vi.mocked(getAdminScopeContext).mockResolvedValue({
    adminUser: { id: ACTOR, role: "core_team", status: "active" } as never,
    authUserId: "auth", globalRole: "core_team", isSuperAdmin: false, programScopes: [], scopeError: null
  } as never);
  vi.mocked(canOperateAnyScope).mockReturnValue(true as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true as never);
  vi.mocked(getAllowedSeasonIds).mockResolvedValue([SEASON] as never);
  vi.mocked(canAccessSeason).mockReturnValue(true as never);
});

describe("1. sửa một buổi — đúng ca đã hỏng 13/09", () => {
  it("mã của buổi 1 lọt vào form buổi 2: từ chối bằng lời nói rõ mã nào, trùng với buổi nào — và KHÔNG ghi gì", async () => {
    const fake = use({ owner: SESSION_1_OWNER });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: CODE } as never);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(CODE);
    expect(result.message).toContain("Mentee Orientation Mùa 12");
    expect(result.message).toContain("19/09/2026");
    expect(result.message).toContain("Xoá trống ô “Mã tham chiếu”");
    expect(result.message).not.toContain("duplicate key");
    expect(fake.eventWrites()).toEqual([]);
    // Soi đúng người: tìm theo mã, và bỏ chính buổi đang sửa ra khỏi phép so.
    expect(fake.lookups[0]).toContainEqual(["eq", "legacy_event_temp_id", CODE]);
    expect(fake.lookups[0]).toContainEqual(["neq", "id", SESSION_2]);
  });

  it("mã không đổi: không kiểm, không ghi lại cột duy nhất — sửa ngày giờ không hỏng vì nó", async () => {
    const fake = use({ before: { ...SESSION_2_ROW, legacy_event_temp_id: "S2-CODE" }, owner: SESSION_1_OWNER });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: "S2-CODE" } as never);

    expect(result.ok).toBe(true);
    expect(fake.lookups).toEqual([]);
    const [write] = fake.eventWrites();
    expect(write.op).toBe("update");
    expect(Object.prototype.hasOwnProperty.call(write.payload, "legacy_event_temp_id")).toBe(false);
    // Những gì người vận hành thật sự sửa vẫn được ghi.
    expect(write.payload).toMatchObject({ event_format: "offline", location_name: "Phòng A.103 - UEH cơ sở A" });
  });

  it("vẫn để trống như cũ: không kiểm, không đụng tới cột", async () => {
    const fake = use({ owner: SESSION_1_OWNER });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: "" } as never);

    expect(result.ok).toBe(true);
    expect(fake.lookups).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(fake.eventWrites()[0].payload, "legacy_event_temp_id")).toBe(false);
  });

  it("xoá mã đang có: ghi null, không cần kiểm trùng", async () => {
    const fake = use({ before: { ...SESSION_2_ROW, legacy_event_temp_id: "OLD" } });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: "" } as never);

    expect(result.ok).toBe(true);
    expect(fake.lookups).toEqual([]);
    expect(fake.eventWrites()[0].payload.legacy_event_temp_id).toBeNull();
  });

  it("đặt mã mới chưa ai dùng: kiểm rồi ghi đúng mã đó", async () => {
    const fake = use({ owner: null });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: "UEHM-S12-MENTEEORIENTATION-2" } as never);

    expect(result.ok).toBe(true);
    expect(fake.lookups).toHaveLength(1);
    expect(fake.eventWrites()[0].payload.legacy_event_temp_id).toBe("UEHM-S12-MENTEEORIENTATION-2");
  });

  it("hai người lưu cùng lúc (23505 lúc ghi): vẫn là lời nói rõ, không phải câu của database", async () => {
    use({ owner: null, writeError: DUPLICATE });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: CODE } as never);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(`Mã tham chiếu “${CODE}”`);
    expect(result.message).not.toContain("duplicate key");
  });

  it("không đọc được phép kiểm: vẫn cho lệnh ghi đi — lỗi hạ tầng không thành lỗi của người dùng", async () => {
    const fake = use({ lookupError: true });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: "S2-NEW" } as never);

    expect(result.ok).toBe(true);
    expect(fake.eventWrites()[0].payload.legacy_event_temp_id).toBe("S2-NEW");
  });

  it("23505 của một ràng buộc KHÁC không bị dịch nhầm thành trùng mã", async () => {
    use({ writeError: { code: "23505", message: 'duplicate key value violates unique constraint "events_other_key"' } });

    const result = await updateEvent({ ...EDIT, legacy_event_temp_id: "" } as never);

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("Mã tham chiếu");
  });
});

describe("2. tạo sự kiện", () => {
  it("mã đã có: từ chối bằng lời nói rõ, không chèn dòng nào", async () => {
    const fake = use({ owner: SESSION_1_OWNER });

    const result = await createEvent({ ...CREATE, legacy_event_temp_id: CODE } as never);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(CODE);
    expect(result.message).toContain("19/09/2026");
    expect(fake.eventWrites()).toEqual([]);
    // Tạo mới thì chưa có dòng nào để loại trừ.
    expect(fake.lookups[0].some(([op]) => op === "neq")).toBe(false);
  });

  it("23505 lúc chèn: lời nói rõ, không phải câu của database", async () => {
    use({ owner: null, writeError: DUPLICATE });

    const result = await createEvent({ ...CREATE, legacy_event_temp_id: CODE } as never);

    expect(result.ok).toBe(false);
    expect(result.message).toContain(`Mã tham chiếu “${CODE}”`);
    expect(result.message).not.toContain("duplicate key");
  });
});

describe("3. tạo chuỗi lặp", () => {
  it("chỉ buổi đầu giữ mã — chép cho mọi buổi thì buổi 2 trở đi hỏng vì trùng", async () => {
    const fake = use({ owner: null });

    const result = await createEventSeries({
      ...CREATE,
      legacy_event_temp_id: CODE,
      recurrence_frequency: "weekly",
      recurrence_interval: "1",
      recurrence_end_mode: "after_count",
      recurrence_count: "3"
    } as never);

    expect(result.ok).toBe(true);
    const inserts = fake.eventWrites().filter((row) => row.op === "insert");
    expect(inserts).toHaveLength(3);
    expect(inserts.map((row) => row.payload.legacy_event_temp_id)).toEqual([CODE, null, null]);
  });
});

describe("4. biểu mẫu không để trình duyệt tự điền", () => {
  const form = readFileSync("app/events/event-form.tsx", "utf8");

  it("thẻ form tắt tự điền", () => {
    expect(form).toMatch(/<form[^>]*autoComplete="off"/);
  });

  it("ô mã tham chiếu tắt tự điền, kể cả khi Chrome bỏ qua lời dặn ở cấp form", () => {
    const input = form.slice(form.indexOf('name="legacy_event_temp_id"'), form.indexOf("/>", form.indexOf('name="legacy_event_temp_id"')));
    expect(input).toContain('autoComplete="off"');
  });
});
