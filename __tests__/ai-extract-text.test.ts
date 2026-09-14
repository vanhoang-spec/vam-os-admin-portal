/**
 * Lấy chữ từ file THẬT — PDF có font tiếng Việt, DOCX, XLSX — trên chính bản
 * Node đang chạy test. Bản giả của bộ đọc sẽ xanh cả khi pdf-parse không nạp
 * được worker, đúng thứ lỗi mà module này từng hỏng lặng lẽ.
 */
import PizZip from "pizzip";
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractTextFromFile } from "@/lib/ai/extract-text";
import { AI_UPLOAD_KINDS } from "@/lib/ai/upload-core";
import { buildDocx } from "@/lib/docx-builder";

function makePdf(document: TDocumentDefinitions): Promise<Buffer> {
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = pdfFonts as unknown as Record<string, string>;
  return new Promise((resolve) => pdfMake.createPdf(document).getBuffer((buffer) => resolve(Buffer.from(buffer))));
}

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** Workbook tối giản: thứ tự sheet trong workbook KHÁC thứ tự tên file, để bắt đọc sai thứ tự. */
function makeXlsx(): Buffer {
  const zip = new PizZip();
  zip.file(
    "xl/workbook.xml",
    xml(`<workbook ${MAIN} ${REL}><sheets><sheet name="Tháng 9 &amp; 10" sheetId="1" r:id="rId2"/><sheet name="Tháng 8" sheetId="2" r:id="rId1"/></sheets></workbook>`)
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>`
    )
  );
  zip.file(
    "xl/sharedStrings.xml",
    xml(`<sst ${MAIN}><si><t>Họ tên mentor</t></si><si><r><t>Số </t></r><r><t xml:space="preserve">recap</t></r></si><si><t>A &lt; B</t></si></sst>`)
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    xml(`<worksheet ${MAIN}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Nguyễn Văn Test</t></is></c><c r="B2"><v>3</v></c><c r="C2" s="1"/></row></sheetData></worksheet>`)
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    xml(`<worksheet ${MAIN}><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" t="str"><f>1+1</f><v>2</v></c></row><row r="2"></row></sheetData></worksheet>`)
  );
  return zip.generate({ type: "nodebuffer" });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("PDF", () => {
  it(
    "đọc được chữ tiếng Việt từ một PDF thật",
    async () => {
      const pdf = await makePdf({
        content: [
          { text: "Kế hoạch Mentor Orientation Mùa 12" },
          { text: "Mỗi mentor dành 1–2 giờ mỗi tháng cho mỗi mentee." }
        ]
      });
      const result = await extractTextFromFile(pdf, AI_UPLOAD_KINDS.pdf);
      expect(result).not.toBeNull();
      const text = result!.text.normalize("NFC");
      expect(text).toContain("Kế hoạch Mentor Orientation Mùa 12");
      expect(text).toContain("mỗi tháng cho mỗi mentee");
      expect(text).not.toMatch(/-- \d+ of \d+ --/);
      expect(result!.truncated).toBe(false);
    },
    30_000
  );

  it(
    "PDF không có lớp chữ (như file scan) trả null, không trả mấy dòng đánh số trang",
    async () => {
      const pdf = await makePdf({ content: [{ canvas: [{ type: "rect", x: 0, y: 0, w: 200, h: 100, color: "#16834c" }] }] });
      expect(await extractTextFromFile(pdf, AI_UPLOAD_KINDS.pdf)).toBeNull();
    },
    30_000
  );

  it(
    "cắt đúng trần ký tự và đánh dấu đã cắt",
    async () => {
      const pdf = await makePdf({ content: [{ text: "Chương trình mentoring ".repeat(60) }] });
      const result = await extractTextFromFile(pdf, AI_UPLOAD_KINDS.pdf, { maxChars: 100 });
      expect(result?.text.length).toBe(100);
      expect(result?.truncated).toBe(true);
    },
    30_000
  );

  it("byte hỏng mang nhãn PDF trả null, không ném lỗi", async () => {
    const broken = Buffer.from("%PDF-1.7\nkhông phải một PDF hợp lệ");
    await expect(extractTextFromFile(broken, AI_UPLOAD_KINDS.pdf)).resolves.toBeNull();
  }, 30_000);
});

describe("DOCX", () => {
  it("đọc được file Word", async () => {
    const docx = buildDocx({ title: "Thư mời mentor", blocks: [{ type: "paragraph", text: "Kính gửi anh chị mentor Mùa 12" }] });
    const result = await extractTextFromFile(docx, AI_UPLOAD_KINDS.docx);
    expect(result?.text).toContain("Thư mời mentor");
    expect(result?.text).toContain("Kính gửi anh chị mentor Mùa 12");
  }, 30_000);

  it("ZIP không phải Word trả null", async () => {
    await expect(extractTextFromFile(makeXlsx(), AI_UPLOAD_KINDS.docx)).resolves.toBeNull();
  }, 30_000);
});

describe("XLSX", () => {
  it("đọc ô chuỗi chia sẻ, ô inline, ô số, theo đúng thứ tự sheet của workbook", async () => {
    const result = await extractTextFromFile(makeXlsx(), AI_UPLOAD_KINDS.xlsx);
    expect(result?.text).toBe(["[Sheet: Tháng 9 & 10]", "A < B\t2", "[Sheet: Tháng 8]", "Họ tên mentor\tSố recap", "Nguyễn Văn Test\t3"].join("\n"));
  }, 30_000);

  it("dừng đọc sớm khi đã đủ trần ký tự", async () => {
    const result = await extractTextFromFile(makeXlsx(), AI_UPLOAD_KINDS.xlsx, { maxChars: 10 });
    expect(result?.text.length).toBeLessThanOrEqual(10);
    expect(result?.truncated).toBe(true);
  }, 30_000);

  it("ZIP không phải bảng tính trả null", async () => {
    const docx = buildDocx({ title: "T", blocks: [{ type: "paragraph", text: "x" }] });
    await expect(extractTextFromFile(docx, AI_UPLOAD_KINDS.xlsx)).resolves.toBeNull();
  }, 30_000);
});

describe("file chữ", () => {
  it("bỏ BOM đầu file và gộp dòng trống thừa", async () => {
    const result = await extractTextFromFile(Buffer.from("\uFEFFDòng 1\r\n\r\n\r\n\r\nDòng 2", "utf8"), "text/plain");
    expect(result).toEqual({ text: "Dòng 1\n\nDòng 2", truncated: false });
  });

  it("file toàn khoảng trắng trả null", async () => {
    await expect(extractTextFromFile(Buffer.from("  \n\t "), "text/csv")).resolves.toBeNull();
  });

  it("HTML giải mã entity đúng một lần", async () => {
    const result = await extractTextFromFile(Buffer.from("<p>A &amp;lt; B &amp; C</p><script>bỏ()</script>"), "text/html");
    expect(result?.text).toBe("A &lt; B & C");
  });

  it("loại không hỗ trợ trả null", async () => {
    await expect(extractTextFromFile(Buffer.from("x"), "image/png")).resolves.toBeNull();
  });
});
