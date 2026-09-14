import PizZip from "pizzip";
import type { AiDoc, DocBlock } from "./doc-blocks";

/**
 * DỰNG FILE WORD (.docx) TỪ BLOCKS — cho mọi thứ Công cụ AI sinh ra.
 *
 * Tài liệu AI sinh ra có SỐ KHỐI và LOẠI KHỐI đổi từng lần (lúc có bảng, lúc chỉ gạch
 * đầu dòng), không có mẫu .docx cố định nào khớp. Nên dựng thẳng OOXML rồi nén bằng
 * `pizzip`.
 *
 * File này Node-only (pizzip, Buffer) — KHÔNG import vào component "use client".
 *
 * Chép từ module AI của TCM CRM. Test đọc ngược file dựng ra bằng `mammoth` (thư viện
 * đọc .docx thật): OOXML sai khuôn thì mammoth ném lỗi hoặc trả thiếu chữ, nên đó là
 * phép thử thật chứ không chỉ kiểm file có nén được không.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

/** Times New Roman 13pt — chuẩn văn bản hành chính Việt Nam (sz tính bằng nửa point ⇒ 26). */
const BODY_FONT = "Times New Roman";
const BODY_SIZE_HALF_PT = 26;

/**
 * Ký tự điều khiển (trừ tab/xuống dòng): Word TỪ CHỐI MỞ file có chúng, và DeepSeek
 * thi thoảng trả về chúng lẫn trong văn bản. Dựng bằng new RegExp(chuỗi escape) để mã
 * nguồn file này chỉ chứa ASCII — gõ ký tự điều khiển thật vào source là thứ không
 * nhìn thấy được khi đọc lại.
 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");

/** XML escape, bỏ ký tự điều khiển. */
function esc(s: string): string {
  return String(s)
    .replace(CONTROL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Một đoạn văn. `style` trỏ tới styleId khai trong styles.xml; `numId` để vào danh sách. */
function para(text: string, opts: { style?: string; numId?: number; bold?: boolean } = {}): string {
  const pPr: string[] = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.numId) pPr.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
  const rPr = opts.bold ? "<w:rPr><w:b/></w:rPr>" : "";
  const body = pPr.length ? `<w:pPr>${pPr.join("")}</w:pPr>` : "";
  // xml:space="preserve" — không có nó Word nuốt khoảng trắng đầu/cuối.
  return `<w:p>${body}<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function cell(text: string, opts: { bold?: boolean; widthPct?: number } = {}): string {
  const w = opts.widthPct ? `<w:tcW w:w="${Math.round(opts.widthPct * 50)}" w:type="pct"/>` : "";
  return `<w:tc><w:tcPr>${w}</w:tcPr>${para(text, { bold: opts.bold })}</w:tc>`;
}

function table(headers: string[], rows: string[][]): string {
  const colPct = 100 / Math.max(headers.length, 1);
  const grid = headers.map(() => `<w:gridCol w:w="${Math.round(9000 / Math.max(headers.length, 1))}"/>`).join("");
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
    .join("");
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h) => cell(h, { bold: true, widthPct: colPct })).join("")}</w:tr>`;
  const body = rows.map((r) => `<w:tr>${r.map((c) => cell(c, { widthPct: colPct })).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>`;
}

function blockXml(b: DocBlock): string {
  switch (b.type) {
    case "heading":
      return para(b.text, { style: `Heading${b.level}` });
    case "paragraph":
      return para(b.text);
    case "bullets":
      return b.items.map((i) => para(i, { style: "ListParagraph", numId: 1 })).join("");
    case "numbered":
      return b.items.map((i) => para(i, { style: "ListParagraph", numId: 2 })).join("");
    case "terms":
      return b.items.map((i) => para(`${i.term}: ${i.definition}`, { style: "ListParagraph", numId: 1 })).join("");
    case "table":
      // Word cần MỘT đoạn văn ngay sau bảng, nếu không hai bảng liền nhau bị dính làm một.
      return table(b.headers, b.rows) + para("");
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${R_NS}/numbering" Target="numbering.xml"/></Relationships>`;

function headingStyle(id: number, sizeHalfPt: number): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${id}"><w:name w:val="heading ${id}"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="${id - 1}"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sizeHalfPt}"/></w:rPr></w:style>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${BODY_FONT}" w:hAnsi="${BODY_FONT}" w:cs="${BODY_FONT}"/><w:sz w:val="${BODY_SIZE_HALF_PT}"/><w:szCs w:val="${BODY_SIZE_HALF_PT}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>${headingStyle(1, 30)}${headingStyle(2, 28)}${headingStyle(3, 26)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style></w:styles>`;

/** numId 1 = gạch đầu dòng · numId 2 = đánh số. */
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

export type DocxFooter = {
  /** Dòng nhỏ cuối tài liệu — đóng dấu "do AI soạn, người đọc phải kiểm lại". */
  note?: string | null;
};

/** Dựng .docx từ tài liệu có cấu trúc. Trả Buffer để route trả thẳng về trình duyệt. */
export function buildDocx(doc: AiDoc, footer: DocxFooter = {}): Buffer {
  const body = doc.blocks.map(blockXml).join("");
  const foot = footer.note ? para(footer.note, { style: "ListParagraph" }) : "";
  // A4 dọc, lề 2cm (1134 twip) — chuẩn văn bản hành chính.
  const sect = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${para(doc.title, { style: "Title" })}${body}${foot}${sect}</w:body></w:document>`;

  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels").file(".rels", ROOT_RELS);
  const word = zip.folder("word");
  word.file("document.xml", document);
  word.file("styles.xml", STYLES);
  word.file("numbering.xml", NUMBERING);
  word.folder("_rels").file("document.xml.rels", DOC_RELS);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
