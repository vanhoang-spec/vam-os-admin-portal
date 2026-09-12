/**
 * Buổi trực tuyến phải có đường dẫn phòng họp.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐÂY LÀ MỘT LỖI CHỨ KHÔNG PHẢI MỘT Ô BỎ TRỐNG
 * ---------------------------------------------------------------------------
 * `normalizeJoinUrl("")` trả về hợp lệ với `url: null`, nên trước bản vá này
 * một buổi trực tuyến lưu được mà không có chỗ nào để vào.
 *
 * Không có gì báo: form lưu êm, danh sách hiện bình thường, thư xác nhận vẫn
 * gửi đi — chỉ là nó không mang dòng "Đường dẫn tham gia", vì `buildEvent-
 * RegistrationConfirmationEmail` chỉ thêm dòng ấy khi có đường dẫn. Người đăng
 * ký phát hiện ra đúng lúc buổi bắt đầu, khi không còn ai kịp sửa.
 *
 * Trên production lúc viết bản vá: 1 buổi trực tuyến, sắp diễn ra, không có
 * đường dẫn.
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
  canOperateAnyScope: vi.fn(async () => true)
}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { validateJoinUrlForFormat, needsJoinUrl } from "@/lib/event-location";
import { updateEvent } from "@/lib/events";

const EVENT = "00000000-0000-4000-8000-0000000000aa";
const SEASON = "00000000-0000-4000-8000-0000000000bb";
const ACTOR = "00000000-0000-4000-8000-0000000000dd";
const LINK = "https://meet.google.com/abc-defg-hij";

describe("1. luật thuần", () => {
  it("trực tuyến mà thiếu đường dẫn: từ chối", () => {
    const result = validateJoinUrlForFormat("online", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("đường dẫn phòng họp");
  });

  it("vừa tại chỗ vừa trực tuyến mà thiếu đường dẫn: cũng từ chối", () => {
    // Người đăng ký chọn tham gia từ xa thì vẫn cần chỗ để vào.
    expect(validateJoinUrlForFormat("hybrid", null).ok).toBe(false);
  });

  it("chỉ tại chỗ thì không đòi", () => {
    expect(validateJoinUrlForFormat("offline", null).ok).toBe(true);
  });

  it("có đường dẫn thì qua, ở mọi hình thức có phần trực tuyến", () => {
    for (const format of ["online", "hybrid"] as const) {
      expect(validateJoinUrlForFormat(format, LINK).ok).toBe(true);
    }
  });

  it("luật đi đúng theo needsJoinUrl, không tự dựng danh sách hình thức riêng", () => {
    for (const format of ["offline", "online", "hybrid"] as const) {
      expect(validateJoinUrlForFormat(format, null).ok).toBe(!needsJoinUrl(format));
    }
  });
});

describe("2. hàm ghi tự kiểm lại", () => {
  const writes: Array<{ table: string; op: string }> = [];

  function client() {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({
        data: {
          id: EVENT, season_id: SEASON, event_name: "Training buổi 2", event_type: "training",
          starts_at: "2026-10-01T02:00:00.000Z", event_format: "online", status: "scheduled"
        },
        error: null
      }),
      update: (payload: unknown) => { writes.push({ table: "events", op: "update" }); void payload; return chain; },
      insert: (payload: unknown) => { writes.push({ table: "events", op: "insert" }); void payload; return chain; }
    };
    return { from: (table: string) => { void table; return chain; }, rpc: vi.fn(async () => ({ data: null, error: null })) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    writes.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role: "core_team", status: "active" } as never);
    vi.mocked(getAdminScopeContext).mockResolvedValue({
      adminUser: { id: ACTOR, role: "core_team", status: "active" } as never,
      authUserId: "auth", globalRole: "core_team", isSuperAdmin: false, programScopes: [], scopeError: null
    } as never);
    vi.mocked(canOperateSeason).mockResolvedValue(true as never);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client() as never);
  });

  it("sửa một buổi sang trực tuyến mà bỏ trống đường dẫn: từ chối, và KHÔNG ghi gì", async () => {
    const result = await updateEvent({
      id: EVENT, season_id: SEASON, event_name: "Training buổi 2", event_type: "training",
      starts_at: "2026-10-01T09:00", event_format: "online", online_join_url: ""
    } as never);

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đường dẫn phòng họp");
    // Ca "không được ghi gì cả" quan trọng ngang ca "ghi đúng": từ chối mà vẫn
    // ghi một phần nghĩa là buổi đã đổi sang trực tuyến rồi mới báo lỗi.
    expect(writes).toEqual([]);
  });

  it("có đường dẫn thì không bị chặn bởi luật này", async () => {
    const result = await updateEvent({
      id: EVENT, season_id: SEASON, event_name: "Training buổi 2", event_type: "training",
      starts_at: "2026-10-01T09:00", event_format: "online", online_join_url: LINK
    } as never);

    if (!result.ok) expect(result.message).not.toContain("đường dẫn phòng họp");
  });

  it("buổi tại chỗ vẫn lưu được khi bỏ trống đường dẫn", async () => {
    const result = await updateEvent({
      id: EVENT, season_id: SEASON, event_name: "Training buổi 2", event_type: "training",
      starts_at: "2026-10-01T09:00", event_format: "offline",
      location_name: "Hội trường A", online_join_url: ""
    } as never);

    if (!result.ok) expect(result.message).not.toContain("đường dẫn phòng họp");
  });
});

describe("3. một cửa cho cả hai đường ghi", () => {
  const source = readFileSync("lib/events.ts", "utf8");

  it("phép kiểm nằm trong resolveEventPlaceInput, nên tạo mới và sửa dùng chung", () => {
    // Đặt ở hai nơi là hai cơ hội để một nơi bị sót khi có người sửa sau này.
    const resolver = source.slice(
      source.indexOf("function resolveEventPlaceInput"),
      source.indexOf("export async function createEvent")
    );
    expect(resolver).toContain("validateJoinUrlForFormat");
    expect(source.split("validateJoinUrlForFormat").length - 1).toBe(2); // 1 import + 1 lệnh gọi
  });

  it("cả createEvent lẫn updateEvent đều đi qua resolver đó", () => {
    expect(source.split("resolveEventPlaceInput(input, startsAt)").length - 1).toBe(2);
  });
});

describe("4. màn hình nói trước, không để người dùng đoán", () => {
  const form = readFileSync("app/events/event-form.tsx", "utf8");

  it("ô đường dẫn được đánh dấu bắt buộc và nói vì sao", () => {
    const field = form.slice(form.indexOf("Đường dẫn tham gia trực tuyến"), form.indexOf("legacy_event_temp_id"));
    expect(field).toContain("required");
    expect(field).toContain("Thư xác nhận gửi cho người đăng ký lấy đường dẫn từ ô này");
  });

  it("ô chỉ hiện khi buổi có phần trực tuyến", () => {
    expect(form).toContain("needsJoinUrl(format) ? (");
  });
});

describe("5. thư xác nhận mang đường dẫn", () => {
  it("thân thư có dòng đường dẫn tham gia", () => {
    // Đây là lý do luật ở trên tồn tại: thiếu đường dẫn thì dòng này biến mất
    // khỏi thư, im lặng.
    const core = readFileSync("lib/email-core.ts", "utf8");
    const builder = core.slice(
      core.indexOf("export function buildEventRegistrationConfirmationEmail"),
      core.indexOf("export function buildEventScheduleChangeEmail")
    );
    expect(builder).toContain("Đường dẫn tham gia:");
    expect(builder).toContain("input.joinUrl");
  });
});
