/**
 * Bảng đếm chéo dùng chung cho các trang báo cáo (phỏng vấn mentee, tuyển mentor).
 * Phần thuần, không I/O. Tách khỏi báo cáo mentee ngày 08/10/2026 khi có báo cáo thứ
 * hai — hai bản đếm riêng là hai cơ hội để một bản tính tỷ lệ khác bản kia.
 */

export type CrossTabOption = { value: string; label: string };
export type CrossTabColumn = { key: string; label: string; total: number };
export type CrossTabCell = { count: number; share: number };
export type CrossTabRow = { key: string; label: string; cells: CrossTabCell[]; total: number };
export type CrossTab = { columns: CrossTabColumn[]; rows: CrossTabRow[] };

export type CrossTabColumnSpec<T> = { key: string; label: string; filter: (row: T) => boolean };

export const NOT_DECLARED = "__none__";

/**
 * Đếm chéo: mỗi dòng là một giá trị (năm học, ngành…), mỗi cột là một nhóm.
 * `share` là tỷ lệ TRONG CỘT — "34% hồ sơ Đạt là năm 1" — để so cơ cấu giữa các
 * nhóm có cỡ khác nhau. `total` là tổng các cột.
 *
 * Giá trị lạ (không có trong danh sách lựa chọn) vẫn được đếm, hiện nguyên mã — bỏ
 * qua nó là làm tổng các dòng lệch với tổng hồ sơ. Giá trị rỗng → "Chưa khai", cuối.
 */
export function crossTab<T>(
  rows: readonly T[],
  columns: readonly CrossTabColumnSpec<T>[],
  categoryOf: (row: T) => string,
  options: readonly CrossTabOption[],
  order: "options" | "count" = "options"
): CrossTab {
  const labels = new Map<string, string>(options.map((o) => [o.value, o.label]));
  const counts = new Map<string, number[]>();
  const totals = columns.map(() => 0);
  for (const row of rows) {
    const raw = categoryOf(row);
    const key = raw ? raw : NOT_DECLARED;
    columns.forEach((col, i) => {
      if (!col.filter(row)) return;
      const line = counts.get(key) ?? columns.map(() => 0);
      line[i] += 1;
      counts.set(key, line);
      totals[i] += 1;
    });
  }
  const optionOrder = new Map<string, number>(options.map((o, i) => [o.value, i]));
  const rank = (key: string) => (key === NOT_DECLARED ? Number.MAX_SAFE_INTEGER : optionOrder.get(key) ?? options.length);
  const result: CrossTabRow[] = Array.from(counts.entries()).map(([key, line]) => ({
    key,
    label: key === NOT_DECLARED ? "Chưa khai" : labels.get(key) ?? key,
    cells: line.map((count, i) => ({ count, share: totals[i] ? count / totals[i] : 0 })),
    total: line.reduce((sum, n) => sum + n, 0)
  }));
  result.sort((a, b) => {
    if (order === "count" && b.total !== a.total) return b.total - a.total;
    const byRank = rank(a.key) - rank(b.key);
    return byRank !== 0 ? byRank : a.label.localeCompare(b.label, "vi");
  });
  return { columns: columns.map((c, i) => ({ key: c.key, label: c.label, total: totals[i] })), rows: result };
}

/** "34%" — làm tròn tới phần trăm. */
export function formatShare(value: number): string {
  return `${Math.round(value * 100)}%`;
}
