/**
 * Action lưu chữ trên form đăng ký.
 *
 * Quyền nằm ở hàm ghi, không ở action — ca này canh rằng action chỉ chuyển xuống
 * những đoạn có mặt trong form (đoạn vắng mặt là "không đụng tới", không phải "xoá"),
 * làm mới đúng các buổi đã ghi, và không làm mới gì khi lưu hỏng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/events", () => ({}));
vi.mock("@/lib/event-form-text-server", () => ({ updateRegistrationFormText: vi.fn() }));

import { revalidatePath } from "next/cache";
import { updateRegistrationFormText } from "@/lib/event-form-text-server";
import { updateRegistrationFormTextAction } from "@/app/actions/events";

const E1 = "00000000-0000-4000-8000-0000000000e1";
const E2 = "00000000-0000-4000-8000-0000000000e2";

function panelForm(fields: Record<string, string>, applyToSeries = true) {
  const formData = new FormData();
  formData.set("event_id", E1);
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  if (applyToSeries) formData.set("apply_to_series", "1");
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lưu chữ trên form đăng ký", () => {
  it("chỉ chuyển đoạn có mặt; khoá lạ bị bỏ; lưu xong làm mới đúng các buổi đã ghi", async () => {
    vi.mocked(updateRegistrationFormText).mockResolvedValue({
      ok: true,
      message: "Đã lưu nội dung form cho cả 2 buổi trong chuỗi.",
      eventIds: [E1, E2]
    });

    const state = await updateRegistrationFormTextAction(
      { ok: false, message: null },
      panelForm({ event_description: "AGENDA – 27.09.2026 & 04.10.2026", payment_instruction: "", event_name: "Tên mới" })
    );

    expect(updateRegistrationFormText).toHaveBeenCalledWith({
      eventId: E1,
      texts: { event_description: "AGENDA – 27.09.2026 & 04.10.2026", payment_instruction: "" },
      applyToSeries: true
    });
    expect(state).toEqual({ ok: true, message: "Đã lưu nội dung form cho cả 2 buổi trong chuỗi." });
    expect(vi.mocked(revalidatePath).mock.calls.map((call) => call[0])).toEqual([
      `/events/${E1}`,
      `/events/${E1}/edit`,
      `/events/${E2}`,
      `/events/${E2}/edit`
    ]);
  });

  it("không tick áp dụng cho cả chuỗi: chuyển xuống false", async () => {
    vi.mocked(updateRegistrationFormText).mockResolvedValue({ ok: true, message: "Đã lưu nội dung form.", eventIds: [E1] });

    await updateRegistrationFormTextAction({ ok: false, message: null }, panelForm({ event_description: "Mới" }, false));

    expect(vi.mocked(updateRegistrationFormText).mock.calls[0][0].applyToSeries).toBe(false);
  });

  it("hàm ghi từ chối: nói nguyên lời từ chối, không làm mới trang", async () => {
    vi.mocked(updateRegistrationFormText).mockResolvedValue({
      ok: false,
      message: "Bạn không có quyền sửa nội dung form của sự kiện này.",
      eventIds: []
    });

    const state = await updateRegistrationFormTextAction({ ok: false, message: null }, panelForm({ event_description: "Mới" }));

    expect(state).toEqual({ ok: false, message: "Bạn không có quyền sửa nội dung form của sự kiện này." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lỗi bất ngờ: báo lỗi, không ném ra màn hình trắng", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(updateRegistrationFormText).mockRejectedValue(new Error("hỏng"));

    const state = await updateRegistrationFormTextAction({ ok: false, message: null }, panelForm({ event_description: "Mới" }));

    expect(state).toEqual({ ok: false, message: "Lỗi hệ thống. Thử lưu lại." });
  });
});
