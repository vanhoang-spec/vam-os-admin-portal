import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("@/lib/events", () => ({ checkInForEvent: mocks.check }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
import { submitEventCheckinAction } from "@/app/checkin/[token]/actions";
import { initialPublicCheckinActionState } from "@/lib/event-action-types";
beforeEach(() => { mocks.check.mockReset(); });
it.each([["", "0901234567"], ["Nguyễn An", ""], ["  ", "  "]])("thiếu tên hoặc điện thoại không gọi đường ghi", async (name, phone) => {
  const form = new FormData();
  form.set("email", "an@example.test"); form.set("full_name", name); form.set("phone", phone);
  const result = await submitEventCheckinAction(initialPublicCheckinActionState, form);
  expect(result.status).toBe("validation_error");
  expect(result.values?.email).toBe("an@example.test");
  expect(mocks.check).not.toHaveBeenCalled();
});
it("đủ liên hệ chuyển đúng giá trị đã trim tới đường check-in", async () => {
  mocks.check.mockResolvedValue({ ok: false, status: "server_error", message: "Thử lại" });
  const form = new FormData();
  form.set("token", "t"); form.set("email", "an@example.test"); form.set("full_name", " Nguyễn An "); form.set("phone", " 0901234567 ");
  await submitEventCheckinAction(initialPublicCheckinActionState, form);
  expect(mocks.check).toHaveBeenCalledWith(expect.objectContaining({ full_name: "Nguyễn An", phone: "0901234567", email: "an@example.test" }));
});
