/**
 * lib/mail-soan-thao-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thư có định dạng (VAM00038): lọc HTML người soạn gửi lên, rút bản chữ thuần, kiểm một mẫu thiết kế,
 * và dựng thân thư HTML cuối cùng cho ứng dụng thư.
 *
 * Vì sao lọc ở MÁY CHỦ, bằng danh sách cho phép: trình soạn chạy trong trình duyệt, nên HTML tới server
 * action là thứ người gửi tự đặt được, không phải thứ trình soạn sinh ra. Một thẻ <script>, một
 * `onerror=`, một `href="javascript:…"` lọt vào mẫu là đi thẳng tới hàng trăm hộp thư. Nên chỉ những
 * thẻ, thuộc tính và thuộc tính CSS liệt kê dưới đây sống sót; mọi thứ khác bị bỏ, kể cả thứ vô hại mà
 * danh sách chưa nghĩ tới. Danh sách hẹp hơn cần thì chỉ làm mất một kiểu định dạng; danh sách rộng hơn
 * cần thì có thể là lỗ hổng.
 *
 * Thứ tự ở lúc gửi: HTML đã lọc lúc lưu → lọc lại → điền ô (giá trị được escape, xem
 * `renderTemplateHtml`) → `dungThanThuHtml` lọc lần cuối, gắn style inline và khung bảng 600px.
 *
 * Module thuần (chỉ phụ thuộc sanitize-html), không I/O. KHÔNG import từ component trình duyệt:
 * sanitize-html kéo theo postcss, nặng và không cần ở đó — xem trước dùng iframe sandbox.
 */
import sanitizeHtml from "sanitize-html";
import { SIGNATURE_HTML } from "@/lib/email-core";
import { kepBeRongAnh } from "@/lib/mail-anh-core";
import {
  MAX_BODY_LENGTH,
  TEMPLATE_SPECS,
  extractPlaceholders,
  validateTemplate,
  type TemplateKind
} from "@/lib/email-templates-core";

/** HTML đã lọc tối đa bao nhiêu ký tự (khớp ràng buộc `email_templates_body_html_length_check` / 200k). */
export const MAX_BODY_HTML_LENGTH = 150_000;
/** HTML thô nhận vào tối đa bao nhiêu; quá thì không lọc luôn, khỏi tốn CPU cho một yêu cầu bất thường. */
const MAX_RAW_HTML_LENGTH = 400_000;

/** Báo khi database chưa áp migration 20261120090000 mà người dùng lưu / chép một mẫu thiết kế. */
export const VI_CHUA_AP_MIGRATION_THIET_KE =
  "Cơ sở dữ liệu chưa cập nhật cho chế độ thiết kế thư (migration 20261120090000). Thư chữ thuần vẫn soạn và gửi được; báo quản trị kỹ thuật áp migration.";

/** Chữ thuần thay cho thư chỉ có ảnh, ở phần text/plain. */
export const CHU_THAY_THU_CHI_CO_ANH = "Thư này có hình ảnh. Vui lòng mở thư ở chế độ hiển thị HTML để xem.";

const TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "span", "a",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "hr", "img", "div",
  "table", "colgroup", "col", "thead", "tbody", "tr", "td", "th"
];

/** Thuộc tính dữ liệu trình soạn cần để đọc lại một mẫu đã lưu (căn ảnh, khung, màu ô, viền ô). */
const EDITOR_DATA_ATTRS: Record<string, string[]> = {
  img: ["data-align"],
  div: ["data-vam-anh"],
  table: ["data-vam-khung"],
  td: ["data-mau-nen", "data-vien"],
  th: ["data-mau-nen", "data-vien"]
};

const BASE_ATTRS: Record<string, string[]> = {
  "*": ["style"],
  a: ["href", "target", "rel", "title"],
  img: ["src", "alt", "width", "height"],
  table: ["width", "cellpadding", "cellspacing", "border", "role", "align", "bgcolor"],
  td: ["colspan", "rowspan", "width", "bgcolor", "align", "valign"],
  th: ["colspan", "rowspan", "width", "bgcolor", "align", "valign"],
  col: ["width", "span"],
  p: ["align"],
  div: ["align"]
};

