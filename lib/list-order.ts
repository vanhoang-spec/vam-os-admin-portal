/**
 * Thứ tự "mới nhất trước" cho các danh sách bản ghi trong CRM — một cửa.
 *
 * BTC 07/10/2026: mọi danh sách là hồ sơ/nhật ký/lịch sử phải xếp mới nhất lên
 * đầu, đồng bộ cả sản phẩm. Trước đó mỗi trang tự viết một phép so, và nhiều
 * trang không so gì cả: `readAllPages` phân trang theo `id` là UUID ngẫu nhiên,
 * nên trang nào quên xếp lại sẽ hiện theo một thứ tự vô nghĩa nhưng ổn định —
 * nhìn qua tưởng "đã xếp theo gì đó".
 *
 * Vì sao so bằng Date.parse chứ không so chuỗi: mốc thời gian đến từ nhiều
 * nguồn (timestamptz của PostgREST "…+00:00", chuỗi ".000Z" do JS ghi, cột DATE
 * "2026-10-05"). So chuỗi chỉ đúng khi mọi dòng cùng một dạng.
 *
 * Dòng thiếu mốc luôn xuống cuối — một hồ sơ chưa có ngày nộp không được chen
 * lên trên hồ sơ vừa nộp hôm nay.
 */

export type Instant = string | null | undefined;

export function parseInstant(value: Instant): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** So hai mốc theo chiều mới nhất trước; mốc vắng hoặc hỏng xuống cuối. */
export function compareNewest(a: Instant, b: Instant): number {
  const x = parseInstant(a);
  const y = parseInstant(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x;
}

/**
 * Bản sao đã xếp mới nhất trước. Các mốc thử lần lượt: mốc đầu hoà (hoặc cùng
 * vắng) thì so mốc sau. Hoà hết thì `id` tăng dần — đúng thứ tự đọc phân trang,
 * nên thứ tự không nhảy giữa hai lần tải trang và dòng không có mốc nào giữ
 * nguyên chỗ như trước khi có hàm này.
 */
export function newestFirst<T extends object>(rows: readonly T[], ...instants: Array<(row: T) => Instant>): T[] {
  return [...rows].sort((a, b) => {
    for (const pick of instants) {
      const order = compareNewest(pick(a), pick(b));
      if (order !== 0) return order;
    }
    const x = idOf(a);
    const y = idOf(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/** Mốc `created_at` của một dòng bất kỳ — nhiều kiểu dòng có cột này mà kiểu TS không khai. */
export function createdAtOf(row: object): Instant {
  const value = (row as { created_at?: unknown }).created_at;
  return typeof value === "string" ? value : null;
}

function idOf(row: object): string {
  return String((row as { id?: unknown }).id ?? "");
}

/** Họ tên theo thứ tự chữ cái tiếng Việt — cho danh sách người (không phải bản ghi theo thời gian). */
export function byVietnameseName<T extends object>(rows: readonly T[], name: (row: T) => string | null | undefined): T[] {
  return [...rows].sort((a, b) => {
    const x = String(name(a) ?? "").trim();
    const y = String(name(b) ?? "").trim();
    // Tên trống xuống cuối, đừng đứng đầu danh sách như một dòng "A".
    if (!x !== !y) return x ? -1 : 1;
    return x.localeCompare(y, "vi") || idOf(a).localeCompare(idOf(b));
  });
}
