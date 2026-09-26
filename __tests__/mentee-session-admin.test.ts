/**
 * __tests__/mentee-session-admin.test.ts
 *
 * Màn hình ban tổ chức điền số ghế cho 12 ca phỏng vấn mentee.
 *
 * ---------------------------------------------------------------------------
 * HAI ĐIỀU ĐÁNG CANH Ở ĐÂY
 * ---------------------------------------------------------------------------
 * 1. Ô ghế để TRỐNG nghĩa là ĐÓNG ca, không phải "giữ nguyên số cũ". Người vận
 *    hành xoá số rồi bấm lưu đang nói "đóng ca này lại". Hiểu thành "không đổi
 *    gì" sẽ để một ca họ tưởng đã đóng vẫn nhận người — và không lỗi nào hiện
 *    ra cho tới khi ứng viên tới nơi.
 *
 * 2. Mọi câu ghi phải lọc theo season_id. Id ca đến từ biểu mẫu, và ô chọn đã
 *    lọc trên màn hình KHÔNG phải một phép kiểm (CLAUDE.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  getSupabaseServiceRoleClient: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: mocks.getSupabaseServiceRoleClient
}));

import {
  applySeatLimitToAllSessions,
  applyVenueToAllSessions,
  saveSessionConfig
} from "@/lib/mentee-session-admin";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SEASON_ID = "22222222-2222-4222-8222-222222222222";

/** Ghi lại đúng những gì hàm gửi xuống database. */
type Ghi = { bang: string; payload: Record<string, unknown>; loc: Array<[string, unknown]> };
let daGhi: Ghi[] = [];
let soDongTraVe = 1;

function fakeClient() {
  return {
    from(bang: string) {
      const loc: Array<[string, unknown]> = [];
      const chain: any = {
        select: () => chain,
        update(payload: Record<string, unknown>) {
          daGhi.push({ bang, payload, loc });
          return chain;
        },
        eq(cot: string, gia_tri: unknown) {
          loc.push([cot, gia_tri]);
          return chain;
        },
        maybeSingle: async () => ({ data: { id: SEASON_ID }, error: null }),
        then: undefined
      };
      // Câu update kết thúc bằng .select("id"): trả về mảng dòng đã đổi.
      chain.select = (_cols?: string) => {
        if (daGhi.length > 0 && daGhi[daGhi.length - 1].bang === bang) {
          return Promise.resolve({
            data: Array.from({ length: soDongTraVe }, (_, i) => ({ id: `row-${i}` })),
            error: null
          }) as any;
        }
        return chain;
      };
      return chain;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  daGhi = [];
  soDongTraVe = 1;
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "au-1", role: "core_team" });
  mocks.getSupabaseServiceRoleClient.mockReturnValue(fakeClient());
});

describe("1. cổng quyền", () => {
  it.each(["reviewer", "support_team", "viewer", "mentor"])(
    "vai trò %s KHÔNG cấu hình được ca, và không ghi gì",
    async (role) => {
      mocks.getCurrentAdminUser.mockResolvedValue({ id: "au-1", role });

      const result = await saveSessionConfig({
        sessionId: SESSION_ID,
        seatLimit: "40",
        venue: "",
        closed: ""
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("không có quyền");
      expect(daGhi).toHaveLength(0);
    }
  );

  it("chưa đăng nhập thì cũng không ghi gì", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(null);
    const result = await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "40", venue: "", closed: "" });
    expect(result.ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });

  it.each(["core_team", "admin", "super_admin"])("vai trò %s thì lưu được", async (role) => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "au-1", role });
    const result = await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "40", venue: "", closed: "" });
    expect(result.ok).toBe(true);
    expect(daGhi).toHaveLength(1);
  });

  it("nút áp cho mọi ca cũng qua đúng cổng đó", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "au-1", role: "reviewer" });
    expect((await applySeatLimitToAllSessions({ seatLimit: "40" })).ok).toBe(false);
    expect((await applyVenueToAllSessions({ venue: "Phòng B2-208" })).ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });
});

