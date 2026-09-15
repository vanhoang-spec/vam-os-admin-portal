/**
 * Action tạo/sửa sự kiện chuyển phần thiết lập các lần quét xuống hàm ghi.
 *
 * Ca quan trọng nhất: một form KHÔNG có phần thiết lập thì khoá `checkin_steps`
 * không được có mặt trong dữ liệu gửi xuống. Hàm ghi đọc "có khoá này" là "BTC vừa
 * lưu danh sách mới" — một mảng rỗng lọt xuống là lượt lưu bị từ chối, còn một
 * mặc định lọt xuống là các lần quét BTC đã đặt bị thay mất.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/event-form-text-server", () => ({ updateRegistrationFormText: vi.fn() }));
vi.mock("@/lib/events", () => ({
  addParticipation: vi.fn(),
  bulkAddEventParticipants: vi.fn(),
  cancelEvent: vi.fn(),
  createCheckinLinkForEvent: vi.fn(),
  createRegistrationLinkForEvent: vi.fn(),
  addSessionToSeries: vi.fn(),
  removeSessionFromSeries: vi.fn(),
  notifyScheduleChange: vi.fn(),
  updateSessionTime: vi.fn(),
  createEvent: vi.fn(),
  createEventSeries: vi.fn(),
  removeParticipation: vi.fn(),
  setRegistrationLinkActive: vi.fn(),
  updateEvent: vi.fn(),
  updateParticipation: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { createEvent, createEventSeries, updateEvent } from "@/lib/events";
import { createEventAction, updateEventAction } from "@/app/actions/events";

const initial = { ok: false, message: null };

function eventForm(options: { steps?: string[]; withSection?: boolean; repeats?: boolean } = {}) {
  const formData = new FormData();
  formData.set("id", "00000000-0000-4000-8000-0000000000e1");
  formData.set("event_name", "Ngày hội Mentor");
  formData.set("starts_at", "2026-10-04T08:00");
  formData.set("qr_checkin_enabled", "true");
  if (options.repeats) formData.set("recurrence_enabled", "true");
  if (options.withSection !== false) {
    formData.set("checkin_steps_present", "1");
    for (const step of options.steps ?? []) formData.append("checkin_steps", step);
  }
  return formData;
}

function inputOf(fn: typeof createEvent | typeof updateEvent | typeof createEventSeries) {
  return vi.mocked(fn).mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "a1", role: "core_team", status: "active" } as never);
  const ok = { ok: true, message: "Đã cập nhật sự kiện.", data: { id: "e1" } };
  vi.mocked(createEvent).mockResolvedValue(ok as never);
  vi.mocked(createEventSeries).mockResolvedValue(ok as never);
  vi.mocked(updateEvent).mockResolvedValue(ok as never);
});

describe("có phần thiết lập", () => {
  it("tạo sự kiện: gửi đúng các lần quét, đúng thứ tự", async () => {
    await createEventAction(initial, eventForm({ steps: ["entrance", "talkshow", "checkout"] }));
    expect(inputOf(createEvent).checkin_steps).toEqual(["entrance", "talkshow", "checkout"]);
  });

  it("tạo chuỗi lặp lại: mọi buổi nhận cùng các lần quét", async () => {
    await createEventAction(initial, eventForm({ steps: ["checkout"], repeats: true }));
    expect(inputOf(createEventSeries).checkin_steps).toEqual(["checkout"]);
  });

  it("sửa sự kiện: gửi đúng các lần quét", async () => {
    await updateEventAction(initial, eventForm({ steps: ["gift_counter", "checkout"] }));
    expect(inputOf(updateEvent).checkin_steps).toEqual(["gift_counter", "checkout"]);
  });

  it("có phần thiết lập mà không còn lần quét nào: gửi mảng rỗng để hàm ghi từ chối, không tự điền mặc định", async () => {
    await updateEventAction(initial, eventForm({ steps: [] }));
    expect(inputOf(updateEvent).checkin_steps).toEqual([]);
  });
});

describe("không có phần thiết lập", () => {
  it("sửa: khoá checkin_steps vắng mặt hẳn", async () => {
    await updateEventAction(initial, eventForm({ withSection: false }));
    expect(Object.prototype.hasOwnProperty.call(inputOf(updateEvent), "checkin_steps")).toBe(false);
  });

  it("tạo: khoá checkin_steps vắng mặt hẳn — hàm ghi dùng mặc định của nó", async () => {
    await createEventAction(initial, eventForm({ withSection: false }));
    expect(Object.prototype.hasOwnProperty.call(inputOf(createEvent), "checkin_steps")).toBe(false);
  });

  it("có ô lần quét lẻ mà không có ô đánh dấu: vẫn không gửi", async () => {
    const formData = eventForm({ withSection: false });
    formData.append("checkin_steps", "checkout");
    await updateEventAction(initial, formData);
    expect(Object.prototype.hasOwnProperty.call(inputOf(updateEvent), "checkin_steps")).toBe(false);
  });
});