function mergeAttrs(...maps: Array<Record<string, string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const map of maps) {
    for (const [tag, list] of Object.entries(map)) out[tag] = [...(out[tag] ?? []), ...list];
  }
  return out;
}

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|transparent)$/i;
const LEN = /^(0|\d{1,4}(\.\d{1,3})?(px|pt|em|rem|%))$/i;
const BOX = /^((0|auto|\d{1,3}(\.\d{1,2})?(px|pt|em|%))\s*){1,4}$/i;
const BORDER = /^(none|0|\d{1,2}px\s+(solid|dashed|dotted)\s+(#[0-9a-f]{3,8}|rgba?\([\d\s,.]+\)))$/i;

const STYLES: sanitizeHtml.IOptions["allowedStyles"] = {
  "*": {
    color: [COLOR],
    "background-color": [COLOR],
    "font-size": [LEN],
    "font-family": [/^[a-z0-9 ,'-]{1,120}$/i],
    "font-weight": [/^(bold|normal|[1-9]00)$/i],
    "font-style": [/^(italic|normal)$/i],
    "text-decoration": [/^(none|underline|line-through)(\s+(underline|line-through))?$/i],
    "text-align": [/^(left|right|center|justify)$/i],
    "vertical-align": [/^(top|middle|bottom)$/i],
    "line-height": [/^(normal|\d(\.\d{1,2})?|\d{1,3}(px|%))$/i],
    width: [LEN, /^auto$/i],
    "min-width": [LEN],
    "max-width": [LEN],
    height: [LEN, /^auto$/i],
    margin: [BOX],
    "margin-top": [LEN, /^auto$/i],
    "margin-bottom": [LEN, /^auto$/i],
    "margin-left": [LEN, /^auto$/i],
    "margin-right": [LEN, /^auto$/i],
    padding: [BOX],
    "padding-left": [LEN],
    "padding-right": [LEN],
    "padding-top": [LEN],
    "padding-bottom": [LEN],
    border: [BORDER],
    "border-top": [BORDER],
    "border-bottom": [BORDER],
    "border-left": [BORDER],
    "border-right": [BORDER],
    "border-radius": [LEN],
    "border-collapse": [/^(collapse|separate)$/i],
    display: [/^(block|inline-block|inline)$/i],
    outline: [/^none$/i]
  }
};

/** Liên kết chỉ được mở http(s) hoặc mailto, và phải là địa chỉ TUYỆT ĐỐI. */
const SAFE_HREF = /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i;
/** Ảnh chỉ tải qua https: ảnh http bị Gmail chặn và để lộ việc mở thư qua kênh không mã hoá. */
const SAFE_SRC = /^https:\/\/[^\s]+$/i;

/**
 * Luật chung cho cả hai lượt lọc. Dù sanitize-html đã chặn `javascript:` theo `allowedSchemes`, nó vẫn
 * cho qua đường dẫn TƯƠNG ĐỐI (không có scheme) — `href="{{ma_thanh_vien}}"` rồi điền giá trị
 * "javascript:…" từ một đơn đăng ký là đường vòng. Nên href/src phải bắt đầu bằng scheme an toàn ngay
 * trong mẫu, và ô điền chỉ được đứng SAU phần đó.
 */
function aTransform(tagName: string, attribs: sanitizeHtml.Attributes) {
  const next: sanitizeHtml.Attributes = { ...attribs };
  const href = String(next.href ?? "").trim();
  if (href && SAFE_HREF.test(href)) {
    next.href = href;
    next.target = "_blank";
    next.rel = "noopener noreferrer";
  } else {
    delete next.href;
    delete next.target;
    delete next.rel;
  }
  return { tagName, attribs: next };
}

function imgAttribs(attribs: sanitizeHtml.Attributes): sanitizeHtml.Attributes {
  const next: sanitizeHtml.Attributes = { ...attribs };
  const src = String(next.src ?? "").trim();
  if (src && SAFE_SRC.test(src)) next.src = src;
  else delete next.src;
  if (next.width !== undefined) next.width = String(kepBeRongAnh(next.width));
  delete next.height;
  // Bề rộng trong style phải khớp thuộc tính `width` đã kẹp: ảnh dán từ nơi khác mang "width:900px"
  // thì Gmail đọc style, Outlook đọc thuộc tính — hai ứng dụng vẽ hai cỡ khác nhau.
  const style = String(next.style ?? "")
    .split(";")
    .map((rule) => rule.trim())
    .filter((rule) => rule && !/^(width|height)\s*:/i.test(rule));
  if (next.width !== undefined) style.push(`width:${next.width}px`);
  if (style.length) next.style = style.join(";");
  else delete next.style;
  next.alt = String(next.alt ?? "").slice(0, 200);
  const align = String(next["data-align"] ?? "");
  if (next["data-align"] !== undefined && !/^(left|center|right)$/.test(align)) delete next["data-align"];
  return next;
}

const SHARED: sanitizeHtml.IOptions = {
  allowedTags: TAGS,
  allowedStyles: STYLES,
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  allowProtocolRelative: false,
  allowedClasses: {},
  // Bỏ nguyên khối, kể cả chữ bên trong: script, style, textarea… không có chỗ trong thân thư.
  disallowedTagsMode: "discard",
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src
};

/**
 * Lọc HTML người soạn gửi lên, để LƯU. Giữ các thuộc tính `data-*` trình soạn cần để mở lại mẫu
 * (căn ảnh, khung nội dung, màu nền và viền ô); lượt lọc cuối lúc gửi sẽ bỏ chúng.
 */
export function locHtmlThu(html: string): string {
  const raw = String(html ?? "");
  if (!raw.trim() || raw.length > MAX_RAW_HTML_LENGTH) return "";
  return sanitizeHtml(raw, {
    ...SHARED,
    allowedAttributes: mergeAttrs(BASE_ATTRS, EDITOR_DATA_ATTRS),
    transformTags: {
      a: aTransform,
      img: (tagName, attribs) => ({ tagName, attribs: imgAttribs(attribs) })
    }
  }).trim();
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
      // Bỏ ký tự điều khiển (trừ xuống dòng / tab): chúng không có nghĩa trong thư chữ thuần.
      if (n < 32 && n !== 9 && n !== 10) return "";
      return String.fromCodePoint(n);
    }
    return ENTITY[code.toLowerCase()] ?? whole;
  });
}

/**
 * Rút bản chữ thuần từ HTML ĐÃ LỌC: phần text/plain của thư (ứng dụng thư chỉ đọc chữ, bộ lọc thư rác
 * so hai phần) và là chỗ mọi phép kiểm cũ trên `body` tiếp tục đọc. Liên kết giữ địa chỉ trong ngoặc.
 *
 * Dùng regex được vì đầu vào là đầu ra của sanitize-html: thẻ đã đóng mở chuẩn, thuộc tính trong nháy kép.
 */
export function htmlSangChu(html: string): string {
  const out = String(html ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, " ")
    .replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_whole, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      const url = decodeEntities(href);
      if (!label) return url;
      return decodeEntities(label) === url || url.startsWith("mailto:") ? label : `${label} (${href})`;
    })
    .replace(/<img\b[^>]*?alt="([^"]+)"[^>]*>/gi, (_whole, alt: string) => `[${alt}]`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, "  ")
    .replace(/<\/(tr)>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n----------\n")
    .replace(/<\/(p|h1|h2|h3|div|blockquote|table|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(out)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type RichTemplateValidation =
  | { ok: true; name: string; subject: string; body: string; bodyHtml: string; warnings: string[] }
  | { ok: false; message: string };

/**
 * Kiểm một mẫu soạn bằng trình thiết kế. Trả về HTML ĐÃ LỌC (thứ được lưu) và bản chữ thuần rút từ nó.
 *
 * Tên, tiêu đề, ô lạ, cảnh báo ô chưa dùng: đi qua đúng `validateTemplate` của mẫu chữ thuần, trên bản
 * chữ — một cửa cho một việc. Dấu < > người soạn gõ như chữ (vd "điểm < 5") được đổi sang ‹ › ở bản chữ
 * vì `validateTemplate` coi chúng là thẻ HTML; ở bản HTML chúng vẫn là &lt; &gt; nguyên vẹn.
 */
export function kiemMauThietKe(input: {
  kind: TemplateKind;
  name?: unknown;
  subject?: unknown;
  bodyHtml?: unknown;
}): RichTemplateValidation {
  const spec = TEMPLATE_SPECS[input.kind];
  if (!spec) return { ok: false, message: "Loại thư không hợp lệ." };

  const raw = String(input.bodyHtml ?? "");
  if (raw.length > MAX_RAW_HTML_LENGTH) {
    return { ok: false, message: "Nội dung thiết kế quá lớn. Vui lòng bớt bảng hoặc khung nội dung." };
  }
  const bodyHtml = locHtmlThu(raw);
  if (bodyHtml.length > MAX_BODY_HTML_LENGTH) {
    return { ok: false, message: "Nội dung thiết kế quá lớn. Vui lòng bớt bảng hoặc khung nội dung." };
  }

  const text = htmlSangChu(bodyHtml).replace(/</g, "‹").replace(/>/g, "›");
  const hasImage = /<img\b/i.test(bodyHtml);
  if (!text && !hasImage) return { ok: false, message: "Vui lòng nhập nội dung thư." };
  if (text.length > MAX_BODY_LENGTH) {
    return { ok: false, message: `Phần chữ của thư không được dài quá ${MAX_BODY_LENGTH} ký tự.` };
  }

  // Một ô điền bị định dạng cắt ngang ("{{ten_<strong>nguoi</strong>_nhan}}") đọc ra chữ thì vẫn đủ,
  // nhưng trong HTML không còn khớp mẫu ô, nên lúc gửi nó đi nguyên dạng ngoặc nhọn. Chặn ở đây.
  const countTokens = (value: string) => (value.match(/\{\{\s*[a-z0-9_]{1,40}\s*\}\}/g) ?? []).length;
  if (countTokens(text) > countTokens(bodyHtml)) {
    return {
      ok: false,
      message:
        "Có ô điền bị định dạng cắt ngang (ví dụ in đậm một nửa ô). Xoá ô đó rồi chèn lại bằng nút “Chèn thông tin”."
    };
  }

  const checked = validateTemplate({
    kind: input.kind,
    name: input.name,
    subject: input.subject,
    body: text || CHU_THAY_THU_CHI_CO_ANH
  });
  if (!checked.ok) return checked;

  // Ô nằm trong thuộc tính (href) không hiện trong chữ khi liên kết có nhãn — kiểm trên chính HTML.
  const known = new Set(spec.placeholders.map((row) => row.key));
  const unknown = extractPlaceholders(bodyHtml).filter((key) => !known.has(key));
  if (unknown.length) {
    return {
      ok: false,
      message: `Thư đang dùng ô không có dữ liệu: ${unknown.map((key) => `{{${key}}}`).join(", ")}. Vui lòng xoá hoặc thay bằng ô hợp lệ.`
    };
  }

  return { ok: true, name: checked.name, subject: checked.subject, body: checked.body, bodyHtml, warnings: checked.warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// Thân thư cuối cùng
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_MAC_DINH: Record<string, string> = {
  p: "margin:0 0 12px",
  h1: "margin:0 0 12px;font-size:26px;line-height:34px;font-weight:bold",
  h2: "margin:0 0 12px;font-size:22px;line-height:30px;font-weight:bold",
  h3: "margin:0 0 10px;font-size:18px;line-height:26px;font-weight:bold",
  ul: "margin:0 0 12px;padding-left:24px",
  ol: "margin:0 0 12px;padding-left:24px",
  li: "margin:0 0 4px",
  blockquote: "margin:0 0 12px;padding:8px 16px;border-left:4px solid #cfd8d3",
  hr: "border:0;border-top:1px solid #dfe7e3;margin:16px 0",
  a: "color:#16834c;text-decoration:underline",
  img: "border:0;outline:none;text-decoration:none;max-width:100%;height:auto"
};

/** Style mặc định đứng TRƯỚC style người soạn: trong cùng một thuộc tính style, khai báo sau thắng. */
function withDefault(tag: string, style: string | undefined): string {
  const base = STYLE_MAC_DINH[tag] ?? "";
  const own = String(style ?? "").trim();
  return [base, own].filter(Boolean).join(";");
}

/** Màu nền của ô, dạng #rrggbb cho thuộc tính `bgcolor` (Outlook không hiểu rgb()). */
function bgColorOf(style: string | undefined): string | null {
  const text = String(style ?? "");
  const hex = /background-color\s*:\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/i.exec(text);
  if (hex) return hex[1];
  const rgb = /background-color\s*:\s*rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(text);
  if (!rgb) return null;
  return `#${rgb
    .slice(1, 4)
    .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Lượt lọc cuối, sau khi đã điền ô: bỏ `data-*`, gắn style inline mặc định cho từng thẻ (Gmail bỏ khối
 * <style>, nên định dạng phải nằm inline), và gắn thuộc tính kiểu cũ mà Outlook bản cài đặt còn đọc:
 * `width` của ảnh, `bgcolor` của ô, `cellpadding/cellspacing/border` của bảng.
 */
function emailify(html: string): string {
  const simple = (tag: string) => (tagName: string, attribs: sanitizeHtml.Attributes) => ({
    tagName,
    attribs: { ...attribs, style: withDefault(tag, attribs.style) }
  });

  return sanitizeHtml(html, {
    ...SHARED,
    allowedAttributes: BASE_ATTRS,
    transformTags: {
      p: simple("p"),
      h1: simple("h1"),
      h2: simple("h2"),
      h3: simple("h3"),
      ul: simple("ul"),
      ol: simple("ol"),
      li: simple("li"),
      blockquote: simple("blockquote"),
      hr: simple("hr"),
      a: (tagName, attribs) => {
        const safe = aTransform(tagName, attribs);
        return { tagName, attribs: { ...safe.attribs, style: withDefault("a", safe.attribs.style) } };
      },
      img: (tagName, attribs) => {
        const next = imgAttribs(attribs);
        // Ảnh không ghi bề rộng (dán từ nơi khác) vẫn phải có `width` cho Outlook, kẻo ảnh to tràn khung.
        if (next.width === undefined) next.width = String(kepBeRongAnh(null));
        return { tagName, attribs: { ...next, style: withDefault("img", next.style) } };
      },
      table: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          role: "presentation",
          cellpadding: "0",
          cellspacing: "0",
          border: "0",
          width: "100%",
          style: [
            attribs["data-vam-khung"] !== undefined ? "border-collapse:separate;margin:0 0 16px" : "border-collapse:collapse;margin:0 0 12px",
            String(attribs.style ?? ""),
            "width:100%"
          ]
            .filter(Boolean)
            .join(";")
        }
      }),
      td: (tagName, attribs) => {
        const bg = bgColorOf(attribs.style);
        return {
          tagName,
          attribs: {
            ...attribs,
            valign: "top",
            ...(bg ? { bgcolor: bg } : {}),
            style: ["vertical-align:top", String(attribs.style ?? "")].filter(Boolean).join(";")
          }
        };
      },
      th: (tagName, attribs) => ({
        tagName: "td",
        attribs: { ...attribs, valign: "top", style: ["vertical-align:top;font-weight:bold", String(attribs.style ?? "")].filter(Boolean).join(";") }
      })
    }
  }).trim();
}

/**
 * Thân thư HTML gửi đi, từ HTML đã lọc VÀ đã điền ô của một người nhận.
 *
 * Bố cục bằng bảng, rộng tối đa 600px: Outlook bản cài đặt (dựng thư bằng Word) không hiểu max-width
 * hay flex, nên có thêm một bảng 600px cố định trong chú thích điều kiện `[if mso]` chỉ Outlook đọc.
 * Điện thoại thấy bảng 100% co theo màn hình. Chữ ký giữ nguyên như thư chữ thuần.
 */
export function dungThanThuHtml(mergedHtml: string): string {
  const body = emailify(String(mergedHtml ?? ""));
  return [
    '<div style="margin:0;padding:0;background-color:#f4f6f5">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#f4f6f5">',
    '<tr><td align="center" style="padding:16px 8px">',
    '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff">',
    '<tr><td style="padding:24px;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#14352a;text-align:left">',
    body,
    SIGNATURE_HTML,
    "</td></tr></table>",
    "<!--[if mso]></td></tr></table><![endif]-->",
    "</td></tr></table>",
    "</div>"
  ].join("");
}

/** Mẫu này soạn bằng trình thiết kế chưa (có HTML đã lưu)? */
export function laMauThietKe(bodyHtml: string | null | undefined): bodyHtml is string {
  return typeof bodyHtml === "string" && bodyHtml.trim().length > 0;
}
