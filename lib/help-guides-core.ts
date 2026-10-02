/**
 * Hướng dẫn sử dụng theo từng trang (biểu tượng cuốn sách cạnh menu chính).
 *
 * BTC 02/10/2026: mỗi module/sub-module trong VAM OS có hướng dẫn riêng, luôn theo
 * tính năng mới nhất. Nội dung là MÃ chứ không phải tài liệu rời: thêm trang mới
 * vào menu mà chưa viết hướng dẫn thì __tests__/help-guides.test.ts đỏ — hướng
 * dẫn không thể tụt lại sau tính năng mà không ai biết.
 *
 * Phần thuần, không I/O: kiểu dữ liệu + chọn hướng dẫn cho một đường dẫn.
 */

export type HelpGuide = {
  title: string;
  /** Trang này dùng để làm gì — 1–2 câu. */
  summary: string;
  /** Các bước dùng, theo đúng nhãn nút trên màn hình. */
  steps: string[];
  /** Ai dùng được, luật/giới hạn quan trọng. */
  notes?: string[];
  /** Ngày cập nhật nội dung gần nhất (DD/MM/YYYY). */
  updated: string;
};

/** Khớp theo đoạn đường dẫn: "/interviews" khớp "/interviews/lich" nhưng không khớp "/interviewsx". */
function covers(pathname: string, key: string): boolean {
  if (key === "/") return pathname === "/";
  return pathname === key || pathname.startsWith(`${key}/`);
}

/**
 * Hướng dẫn cho đường dẫn đang mở: khoá dài nhất bao được đường dẫn thắng —
 * "/interviews/mentee-offline/huong-dan" ra hướng dẫn của chính trang đó nếu có,
 * không thì của "/interviews/mentee-offline", rồi mới tới "/interviews".
 */
export function helpGuideFor(pathname: string, guides: Readonly<Record<string, HelpGuide>>): { key: string; guide: HelpGuide } | null {
  const path = (pathname.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  let best: string | null = null;
  for (const key of Object.keys(guides)) {
    if (covers(path, key) && (!best || key.length > best.length)) best = key;
  }
  return best ? { key: best, guide: guides[best] } : null;
}
