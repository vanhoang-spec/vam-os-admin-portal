/**
 * Thứ tự dòng trong file CSV danh sách đăng ký (BTC 07/10/2026): buổi theo thứ
 * tự diễn ra, trong mỗi buổi đăng ký mới nhất trước — cùng thứ tự với trang sự
 * kiện. Trước đó database sắp theo event_id (UUID ngẫu nhiên), nên một chuỗi ba
 * buổi có thể in buổi 3 lên trước buổi 1.
 */
import { describe, expect, it } from "vitest";
import { orderRegistrationsForExport, type ExportSession } from "@/lib/event-export";

// id của buổi cố ý ngược thứ tự buổi: sắp theo id sẽ ra buổi 3 → 2 → 1.
const SESSIONS = new Map<string, ExportSession>([
  ["c-buoi-1", { id: "c-buoi-1", seriesIndex: 1, startsAt: "2026-10-03T01:00:00.000Z" }],
  ["b-buoi-2", { id: "b-buoi-2", seriesIndex: 2, startsAt: "2026-10-10T01:00:00.000Z" }],
  ["a-buoi-3", { id: "a-buoi-3", seriesIndex: 3, startsAt: "2026-10-17T01:00:00.000Z" }]
]);

const reg = (id: string, eventId: string, registeredAt: string | null) => ({ id, event_id: eventId, registered_at: registeredAt });
const ids = (rows: Array<Record<string, unknown>>) => rows.map((row) => row.id);

describe("orderRegistrationsForExport", () => {
  it("buổi theo số buổi, không theo id; trong buổi đăng ký mới nhất trước", () => {
    const rows = [
      reg("r3-old", "a-buoi-3", "2026-09-01T00:00:00Z"),
      reg("r1-old", "c-buoi-1", "2026-09-01T00:00:00Z"),
      reg("r2", "b-buoi-2", "2026-09-05T00:00:00Z"),
      reg("r1-new", "c-buoi-1", "2026-09-20T08:00:00+07:00"),
      reg("r3-new", "a-buoi-3", "2026-09-28T00:00:00Z")
    ];
    expect(ids(orderRegistrationsForExport(rows, SESSIONS))).toEqual(["r1-new", "r1-old", "r2", "r3-new", "r3-old"]);
  });

  it("không có số buổi thì theo giờ bắt đầu; dòng không rõ buổi và đăng ký không có giờ xuống cuối", () => {
    const sessions = new Map<string, ExportSession>([
      ["late", { id: "late", seriesIndex: null, startsAt: "2026-10-20T01:00:00.000Z" }],
      ["early", { id: "early", seriesIndex: null, startsAt: "2026-10-05T01:00:00.000Z" }]
    ]);
    const rows = [
      reg("x-unknown", "khong-co", "2026-10-01T00:00:00Z"),
      reg("late-1", "late", "2026-09-01T00:00:00Z"),
      reg("early-nodate", "early", null),
      reg("early-1", "early", "2026-09-02T00:00:00Z")
    ];
    expect(ids(orderRegistrationsForExport(rows, sessions))).toEqual(["early-1", "early-nodate", "late-1", "x-unknown"]);
  });
});
