/**
 * Hướng dẫn một trang "Từ VAM OS sang Canva AI" — không được nói sai màn hình.
 *
 * Người đọc là Support team: họ mở hướng dẫn ra và đi tìm đúng chữ trên màn
 * hình. Mỗi nhãn nút, mỗi lời báo lỗi, mỗi con số trong tài liệu phải có thật
 * trong mã nguồn đang chạy. Đổi một nhãn mà quên sửa hướng dẫn thì test này đỏ
 * — rẻ hơn nhiều so với một bạn support đi tìm cái nút không tồn tại.
 *
 * Nửa Canva của hướng dẫn KHÔNG khoá được như vậy: đó là sản phẩm của bên khác
 * và họ đổi giao diện lúc nào tuỳ họ. Vì thế tài liệu cố ý tả Canva theo CHỨC
 * NĂNG ("ô nhập mô tả") chứ không theo nhãn nút, và ca cuối canh đúng điều đó.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_UPLOAD_ACCEPT, MAX_AI_FILES, MAX_AI_FILE_BYTES } from "@/lib/ai/upload-core";
import { AI_INPUT_LIMITS } from "@/lib/ai/ai-core";
import { canUseAiTools } from "@/lib/permissions";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const html = read("docs/huong-dan/HUONG_DAN_CANVA_AI.html");
/** Hướng dẫn như người đọc thấy: bỏ style, bỏ thẻ, gộp khoảng trắng. */
const guideText = html
  .replace(/<style[\s\S]*?<\/style>/i, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

const TOOLS = "app/ai/ai-tools.tsx";
const SHARED = "app/ai/ai-shared.tsx";
const CORE = "lib/ai/ai-core.ts";
const PROMPTS = "lib/ai/prompts.ts";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  ["Vận hành → Công cụ AI", "lib/nav-model.ts", '{ href: "/ai", label: "Công cụ AI" }'],
  ["Brief thiết kế cho Canva AI", TOOLS, 'title="Brief thiết kế cho Canva AI"'],
  ["Hạng mục cần thiết kế", TOOLS, ">Hạng mục cần thiết kế</label>"],
  ["Ghi chú / định hướng (tuỳ chọn)", TOOLS, ">Ghi chú / định hướng (tuỳ chọn)</label>"],
  ["Key visual, backdrop, standee, bài đăng Facebook…", TOOLS, 'placeholder="Key visual, backdrop, standee, bài đăng Facebook…"'],
  ["Tài liệu đính kèm (tuỳ chọn)", TOOLS, 'label="Tài liệu đính kèm (tuỳ chọn)"'],
  ["Chạy trợ lý", SHARED, '"Chạy trợ lý"'],
  ["Chạy lại", SHARED, '"Chạy lại"'],
  ["Sao chép", SHARED, '"Sao chép"'],
  ["Tải Word", SHARED, "Tải Word"],
  ["Tải PDF", SHARED, "Tải PDF"],
  ["Vai trò của bạn không dùng được Công cụ AI.", CORE, "Vai trò của bạn không dùng được Công cụ AI."],
  ["Trợ lý phản hồi quá lâu. Vui lòng thử lại.", CORE, "Trợ lý phản hồi quá lâu. Vui lòng thử lại."],
  ["DeepSeek đang từ chối yêu cầu", CORE, "DeepSeek đang từ chối yêu cầu"],
  ["Chưa cấu hình khoá API DeepSeek", CORE, "Chưa cấu hình khoá API DeepSeek"],
  ["Phiên đăng nhập đã hết hạn.", CORE, "Phiên đăng nhập đã hết hạn."],
  // Ba phần của kết quả đúng như prompt hệ thống yêu cầu model trả về.
  ["Ghi chú cho người thiết kế", PROMPTS, "Ghi chú cho người thiết kế"],
  ["Checklist trước khi gửi duyệt", PROMPTS, "Checklist trước khi gửi duyệt"],
  ["placeholder palette", PROMPTS, "placeholder palette"]
];

describe("1. mọi chữ trích trong hướng dẫn đều có thật trên màn hình", () => {
  it.each(QUOTED)("“%s”", (quoted, sourceFile, needle) => {
    expect(guideText).toContain(quoted);
    expect(read(sourceFile)).toContain(needle);
  });
});

