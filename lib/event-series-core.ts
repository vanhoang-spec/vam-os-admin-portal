/**
 * lib/event-series-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Buổi thứ mấy trong chuỗi: đọc theo THỜI GIAN, không theo lúc được tạo.
 *
 * Module thuần, không I/O.
 *
 * CHUYỆN ĐÃ XẢY RA THẬT (14/09/2026)
 * Chuỗi Mentor Orientation có buổi 20/09 là "Buổi 1". Ban tổ chức dời buổi đó sang
 * 04/10 qua form "Sửa sự kiện" — đường ghi này không đánh số lại — nên danh sách,
 * link đăng ký và file xuất vẫn gọi 04/10 là "Buổi 1", nằm sau "Buổi 2" ngày 27/09.
 * Hai buổi có nội dung khác nhau, nên người đăng ký đọc nhầm là chọn nhầm buổi.
 *
 * Số thứ tự buổi là thứ người đọc dùng để đối chiếu giữa danh sách trong CRM, ô
 * chọn buổi trên link đăng ký, file xuất và thư gửi hàng loạt. Nó phải chạy 1, 2, 3
 * theo đúng thứ tự các buổi diễn ra, sau MỌI đường ghi đổi được ngày giờ.
 */

/** Dòng đọc thẳng từ database — mọi cột đều có thể vắng hoặc sai kiểu. */
export type SeriesRow = {
  id?: unknown;
  starts_at?: unknown;
  series_index?: unknown;
  series_total?: unknown;
};

export type SeriesSlot = { id: string; series_index: number; series_total: number };

function timeOf(value: unknown): number {
  const ms = Date.parse(String(value ?? ""));
  // Buổi chưa có giờ (hay giờ không đọc được) xếp cuối, không chen vào giữa chuỗi.
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

function previousIndexOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

/**
 * Số thứ tự và tổng mà từng buổi PHẢI mang, xếp theo thứ tự diễn ra.
 *
 * Cùng giờ bắt đầu (hai lớp song song ở hai phòng) thì giữ nguyên thứ tự cũ, rồi
 * mới tới mã: không có luật phá hoà cố định thì mỗi lần lưu, hai buổi song song có
 * thể đổi số cho nhau dù không ai đổi gì.
 */
export function chronologicalSeriesSlots(rows: SeriesRow[]): SeriesSlot[] {
  const sorted = rows
    .map((row) => ({ row, id: String(row.id), time: timeOf(row.starts_at), previous: previousIndexOf(row.series_index) }))
    .sort((left, right) => {
      if (left.time !== right.time) return left.time < right.time ? -1 : 1;
      if (left.previous !== right.previous) return left.previous < right.previous ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  return sorted.map((entry, index) => ({ id: entry.id, series_index: index + 1, series_total: sorted.length }));
}

/**
 * Chỉ những buổi đang mang sai số thứ tự hoặc sai tổng.
 *
 * Đường ghi hẹp: một lần lưu không làm thứ tự thay đổi thì không phát ra lệnh ghi
 * nào — và nhật ký, dấu thời gian cập nhật của các buổi khác không bị động tới vô cớ.
 */
export function seriesRenumberWrites(rows: SeriesRow[]): SeriesSlot[] {
  const current = new Map(rows.map((row) => [String(row.id), row]));
  return chronologicalSeriesSlots(rows).filter((slot) => {
    const row = current.get(slot.id);
    return row?.series_index !== slot.series_index || row?.series_total !== slot.series_total;
  });
}
