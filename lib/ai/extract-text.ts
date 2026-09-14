import "server-only";

/**
 * Lấy CHỮ THUẦN từ file người dùng tải lên cho Công cụ AI, để đưa vào prompt.
 *
 * Best-effort và KHÔNG BAO GIỜ ném lỗi: một file hỏng không được làm sập cả lượt chạy.
 * Không đọc được thì trả null, và lib/ai/uploads.ts báo tên file đó cho người dùng.
 *
 * Chép từ module AI của TCM CRM, hai chỗ đổi:
 *   - XLSX đọc bằng `pizzip` (vốn phải có để dựng Word) thay vì `exceljs`: chỉ cần chữ
 *     trong ô, không cần một thư viện Excel đầy đủ kéo theo archiver, unzipper, uuid.
 *   - PDF nạp `pdf-parse/worker` trước, theo hướng dẫn của thư viện cho Next.js.
 *
 * Về PDF: pdf-parse chỉ được gọi `getText()`. Không gọi hàm nào vẽ trang hay lấy ảnh
 * nhúng — xem mục 3b của __tests__/image-optimizer-attack-surface.test.ts.
 */

const MAX_CHARS_PER_FILE = 6000; // chặn một file quá dài nuốt hết ngân sách token của prompt

/**
 * Trần ký tự cho MỘT lần đọc. Mặc định 6000; công cụ soạn thảo truyền trần riêng cho
 * file mẫu tham chiếu. `.slice()` phía sau KHÔNG lấy lại được phần đã bị cắt ở đây.
 */
export type ExtractOptions = { maxChars?: number };
export type ExtractedText = { text: string; truncated: boolean };

function truncate(text: string, maxChars: number = MAX_CHARS_PER_FILE): ExtractedText {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false };
  return { text: cleaned.slice(0, maxChars), truncated: true };
}

function fromCodePoint(value: number): string {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
}

/** Giải mã entity XML. `&amp;` giải mã SAU CÙNG, nếu không `&amp;lt;` thành dấu `<`. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * HTML → chữ: bỏ hẳn script/style/head, đổi thẻ khối và `<br>` thành xuống dòng để giữ
 * ranh giới dòng cho model, rồi gỡ thẻ. Không dùng DOM parser: chỉ cần chữ cho prompt.
 */
function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|section|article|table|thead|tbody)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ");
  return decodeXmlEntities(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * RTF → chữ bằng chuỗi phép thay thế. Đọc buffer bằng `latin1` chứ không phải utf-8:
 * RTF mã hoá ký tự ngoài ASCII bằng escape `\'xx` một byte, đọc utf-8 là hỏng byte
 * trước khi kịp giải mã escape.
 */
function rtfToText(rtf: string): string {
  return rtf
    .replace(/\{\\\*[\s\S]*?\}/g, " ")
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\line\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\'([0-9a-fA-F]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u(-?\d+)\s?\??/g, (_match, dec: string) => String.fromCharCode(((Number(dec) % 65536) + 65536) % 65536))
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function openZip(buffer: Buffer) {
  const PizZip = (await import("pizzip")).default;
  return new PizZip(buffer);
}

type Zip = Awaited<ReturnType<typeof openZip>>;

function readZipText(zip: Zip, name: string): string {
  return zip.file(name)?.asText() ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function xmlAttribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${escapeRegExp(name)}="([^"]*)"`).exec(attributes);
  return match ? match[1] : null;
}

/** Nối mọi `<t>…</t>` trong một đoạn XML (chuỗi chia sẻ của XLSX, ô inline). */
function joinTextRuns(xml: string): string {
  const parts: string[] = [];
  const pattern = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml))) parts.push(decodeXmlEntities(match[1]));
  return parts.join("");
}

