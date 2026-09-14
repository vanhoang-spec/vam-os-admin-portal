/**
 * Lưu form "Sửa sự kiện" làm thứ tự các buổi trong chuỗi đổi thì câu báo trên màn
 * hình phải nói ra buổi này giờ là buổi mấy.
 *
 * `updateEvent` nói điều đó trong lời báo của nó; action từng thay mọi lời báo
 * thành công bằng một câu cố định, nên người vừa dời ngày không bao giờ thấy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateEvent = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
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
  updateEvent,
  updateParticipation: vi.fn()
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { updateEventAction } from "@/app/actions/events";

const ROOT = join(__dirname, "..");
const EVENT_ID = "00000000-0000-4000-8000-0000000000a1";

function form() {
  const data = new FormData();
  data.set("id", EVENT_ID);
  data.set("event_name", "Mentor Orientation");
  data.set("starts_at", "2026-10-04T08:00");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: "u1", role: "core_team", status: "active" } as never);
});

describe("câu báo sau khi lưu form Sửa sự kiện", () => {
  it("thứ tự buổi đổi: giữ câu quen thuộc và nói thêm buổi này giờ là buổi mấy", async () => {
    updateEvent.mockResolvedValue({
      ok: true,
      message: "Đã cập nhật sự kiện. Thứ tự các buổi trong chuỗi đã được sắp lại theo thời gian: buổi này giờ là Buổi 2/2."
    });

    const state = await updateEventAction({ ok: false, message: null }, form());

    expect(state).toEqual({
      ok: true,
      message:
        "Đã lưu thay đổi sự kiện thành công. Thứ tự các buổi trong chuỗi đã được sắp lại theo thời gian: buổi này giờ là Buổi 2/2."
    });
  });

  it("không có gì thêm để nói: đúng câu cũ, không thừa khoảng trắng", async () => {
    updateEvent.mockResolvedValue({ ok: true, message: "Đã cập nhật sự kiện." });

    const state = await updateEventAction({ ok: false, message: null }, form());

    expect(state).toEqual({ ok: true, message: "Đã lưu thay đổi sự kiện thành công." });
  });

  it("chưa sắp lại được thứ tự: nói ra, không nuốt đi", async () => {
    updateEvent.mockResolvedValue({
      ok: true,
      message: "Đã cập nhật sự kiện. Chưa sắp lại được thứ tự các buổi trong chuỗi — bấm lưu thêm một lần để hệ thống sắp lại."
    });

    const state = await updateEventAction({ ok: false, message: null }, form());

    expect(state.message).toContain("Chưa sắp lại được thứ tự các buổi");
  });

  it("lưu hỏng: trả thẳng lời báo lỗi", async () => {
    updateEvent.mockResolvedValue({ ok: false, message: "Thời điểm sự kiện không hợp lệ." });

    const state = await updateEventAction({ ok: false, message: null }, form());

    expect(state).toEqual({ ok: false, message: "Thời điểm sự kiện không hợp lệ." });
  });
});

describe("hai đầu dùng chung một câu mở đầu", () => {
  it("mọi lời báo thành công của updateEvent đều bắt đầu đúng bằng câu action tách ghi chú ra", () => {
    const events = readFileSync(join(ROOT, "lib", "events.ts"), "utf8");
    const start = events.indexOf("export async function updateEvent(");
    const end = events.indexOf("export async function", start + 1);
    const body = events.slice(start, end);

    const openings = Array.from(body.matchAll(/["`](Đã cập nhật sự kiện[^"`]*)["`]/g), (match) => match[1]);
    expect(openings.length).toBeGreaterThanOrEqual(3);
    for (const message of openings) {
      // Một câu mở đầu khác ("Đã cập nhật sự kiện, nhưng…") làm action nuốt mất ghi chú.
      expect(message.startsWith("Đã cập nhật sự kiện."), message).toBe(true);
    }

    expect(readFileSync(join(ROOT, "app", "actions", "events.ts"), "utf8")).toContain('const UPDATE_EVENT_OK = "Đã cập nhật sự kiện.";');
  });
});
