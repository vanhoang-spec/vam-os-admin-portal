/**
 * Hướng dẫn một trang "Dùng Công cụ AI trên VAM OS" — không được nói sai màn hình.
 *
 * Người đọc tin hướng dẫn và đi tìm đúng chữ trên màn hình. Mỗi câu hướng dẫn
 * trích — tên menu, tên công cụ, nhãn nút, lời báo — phải có thật trong mã nguồn,
 * và mỗi con số (số file, dung lượng, ai dùng được) phải khớp hằng số đang chạy.
 * Đổi một nhãn hay một giới hạn mà quên sửa hướng dẫn thì test này đỏ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_UPLOAD_ACCEPT, MAX_AI_FILES, MAX_AI_FILE_BYTES } from "@/lib/ai/upload-core";
import { canRunAiExecutiveReport, canUseAiTools } from "@/lib/permissions";

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const html = read("docs/huong-dan/HUONG_DAN_CONG_CU_AI.html");
/** Hướng dẫn như người đọc thấy: bỏ thẻ, gộp khoảng trắng. */
const guideText = html.replace(/<style[\s\S]*?<\/style>/i, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const TOOLS = "app/ai/ai-tools.tsx";
const SHARED = "app/ai/ai-shared.tsx";
const CORE = "lib/ai/ai-core.ts";

// [câu hướng dẫn trích, file nguồn, chuỗi phải có trong file nguồn]
const QUOTED: Array<[string, string, string]> = [
  ["Vận hành → Công cụ AI", "lib/nav-model.ts", '{ href: "/ai", label: "Công cụ AI" }'],
  ["Tìm ý tưởng hoạt động", TOOLS, 'title="Tìm ý tưởng hoạt động"'],
  ["Viết content", TOOLS, 'title="Viết content"'],
  ["Brief thiết kế cho Canva AI", TOOLS, 'title="Brief thiết kế cho Canva AI"'],
  ["Báo cáo Ban điều hành", TOOLS, 'title="Báo cáo Ban điều hành"'],
  ["Xu hướng ngành tại Việt Nam", TOOLS, 'title="Xu hướng ngành tại Việt Nam"'],
  ["Soạn thảo văn bản", TOOLS, 'title="Soạn thảo văn bản"'],
  ["Chạy trợ lý", SHARED, '"Chạy trợ lý"'],
  ["Chạy lại", SHARED, '"Chạy lại"'],
  ["Đang xử lý… (có thể mất tới 1 phút)", SHARED, '"Đang xử lý… (có thể mất tới 1 phút)"'],
  ["Tải Word", SHARED, "Tải Word"],
  ["Tải PDF", SHARED, "Tải PDF"],
  ["Sao chép", SHARED, '"Sao chép"'],
  ["Không dùng được các file sau:", SHARED, "Không dùng được các file sau:"],
  ["không lấy được chữ", "lib/ai/upload-core.ts", 'unreadable: "không lấy được chữ'],
  // Nhãn nguồn dựng bằng `dựa trên ${state.sourceCount ?? 0} nguồn web`.
  ["Câu trả lời dựa trên N nguồn web", TOOLS, "Câu trả lời dựa trên ${state.sourceCount ?? 0} nguồn web"],
  ["Không có nguồn web", TOOLS, '"Không có nguồn web.'],
  ["Chưa cấu hình khoá API DeepSeek cho Công cụ AI.", CORE, "Chưa cấu hình khoá API DeepSeek cho Công cụ AI."],
  ["Trợ lý phản hồi quá lâu.", CORE, "Trợ lý phản hồi quá lâu."],
  ["Trợ lý trả về nội dung sai khuôn", CORE, "Trợ lý trả về nội dung sai khuôn"],
  ["DeepSeek đang từ chối yêu cầu", CORE, "DeepSeek đang từ chối yêu cầu"],
  ["Vai trò của bạn không dùng được Công cụ AI.", CORE, "Vai trò của bạn không dùng được Công cụ AI."]
];

describe("mỗi câu hướng dẫn trích đều có thật trên màn hình", () => {
  for (const [quote, file, needle] of QUOTED) {
    it(`"${quote}"`, () => {
      expect(guideText).toContain(quote);
      expect(read(file), `${file} không còn "${needle}"`).toContain(needle);
    });
  }

  it("menu Công cụ AI nằm trong nhóm Vận hành", () => {
    const nav = read("lib/nav-model.ts");
    const group = nav.indexOf('label: "Vận hành"');
    expect(group).toBeGreaterThan(-1);
    expect(nav.indexOf('{ href: "/ai", label: "Công cụ AI" }', group)).toBeGreaterThan(group);
  });
});

describe("những con số và quyền hướng dẫn khẳng định", () => {
  it("tối đa 3 file, mỗi file 8MB, đúng sáu loại file", () => {
    expect(guideText).toContain(`tối đa ${MAX_AI_FILES} file`);
    expect(guideText).toContain(`mỗi file ${MAX_AI_FILE_BYTES / (1024 * 1024)}MB`);
    const listed = AI_UPLOAD_ACCEPT.split(",").map((extension) => extension.slice(1).toUpperCase());
    expect(guideText).toContain(listed.join(", "));
  });

  it("soạn thảo văn bản nhận đúng 1 file mẫu", () => {
    expect(guideText).toContain("1 file mẫu");
    expect(read("app/actions/ai-tools.ts")).toContain('readAiUploads(formData, "reference", { maxChars: MAX_DOCUMENT_REF_CHARS, maxFiles: 1 })');
  });

  it("bốn vai trò dùng được, báo cáo Ban điều hành chỉ Super Admin và Admin", () => {
    expect(guideText).toContain("Super Admin, Admin, Core team, Support team");
    expect(["super_admin", "admin", "core_team", "support_team"].every((role) => canUseAiTools(role))).toBe(true);
    expect(["reviewer", "viewer"].some((role) => canUseAiTools(role))).toBe(false);

    expect(guideText).toContain("Báo cáo Ban điều hành chỉ Super Admin và Admin thấy");
    expect(["super_admin", "admin"].every((role) => canRunAiExecutiveReport(role))).toBe(true);
    expect(["core_team", "support_team"].some((role) => canRunAiExecutiveReport(role))).toBe(false);
  });

  it("nội dung được gửi sang DeepSeek, và app không lưu kết quả", () => {
    expect(guideText).toContain("DeepSeek, máy chủ ở nước ngoài");
    expect(guideText).toContain("App không lưu kết quả");
    expect(read(CORE)).toContain("được gửi sang DeepSeek (máy chủ ở nước ngoài)");
    expect(read("app/actions/ai-tools.ts")).not.toMatch(/supabase|\.insert\(|\.upsert\(/);
  });

  it("thiếu dữ kiện thì để chỗ trống, và không tự điền số hiệu, ngày ban hành", () => {
    expect(guideText).toContain("[…]");
    const rules = read("lib/ai/document-prompts.ts");
    expect(rules).toContain("ĐỂ CHỖ TRỐNG dạng […]");
    expect(rules).toContain("KHÔNG tự sinh SỐ HIỆU văn bản và KHÔNG tự điền ngày ban hành");
  });

  it("mục báo cáo không đọc được không phải bằng 0", () => {
    expect(guideText).toContain("không phải bằng 0");
    expect(read("lib/ai/prompts.ts")).toContain("KHÔNG coi là bằng 0");
  });

  it("chữ đã gõ còn nguyên sau khi chạy", () => {
    expect(guideText).toContain("chữ bạn đã gõ vẫn còn nguyên");
    expect(read(TOOLS).match(/onReset=\{keepFormValues\}/g)).toHaveLength(6);
  });
});

describe("hướng dẫn không mang dữ liệu người thật", () => {
  it("không có địa chỉ email hay số điện thoại nào", () => {
    expect(html).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(html).not.toMatch(/\b0\d{9}\b/);
  });
});
