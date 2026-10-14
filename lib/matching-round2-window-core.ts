/**
 * Danh sách 15 hồ sơ của từng mentor ở Vòng 2 (BTC 14/10/2026). Phần thuần, không I/O.
 *
 * Nhóm đông có tới 175 mentee; đưa cả danh sách cho mỗi mentor thì không ai đọc hết, và vài hồ sơ
 * đầu trang luôn được chọn trước. BTC chốt: mỗi mentor thấy tối đa 15 bạn, chia sao cho mỗi mentee
 * xuất hiện ở số mentor gần như bằng nhau.
 *
 * Cách chia — "vòng tròn":
 *   - Mentee của cụm chọn xếp thành một vòng theo thứ tự ngẫu nhiên CỐ ĐỊNH (băm theo mùa + cụm +
 *     mã đơn), gồm cả bạn đã có mentor: vị trí trên vòng không bao giờ dịch khi có người được chọn.
 *   - Mentor thứ i của cụm (xếp theo lúc tạo link) xuất phát ở vị trí frac((i+1)·φ)·N. Dãy này rải
 *     đều quanh vòng với MỌI số mentor, nên gửi thêm link đợt sau không làm dịch điểm xuất phát của
 *     mentor đã có (chia đều theo i·N/M thì đều hơn một chút lúc mở, nhưng mỗi link mới làm xáo danh
 *     sách của cả cụm).
 *   - Danh sách của mentor = 15 bạn CÒN TRỐNG đầu tiên kể từ điểm xuất phát. Một bạn được chọn thì
 *     biến khỏi danh sách, bạn kế tiếp trên vòng vào thay; 14 hồ sơ kia giữ nguyên. Còn dưới 15 bạn
 *     trống thì mentor thấy hết.
 *
 * Đo trên số thật 14/10 (nhóm 4: 124 mentor, 175 mentee): lúc mở mỗi bạn hiện ở 10–12 mentor; sau
 * khi chọn một nửa, 11–28 — không bạn nào bị thấy ít hơn lúc mở. Giới hạn 15 chỉ ở phần hiển thị;
 * database vẫn phân xử lượt chọn như cũ.
 */
import { stableOrderKey } from "@/lib/matching-round2-link-core";

export const ROUND2_WINDOW_SIZE = 15;
const PHI = (Math.sqrt(5) - 1) / 2;

/** Vòng của cụm: mã đơn mentee theo thứ tự băm cố định (trùng khoá băm thì theo mã). */
export function round2Circle(seasonId: string, groups: readonly number[], applicationIds: readonly string[]): string[] {
  const seed = `${seasonId}|vong2|${[...groups].sort((a, b) => a - b).join("+")}`;
  return Array.from(new Set(applicationIds)).sort((x, y) => stableOrderKey(seed, x) - stableOrderKey(seed, y) || (x < y ? -1 : x > y ? 1 : 0));
}

/** Thứ tự của mentor trong cụm: theo lúc tạo link, trùng thì theo mã link. -1 = không có trong danh sách. */
export function round2MentorIndex(links: ReadonlyArray<{ id: string; createdAt: string }>, linkId: string): number {
  const ordered = [...links].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return ordered.findIndex((l) => l.id === linkId);
}

/** Điểm xuất phát trên vòng N vị trí của mentor thứ `index`. */
export function round2WindowStart(index: number, n: number): number {
  if (n <= 0) return 0;
  const i = Math.max(0, index);
  return Math.min(n - 1, Math.floor((((i + 1) * PHI) % 1) * n));
}

/** 15 (hoặc `size`) bạn còn trống đầu tiên kể từ điểm xuất phát, theo thứ tự trên vòng. */
export function round2Window(circle: readonly string[], available: ReadonlySet<string>, start: number, size = ROUND2_WINDOW_SIZE): string[] {
  const out: string[] = [];
  const n = circle.length;
  for (let step = 0; step < n && out.length < size; step += 1) {
    const id = circle[(start + step) % n];
    if (available.has(id)) out.push(id);
  }
  return out;
}
