/**
 * Phiếu chấm phỏng vấn mentee theo mùa — phần thuần + đường tải Handbook.
 *
 * Database là nơi phân xử thật (__tests__/mentee-offline-postgres.test.ts); ở
 * đây canh những gì chạy trước khi tới database: kiểm phiếu, đọc dữ liệu biểu
 * mẫu, ô xuất CSV, lọc HTML, và file Word đi qua đúng một cửa.
 */
import { describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";

vi.mock("server-only", () => ({}));

import {
  cleanRubricDraft,
  formatWeightedScore,
  interviewRubricExportCells,
  parseRubricInput,
  rubricDraftError,
  slugifyCriterionKey,
  weightedScore
} from "@/lib/mentee-interview-rubric-core";
import { S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE } from "@/lib/mentee-interview-rubric-s12";
import { sanitizeHandbookHtml } from "@/lib/handbook-html";
import { readHandbookDocx } from "@/lib/ai/uploads";

describe("1. điểm quy đổi — cùng công thức với database", () => {
  it("(5×30 + 3×20 + 4×25 + 2×25) / 100 = 3.6, làm tròn 2 số", () => {
    expect(weightedScore([{ score: 5, weight: 30 }, { score: 3, weight: 20 }, { score: 4, weight: 25 }, { score: 2, weight: 25 }])).toBe(3.6);
    expect(weightedScore([{ score: 1, weight: 1 }, { score: 2, weight: 2 }])).toBe(1.67);
  });
  it("không có tiêu chí thì không bịa ra số", () => {
    expect(weightedScore([])).toBeNull();
    expect(formatWeightedScore(null)).toBe("—");
    expect(formatWeightedScore("3.6")).toBe("3.60/5");
  });
});

describe("2. kiểm phiếu trước khi gửi", () => {
  it("phiếu S12 hợp lệ", () => {
    expect(rubricDraftError(S12_INTERVIEW_CRITERIA, S12_INTERVIEW_GUIDANCE)).toBeNull();
  });
  it("tổng trọng số khác 100 bị chặn, báo đúng con số", () => {
    const heavy = S12_INTERVIEW_CRITERIA.map((c, i) => (i === 0 ? { ...c, weight: 35 } : c));
    expect(rubricDraftError(heavy, {})).toContain("105%");
  });
  it("trùng mã, mã sai dạng, thiếu tên, trọng số không nguyên đều bị chặn", () => {
    expect(rubricDraftError(S12_INTERVIEW_CRITERIA.map((c, i) => (i === 1 ? { ...c, key: "need" } : c)), {})).toContain("trùng");
    expect(rubricDraftError(S12_INTERVIEW_CRITERIA.map((c, i) => (i === 0 ? { ...c, key: "Need" } : c)), {})).toContain("mã nội bộ");
    expect(rubricDraftError(S12_INTERVIEW_CRITERIA.map((c, i) => (i === 0 ? { ...c, label: "  " } : c)), {})).toContain("chưa có tên");
    expect(rubricDraftError(S12_INTERVIEW_CRITERIA.map((c, i) => (i === 0 ? { ...c, weight: 30.5 } : c)), {})).toContain("số nguyên");
    expect(rubricDraftError(S12_INTERVIEW_CRITERIA.map((c, i) => (i === 0 ? { ...c, weight: Number.NaN } : c)), {})).toContain("số nguyên");
    expect(rubricDraftError([], {})).toContain("ít nhất 1");
  });
});

describe("3. mã tiêu chí sinh từ nhãn tiếng Việt", () => {
  it("bỏ dấu, đ → d, thường hoá, không trùng mã đã có", () => {
    expect(slugifyCriterionKey("Tiêu chí mới", [])).toBe("tieu_chi_moi");
    expect(slugifyCriterionKey("Tiêu chí mới", ["tieu_chi_moi"])).toBe("tieu_chi_moi_2");
    expect(slugifyCriterionKey("Đi đến cùng", [])).toBe("di_den_cung");
    expect(slugifyCriterionKey("123", [])).toBe("tieu_chi");
  });
  it("mã sinh ra luôn qua được luật mã của database", () => {
    for (const label of ["Tiêu chí mới", "Đi đến cùng", "123", "A", "!!!"]) {
      expect(slugifyCriterionKey(label, [])).toMatch(/^[a-z][a-z0-9_]{1,39}$/);
    }
  });
});

describe("4. đọc phiếu từ biểu mẫu — người gửi tự đặt được mọi thứ", () => {
  it("sai hình dạng là null, không đoán", () => {
    expect(parseRubricInput("x", {})).toBeNull();
    expect(parseRubricInput([{ key: "a", label: "A", weight: "50" }], {})).toBeNull();
    expect(parseRubricInput([null], {})).toBeNull();
    expect(parseRubricInput([], [])).toBeNull();
  });
  it("trường lạ bị bỏ, chữ không phải chuỗi thành rỗng", () => {
    const parsed = parseRubricInput(
      [{ key: "need", label: "Nhu cầu", weight: 100, extra: "x", question: 5, descriptors: { "1": "thấp", "9": "lạ" }, interview_questions: ["a", 3] }],
      { motto: "M", hack: "x" }
    )!;
    expect(parsed.criteria[0]).toEqual({ key: "need", label: "Nhu cầu", label_en: "", weight: 100, question: "",
      descriptors: { "1": "thấp", "3": "", "5": "" }, interview_questions: ["a", ""] });
    expect(parsed.guidance).toEqual({ motto: "M", note: "", reminder: "" });
  });
  it("làm gọn: bỏ mô tả/câu hỏi trống, cắt khoảng trắng", () => {
    const { criteria, guidance } = cleanRubricDraft(
      [{ key: "need", label: " Nhu cầu ", weight: 100, question: "", descriptors: { "1": " thấp ", "3": "" }, interview_questions: ["", " Câu 1 ", ""] }],
      { motto: " M ", note: "" }
    );
    expect(criteria[0]).toEqual({ key: "need", label: "Nhu cầu", weight: 100, descriptors: { "1": "thấp" }, interview_questions: ["Câu 1"] });
    expect(guidance).toEqual({ motto: "M" });
  });
});

describe("5. ô xuất CSV cho dòng phỏng vấn theo phiếu", () => {
  it("điểm từng tiêu chí, điểm quy đổi, nhãn tiếng Việt của mục B/C", () => {
    expect(interviewRubricExportCells({
      interview_scores: [{ key: "need", label: "Nhu cầu Mentoring & Giá trị phát triển", weight: 30, score: 5, note: null },
        { key: "readiness", label: "Sẵn sàng học hỏi", weight: 20, score: 3, note: null }],
      weighted_score: "3.6", key_development_need: "Khám phá hướng nghề", expectation_alignment: "concern",
      alignment_note: "Lo bận", take_choice: "recommend_other", desired_mentor_profile: "Coaching", additional_note: null
    })).toEqual([
      "Nhu cầu Mentoring & Giá trị phát triển: 5; Sẵn sàng học hỏi: 3", "3.60", "Khám phá hướng nghề", "Kỳ vọng không phù hợp",
      "Lo bận", "Không – Nhưng đề xuất bạn này trở thành Mentee và Mentor khác nhận bạn", "Coaching", ""
    ]);
  });
  it("dòng vòng hồ sơ để trống cả 8 ô, không bịa", () => {
    expect(interviewRubricExportCells({ weighted_score: null })).toEqual(["", "", "", "", "", "", "", ""]);
  });
});

describe("6. lọc HTML Handbook", () => {
  it("giữ chữ, tiêu đề, bảng; bỏ script, sự kiện, style, ảnh, iframe", () => {
    const out = sanitizeHandbookHtml(
      '<h1 onclick="x()">Tiêu đề</h1><script>alert(1)</script><p style="color:red">Chữ <strong>đậm</strong></p>' +
      '<table><tr><td colspan="2">Ô</td></tr></table><img src="x.png"><iframe src="https://e.com"></iframe>'
    );
    expect(out).toBe('<h1>Tiêu đề</h1><p>Chữ <strong>đậm</strong></p><table><tr><td colspan="2">Ô</td></tr></table>');
  });
  it("liên kết: chỉ http/https/mailto, luôn mở tab mới an toàn", () => {
    expect(sanitizeHandbookHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeHandbookHtml('<a href="data:text/html,x">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeHandbookHtml('<a href="https://vam.vn">x</a>')).toBe('<a href="https://vam.vn" target="_blank" rel="noopener noreferrer">x</a>');
  });
});

// File Word tối giản dựng tại chỗ: tiêu đề, bảng, một liên kết javascript: và
// một tham chiếu ảnh — đủ để thấy bộ chuyển giữ bảng, bỏ ảnh, lọc liên kết.
function minimalDocx(): Uint8Array {
  const zip = new PizZip();
  zip.file("[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>' +
    '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>');
  zip.file("word/media/image1.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  zip.file("word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>' +
    '<w:p><w:r><w:t>VAM MENTEE INTERVIEW GUIDE</w:t></w:r></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Tiêu chí</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Weight</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:hyperlink r:id="rId5"><w:r><w:t>bấm vào</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Ảnh"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:blipFill><a:blip r:embed="rId6"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>' +
    "</w:body></w:document>");
  return zip.generate({ type: "uint8array" });
}
function form(bytes: Uint8Array, name: string) {
  const fd = new FormData();
  fd.append("handbook", new File([new Uint8Array(bytes)], name));
  return fd;
}

describe("7. Handbook Word đi qua đúng một cửa", () => {
  it("file Word thật: giữ bảng, BỎ ảnh, bỏ liên kết javascript:", async () => {
    const result = await readHandbookDocx(form(minimalDocx(), "VAM_Handbook_S12.docx"), "handbook");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.name).toBe("VAM_Handbook_S12.docx");
    expect(result.html).toContain("VAM MENTEE INTERVIEW GUIDE");
    expect(result.html).toContain("<table>");
    expect(result.html).toContain("<td><p>Tiêu chí</p></td>");
    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("data:image");
  }, 30000);
  it("không phải .docx, hoặc byte không đúng loại, đều bị từ chối", async () => {
    const pdf = await readHandbookDocx(form(new TextEncoder().encode("%PDF-1.4 x"), "handbook.pdf"), "handbook");
    expect(pdf).toEqual({ ok: false, message: "Handbook phải là file Word .docx." });
    const fakeDocx = await readHandbookDocx(form(new TextEncoder().encode("%PDF-1.4 x"), "handbook.docx"), "handbook");
    expect(fakeDocx.ok).toBe(false);
    if (!fakeDocx.ok) expect(fakeDocx.message).toContain("nội dung không đúng loại file");
    const png = await readHandbookDocx(form(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), "anh.docx"), "handbook");
    expect(png.ok).toBe(false);
    if (!png.ok) expect(png.message).toContain("không nhận file ảnh");
  });
  it("đúng MỘT file", async () => {
    const none = await readHandbookDocx(new FormData(), "handbook");
    expect(none).toEqual({ ok: false, message: "Chọn đúng một file Word (.docx)." });
    const two = form(minimalDocx(), "a.docx");
    two.append("handbook", new File([new Uint8Array(minimalDocx())], "b.docx"));
    expect((await readHandbookDocx(two, "handbook")).ok).toBe(false);
  });
});
