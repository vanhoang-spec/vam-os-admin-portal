/**
 * `sendReviewBatchAssigned` — chặng giữa hàm báo và mẫu thư.
 *
 * Mẫu thư có test riêng; hàm báo có test riêng, với hàm gửi là bản giả. Chặng
 * giữa hai thứ đó từng không có test nào: bỏ `roleApplied` ở đây thì mọi lô đơn
 * mentor lặng lẽ thành "hồ sơ", và cả hai bộ test kia vẫn xanh. Dựng lại lỗi
 * mới thấy.
 *
 * Gửi thư tắt trong môi trường test, nên hàm ghi một dòng `skipped` vào nhật ký
 * thư gửi — mang đúng tiêu đề của lá thư đã dựng. Đó là chỗ soi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inserts: [] as Array<Record<string, unknown>> }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        mocks.inserts.push({ table, ...row });
        return { error: null };
      }
    })
  })
}));

import { sendReviewBatchAssigned } from "@/lib/email";

const ENV_KEYS = ["VAM_OS_EMAIL_ENABLED", "VAM_OS_PUBLIC_BASE_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  mocks.inserts.length = 0;
  // Gửi thư tắt, và đường dẫn phải dựng từ `requestOrigin` truyền vào.
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const INPUT = {
  toEmail: "my@example.com",
  reviewerName: "Võ Nguyễn Hoàng Mỹ",
  seasonLabel: "UEH Mentoring S12",
  assignmentCount: 10,
  dueLabel: "20/09/2026",
  roleApplied: "mentor",
  assignmentBatchId: "batch-1",
  requestOrigin: "https://os.example.org"
};

describe("hàm gửi chuyển đủ nội dung xuống mẫu thư", () => {
  it("vai trò và hạn của lô có mặt trong tiêu đề lá thư đã dựng", async () => {
    const result = await sendReviewBatchAssigned(INPUT);

    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.inserts).toHaveLength(1);
    expect(mocks.inserts[0].subject).toContain("10 hồ sơ mentor");
    expect(mocks.inserts[0].subject).toContain("hạn 20/09/2026");
  });

  it("ghi nhật ký đúng loại thư, đúng người nhận, gắn với lô giao", async () => {
    await sendReviewBatchAssigned(INPUT);

    expect(mocks.inserts[0]).toMatchObject({
      table: "outbound_emails",
      kind: "review_batch_assigned",
      to_email: "my@example.com",
      status: "skipped",
      related_table: "review_assignment_batches",
      related_id: "batch-1"
    });
  });

  it("không có địa chỉ trang để dựng đường dẫn: không gửi, nói rõ vì sao", async () => {
    const result = await sendReviewBatchAssigned({ ...INPUT, requestOrigin: null });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("VAM_OS_PUBLIC_BASE_URL");
    expect(mocks.inserts).toHaveLength(0);
  });
});
