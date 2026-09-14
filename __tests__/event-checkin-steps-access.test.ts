/**
 * Ai được thiết lập các lần quét mã QR — và lệnh ghi chỉ chạm đúng một cột.
 *
 * Chủ dự án chốt lại 14/09/2026: support team cũng được sửa phần này. Nhưng chỉ
 * support team được ghép vào ĐÚNG buổi đó, và chỉ phần này: form Sửa sự kiện ghi cả
 * tên, giờ, địa điểm, phí — một lệnh ghi rộng hơn một cột là trao nhiều hơn thứ
 * đã quyết định trao.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/event-supporters", () => ({ canScanEvent: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/events", () => ({
  writeAdminAudit: vi.fn(async () => undefined),
  isValidUuid: (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canScanEvent } from "@/lib/event-supporters";
import { writeAdminAudit } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canConfigureCheckinSteps, updateEventCheckinSteps } from "@/lib/event-checkin-steps-server";

const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const EVENT = { id: EVENT_ID, season_id: SEASON };

const user = (role: string, status = "active") => ({ id: `u-${role}`, role, status }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getAdminScopeContext).mockResolvedValue({ scope: "ctx" } as never);
  vi.mocked(canOperateSeason).mockResolvedValue(true);
  vi.mocked(canScanEvent).mockResolvedValue(false);
});

describe("1. ai được thiết lập", () => {
  it("chưa đăng nhập: không", async () => {
    expect(await canConfigureCheckinSteps(null, EVENT)).toBe(false);
  });

  it.each(["super_admin", "admin", "core_team"])("%s vận hành được mùa của buổi: được", async (role) => {
    expect(await canConfigureCheckinSteps(user(role), EVENT)).toBe(true);
    expect(canOperateSeason).toHaveBeenCalledWith({ scope: "ctx" }, SEASON);
  });

  it("core_team không vận hành được mùa đó: không", async () => {
    vi.mocked(canOperateSeason).mockResolvedValue(false);
    expect(await canConfigureCheckinSteps(user("core_team"), EVENT)).toBe(false);
  });

  it("đọc phạm vi hỏng: không — lỗi hạ tầng không thành quyền", async () => {
    vi.mocked(canOperateSeason).mockRejectedValue(new Error("hỏng"));
    expect(await canConfigureCheckinSteps(user("admin"), EVENT)).toBe(false);
  });

  it("support team được ghép vào đúng buổi này: được", async () => {
    vi.mocked(canScanEvent).mockResolvedValue(true);
    expect(await canConfigureCheckinSteps(user("support_team"), EVENT)).toBe(true);
    expect(canScanEvent).toHaveBeenCalledWith(expect.objectContaining({ role: "support_team" }), EVENT_ID);
  });

  it("support team KHÔNG được ghép vào buổi này: không", async () => {
    vi.mocked(canScanEvent).mockResolvedValue(false);
    expect(await canConfigureCheckinSteps(user("support_team"), EVENT)).toBe(false);
  });

  it.each(["reviewer", "viewer"])("%s dù có dòng ghép vào buổi: không", async (role) => {
    vi.mocked(canScanEvent).mockResolvedValue(true);
    expect(await canConfigureCheckinSteps(user(role), EVENT)).toBe(false);
  });
});

describe("2. lệnh ghi", () => {
  type Write = { op: "update"; payload: Record<string, unknown>; filters: Array<[string, unknown]> };

  function use(opts: { readError?: boolean; missing?: boolean } = {}) {
    const writes: Write[] = [];
    const from = vi.fn(() => {
      let write: Write | null = null;
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          write?.filters.push([column, value]);
          return chain;
        },
        update: (payload: Record<string, unknown>) => {
          write = { op: "update", payload, filters: [] };
          writes.push(write);
          return chain;
        },
        maybeSingle: async () => {
          if (write) return { data: { ...EVENT, checkin_steps: write.payload.checkin_steps }, error: null };
          if (opts.readError) return { data: null, error: { message: "đọc hỏng" } };
          if (opts.missing) return { data: null, error: null };
          return { data: { ...EVENT, checkin_steps: ["entrance"] }, error: null };
        }
      };
      return chain;
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from } as never);
    return { writes, from };
  }

  const save = (steps: unknown, eventId: unknown = EVENT_ID) => updateEventCheckinSteps({ eventId, steps });

  it("support team được ghép: ghi ĐÚNG MỘT cột, đúng buổi, có nhật ký", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(user("support_team"));
    vi.mocked(canScanEvent).mockResolvedValue(true);
    const fake = use();

    const result = await save(["entrance", "gift_counter", "checkout"]);

    expect(result).toEqual({ ok: true, message: "Đã lưu các lần quét." });
    expect(fake.writes).toEqual([
      { op: "update", payload: { checkin_steps: ["entrance", "gift_counter", "checkout"] }, filters: [["id", EVENT_ID]] }
    ]);
    expect(writeAdminAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionType: "update_event" })
    );
  });

  it("support team không được ghép: không ghi — và trả lời 'không có quyền' kể cả khi danh sách sai", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(user("support_team"));
    vi.mocked(canScanEvent).mockResolvedValue(false);
    const fake = use();

    const result = await save(["booth_program"]);

    expect(result).toEqual({ ok: false, message: "Bạn không có quyền thiết lập các lần quét của sự kiện này." });
    expect(fake.writes).toEqual([]);
    expect(writeAdminAudit).not.toHaveBeenCalled();
  });

  it("có quyền mà danh sách sai: không ghi", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(user("core_team"));
    const fake = use();

    expect(await save([])).toEqual({ ok: false, message: "Cần ít nhất một lần quét mã QR." });
    expect(fake.writes).toEqual([]);
  });

  it("không đọc được sự kiện, hoặc không có sự kiện: không ghi", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue(user("admin"));

    const broken = use({ readError: true });
    expect((await save(["checkout"])).ok).toBe(false);
    expect(broken.writes).toEqual([]);

    const missing = use({ missing: true });
    expect(await save(["checkout"])).toEqual({ ok: false, message: "Không tìm thấy sự kiện." });
    expect(missing.writes).toEqual([]);
  });

  it("chưa đăng nhập, hoặc mã sự kiện không hợp lệ: không chạm database", async () => {
    const fake = use();

    vi.mocked(getCurrentAdminUser).mockResolvedValue(null as never);
    expect((await save(["checkout"])).ok).toBe(false);

    vi.mocked(getCurrentAdminUser).mockResolvedValue(user("admin"));
    expect(await save(["checkout"], "không-phải-uuid")).toEqual({ ok: false, message: "ID sự kiện không hợp lệ." });

    expect(fake.from).not.toHaveBeenCalled();
  });
});
