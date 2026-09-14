/**
 * Buổi thứ mấy trong chuỗi đọc theo thời gian — dựng lại đúng dữ liệu Mentor
 * Orientation trên production ngày 14/09/2026.
 */
import { describe, expect, it } from "vitest";
import { chronologicalSeriesSlots, seriesRenumberWrites } from "@/lib/event-series-core";

/** Đúng hai dòng đang có trên production: buổi 04/10 mang số 1, buổi 27/09 mang số 2. */
const MENTOR_ORIENTATION = [
  { id: "18b9e27d", starts_at: "2026-10-04T01:00:00+00:00", series_index: 1, series_total: 2 },
  { id: "0b46f3e8", starts_at: "2026-09-27T01:00:00+00:00", series_index: 2, series_total: 2 }
];

describe("chronologicalSeriesSlots", () => {
  it("27/09 thành Buổi 1, 04/10 thành Buổi 2", () => {
    expect(chronologicalSeriesSlots(MENTOR_ORIENTATION)).toEqual([
      { id: "0b46f3e8", series_index: 1, series_total: 2 },
      { id: "18b9e27d", series_index: 2, series_total: 2 }
    ]);
  });

  it("so theo thời điểm thật, không theo chuỗi ký tự — hai cách viết cùng múi giờ khác nhau vẫn đúng thứ tự", () => {
    const slots = chronologicalSeriesSlots([
      // 08:00 giờ Việt Nam ngày 27/09, viết kèm độ lệch +07:00.
      { id: "b", starts_at: "2026-09-27T08:00:00+07:00", series_index: 1 },
      // 07:30Z ngày 26/09 — đứng sau khi so chuỗi ký tự, nhưng diễn ra TRƯỚC.
      { id: "a", starts_at: "2026-09-26T07:30:00.000Z", series_index: 2 }
    ]);
    expect(slots.map((slot) => slot.id)).toEqual(["a", "b"]);
  });

  it("cùng giờ thì giữ thứ tự cũ, rồi mới theo mã — không đổi số cho nhau khi không ai đổi gì", () => {
    const rows = [
      { id: "phong-b", starts_at: "2026-09-27T01:00:00.000Z", series_index: 1 },
      { id: "phong-a", starts_at: "2026-09-27T01:00:00.000Z", series_index: 2 }
    ];
    expect(chronologicalSeriesSlots(rows).map((slot) => slot.id)).toEqual(["phong-b", "phong-a"]);
    // Chạy lại trên kết quả của chính nó thì không đổi gì.
    const again = chronologicalSeriesSlots(chronologicalSeriesSlots(rows).map((slot) => ({ ...slot, starts_at: "2026-09-27T01:00:00.000Z" })));
    expect(again.map((slot) => slot.id)).toEqual(["phong-b", "phong-a"]);

    expect(
      chronologicalSeriesSlots([
        { id: "z", starts_at: "2026-09-27T01:00:00.000Z" },
        { id: "a", starts_at: "2026-09-27T01:00:00.000Z" }
      ]).map((slot) => slot.id)
    ).toEqual(["a", "z"]);
  });

  it("buổi chưa có giờ hoặc giờ hỏng xếp cuối", () => {
    const slots = chronologicalSeriesSlots([
      { id: "khong-gio", starts_at: null, series_index: 1 },
      { id: "gio-hong", starts_at: "không phải ngày", series_index: 2 },
      { id: "co-gio", starts_at: "2026-09-27T01:00:00.000Z", series_index: 3 }
    ]);
    expect(slots.map((slot) => slot.id)).toEqual(["co-gio", "khong-gio", "gio-hong"]);
    expect(slots.map((slot) => slot.series_total)).toEqual([3, 3, 3]);
  });

  it("chuỗi rỗng không ra số nào", () => {
    expect(chronologicalSeriesSlots([])).toEqual([]);
  });
});

describe("seriesRenumberWrites", () => {
  it("chỉ ghi những buổi đang mang sai số", () => {
    expect(seriesRenumberWrites(MENTOR_ORIENTATION)).toEqual([
      { id: "0b46f3e8", series_index: 1, series_total: 2 },
      { id: "18b9e27d", series_index: 2, series_total: 2 }
    ]);
  });

  it("chuỗi đã đúng thứ tự thì không ghi gì", () => {
    expect(
      seriesRenumberWrites([
        { id: "a", starts_at: "2026-09-19T10:00:00.000Z", series_index: 1, series_total: 2 },
        { id: "b", starts_at: "2026-09-28T10:00:00.000Z", series_index: 2, series_total: 2 }
      ])
    ).toEqual([]);
  });

  it("đúng số nhưng sai tổng thì vẫn ghi, và luôn ghi số kèm tổng", () => {
    expect(
      seriesRenumberWrites([
        { id: "a", starts_at: "2026-09-19T10:00:00.000Z", series_index: 1, series_total: 3 },
        { id: "b", starts_at: "2026-09-28T10:00:00.000Z", series_index: 2, series_total: 2 }
      ])
    ).toEqual([{ id: "a", series_index: 1, series_total: 2 }]);
  });

  it("số lưu dạng chuỗi không tính là đúng — ghi lại cho đúng kiểu", () => {
    expect(seriesRenumberWrites([{ id: "a", starts_at: "2026-09-19T10:00:00.000Z", series_index: "1", series_total: 1 }])).toEqual([
      { id: "a", series_index: 1, series_total: 1 }
    ]);
  });
});