describe("2. các con số khớp hằng số đang chạy", () => {
  it("số file và dung lượng tối đa", () => {
    expect(MAX_AI_FILES).toBe(3);
    expect(guideText).toContain(`${MAX_AI_FILES} file`);
    expect(MAX_AI_FILE_BYTES / (1024 * 1024)).toBe(8);
    expect(guideText).toContain("8MB");
  });

  it("đủ sáu đuôi file mà ô đính kèm nhận", () => {
    for (const ext of AI_UPLOAD_ACCEPT.split(",")) {
      expect(guideText).toContain(ext.replace(".", "").toUpperCase());
    }
  });

  /**
   * Bốn vai trò này là câu trả lời cho "tôi có dùng được không" — câu đầu tiên
   * người đọc hỏi. Thêm hay bớt một vai trò mà quên sửa hướng dẫn thì hoặc có
   * người bị từ chối oan, hoặc có người đi xin quyền họ đã có.
   */
  it("đúng bốn vai trò dùng được Công cụ AI", () => {
    const roles: Array<[string, string]> = [
      ["super_admin", "Super Admin"],
      ["admin", "Admin"],
      ["core_team", "Core team"],
      ["support_team", "Support team"]
    ];
    for (const [role, label] of roles) {
      expect(canUseAiTools(role)).toBe(true);
      expect(guideText).toContain(label);
    }
    for (const role of ["reviewer", "mentor", "mentee", ""]) {
      expect(canUseAiTools(role)).toBe(false);
    }
  });

  it("ô ghi chú vẫn là ô dài — hướng dẫn bảo người đọc viết kỹ vào đó", () => {
    expect(AI_INPUT_LIMITS.note).toBeGreaterThan(AI_INPUT_LIMITS.deliverable);
    expect(guideText).toContain("Đây là ô quyết định chất lượng");
  });
});

describe("3. những điều tài liệu không được quên", () => {
  it("nói rõ prompt giữ nguyên tiếng Anh", () => {
    expect(guideText).toContain("Đừng dịch prompt sang tiếng Việt");
    // Và nêu đúng lý do đã viết trong prompt hệ thống.
    expect(read(PROMPTS)).toContain("Canva AI hiểu prompt tiếng Anh tốt hơn");
    expect(guideText).toContain("ít lệch bố cục");
  });

  it("cấm đưa dữ liệu cá nhân sang nhà cung cấp ngoài", () => {
    expect(guideText).toContain("Không đưa dữ liệu cá nhân vào ô nhập");
    expect(guideText).toContain("DeepSeek");
    expect(guideText).toContain("Canva");
  });

  it("nhắc kiểm lại kết quả AI, đúng câu app vẫn in dưới mỗi tài liệu", () => {
    expect(read(CORE)).toContain("Nội dung do AI soạn — người đọc phải kiểm lại trước khi dùng.");
    expect(guideText).toContain("Nội dung do AI soạn — người đọc phải kiểm lại trước khi dùng.");
  });

  it("dạy dán MỘT prompt một lần — lỗi hay gặp nhất của người mới", () => {
    expect(guideText).toContain("Dán MỘT prompt, không dán cả tài liệu");
  });

  /**
   * Canva là sản phẩm của bên khác: nhãn nút của họ đổi mà không ai báo, nên
   * hướng dẫn cố ý không ghim vào nhãn đó. Ca này canh cái sự cố ý ấy.
   */
  it("tả Canva theo chức năng và nói thẳng là nhãn nút sẽ đổi", () => {
    expect(guideText).toContain("ô nhập mô tả");
    expect(guideText).toContain("Canva đổi tên nút khá thường xuyên");
  });

  it("không mang dữ liệu cá nhân của người thật", () => {
    expect(guideText).not.toMatch(/[\w.+-]+@(?!example\.com)[\w-]+\.[\w.]+/);
    expect(guideText).not.toMatch(/0\d{9}/);
  });
});

describe("4. vẫn đúng MỘT trang khi in", () => {
  /**
   * Quy tắc "giữ đúng một trang" của thư mục này lâu nay là một dòng nhắc trong
   * README, tức là phụ thuộc vào việc người sửa có nhớ mở PDF ra đếm hay không.
   * Đếm thẳng trong PDF thì không phải nhớ nữa.
   */
  it("bản PDF có đúng một trang", () => {
    const pdf = readFileSync(join(ROOT, "docs/huong-dan/HUONG_DAN_CANVA_AI.pdf"), "latin1");
    const pages = pdf.match(/\/Type\s*\/Page[^s]/g);
    expect(pages, "không đọc được số trang trong PDF — dựng lại bằng Chrome headless").not.toBeNull();
    expect(pages).toHaveLength(1);
  });
});
