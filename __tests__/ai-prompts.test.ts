/**
 * Prompt của Công cụ AI: nói về VAM chứ không về agency gốc, không còn dấu vết
 * của hai tính năng kế toán đã bỏ, và giữ nguyên các luật chống bịa.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOC_JSON_FORMAT, withDocFormat } from "@/lib/ai/doc-format";
import { documentDraftPrompt } from "@/lib/ai/document-prompts";
import { DOCUMENT_TYPES, resolveDocumentType } from "@/lib/ai/document-types";
import {
  brainstormPrompt,
  canvaBriefPrompt,
  contentWriterPrompt,
  executiveReportPrompt,
  industryTrendGroundedPrompt,
  industryTrendPrompt,
  type ExecutiveReportInput
} from "@/lib/ai/prompts";
import type { AiMessage } from "@/lib/ai/types";
import { VAM_CONTEXT, VAM_ORG_NAME } from "@/lib/ai/vam-context";

const ROOT = join(__dirname, "..");

const REPORT: ExecutiveReportInput = {
  generatedAt: "14/09/2026 09:00",
  seasonCode: "UEHM-S12",
  seasonLabel: "Mùa 12",
  sections: [
    { title: "Tuyển sinh và ghép cặp", unavailable: false, metrics: [{ label: "Hồ sơ ứng tuyển trong mùa", value: 1234 }, { label: "Cặp ghép", value: null }] },
    { title: "Việc vận hành", unavailable: true, metrics: [] }
  ]
};

const ALL_PROMPTS: Array<[string, AiMessage[]]> = [
  ["brainstorm", brainstormPrompt({ topic: "Networking", brief: "Cho mentee năm 3", attachmentsText: "Tài liệu" })],
  ["content", contentWriterPrompt({ topic: "Mở đăng ký", brief: "Fanpage", attachmentsText: null })],
  ["canva", canvaBriefPrompt({ deliverable: "Backdrop", note: "Tông xanh", attachmentsText: null })],
  ["report", executiveReportPrompt(REPORT)],
  ["trend-grounded", industryTrendGroundedPrompt("logistics", [{ title: "Nguồn", url: "https://a.vn", content: "x", publishedDate: null }])],
  ["trend", industryTrendPrompt("logistics")],
  [
    "document",
    documentDraftPrompt({ type: DOCUMENT_TYPES[0], subject: null, brief: "Dữ kiện", referenceText: null, referenceName: null, orgName: VAM_ORG_NAME })
  ]
];

/** Dấu vết của agency gốc và của hai tính năng kiểm tra kế toán đã bỏ. */
const FORBIDDEN = [/\bTCM\b/, /Targeted Marketing/i, /CO\/CE/, /make-?up/i, /ngân hàng/i, /kế toán/i, /activation/i, /\bBTL\b/, /chi hộ/i, /bank/i];

describe("không còn dấu vết của bản gốc và của tính năng đã bỏ", () => {
  it.each(ALL_PROMPTS)("prompt %s", (_name, messages) => {
    const text = messages.map((message) => message.content).join("\n");
    for (const pattern of FORBIDDEN) expect(text, String(pattern)).not.toMatch(pattern);
  });

  it("mã nguồn module (bỏ chú thích) không còn đối chiếu ngân hàng, CO/CE hay văn bản kế toán", () => {
    const files = [
      ...readdirSync(join(ROOT, "lib", "ai")).map((name) => join(ROOT, "lib", "ai", name)),
      join(ROOT, "app", "actions", "ai-tools.ts"),
      join(ROOT, "app", "ai", "ai-tools.tsx"),
      join(ROOT, "app", "ai", "page.tsx")
    ];
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/bank|recon|cost.?sheet|CO\/CE|FINANCE_MEMO|kế toán|ngân hàng|anthropic|claude/i);
    }
  });

  it("danh mục văn bản còn đúng 8 loại, không có văn bản kế toán", () => {
    expect(DOCUMENT_TYPES.map((type) => type.code)).toEqual([
      "DECISION",
      "ANNOUNCEMENT",
      "OFFICIAL_LETTER",
      "PROPOSAL",
      "MINUTES",
      "REGULATION",
      "VOLUNTEER_LETTER",
      "OTHER"
    ]);
    expect(resolveDocumentType("FINANCE_MEMO")).toBeNull();
    const text = JSON.stringify(DOCUMENT_TYPES);
    expect(text).not.toMatch(/kế toán|công nợ|nhắc nợ|thanh toán/i);
  });
});

