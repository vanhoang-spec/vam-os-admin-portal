/**
 * Loại file quyết định bằng byte đầu, không bằng tên hay MIME trình duyệt gửi —
 * và không có đường nào để một file ảnh đi tiếp.
 */
import { describe, expect, it } from "vitest";
import {
  AI_UPLOAD_ACCEPT,
  AI_UPLOAD_KINDS,
  MAX_AI_FILE_BYTES,
  displayUploadName,
  looksLikeImage,
  sniffAiUpload,
  uploadExtension
} from "@/lib/ai/upload-core";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

const PDF = text("%PDF-1.7\n1 0 obj");
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46);
const GIF_TEXT = text("GIF89a hello");
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
const HEIC = bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63);

describe("sniffAiUpload — file hợp lệ", () => {
  it("nhận PDF, DOCX, XLSX và file chữ, trả MIME theo đuôi chứ không theo thứ trình duyệt gửi", () => {
    expect(sniffAiUpload(PDF, "Brief.PDF")).toEqual({ ok: true, extension: "pdf", mime: AI_UPLOAD_KINDS.pdf });
    expect(sniffAiUpload(ZIP, "mau.docx")).toEqual({ ok: true, extension: "docx", mime: AI_UPLOAD_KINDS.docx });
    expect(sniffAiUpload(ZIP, "so-lieu.xlsx")).toEqual({ ok: true, extension: "xlsx", mime: AI_UPLOAD_KINDS.xlsx });
    expect(sniffAiUpload(text("Chương trình UEH Mentoring"), "ghi-chu.txt")).toEqual({ ok: true, extension: "txt", mime: "text/plain" });
    expect(sniffAiUpload(text("a,b\n1,2"), "bang.csv")).toMatchObject({ ok: true, mime: "text/csv" });
    expect(sniffAiUpload(text("# Tiêu đề"), "note.md")).toMatchObject({ ok: true, mime: "text/markdown" });
  });

  it("chấp nhận tiêu đề PDF nằm sau rác trong 1024 byte đầu, như chuẩn PDF cho phép", () => {
    const junk = new Uint8Array(600).fill(0x20);
    const shifted = new Uint8Array([...Array.from(junk), ...Array.from(PDF)]);
    expect(sniffAiUpload(shifted, "a.pdf")).toMatchObject({ ok: true });

    const tooFar = new Uint8Array([...Array.from(new Uint8Array(2000).fill(0x20)), ...Array.from(PDF)]);
    expect(sniffAiUpload(tooFar, "a.pdf")).toEqual({ ok: false, reason: "signature" });
  });
});

describe("sniffAiUpload — không file ảnh nào đi qua", () => {
  it.each([
    ["PNG đội tên .pdf", PNG, "anh.pdf"],
    ["JPEG đội tên .txt", JPEG, "anh.txt"],
    ["GIF đội tên .md", GIF_TEXT, "anh.md"],
    ["WEBP đội tên .docx", WEBP, "anh.docx"],
    ["HEIC đội tên .xlsx", HEIC, "anh.xlsx"]
  ])("%s", (_label, content, name) => {
    expect(sniffAiUpload(content, name)).toEqual({ ok: false, reason: "image" });
  });

  it("đuôi ảnh bị từ chối ngay cả khi nội dung là chữ", () => {
    expect(sniffAiUpload(text("không phải ảnh"), "anh.png")).toEqual({ ok: false, reason: "extension" });
    expect(sniffAiUpload(text("<svg/>"), "logo.svg")).toEqual({ ok: false, reason: "extension" });
  });

  it("nhận ra các chữ ký ảnh mà libvips giải mã", () => {
    for (const image of [PNG, JPEG, GIF_TEXT, WEBP, HEIC]) expect(looksLikeImage(image)).toBe(true);
    for (const document of [PDF, ZIP, text("xin chào")]) expect(looksLikeImage(document)).toBe(false);
  });
});

describe("sniffAiUpload — nội dung không khớp đuôi", () => {
  it("PDF phải có tiêu đề %PDF-, DOCX/XLSX phải là ZIP", () => {
    expect(sniffAiUpload(ZIP, "gia-pdf.pdf")).toEqual({ ok: false, reason: "signature" });
    expect(sniffAiUpload(PDF, "gia-word.docx")).toEqual({ ok: false, reason: "signature" });
    expect(sniffAiUpload(text("a,b"), "gia-excel.xlsx")).toEqual({ ok: false, reason: "signature" });
  });

  it("file chữ phải là UTF-8 và không có byte NUL", () => {
    expect(sniffAiUpload(bytes(0x61, 0x00, 0x62), "a.csv")).toEqual({ ok: false, reason: "binary_text" });
    expect(sniffAiUpload(bytes(0xc3, 0x28), "a.txt")).toEqual({ ok: false, reason: "binary_text" });
  });

  it("từ chối đuôi ngoài danh sách và file không đuôi", () => {
    expect(sniffAiUpload(text("MZ"), "chay.exe")).toEqual({ ok: false, reason: "extension" });
    expect(sniffAiUpload(PDF, "khong-duoi")).toEqual({ ok: false, reason: "extension" });
    expect(sniffAiUpload(ZIP, "cu.doc")).toEqual({ ok: false, reason: "extension" });
  });

  it("từ chối file rỗng và file vượt 8MB", () => {
    expect(sniffAiUpload(new Uint8Array(0), "a.pdf")).toEqual({ ok: false, reason: "empty" });
    const big = new Uint8Array(MAX_AI_FILE_BYTES + 1);
    big.set(PDF, 0);
    expect(sniffAiUpload(big, "a.pdf")).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("tiện ích", () => {
  it("accept của ô chọn file khớp đúng danh sách đuôi", () => {
    expect(AI_UPLOAD_ACCEPT.split(",").map((value) => value.slice(1)).sort()).toEqual(Object.keys(AI_UPLOAD_KINDS).sort());
  });

  it("uploadExtension lấy đuôi viết thường", () => {
    expect(uploadExtension("Ke Hoach.Final.DOCX")).toBe("docx");
    expect(uploadExtension("khong-duoi")).toBe("");
  });

  it("displayUploadName cắt tên dài và thay tên rỗng", () => {
    expect(displayUploadName("")).toBe("file");
    expect(displayUploadName("a".repeat(120))).toHaveLength(80);
  });
});
