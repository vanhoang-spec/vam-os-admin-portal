/**
 * Đường duy nhất lấy byte của file tải lên: kiểm kích thước và byte đầu TRƯỚC khi
 * đưa cho bộ lấy chữ, và không một file hỏng nào làm hỏng cả lượt.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const extractTextFromFile = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/extract-text", () => ({ extractTextFromFile }));

import { MAX_AI_FILE_BYTES } from "@/lib/ai/upload-core";
import { readAiUploads, uploadsToPromptText } from "@/lib/ai/uploads";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nnội dung");
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function formWith(field: string, files: Array<File | string>) {
  const data = new FormData();
  for (const file of files) data.append(field, file);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  extractTextFromFile.mockResolvedValue({ text: "chữ lấy từ file", truncated: false });
});

describe("readAiUploads", () => {
  it("ảnh đội tên .pdf bị từ chối và KHÔNG tới bộ lấy chữ", async () => {
    const result = await readAiUploads(formWith("files", [new File([PNG_BYTES], "brief.pdf", { type: "application/pdf" })]), "files", {
      maxChars: 6000
    });
    expect(extractTextFromFile).not.toHaveBeenCalled();
    expect(result).toEqual({ files: [], rejected: ["brief.pdf (không nhận file ảnh)"] });
  });

  it("đưa đúng byte đã kiểm cho bộ lấy chữ, với MIME theo nội dung chứ không theo trình duyệt", async () => {
    const result = await readAiUploads(formWith("files", [new File([PDF_BYTES], "brief.pdf", { type: "image/png" })]), "files", {
      maxChars: 1234
    });
    expect(extractTextFromFile).toHaveBeenCalledTimes(1);
    const [buffer, mime, options] = extractTextFromFile.mock.calls[0];
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(Array.from(buffer as Buffer)).toEqual(Array.from(PDF_BYTES));
    expect(mime).toBe("application/pdf");
    expect(options).toEqual({ maxChars: 1234 });
    expect(result).toEqual({ files: [{ name: "brief.pdf", text: "chữ lấy từ file", truncated: false }], rejected: [] });
  });

  it("file vượt 8MB bị từ chối trước khi đọc", async () => {
    const big = new File([new Uint8Array(MAX_AI_FILE_BYTES + 1)], "to.pdf");
    const readSpy = vi.spyOn(big, "arrayBuffer");
    const result = await readAiUploads(formWith("files", [big]), "files", { maxChars: 6000 });
    expect(readSpy).not.toHaveBeenCalled();
    expect(extractTextFromFile).not.toHaveBeenCalled();
    expect(result.rejected).toEqual(["to.pdf (quá 8MB)"]);
  });

  it("chỉ đọc đủ số file cho phép, file thừa được báo lại", async () => {
    const files = ["a", "b", "c", "d"].map((name) => new File([PDF_BYTES], `${name}.pdf`));
    const result = await readAiUploads(formWith("files", files), "files", { maxChars: 6000 });
    expect(extractTextFromFile).toHaveBeenCalledTimes(3);
    expect(result.files.map((file) => file.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(result.rejected).toEqual(["d.pdf (quá 3 file)"]);

    vi.clearAllMocks();
    extractTextFromFile.mockResolvedValue({ text: "x", truncated: false });
    const single = await readAiUploads(formWith("reference", files.slice(0, 2)), "reference", { maxChars: 6000, maxFiles: 1 });
    expect(single.files).toHaveLength(1);
    // Trần của chính công cụ, không phải trần mặc định 3.
    expect(single.rejected).toEqual(["b.pdf (quá 1 file)"]);
  });

  it("file không lấy được chữ, hoặc bộ lấy chữ lỗi, được báo lại mà không làm hỏng các file khác", async () => {
    extractTextFromFile
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("hỏng"))
      .mockResolvedValueOnce({ text: "đọc được", truncated: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const files = ["scan", "loi", "tot"].map((name) => new File([PDF_BYTES], `${name}.pdf`));
    const result = await readAiUploads(formWith("files", files), "files", { maxChars: 6000 });
    expect(result.files).toEqual([{ name: "tot.pdf", text: "đọc được", truncated: true }]);
    expect(result.rejected).toEqual([
      "scan.pdf (không lấy được chữ (file scan hoặc hỏng?))",
      "loi.pdf (không lấy được chữ (file scan hoặc hỏng?))"
    ]);
  });

  it("bỏ qua giá trị không phải file và file rỗng", async () => {
    const result = await readAiUploads(formWith("files", ["chữ", new File([], "rong.pdf")]), "files", { maxChars: 6000 });
    expect(result).toEqual({ files: [], rejected: [] });
    expect(extractTextFromFile).not.toHaveBeenCalled();
  });
});

describe("uploadsToPromptText", () => {
  it("không có file thì trả null, có file thì ghép kèm tên và dấu cắt bớt", () => {
    expect(uploadsToPromptText([])).toBeNull();
    expect(
      uploadsToPromptText([
        { name: "a.pdf", text: "Một", truncated: false },
        { name: "b.docx", text: "Hai", truncated: true }
      ])
    ).toBe("--- a.pdf ---\nMột\n\n--- b.docx ---\nHai\n…(đã cắt bớt, file dài hơn)");
  });
});