describe("2. ô ghế để trống nghĩa là ĐÓNG", () => {
  it("để trống ghi seat_limit = null, không bỏ qua trường đó", async () => {
    const result = await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "", venue: "", closed: "" });

    expect(result.ok).toBe(true);
    expect(daGhi[0].payload).toHaveProperty("seat_limit", null);
  });

  it("chỉ toàn khoảng trắng cũng là để trống", async () => {
    await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "   ", venue: "", closed: "" });
    expect(daGhi[0].payload.seat_limit).toBeNull();
  });

  it("số 0 bị từ chối, kèm câu chỉ đúng cách đóng ca", async () => {
    const result = await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "0", venue: "", closed: "" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Để trống nếu muốn đóng ca");
    expect(daGhi).toHaveLength(0);
  });

  it.each(["abc", "12a", "-5", "4.5", "1e3"])("giá trị %s không phải số nguyên thì từ chối", async (bad) => {
    const result = await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: bad, venue: "", closed: "" });
    expect(result.ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });

  it("số quá lớn bị chặn — 300 ghế một ca là con số không ai gõ có chủ ý", async () => {
    const result = await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "5000", venue: "", closed: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("tối đa 300");
    expect(daGhi).toHaveLength(0);
  });

  it("nút áp cho mọi ca KHÔNG nhận ô trống — đóng cả đợt phải là việc có chủ ý", async () => {
    const result = await applySeatLimitToAllSessions({ seatLimit: "" });
    expect(result.ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });
});

describe("3. mọi câu ghi đều bị khoá trong mùa đang tuyển", () => {
  it("lưu một ca: lọc theo cả id lẫn season_id", async () => {
    await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "40", venue: "", closed: "" });

    const loc = Object.fromEntries(daGhi[0].loc);
    expect(loc.id).toBe(SESSION_ID);
    expect(loc.season_id).toBe(SEASON_ID);
  });

  it("id ca không phải uuid thì từ chối trước khi chạm database", async () => {
    const result = await saveSessionConfig({ sessionId: "'; drop table --", seatLimit: "40", venue: "", closed: "" });
    expect(result.ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });

  it("id ca của mùa khác: database không đổi dòng nào, và hàm nói thật", async () => {
    soDongTraVe = 0;
    const result = await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "40", venue: "", closed: "" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không tìm thấy ca này");
  });

  it("áp hàng loạt cũng chỉ chạm mùa đang tuyển", async () => {
    soDongTraVe = 12;
    const result = await applySeatLimitToAllSessions({ seatLimit: "40" });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("12 ca");
    expect(Object.fromEntries(daGhi[0].loc).season_id).toBe(SEASON_ID);
  });
});

describe("4. mỗi nút chỉ đụng vào việc của nó", () => {
  /**
   * Người bấm "áp số ghế cho mọi ca" đang nói về GHẾ. Nếu câu update ấy ghi
   * kèm venue hay status thì nó sẽ xoá sạch địa điểm riêng mà ban tổ chức vừa
   * điền cho từng ca — một mất mát im lặng.
   */
  it("áp số ghế không ghi đè địa điểm hay trạng thái", async () => {
    await applySeatLimitToAllSessions({ seatLimit: "40" });

    expect(daGhi[0].payload).toHaveProperty("seat_limit", 40);
    expect(daGhi[0].payload).not.toHaveProperty("venue");
    expect(daGhi[0].payload).not.toHaveProperty("status");
  });

  it("áp địa điểm không ghi đè số ghế", async () => {
    await applyVenueToAllSessions({ venue: "  Phòng B2-208, Cơ sở B UEH  " });

    expect(daGhi[0].payload).toHaveProperty("venue", "Phòng B2-208, Cơ sở B UEH");
    expect(daGhi[0].payload).not.toHaveProperty("seat_limit");
  });

  it("lưu một ca thì ghi cả ba trường, vì biểu mẫu mang cả ba", async () => {
    await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "40", venue: "Phòng A", closed: "yes" });

    expect(daGhi[0].payload).toMatchObject({
      seat_limit: 40,
      venue: "Phòng A",
      status: "closed"
    });
  });

  it("bỏ tick Đóng thì ca mở lại", async () => {
    await saveSessionConfig({ sessionId: SESSION_ID, seatLimit: "40", venue: "", closed: "" });
    expect(daGhi[0].payload.status).toBe("open");
    expect(daGhi[0].payload.venue).toBeNull();
  });
});
