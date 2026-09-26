/**
 * __tests__/email-automation-server.test.ts
 *
 * Đọc/ghi nội dung thư tự động, và điều quan trọng nhất: chuyện gì xảy ra khi
 * nội dung đã lưu dùng không được.
 *
 * ---------------------------------------------------------------------------
 * HAI ĐIỀU ĐÁNG CANH
 * ---------------------------------------------------------------------------
 * 1. HỎNG THÌ VẪN GỬI. Một lá thư tự động không bao giờ được phép KHÔNG ĐI vì
 *    có người vừa sửa hỏng nội dung của nó — người nhận không biết là có một lá
 *    thư đang thiếu, và không ai báo cho họ.
 *
 * 2. MỌI LẦN LƯU ĐỀU CÓ DÒNG LỊCH SỬ. Thư tự động đi im lặng tới hàng trăm
 *    người; câu hỏi đầu tiên khi phát hiện một câu sai luôn là "ai sửa, lúc
 *    nào, trước đó viết gì".
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
  resolveAutomationEmail,
  revertAutomationContent,
  saveAutomationContent
} from "@/lib/email-automation";
import { defaultAutomationContent } from "@/lib/email-automation-defaults";

const SLOT = "interview_round_invite";

type Ghi = { bang: string; loai: "insert" | "upsert" | "delete"; payload: any; loc: Array<[string, unknown]> };
let daGhi: Ghi[] = [];
/** Dòng override mà bản giả trả về khi được hỏi. */
let dongHienCo: { slot_id: string; subject: string; body: string } | null = null;
/** Bật để mọi lượt đọc trả về lỗi — mô phỏng database không đọc được. */
let docLoi = false;

const FALLBACK = { subject: "Tiêu đề mặc định", text: "Thân thư mặc định", html: "<p>mac dinh</p>" };

/**
 * Bản giả Supabase.
 *
 * Hình dạng CHUỖI GỌI phải giống thật: `.select(...).in(...)` rồi mới `await`.
 * Một bản giả trả về Promise ngay ở `.select()` sẽ xanh y hệt cho cả bản đọc
 * thiếu bộ lọc — đúng loại lỗi CLAUDE.md đã ghi về bản giả nuốt `.order()`.
 */
function fakeClient() {
  return {
    from(bang: string) {
      const loc: Array<[string, unknown]> = [];
      const ketQua = () => {
        if (docLoi) return { data: null, error: { message: "khong doc duoc" } };
        if (bang === "email_automation_overrides") {
          return { data: dongHienCo ? [dongHienCo] : [], error: null };
        }
        return { data: [], error: null };
      };

      const chain: any = {
        select: () => chain,
        eq(cot: string, gia_tri: unknown) {
          loc.push([cot, gia_tri]);
          return chain;
        },
        in(cot: string, gia_tri: unknown) {
          loc.push([cot, gia_tri]);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        upsert(payload: any) {
          daGhi.push({ bang, loai: "upsert", payload, loc });
          return Promise.resolve({ error: null });
        },
        insert(payload: any) {
          daGhi.push({ bang, loai: "insert", payload, loc });
          return Promise.resolve({ error: null });
        },
        delete() {
          daGhi.push({ bang, loai: "delete", payload: null, loc });
          return chain;
        },
        // Chuỗi chờ được ở bất kỳ điểm nào, đúng như PostgREST.
        then: (resolve: any) => resolve(ketQua())
      };
      return chain;
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  daGhi = [];
  dongHienCo = null;
  docLoi = false;
  mocks.getCurrentAdminUser.mockResolvedValue({ id: "au-1", role: "support_team", full_name: "Chị Hỗ Trợ" });
  mocks.getSupabaseServiceRoleClient.mockReturnValue(fakeClient());
});

describe("1. cổng quyền", () => {
  it.each(["reviewer", "viewer", "mentor"])("vai trò %s không sửa được, và không ghi gì", async (role) => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "au-1", role });
    const content = defaultAutomationContent(SLOT)!;

    const saved = await saveAutomationContent({ slotId: SLOT, ...content });
    const reverted = await revertAutomationContent(SLOT);

    expect(saved.ok).toBe(false);
    expect(reverted.ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });

  it("chưa đăng nhập thì cũng không ghi gì", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(null);
    const content = defaultAutomationContent(SLOT)!;
    expect((await saveAutomationContent({ slotId: SLOT, ...content })).ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });

  it.each(["core_team", "support_team", "admin", "super_admin"])("vai trò %s lưu được", async (role) => {
    mocks.getCurrentAdminUser.mockResolvedValue({ id: "au-1", role });
    const content = defaultAutomationContent(SLOT)!;

    const result = await saveAutomationContent({ slotId: SLOT, ...content });

    expect(result.ok).toBe(true);
    expect(daGhi.some((g) => g.bang === "email_automation_overrides" && g.loai === "upsert")).toBe(true);
  });
});

