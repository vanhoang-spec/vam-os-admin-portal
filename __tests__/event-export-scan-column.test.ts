/**
 * Cột "Các lần quét" trong file CSV danh sách đăng ký.
 *
 * File này là thứ BTC dùng sau sự kiện để xét cộng điểm rèn luyện, phát quà, hay
 * báo cáo đối tác. Một cột lệch người (lượt quét của A in vào dòng của B) trông
 * vẫn như một bảng bình thường.
 */
import { describe, expect, it } from "vitest";
import { buildCheckinSteps } from "@/lib/event-checkin-steps";
import {
  EVENT_EXPORT_HEADERS,
  buildEventRegistrationCsv,
  eventRegistrationRow,
  type ExportScan,
  type ExportSession
} from "@/lib/event-export";

const STEPS = buildCheckinSteps(["entrance", "gift_counter", "checkout"]);
const SESSIONS = new Map<string, ExportSession>([
  ["e1", { id: "e1", seriesIndex: null, startsAt: "2026-09-20T01:00:00.000Z", steps: STEPS }]
]);
const COLUMN = EVENT_EXPORT_HEADERS.indexOf("Các lần quét");

function registration(id: string, overrides: Record<string, unknown> = {}) {
  return { id, event_id: "e1", full_name: `Người ${id}`, attendance_status: "checked_in", ...overrides };
}

describe("cột Các lần quét", () => {
  it("nằm ngay sau Thời điểm check-in", () => {
    expect(COLUMN).toBe(EVENT_EXPORT_HEADERS.indexOf("Thời điểm check-in") + 1);
  });

  it("liệt kê các lần quét theo thứ tự đã đi qua, nhãn theo thiết lập, giờ Việt Nam", () => {
    const scans = new Map<string, ExportScan[]>([
      [
        "r1",
        [
          { station: "checkout", scannedAt: "2026-09-20T04:32:00.000Z" },
          { station: "entrance", scannedAt: "2026-09-20T01:05:00.000Z" }
        ]
      ]
    ]);

    const row = eventRegistrationRow(registration("r1"), SESSIONS, scans);

    expect(row[COLUMN]).toBe("Quét lần 1 · Check in 08:05; Quét lần 3 · Check out 11:32");
  });

  it("chưa được quét lần nào: ô trống", () => {
    expect(eventRegistrationRow(registration("r1"), SESSIONS, new Map())[COLUMN]).toBe("");
    expect(eventRegistrationRow(registration("r1"), SESSIONS)[COLUMN]).toBe("");
  });

  it("quét lại cùng một lần quét chỉ ghi một lần, giữ giờ đầu tiên", () => {
    const scans = new Map<string, ExportScan[]>([
      [
        "r1",
        [
          { station: "gift_counter", scannedAt: "2026-09-20T03:00:00.000Z" },
          { station: "gift_counter", scannedAt: "2026-09-20T02:10:00.000Z" }
        ]
      ]
    ]);
    expect(eventRegistrationRow(registration("r1"), SESSIONS, scans)[COLUMN]).toBe("Quét lần 2 · Check quầy đổi quà 09:10");
  });

  it("lượt quét của người này không in vào dòng người khác", () => {
    const scans = new Map<string, ExportScan[]>([
      ["r2", [{ station: "checkout", scannedAt: "2026-09-20T04:00:00.000Z" }]]
    ]);
    const csv = buildEventRegistrationCsv([registration("r1"), registration("r2")], SESSIONS, scans);
    const [, first, second] = csv.split(String.fromCharCode(10));

    expect(first).not.toContain("Check out");
    expect(second).toContain("Quét lần 3 · Check out 11:00");
  });

  it("lượt quét ở trạm của máy quét cũ vẫn ra chữ, không ra mã", () => {
    const scans = new Map<string, ExportScan[]>([
      ["r1", [{ station: "booth_program", scannedAt: "2026-09-14T02:00:00.000Z" }]]
    ]);
    expect(eventRegistrationRow(registration("r1"), SESSIONS, scans)[COLUMN]).toBe("Booth chương trình 09:00");
  });
});
