/**
 * Action lưu các lần quét từ trang máy quét.
 *
 * Quyền nằm ở hàm ghi, không ở action — ca này canh rằng action chuyển đúng buổi,
 * đúng thứ tự các lần quét xuống, và không làm mới trang khi lưu hỏng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/event-supporters", () => ({ canScanEvent: vi.fn() }));
vi.mock("@/lib/event-checkin", () => ({ recordScan: vi.fn() }));
vi.mock("@/lib/event-checkin-steps-server", () => ({ updateEventCheckinSteps: vi.fn() }));

import { revalidatePath } from "next/cache";
import { updateEventCheckinSteps } from "@/lib/event-checkin-steps-server";
import { updateCheckinStepsAction } from "@/app/actions/event-scan";

const EVENT_ID = "00000000-0000-4000-8000-0000000000e1";

function panelForm(steps: string[]) {
  const formData = new FormData();
  formData.set("event_id", EVENT_ID);
  formData.set("checkin_steps_present", "1");
  for (const step of steps) formData.append("checkin_steps", step);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lưu các lần quét từ máy quét", () => {
  it("chuyển đúng buổi, đúng thứ tự; lưu xong làm mới máy quét, trang sự kiện, form sửa", async () => {
    vi.mocked(updateEventCheckinSteps).mockResolvedValue({ ok: true, message: "Đã lưu các lần quét." });

    const state = await updateCheckinStepsAction({ ok: false, message: null }, panelForm(["checkout", "entrance"]));

    expect(updateEventCheckinSteps).toHaveBeenCalledWith({ eventId: EVENT_ID, steps: ["checkout", "entrance"] });
    expect(state.ok).toBe(true);
    expect(state.message).toContain("tải lại trang");
    expect(vi.mocked(revalidatePath).mock.calls.map((call) => call[0])).toEqual([
      `/events/${EVENT_ID}`,
      `/events/${EVENT_ID}/scan`,
      `/events/${EVENT_ID}/edit`
    ]);
  });

  it("hàm ghi từ chối: nói nguyên lời từ chối, không làm mới trang", async () => {
    vi.mocked(updateEventCheckinSteps).mockResolvedValue({
      ok: false,
      message: "Bạn không có quyền thiết lập các lần quét của sự kiện này."
    });

    const state = await updateCheckinStepsAction({ ok: false, message: null }, panelForm(["checkout"]));

    expect(state).toEqual({ ok: false, message: "Bạn không có quyền thiết lập các lần quét của sự kiện này." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("lỗi bất ngờ: báo lỗi, không ném ra màn hình trắng", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(updateEventCheckinSteps).mockRejectedValue(new Error("hỏng"));

    const state = await updateCheckinStepsAction({ ok: false, message: null }, panelForm(["checkout"]));

    expect(state).toEqual({ ok: false, message: "Lỗi hệ thống. Thử lưu lại." });
  });
});