describe("2. lưu", () => {
  it("nội dung không hợp lệ bị chặn TRƯỚC khi chạm database", async () => {
    const result = await saveAutomationContent({
      slotId: SLOT,
      subject: "Mời {{ten_nguoi_nhan}}",
      // Thiếu {{mua}} — ô bắt buộc của lá thư này.
      body: "Chào {{ten_nguoi_nhan}}, hồ sơ của bạn đã qua vòng đầu."
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mua");
    expect(daGhi).toHaveLength(0);
  });

  it("ghi đúng slot_id và người sửa", async () => {
    const content = defaultAutomationContent(SLOT)!;
    await saveAutomationContent({ slotId: SLOT, ...content });

    const write = daGhi.find((g) => g.bang === "email_automation_overrides")!;
    expect(write.payload.slot_id).toBe(SLOT);
    expect(write.payload.updated_by).toBe("au-1");
  });

  it("mỗi lần lưu ghi một dòng lịch sử, kèm nội dung TRƯỚC đó", async () => {
    dongHienCo = { slot_id: SLOT, subject: "Tiêu đề cũ", body: "Thân thư cũ" };
    const content = defaultAutomationContent(SLOT)!;

    await saveAutomationContent({ slotId: SLOT, ...content });

    const logRow = daGhi.find((g) => g.bang === "email_automation_override_log")!;
    expect(logRow.payload.action).toBe("save");
    expect(logRow.payload.subject_before).toBe("Tiêu đề cũ");
    expect(logRow.payload.body_before).toBe("Thân thư cũ");
    expect(logRow.payload.changed_by_name).toBe("Chị Hỗ Trợ");
  });

  it("lần lưu đầu tiên ghi lịch sử với nội dung trước là null — trước đó là bản mặc định", async () => {
    const content = defaultAutomationContent(SLOT)!;
    await saveAutomationContent({ slotId: SLOT, ...content });

    const logRow = daGhi.find((g) => g.bang === "email_automation_override_log")!;
    expect(logRow.payload.body_before).toBeNull();
  });

  it("không đọc được bảng thì KHÔNG ghi đè — thà không lưu còn hơn lưu mất lịch sử", async () => {
    docLoi = true;
    const content = defaultAutomationContent(SLOT)!;

    const result = await saveAutomationContent({ slotId: SLOT, ...content });

    expect(result.ok).toBe(false);
    expect(daGhi).toHaveLength(0);
  });
});

describe("3. trả về bản mặc định", () => {
  it("XOÁ dòng, không ghi đè bằng một bản chép của mã nguồn", async () => {
    dongHienCo = { slot_id: SLOT, subject: "Đã sửa", body: "Đã sửa" };

    const result = await revertAutomationContent(SLOT);

    expect(result.ok).toBe(true);
    const write = daGhi.find((g) => g.bang === "email_automation_overrides")!;
    expect(write.loai).toBe("delete");
    expect(Object.fromEntries(write.loc).slot_id).toBe(SLOT);
  });

  it("nội dung vừa xoá vẫn nằm lại trong lịch sử", async () => {
    dongHienCo = { slot_id: SLOT, subject: "Đã sửa", body: "Thân thư đã sửa" };

    await revertAutomationContent(SLOT);

    const logRow = daGhi.find((g) => g.bang === "email_automation_override_log")!;
    expect(logRow.payload.action).toBe("revert");
    expect(logRow.payload.body_before).toBe("Thân thư đã sửa");
    expect(logRow.payload.body_after).toBeNull();
  });

  it("đang dùng bản mặc định thì không xoá gì cả", async () => {
    dongHienCo = null;

    const result = await revertAutomationContent(SLOT);

    expect(result.ok).toBe(true);
    expect(daGhi).toHaveLength(0);
  });
});

describe("4. lúc gửi: hỏng thì vẫn gửi bản mặc định", () => {
  const values = { ten_nguoi_nhan: "Anh A", mua: "UEHM-S12" };

  it("không có nội dung đã lưu thì gửi bản của hàm dựng thư", async () => {
    dongHienCo = null;

    const result = await resolveAutomationEmail({ slotId: SLOT, values, fallback: FALLBACK });

    expect(result).toEqual(FALLBACK);
  });

  it("có nội dung đã lưu thì gửi nội dung đó", async () => {
    dongHienCo = {
      slot_id: SLOT,
      subject: "Chúc mừng {{ten_nguoi_nhan}}",
      body: "Chào {{ten_nguoi_nhan}},\n\nHồ sơ {{mua}} của bạn đã qua vòng đầu."
    };

    const result = await resolveAutomationEmail({ slotId: SLOT, values, fallback: FALLBACK });

    expect(result.subject).toBe("Chúc mừng Anh A");
    expect(result.text).toContain("Hồ sơ UEHM-S12 của bạn");
    // HTML dựng lại từ chính chữ đã điền, không phải HTML của bản mặc định.
    expect(result.html).toContain("Anh A");
    expect(result.html).not.toBe(FALLBACK.html);
  });

  it("KHÔNG ĐỌC ĐƯỢC bảng thì vẫn gửi, bằng bản mặc định", async () => {
    docLoi = true;

    const result = await resolveAutomationEmail({ slotId: SLOT, values, fallback: FALLBACK });

    expect(result).toEqual(FALLBACK);
  });

  it("nội dung đã lưu thiếu dữ liệu cho một ô bắt buộc thì vẫn gửi, bằng bản mặc định", async () => {
    dongHienCo = {
      slot_id: SLOT,
      subject: "Chào {{ten_nguoi_nhan}}",
      body: "Mùa {{mua}} — {{ten_nguoi_nhan}}"
    };

    const result = await resolveAutomationEmail({
      slotId: SLOT,
      // Thiếu `mua`.
      values: { ten_nguoi_nhan: "Anh A" },
      fallback: FALLBACK
    });

    expect(result).toEqual(FALLBACK);
  });

  it("slot lạ thì vẫn gửi, bằng bản mặc định", async () => {
    const result = await resolveAutomationEmail({
      slotId: "khong-co-that",
      values,
      fallback: FALLBACK
    });

    expect(result).toEqual(FALLBACK);
  });

  it("thẻ HTML lọt vào nội dung đã lưu vẫn bị escape, không thành thẻ chạy được", async () => {
    dongHienCo = {
      slot_id: SLOT,
      subject: "Chào {{ten_nguoi_nhan}}",
      body: "Mùa {{mua}} <script>alert(1)</script>"
    };

    const result = await resolveAutomationEmail({ slotId: SLOT, values, fallback: FALLBACK });

    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});
