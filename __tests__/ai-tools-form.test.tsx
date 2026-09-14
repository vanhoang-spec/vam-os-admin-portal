/** @vitest-environment jsdom */
/**
 * Form của Công cụ AI dựng được thật (bắt useActionState — thứ qua được cả bốn
 * cổng rồi mới vỡ lúc chạy), và khối kết quả nói đúng điều cần nói.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiState } from "@/lib/ai-action-types";

const formState = vi.hoisted(() => ({ value: null as AiState | null }));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormState: (action: unknown, initial: AiState) => [formState.value ?? initial, action],
  useFormStatus: () => ({ pending: false })
}));

vi.mock("@/app/actions/ai-tools", () => ({
  brainstormIdeas: vi.fn(),
  writeContent: vi.fn(),
  generateCanvaBrief: vi.fn(),
  generateExecutiveReport: vi.fn(),
  askIndustryTrend: vi.fn(),
  draftDocument: vi.fn()
}));

import { BrainstormTool, DocumentTool, ExecutiveReportTool, TrendTool } from "@/app/ai/ai-tools";

const DOC = {
  title: "Ý tưởng networking",
  blocks: [
    { type: "heading" as const, level: 1 as const, text: "Ba ý tưởng" },
    { type: "paragraph" as const, text: "Xoay vòng nhóm nhỏ" }
  ]
};

beforeEach(() => {
  formState.value = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("form dựng được và mang đúng trường", () => {
  it("tìm ý tưởng: ô chủ đề, brief, ô file đúng accept, và chặn reset làm mất chữ", () => {
    const { container } = render(<BrainstormTool />);
    const form = container.querySelector("form")!;
    expect(form.querySelector('input[name="topic"]')).not.toBeNull();
    expect(form.querySelector('textarea[name="brief"]')).not.toBeNull();
    const file = form.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file.name).toBe("files");
    expect(file.multiple).toBe(true);
    expect(file.accept).toBe(".pdf,.docx,.xlsx,.txt,.csv,.md");

    const reset = new Event("reset", { cancelable: true, bubbles: true });
    form.dispatchEvent(reset);
    expect(reset.defaultPrevented).toBe(true);
  });

  it("báo cáo gửi đúng mùa màn hình đang hiện và nói rõ chỉ số tổng được gửi đi", () => {
    const { container } = render(<ExecutiveReportTool seasonCode="UEHM-S12" seasonName="Mùa 12" />);
    expect((container.querySelector('input[name="season"]') as HTMLInputElement).value).toBe("UEHM-S12");
    expect(container.textContent).toContain("Chỉ các con số tổng");
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it("soạn thảo: không có văn bản kế toán, đổi loại thì đổi gợi ý, chỉ một file mẫu", () => {
    const { container } = render(<DocumentTool />);
    const select = container.querySelector('select[name="docType"]') as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toHaveLength(8);
    expect(labels.join("|")).not.toMatch(/kế toán/i);

    fireEvent.change(select, { target: { value: "OFFICIAL_LETTER" } });
    expect(container.textContent).toContain("Gửi nhà trường, doanh nghiệp đối tác, nhà tài trợ");

    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file.name).toBe("reference");
    expect(file.multiple).toBe(false);
  });
});

describe("xu hướng ngành nói rõ nguồn gốc câu trả lời", () => {
  it("chưa bật tìm web thì cảnh báo trước ô nhập", () => {
    render(<TrendTool webSearchOn={false} />);
    expect(screen.getByText(/trợ lý KHÔNG truy cập internet/)).toBeTruthy();
  });

  it("có nguồn thì ghi số nguồn, không nguồn thì ghi là kiến thức chung", () => {
    formState.value = { doc: DOC, grounded: true, sourceCount: 3 };
    render(<TrendTool webSearchOn />);
    expect(screen.getByTestId("trend-grounding").textContent).toContain("dựa trên 3 nguồn web");
    cleanup();

    formState.value = { doc: DOC, grounded: false };
    render(<TrendTool webSearchOn />);
    expect(screen.getByTestId("trend-grounding").textContent).toContain("Không có nguồn web");
  });

  it("chưa có kết quả thì không có nhãn nguồn", () => {
    render(<TrendTool webSearchOn />);
    expect(screen.queryByTestId("trend-grounding")).toBeNull();
  });
});

describe("khối kết quả", () => {
  it("lỗi hiện thành alert, file bị từ chối liệt kê đủ", () => {
    formState.value = { error: "Trợ lý phản hồi quá lâu.", rejectedFiles: ["poster.pdf (không nhận file ảnh)"] };
    render(<BrainstormTool />);
    expect(screen.getByRole("alert").textContent).toBe("Trợ lý phản hồi quá lâu.");
    expect(screen.getByText("poster.pdf (không nhận file ảnh)")).toBeTruthy();
  });

  it("tài liệu hiện đủ, và form Tải Word gửi đúng tài liệu đang hiện tới route xuất", () => {
    formState.value = { doc: DOC };
    const { container } = render(<BrainstormTool />);
    expect(container.textContent).toContain("Ba ý tưởng");
    expect(container.textContent).toContain("Xoay vòng nhóm nhỏ");
    expect(container.textContent).toContain("Nội dung do AI soạn");

    const exportForm = screen.getByRole("button", { name: /Tải Word/ }).closest("form")!;
    expect(exportForm.getAttribute("action")).toBe("/api/ai-doc/docx");
    expect(exportForm.getAttribute("method")).toBe("POST");
    expect(exportForm.getAttribute("target")).toBe("_blank");
    const hidden = within(exportForm).getByDisplayValue(JSON.stringify(DOC)) as HTMLInputElement;
    expect(hidden.name).toBe("doc");
  });

  it("Sao chép đổ tài liệu ra chữ thuần; clipboard bị chặn thì báo không sao chép được", async () => {
    formState.value = { doc: DOC };
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<BrainstormTool />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    expect(await screen.findByRole("button", { name: "Đã sao chép" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("Ý tưởng networking\n\nBA Ý TƯỞNG\n\nXoay vòng nhóm nhỏ");
    cleanup();

    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<BrainstormTool />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    expect(await screen.findByRole("button", { name: "Không sao chép được" })).toBeTruthy();
  });

  it("Tải PDF chỉ đánh dấu đúng khối kết quả rồi gỡ dấu sau khi in", () => {
    formState.value = { doc: DOC };
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<BrainstormTool />);
    fireEvent.click(screen.getByRole("button", { name: /Tải PDF/ }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("ai-printing")).toBe(true);
    expect(document.querySelectorAll(".ai-print-target")).toHaveLength(1);

    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("ai-printing")).toBe(false);
    expect(document.querySelectorAll(".ai-print-target")).toHaveLength(0);
  });
});

describe("không dùng useActionState", () => {
  it("không file nào của module AI gọi useActionState", () => {
    const root = join(__dirname, "..", "app", "ai");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const code = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/useActionState/);
    }
  });
});
