/**
 * File Word dựng từ tài liệu AI phải mở được — kiểm bằng cách đọc ngược bằng
 * mammoth, thư viện đọc .docx thật, chứ không chỉ kiểm file có nén được không.
 */
import mammoth from "mammoth";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import type { AiDoc } from "@/lib/doc-blocks";
import { DOCX_MIME, buildDocx } from "@/lib/docx-builder";

function documentXml(buffer: Buffer): string {
  return new PizZip(buffer).file("word/document.xml")?.asText() ?? "";
}

const SAMPLE: AiDoc = {
  title: "Kế hoạch Mentor Orientation Mùa 12",
  blocks: [
    { type: "heading", level: 1, text: "Mục tiêu" },
    { type: "paragraph", text: "Giúp mentor mới hiểu vai trò đồng hành." },
    { type: "bullets", items: ["Chia sẻ kinh nghiệm", "Giới thiệu quy chế"] },
    { type: "numbered", items: ["Đón khách", "Khai mạc"] },
    { type: "terms", items: [{ term: "Recap", definition: "Biên bản buổi gặp" }] },
    { type: "table", headers: ["Hạng mục", "Phụ trách"], rows: [["Âm thanh", "Ban hậu cần"]] }
  ]
};

describe("buildDocx", () => {
  it("dựng file .docx mà mammoth đọc lại được đủ chữ", async () => {
    const buffer = buildDocx(SAMPLE, { note: "Nội dung do AI soạn" });
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");

    const { value } = await mammoth.extractRawText({ buffer });
    for (const text of [
      "Kế hoạch Mentor Orientation Mùa 12",
      "Mục tiêu",
      "Giúp mentor mới hiểu vai trò đồng hành.",
      "Chia sẻ kinh nghiệm",
      "Khai mạc",
      "Recap: Biên bản buổi gặp",
      "Âm thanh",
      "Ban hậu cần",
      "Nội dung do AI soạn"
    ]) {
      expect(value).toContain(text);
    }
  });

  it("lọc ký tự điều khiển — Word từ chối mở file có chúng", () => {
    const dirty = `Dòng${String.fromCharCode(1)}có${String.fromCharCode(0x1f)}ký tự${String.fromCharCode(0x0b)}lạ`;
    const xml = documentXml(buildDocx({ title: "T", blocks: [{ type: "paragraph", text: dirty }] }));
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]"));
    expect(xml).toContain("Dòngcóký tựlạ");
  });

  it("escape XML, để chữ AI trả về không phá cấu trúc file", async () => {
    const buffer = buildDocx({ title: "T", blocks: [{ type: "paragraph", text: '<w:b/>&"trích"' }] });
    expect(documentXml(buffer)).toContain("&lt;w:b/&gt;&amp;&quot;trích&quot;");
    const { value } = await mammoth.extractRawText({ buffer });
    expect(value).toContain('<w:b/>&"trích"');
  });

  it("chèn một đoạn trống ngay sau mỗi bảng, để hai bảng liền nhau không dính làm một", () => {
    const table = { type: "table" as const, headers: ["A"], rows: [["1"]] };
    const xml = documentXml(buildDocx({ title: "T", blocks: [table, table] }));
    expect(xml.match(/<w:tbl>/g)).toHaveLength(2);
    expect(xml.match(/<\/w:tbl><w:p>/g)).toHaveLength(2);
  });

  it("khai đúng MIME của file Word", () => {
    expect(DOCX_MIME).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });
});