/** ODT (LibreOffice) là file ZIP chứa `content.xml`. */
async function odtToText(buffer: Buffer): Promise<string> {
  const xml = readZipText(await openZip(buffer), "content.xml");
  const text = xml
    .replace(/<text:tab\/>/g, "\t")
    .replace(/<text:line-break\/>/g, "\n")
    .replace(/<\/text:(p|h)>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeXmlEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * XLSX → chữ dạng TSV, mỗi sheet mở đầu bằng `[Sheet: tên]`, theo đúng thứ tự sheet
 * trong workbook.
 *
 * Dừng sớm khi đã đủ `maxChars`: bảng tính có thể hàng chục nghìn dòng, đọc hết rồi
 * mới cắt là đốt bộ nhớ vô ích.
 */
async function xlsxToText(buffer: Buffer, maxChars: number): Promise<string> {
  const zip = await openZip(buffer);
  let match: RegExpExecArray | null;

  const shared: string[] = [];
  const sharedPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  const sharedXml = readZipText(zip, "xl/sharedStrings.xml");
  while ((match = sharedPattern.exec(sharedXml))) {
    // <rPh> là phiên âm (tiếng Nhật) đi kèm ô — không phải nội dung người gõ.
    shared.push(joinTextRuns(match[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, "")));
  }

  const targets = new Map<string, string>();
  const relationPattern = /<Relationship\b([^>]*?)\/?>/g;
  const relsXml = readZipText(zip, "xl/_rels/workbook.xml.rels");
  while ((match = relationPattern.exec(relsXml))) {
    const id = xmlAttribute(match[1], "Id");
    const target = xmlAttribute(match[1], "Target");
    // Target tương đối với xl/ ("worksheets/sheet1.xml") hoặc tuyệt đối ("/xl/worksheets/sheet1.xml").
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }

  const sheets: { name: string; path: string }[] = [];
  const sheetPattern = /<sheet\b([^>]*?)\/?>/g;
  const workbookXml = readZipText(zip, "xl/workbook.xml");
  while ((match = sheetPattern.exec(workbookXml))) {
    const relationId = xmlAttribute(match[1], "r:id");
    const path = relationId ? targets.get(relationId) : undefined;
    if (path) sheets.push({ name: decodeXmlEntities(xmlAttribute(match[1], "name") ?? path), path });
  }

  const lines: string[] = [];
  let size = 0;
  for (const sheet of sheets) {
    const sheetXml = readZipText(zip, sheet.path);
    if (!sheetXml) continue;
    lines.push(`[Sheet: ${sheet.name}]`);

    const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let row: RegExpExecArray | null;
    while ((row = rowPattern.exec(sheetXml))) {
      const cells: string[] = [];
      const cellPattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cell: RegExpExecArray | null;
      while ((cell = cellPattern.exec(row[1]))) {
        const type = xmlAttribute(cell[1], "t");
        const body = cell[2] ?? "";
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body);
        let value = "";
        if (type === "s") value = raw ? shared[Number(raw[1])] ?? "" : "";
        else if (type === "inlineStr") value = joinTextRuns(body);
        else value = raw ? decodeXmlEntities(raw[1]) : "";
        if (value.trim()) cells.push(value.trim());
      }
      if (cells.length === 0) continue;
      const line = cells.join("\t");
      lines.push(line);
      size += line.length + 1;
      if (size > maxChars) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

/** pdf-parse chèn dòng "-- 1 of 3 --" giữa các trang; một PDF scan chỉ còn lại mấy dòng đó. */
function stripPdfPageMarkers(text: string): string {
  return text.replace(/^\s*-- \d+ of \d+ --\s*$/gm, "");
}

async function pdfToText(buffer: Buffer): Promise<string> {
  // Hướng dẫn của pdf-parse cho Next.js và serverless: nạp worker TRƯỚC. Nó đặt
  // DOMMatrix/Path2D/ImageData lên global và nạp sẵn worker của pdf.js — khi bị đóng
  // gói, pdf.js không tự tìm được file worker (xem next.config.mjs).
  await import("pdf-parse/worker");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return stripPdfPageMarkers(result.text);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export async function extractTextFromFile(
  buffer: Buffer,
  mime: string,
  opts?: ExtractOptions
): Promise<ExtractedText | null> {
  const maxChars = opts?.maxChars ?? MAX_CHARS_PER_FILE;
  const nonEmpty = (text: string) => (text.trim() ? truncate(text, maxChars) : null);
  try {
    if (mime === "application/pdf") {
      return nonEmpty(await pdfToText(buffer));
    }
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return nonEmpty(result.value);
    }
    if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      return nonEmpty(await xlsxToText(buffer, maxChars));
    }
    if (mime === "text/html" || mime === "application/xhtml+xml") {
      return nonEmpty(htmlToText(buffer.toString("utf8")));
    }
    if (mime === "text/plain" || mime === "text/csv" || mime === "text/markdown") {
      return nonEmpty(buffer.toString("utf8").replace(/^\uFEFF/, ""));
    }
    if (mime === "application/rtf" || mime === "text/rtf") {
      return nonEmpty(rtfToText(buffer.toString("latin1")));
    }
    if (mime === "application/vnd.oasis.opendocument.text") {
      return nonEmpty(await odtToText(buffer));
    }
    return null;
  } catch (error) {
    console.error("[AI] extractTextFromFile lỗi (bỏ qua file này):", error);
    return null;
  }
}