describe("bối cảnh và luật chống bịa", () => {
  it("mọi prompt có system mở đầu bằng bối cảnh VAM, trừ soạn thảo văn bản dùng tên đơn vị", () => {
    for (const [name, messages] of ALL_PROMPTS) {
      const system = messages.find((message) => message.role === "system")?.content ?? "";
      if (name === "document") expect(system).toContain(VAM_ORG_NAME);
      else expect(system.startsWith(VAM_CONTEXT)).toBe(true);
    }
  });

  it("file đính kèm chỉ xuất hiện khi có", () => {
    expect(ALL_PROMPTS[0][1][1].content).toContain("TÀI LIỆU ĐÍNH KÈM");
    expect(ALL_PROMPTS[1][1][1].content).not.toContain("TÀI LIỆU ĐÍNH KÈM");
  });

  it("brief Canva bỏ dòng ghi chú khi không có ghi chú", () => {
    expect(canvaBriefPrompt({ deliverable: "Standee", note: null, attachmentsText: null })[1].content).not.toContain("Ghi chú");
    expect(canvaBriefPrompt({ deliverable: "Standee", note: "Tông xanh", attachmentsText: null })[1].content).toContain("Tông xanh");
  });

  it("báo cáo: nguồn không đọc được và chỉ số không tính được không bao giờ thành 0", () => {
    const user = executiveReportPrompt(REPORT)[1].content;
    expect(user).toContain("Hồ sơ ứng tuyển trong mùa: 1.234");
    expect(user).toContain("Cặp ghép: không tính được");
    expect(user).toMatch(/## Việc vận hành\nKHÔNG ĐỌC ĐƯỢC/);
    expect(user).not.toMatch(/Cặp ghép: 0/);
    expect(executiveReportPrompt(REPORT)[0].content).toContain("KHÔNG coi là bằng 0");
  });

  it("xu hướng có nguồn: đưa đủ link và ngày đăng, bắt dẫn nguồn", () => {
    const [system, user] = industryTrendGroundedPrompt("logistics", [
      { title: "Báo A", url: "https://a.vn/x", content: "Nội dung A", publishedDate: "2026-08-01" },
      { title: "Báo B", url: "https://b.vn/y", content: "Nội dung B", publishedDate: null }
    ]);
    expect(user.content).toContain("URL: https://a.vn/x");
    expect(user.content).toContain("Ngày đăng: 2026-08-01");
    expect(user.content).toContain("URL: https://b.vn/y");
    expect(user.content).toContain("NGUỒN TÌM ĐƯỢC (2)");
    expect(system.content).toContain("MỖI nhận định lấy từ nguồn phải kèm");
  });

  it("xu hướng không nguồn: buộc nói rõ không có internet và cấm đưa số liệu", () => {
    const system = industryTrendPrompt("logistics")[0].content;
    expect(system).toContain("KHÔNG có kết nối internet");
    expect(system).toContain("TUYỆT ĐỐI KHÔNG nêu số liệu");
  });

  it("soạn thảo: bố cục đúng thứ tự, file tham chiếu chỉ để học bố cục", () => {
    const type = resolveDocumentType("PROPOSAL")!;
    const [system, user] = documentDraftPrompt({
      type,
      subject: "Về việc tổ chức orientation",
      brief: "Kinh phí 5 triệu",
      referenceText: "Mẫu cũ",
      referenceName: "mau.docx",
      orgName: VAM_ORG_NAME
    });
    const positions = type.outline.map((line) => system.content.indexOf(line));
    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(user.content).toContain("TRÍCH YẾU NGƯỜI DÙNG ĐẶT: Về việc tổ chức orientation");
    expect(user.content).toContain("FILE THAM CHIẾU (mau.docx) — học bố cục và cách hành văn, KHÔNG chép số liệu");
  });
});

describe("withDocFormat", () => {
  it("chèn khuôn JSON đúng một lần, vào message system đầu tiên", () => {
    const out = withDocFormat([
      { role: "system", content: "A" },
      { role: "user", content: "B" },
      { role: "system", content: "C" }
    ]);
    expect(out[0].content).toBe(`A\n${DOC_JSON_FORMAT}`);
    expect(out[1].content).toBe("B");
    expect(out[2].content).toBe("C");
    expect(out.map((message) => message.content).join("").split(DOC_JSON_FORMAT)).toHaveLength(2);
  });

  it("prompt không có system thì thêm một system ở đầu", () => {
    expect(withDocFormat([{ role: "user", content: "B" }])).toEqual([
      { role: "system", content: DOC_JSON_FORMAT },
      { role: "user", content: "B" }
    ]);
  });

  it("khuôn cấm ký tự markdown trong nội dung khối", () => {
    expect(DOC_JSON_FORMAT).toContain("TUYỆT ĐỐI không dùng ký tự markdown");
  });
});
