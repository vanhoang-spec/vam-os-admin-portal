/**
 * Khuôn tài liệu AI: một khối hỏng không được giết cả bài, và tên file tải về
 * không được mất chữ số hay chữ cái.
 */
import { describe, expect, it } from "vitest";
import { MAX_DOC_BLOCKS, docFileName, docToPlainText, parseAiDoc } from "@/lib/doc-blocks";

describe("parseAiDoc — dọn rồi mới kiểm", () => {
  it("kẹp cấp tiêu đề về 1–3 mà không mất chữ", () => {
    const doc = parseAiDoc({
      title: "Tiêu đề",
      blocks: [
        { type: "heading", level: 0, text: "Cấp không" },
        { type: "heading", level: 5, text: "Cấp năm" },
        { type: "heading", level: "2", text: "Cấp chuỗi" },
        { type: "heading", level: "abc", text: "Cấp rác" }
      ]
    });
    expect(doc?.blocks).toEqual([
      { type: "heading", level: 1, text: "Cấp không" },
      { type: "heading", level: 3, text: "Cấp năm" },
      { type: "heading", level: 2, text: "Cấp chuỗi" },
      { type: "heading", level: 2, text: "Cấp rác" }
    ]);
  });

  it("bỏ khối rỗng thay vì đánh hỏng cả tài liệu", () => {
    const doc = parseAiDoc({
      title: "Kế hoạch",
      blocks: [
        { type: "paragraph", text: "   " },
        { type: "bullets", items: [" ", ""] },
        { type: "table", headers: ["A"], rows: [] },
        { type: "terms", items: [{ term: " ", definition: "x" }] },
        { type: "markdown", text: "## lạ" },
        null,
        { type: "paragraph", text: "Đoạn còn lại" }
      ]
    });
    expect(doc?.blocks).toEqual([{ type: "paragraph", text: "Đoạn còn lại" }]);
  });

  it("bỏ phần tử rỗng bên trong khối còn lại", () => {
    const doc = parseAiDoc({
      title: "T",
      blocks: [
        { type: "bullets", items: ["Một", " ", "Hai"] },
        { type: "terms", items: [{ term: "", definition: "mất" }, { term: "Recap", definition: "Biên bản buổi gặp" }] }
      ]
    });
    expect(doc?.blocks).toEqual([
      { type: "bullets", items: ["Một", "Hai"] },
      { type: "terms", items: [{ term: "Recap", definition: "Biên bản buổi gặp" }] }
    ]);
  });

  it("ép mọi dòng bảng về đúng số cột của tiêu đề", () => {
    const doc = parseAiDoc({
      title: "Bảng",
      blocks: [
        {
          type: "table",
          headers: ["Chỉ số", "Tháng 8", "Tháng 9"],
          rows: [["Recap"], ["Mentor", "10", "12", "thừa"], [null, 5]]
        }
      ]
    });
    expect(doc?.blocks[0]).toEqual({
      type: "table",
      headers: ["Chỉ số", "Tháng 8", "Tháng 9"],
      rows: [
        ["Recap", "", ""],
        ["Mentor", "10", "12"],
        ["", "5", ""]
      ]
    });
  });

  it("trả null khi không còn gì hợp lệ, không bịa ra tài liệu rỗng", () => {
    expect(parseAiDoc({ title: "T", blocks: [{ type: "paragraph", text: "" }] })).toBeNull();
    expect(parseAiDoc({ blocks: [{ type: "paragraph", text: "thiếu tiêu đề" }] })).toBeNull();
    expect(parseAiDoc("không phải object")).toBeNull();
    expect(parseAiDoc(null)).toBeNull();
  });

  it("từ chối tài liệu vượt trần số khối", () => {
    const blocks = Array.from({ length: MAX_DOC_BLOCKS + 1 }, (_, index) => ({ type: "paragraph", text: `Đoạn ${index}` }));
    expect(parseAiDoc({ title: "Dài", blocks })).toBeNull();
    expect(parseAiDoc({ title: "Vừa", blocks: blocks.slice(0, MAX_DOC_BLOCKS) })).not.toBeNull();
  });
});

describe("docFileName", () => {
  it("bỏ dấu tiếng Việt nhưng giữ nguyên chữ số và chữ cái", () => {
    // Regex dấu kết hợp mất lớp gạch chéo ngược (`[u0300-u036f]`) sẽ xoá luôn
    // chữ số và phần lớn chữ cái — ca này đỏ ngay.
    expect(docFileName("Kế hoạch Mùa 12: Đợt 1/2", "docx")).toBe("Ke hoach Mua 12 Dot 1 2.docx");
    expect(docFileName("Thư mời mentor — UEHM-S12", "pdf")).toBe("Thu moi mentor — UEHM-S12.pdf");
  });

  it("bỏ ký tự Windows cấm trong tên file", () => {
    expect(docFileName('a\\b/c:d*e?f"g<h>i|j', "docx")).toBe("a b c d e f g h i j.docx");
  });

  it("tiêu đề rỗng thì dùng tên mặc định, tiêu đề dài thì cắt", () => {
    expect(docFileName("   ", "docx")).toBe("tai-lieu.docx");
    expect(docFileName("x".repeat(200), "docx")).toBe(`${"x".repeat(80)}.docx`);
  });
});

describe("docToPlainText", () => {
  it("đổ đủ các loại khối ra chữ, không dùng cú pháp markdown", () => {
    const text = docToPlainText({
      title: "Báo cáo",
      blocks: [
        { type: "heading", level: 1, text: "Tổng quan" },
        { type: "paragraph", text: "Mùa đang chạy tốt." },
        { type: "bullets", items: ["Một", "Hai"] },
        { type: "numbered", items: ["Bước đầu", "Bước sau"] },
        { type: "terms", items: [{ term: "Recap", definition: "Biên bản buổi gặp" }] },
        { type: "table", headers: ["A", "B"], rows: [["1", "2"]] }
      ]
    });
    expect(text).toBe(
      [
        "Báo cáo",
        "",
        "TỔNG QUAN",
        "",
        "Mùa đang chạy tốt.",
        "",
        "• Một",
        "• Hai",
        "",
        "1. Bước đầu",
        "2. Bước sau",
        "",
        "Recap: Biên bản buổi gặp",
        "",
        "A\tB",
        "1\t2"
      ].join("\n")
    );
    expect(text).not.toMatch(/\*\*|##/);
  });
});
