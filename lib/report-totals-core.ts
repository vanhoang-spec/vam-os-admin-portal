/**
 * Dòng tổng của các bảng báo cáo (BTC 09/10/2026: bảng nhiều dòng phải có dòng hoặc
 * cột tổng để người đọc khỏi tự cộng). Phần thuần, không I/O.
 */

/**
 * Cộng một cột số. Ô không phải số ("Chưa có recap", chữ lạ từ RPC) bỏ qua thay vì
 * làm cả dòng tổng thành NaN — một ô hỏng không được xoá mất con số của mọi ô khác.
 */
export function sumBy<T>(rows: readonly T[], pick: (row: T) => unknown): number {
  let total = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

/**
 * Tỷ lệ phần trăm làm tròn một chữ số thập phân — cùng cách RPC phân tích mùa tính
 * từng dòng (`round(100.0 * a / n, 1)`), để dòng tổng đọc cùng thang với các dòng
 * trên nó. Mẫu số 0 → null (không có gì để chia, không phải 0%).
 */
export function percentOneDecimal(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part * 1000) / whole) / 10;
}
