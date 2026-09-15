/**
 * Ai được sửa chữ trên form đăng ký — và lệnh ghi chỉ chạm các đoạn chữ đã đổi.
 *
 * Ca có thật (15/09/2026): hai buổi Mentor Orientation cùng mang "AGENDA – 20.09.2026
 * & 27.09.2026" sau khi buổi 20/09 dời sang 04/10. Sửa một buổi mà buổi kia giữ bản
 * cũ thì link chung và link riêng nói hai điều khác nhau.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/events", () => ({
  writeAdminAudit: vi.fn(async () => undefined),
  isValidUuid: (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { writeAdminAudit } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canEditRegistrationFormText, updateRegistrationFormText } from "@/lib/event-form-text-server";

const E1 = "00000000-0000-4000-8000-0000000000e1";
const E2 = "00000000-0000-4000-8000-0000000000e2";
const E3 = "00000000-0000-4000-8000-0000000000e3";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const OTHER_SEASON = "00000000-0000-4000-8000-0000000000cc";
const SERIES = "00000000-0000-4000-8000-0000000000aa";

const OLD = "🕒 AGENDA – 20.09.2026 & 27.09.2026";
const NEW = "🕒 AGENDA – 27.09.2026 & 04.10.2026";

type Row = Record<string, unknown> & { id: string };

const blank = {
  no_show_policy_text: null,
  proof_description: null,
  fee_description: null,
  meal_payment_instruction: null
};
const SESSION_1: Row = { id: E1, season_id: SEASON, series_id: SERIES, event_description: OLD, payment_instruction: "STK 1", ...blank };
const SESSION_2: Row = { id: E2, season_id: SEASON, series_id: SERIES, event_description: OLD, payment_instruction: "STK 2 — riêng buổi 2", ...blank };
const SINGLE: Row = { id: E3, season_id: SEASON, series_id: null, event_description: OLD, payment_instruction: null, ...blank };

const user = (role: string) => ({ id: `u-${role}`, role, status: "active" }) as never;

type Write = { table: string; payload: Record<string, unknown>; ids: unknown };

function use(opts: { rows?: Row[]; readError?: boolean; seriesError?: boolean; updateError?: boolean } = {}) {
  const rows = opts.rows ?? [SESSION_1, SESSION_2, SINGLE];
  const writes: Write[] = [];
  const filters: Array<[string, unknown]> = [];

  const from = vi.fn((table: string) => {
    const state: { update?: Record<string, unknown>; eq?: [string, unknown]; in?: [string, unknown[]] } = {};
    const run = () => {
      if (state.update) {
        writes.push({ table, payload: state.update, ids: state.in ?? null });
        if (opts.updateError) return { data: null, error: { message: "ghi hỏng" } };
        const ids = state.in?.[1] ?? [];
        return { data: rows.filter((row) => ids.includes(row.id)).map((row) => ({ ...row, ...state.update })), error: null };
      }
      if (opts.seriesError) return { data: null, error: { message: "đọc chuỗi hỏng" } };
      const [column, value] = state.eq ?? ["", undefined];
      return { data: rows.filter((row) => row[column] === value), error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        state.eq = [column, value];
        filters.push([column, value]);
        return chain;
      },
      in: (column: string, values: unknown[]) => {
        state.in = [column, values];
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        state.update = payload;
        return chain;
      },
      maybeSingle: async () => {
        if (opts.readError) return { data: null, error: { message: "đọc hỏng" } };
        const [column, value] = state.eq ?? ["", undefined];
        return { data: rows.find((row) => row[column] === value) ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject)
    };
    return chain;
  });

  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from } as never);
  return { writes, filters, from };
}

const save = (texts: Record<string, unknown>, opts: { eventId?: unknown; applyToSeries?: boolean } = {}) =>
  updateRegistrationFormText({ eventId: opts.eventId ?? E1, texts, applyToSeries: opts.applyToSeries ?? true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scope: "ctx" } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(getCurrentAdminUser).mockResolvedValue(user("core_team"));
});

describe("1. ai được sửa", () => {
  it.each(["super_admin", "admin", "core_team"])("%s vận hành được mùa của buổi: được", async (role) => {
    expect(await canEditRegistrationFormText(user(role), { season_id: SEASON })).toBe(true);
    expect(canOperateSeason).toHaveBeenCalledWith({ scope: "ctx" }, SEASON);
  });

  it.each(["support_team", "reviewer", "viewer"])("%s: không", async (role) => {
    expect(await canEditRegistrationFormText(user(role), { season_id: SEASON })).toBe(false);
  });

  it("không vận hành được mùa đó: không", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect(await canEditRegistrationFormText(user("admin"), { season_id: SEASON })).toBe(false);
  });

  it("đọc phạm vi hỏng: không — lỗi hạ tầng không thành quyền", async () => {
    vi.mocked(canOperateSeason).mockRejectedValue(new Error("hỏng"));
    expect(await canEditRegistrationFormText(user("admin"), { season_id: SEASON })).toBe(false);
  });

  it("chưa đăng nhập: không", async () => {
    expect(await canEditRegistrationFormText(null, { season_id: SEASON })).toBe(false);
  });
});

describe("2. lệnh ghi", () => {
  it("chuỗi, có tick: ghi ĐÚNG đoạn đã đổi vào cả hai buổi, mỗi buổi một dòng nhật ký", async () => {
    const fake = use();

    const result = await save({ event_description: NEW, payment_instruction: "STK 1" });

    expect(result).toEqual({ ok: true, message: "Đã lưu nội dung form cho cả 2 buổi trong chuỗi.", eventIds: [E1, E2] });
    // payment_instruction của buổi 1 không đổi nên KHÔNG được chép sang buổi 2,
    // nơi nó đang mang nội dung riêng.
    expect(fake.writes).toEqual([{ table: "events", payload: { event_description: NEW }, ids: ["id", [E1, E2]] }]);
    expect(writeAdminAudit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(writeAdminAudit).mock.calls.map((call) => call[1])).toEqual([
      {
        actionType: "update_event",
        beforeData: SESSION_1,
        afterData: { ...SESSION_1, event_description: NEW }
      },
      {
        actionType: "update_event",
        beforeData: SESSION_2,
        afterData: { ...SESSION_2, event_description: NEW }
      }
    ]);
  });

  it("chuỗi, bỏ tick: chỉ buổi đang mở", async () => {
    const fake = use();

    const result = await save({ event_description: NEW }, { applyToSeries: false });

    expect(result.eventIds).toEqual([E1]);
    expect(result.message).toBe("Đã lưu nội dung form.");
    expect(fake.writes).toEqual([{ table: "events", payload: { event_description: NEW }, ids: ["id", [E1]] }]);
    expect(fake.filters).not.toContainEqual(["series_id", SERIES]);
  });

  it("sự kiện đơn lẻ, có tick: chỉ chính nó, không đi tìm chuỗi", async () => {
    const fake = use();

    await save({ event_description: NEW }, { eventId: E3 });

    expect(fake.writes).toEqual([{ table: "events", payload: { event_description: NEW }, ids: ["id", [E3]] }]);
    expect(fake.filters.map((filter) => filter[0])).not.toContain("series_id");
  });

  it("đường ghi hẹp: khoá ngoài danh sách gửi kèm không được ghi", async () => {
    const fake = use();

    await save({ event_description: NEW, event_name: "Tên mới", show_student_id_field: "false", fee_amount: "0" });

    expect(fake.writes).toHaveLength(1);
    expect(Object.keys(fake.writes[0].payload)).toEqual(["event_description"]);
  });

  it("không có gì đổi: không ghi, không nhật ký", async () => {
    const fake = use();

    const result = await save({ event_description: OLD, payment_instruction: "STK 1" });

    expect(result).toEqual({ ok: true, message: "Nội dung form không có gì thay đổi.", eventIds: [] });
    expect(fake.writes).toEqual([]);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("dài quá trần: không ghi", async () => {
    const fake = use();

    expect((await save({ event_description: "a".repeat(20001) })).ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });
});

describe("3. không được thì không ghi gì", () => {
  it.each(["support_team", "reviewer"])("%s: không ghi — và trả lời 'không có quyền' kể cả khi nội dung sai", async (role) => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(user(role));
    const fake = use();

    const result = await save({ event_description: "a".repeat(20001) });

    expect(result).toEqual({ ok: false, message: "Bạn không có quyền sửa nội dung form của sự kiện này.", eventIds: [] });
    expect(fake.writes).toEqual([]);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("một buổi của chuỗi nằm ở mùa không vận hành được: không ghi buổi nào", async () => {
    vi.mocked(canOperateSeason).mockImplementation(async (_ctx, season) => season === SEASON);
    const fake = use({ rows: [SESSION_1, { ...SESSION_2, season_id: OTHER_SEASON }] });

    const result = await save({ event_description: NEW });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Bỏ chọn");
    expect(fake.writes).toEqual([]);
  });

  it("đọc chuỗi hỏng: không ghi", async () => {
    const fake = use({ seriesError: true });

    expect((await save({ event_description: NEW })).ok).toBe(false);
    expect(fake.writes).toEqual([]);
  });

  it("ghi hỏng: báo lỗi, không nhật ký", async () => {
    use({ updateError: true });

    expect(await save({ event_description: NEW })).toEqual({
      ok: false,
      message: "Không lưu được nội dung form. Thử lại.",
      eventIds: []
    });
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("không đọc được sự kiện, hoặc không có sự kiện: không ghi", async () => {
    const broken = use({ readError: true });
    expect((await save({ event_description: NEW })).ok).toBe(false);
    expect(broken.writes).toEqual([]);

    const missing = use({ rows: [] });
    expect(await save({ event_description: NEW })).toEqual({ ok: false, message: "Không tìm thấy sự kiện.", eventIds: [] });
    expect(missing.writes).toEqual([]);
  });

  it("chưa đăng nhập, hoặc mã sự kiện không hợp lệ: không chạm database", async () => {
    const fake = use();

    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as never);
    expect((await save({ event_description: NEW })).message).toBe("Bạn chưa đăng nhập.");

    vi.mocked(getCurrentAdminUser).mockResolvedValue(user("admin"));
    expect((await save({ event_description: NEW }, { eventId: "không-phải-uuid" })).message).toBe("ID sự kiện không hợp lệ.");

    expect(fake.from).not.toHaveBeenCalled();
  });
});
