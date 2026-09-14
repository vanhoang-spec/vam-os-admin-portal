/**
 * lib/ai/upload-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * File nào được tải lên cho Công cụ AI, và làm sao biết một file đúng là loại nó nói.
 *
 * Module thuần, không I/O.
 *
 * VÌ SAO CHẶT THẾ NÀY
 * `__tests__/image-optimizer-attack-surface.test.ts` giữ cho bộ giải mã ảnh sharp /
 * libvips (đang có lỗ hổng chưa vá được) không bao giờ nhận byte do người dùng gửi.
 * Công cụ AI là chỗ đầu tiên trong app nhận file nhị phân, nên nó phải chứng minh
 * được ba điều:
 *   1. Không nhận ẢNH dưới bất kỳ tên nào — danh sách đuôi không có ảnh, và byte đầu
 *      của ảnh bị từ chối ngay cả khi file đội tên .pdf hay .txt.
 *   2. Loại file quyết định bằng BYTE ĐẦU, không bằng `file.type`: trình duyệt tự khai
 *      MIME theo đuôi tên, người gửi đặt được bất cứ gì.
 *   3. Byte chỉ đi vào bộ lấy chữ, không lưu, không trả ra — xem lib/ai/uploads.ts.
 */

export const AI_UPLOAD_KINDS = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown"
} as const;

export type AiUploadExtension = keyof typeof AI_UPLOAD_KINDS;

/** Giá trị `accept` của ô chọn file — test khoá đúng chuỗi này. */
export const AI_UPLOAD_ACCEPT = ".pdf,.docx,.xlsx,.txt,.csv,.md";

export const AI_UPLOAD_MIME: readonly string[] = Object.values(AI_UPLOAD_KINDS);

/**
 * 8MB mỗi file. `bodySizeLimit` của server action (next.config.mjs) áp cho MỌI action,
 * kể cả form ứng tuyển công khai, nên nó được đặt vừa đủ cho 1 file cỡ này chứ không
 * nới rộng cho cả app.
 */
export const MAX_AI_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_AI_FILES = 3;

export type AiUploadRejectReason = "empty" | "too_large" | "too_many" | "extension" | "image" | "signature" | "binary_text" | "unreadable";

export const AI_UPLOAD_REJECT_LABELS: Record<AiUploadRejectReason, string> = {
  empty: "file rỗng",
  too_large: "quá 8MB",
  too_many: "vượt số file cho phép",
  extension: "chỉ nhận PDF, DOCX, XLSX, TXT, CSV, MD",
  image: "không nhận file ảnh",
  signature: "nội dung không đúng loại file",
  binary_text: "không phải file chữ",
  unreadable: "không lấy được chữ (file scan hoặc hỏng?)"
};

export type AiUploadVerdict =
  | { ok: true; extension: AiUploadExtension; mime: string }
  | { ok: false; reason: AiUploadRejectReason };

export function uploadExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(String(name ?? "").trim());
  return match ? match[1].toLowerCase() : "";
}

function isAllowedExtension(value: string): value is AiUploadExtension {
  return Object.prototype.hasOwnProperty.call(AI_UPLOAD_KINDS, value);
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Byte đầu của các định dạng ảnh mà libvips giải mã được. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) || // GIF
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) || // WEBP
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || // TIFF little-endian
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]) || // TIFF big-endian
    startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4) || // HEIC / AVIF (hộp ftyp)
    startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) // ICO
  );
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — DOCX và XLSX đều là ZIP
/** Chuẩn PDF cho phép tiêu đề nằm trong 1024 byte đầu, có trình xuất PDF chèn rác trước nó. */
const PDF_HEADER_WINDOW = 1024;

function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, PDF_HEADER_WINDOW);
  for (let offset = 0; offset <= limit; offset++) {
    if (startsWith(bytes, PDF_MAGIC, offset)) return true;
  }
  return false;
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Quyết định một file có được đi tiếp vào bộ lấy chữ hay không. Luật đầu tiên khớp sẽ thắng. */
export function sniffAiUpload(bytes: Uint8Array, name: string): AiUploadVerdict {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > MAX_AI_FILE_BYTES) return { ok: false, reason: "too_large" };

  const extension = uploadExtension(name);
  if (!isAllowedExtension(extension)) return { ok: false, reason: "extension" };
  if (looksLikeImage(bytes)) return { ok: false, reason: "image" };

  const mime = AI_UPLOAD_KINDS[extension];
  if (extension === "pdf") {
    return hasPdfHeader(bytes) ? { ok: true, extension, mime } : { ok: false, reason: "signature" };
  }
  if (extension === "docx" || extension === "xlsx") {
    return startsWith(bytes, ZIP_MAGIC) ? { ok: true, extension, mime } : { ok: false, reason: "signature" };
  }
  return isUtf8Text(bytes) ? { ok: true, extension, mime } : { ok: false, reason: "binary_text" };
}

/** Tên file hiện lại cho người dùng — tên do người gửi tự đặt, cắt ngắn cho vừa dòng báo. */
export function displayUploadName(name: unknown): string {
  const value = String(name ?? "").trim() || "file";
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}
