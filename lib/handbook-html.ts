import sanitizeHtml from "sanitize-html";

/**
 * Lọc HTML của Handbook phỏng vấn (chuyển từ .docx bằng mammoth).
 *
 * Chỉ giữ thẻ chữ và bảng — đúng những gì một tài liệu hướng dẫn cần. KHÔNG có
 * `img`: ảnh trong file Word bị bỏ ngay từ lúc chuyển đổi, và lọc lại ở đây để
 * không đường nào biến một file tải lên thành ảnh phục vụ ra ngoài (phân loại
 * cảnh báo sharp, __tests__/image-optimizer-attack-surface.test.ts). Liên kết
 * chỉ http/https/mailto — `javascript:` hay `data:` bị bỏ.
 *
 * Lọc lúc LƯU và lọc lại lúc HIỂN THỊ: dòng trong database không phải lúc nào
 * cũng đi qua đúng đường lưu của ứng dụng.
 */
export const HANDBOOK_ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "blockquote",
  "strong", "b", "em", "i", "u", "s", "sub", "sup",
  "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "a"
];

export function sanitizeHandbookHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: HANDBOOK_ALLOWED_TAGS,
    allowedAttributes: { a: ["href", "target", "rel"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" })
    }
  }).trim();
}
