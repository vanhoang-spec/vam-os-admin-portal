/**
 * Biến các đoạn http(s):// trong chữ tự do thành link — một cửa cho mọi chỗ hiện chữ
 * người vận hành hoặc người nộp đơn tự gõ: ô CV ở trang mentor chọn mentee (Vòng 2),
 * địa điểm của ca trên trang chọn ca của mentee (link nhóm Zalo chiều 10/10).
 *
 * Chỉ http/https: một "javascript:..." vẫn chỉ là chữ. Không dùng regex có dấu gạch
 * chéo ngược — tách từ bằng cách duyệt từng ký tự.
 */
export type LinkPart = { kind: "text"; value: string } | { kind: "link"; value: string; href: string };

const WHITESPACE = new Set([" ", String.fromCharCode(9), String.fromCharCode(10), String.fromCharCode(13)]);

export function linkify(text: string): LinkPart[] {
  const words: string[] = [];
  let current = "";
  for (const ch of text) {
    if (WHITESPACE.has(ch)) {
      if (current) words.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) words.push(current);

  const parts: LinkPart[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length) parts.push({ kind: "text", value: buffer.join(" ") });
    buffer = [];
  };
  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.startsWith("https://") || lower.startsWith("http://")) {
      flush();
      parts.push({ kind: "link", value: word, href: word });
    } else {
      buffer.push(word);
    }
  }
  flush();
  return parts;
}
