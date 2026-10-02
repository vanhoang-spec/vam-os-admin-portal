import "server-only";

import { extractTextFromFile, type ExtractOptions } from "./extract-text";
import {
  AI_UPLOAD_KINDS,
  AI_UPLOAD_REJECT_LABELS,
  MAX_AI_FILE_BYTES,
  MAX_AI_FILES,
  displayUploadName,
  sniffAiUpload,
  uploadExtension,
  type AiUploadRejectReason
} from "./upload-core";
import { sanitizeHandbookHtml } from "@/lib/handbook-html";

/**
 * CỬA DUY NHẤT lấy byte của file người dùng tải lên.
 *
 * `__tests__/image-optimizer-attack-surface.test.ts` khoá rằng trong app/, lib/,
 * components/ chỉ file này được gọi `arrayBuffer()`. Byte đi đúng một đường:
 * kiểm kích thước → kiểm byte đầu (upload-core) → bộ lấy chữ → trả về CHỮ. Không lưu
 * xuống đâu, không trả byte ra ngoài, không đưa cho thư viện ảnh nào.
 *
 * Hai nơi dùng chung đúng một đường đó (`readVerifiedUpload`): Công cụ AI (chữ
 * thuần) và Handbook phỏng vấn mentee (HTML chữ + bảng, ảnh bị bỏ — tái phân loại
 * 02/10/2026 ghi trong test trên).
 *
 * Không bao giờ ném lỗi vì một file hỏng: file bị từ chối được ghi tên kèm lý do để
 * màn hình báo lại, và công cụ vẫn chạy với phần còn lại — bắt người dùng làm lại cả
 * lượt vì một file hỏng là tệ hơn.
 */

export type AiUploadText = { name: string; text: string; truncated: boolean };
export type AiUploadResult = { files: AiUploadText[]; rejected: string[] };

type VerifiedRead =
  | { ok: true; name: string; text: string; truncated: boolean }
  | { ok: false; reason: AiUploadRejectReason };

async function readVerifiedUpload(file: File, opts: ExtractOptions & { onlyMime?: string }): Promise<VerifiedRead> {
  // Kiểm kích thước TRƯỚC khi đọc byte: đọc cả file lớn vào bộ nhớ rồi mới từ chối
  // là tự làm đầy RAM của function.
  if (file.size > MAX_AI_FILE_BYTES) return { ok: false, reason: "too_large" };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verdict = sniffAiUpload(bytes, file.name);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    if (opts.onlyMime && verdict.mime !== opts.onlyMime) return { ok: false, reason: "extension" };
    const extracted = await extractTextFromFile(Buffer.from(bytes), verdict.mime, opts);
    if (!extracted || (!extracted.text.trim() && !extracted.truncated)) return { ok: false, reason: "unreadable" };
    return { ok: true, name: displayUploadName(file.name), text: extracted.text, truncated: extracted.truncated };
  } catch (error) {
    console.error("[upload] đọc file tải lên lỗi (bỏ qua file này):", error);
    return { ok: false, reason: "unreadable" };
  }
}

export async function readAiUploads(
  formData: FormData,
  field: string,
  opts: { maxChars: number; maxFiles?: number }
): Promise<AiUploadResult> {
  const maxFiles = opts.maxFiles ?? MAX_AI_FILES;
  const entries = formData.getAll(field).filter((value): value is File => value instanceof File && value.size > 0);

  const files: AiUploadText[] = [];
  const rejected: string[] = [];
  // "quá N file" phải nói đúng trần của chính công cụ: soạn thảo chỉ nhận 1 file mẫu.
  const reject = (file: File, reason: AiUploadRejectReason) =>
    rejected.push(
      `${displayUploadName(file.name)} (${reason === "too_many" ? `quá ${maxFiles} file` : AI_UPLOAD_REJECT_LABELS[reason]})`
    );

  for (let index = 0; index < entries.length; index++) {
    const file = entries[index];
    if (index >= maxFiles) {
      reject(file, "too_many");
      continue;
    }
    const read = await readVerifiedUpload(file, { maxChars: opts.maxChars });
    if (!read.ok) {
      reject(file, read.reason);
      continue;
    }
    files.push({ name: read.name, text: read.text, truncated: read.truncated });
  }

  return { files, rejected };
}

/** Ghép chữ của các file thành một khối cho prompt; null khi không có file nào đọc được. */
export function uploadsToPromptText(files: AiUploadText[]): string | null {
  if (files.length === 0) return null;
  return files
    .map((file) => `--- ${file.name} ---\n${file.text}${file.truncated ? "\n…(đã cắt bớt, file dài hơn)" : ""}`)
    .join("\n\n");
}

/** Trần HTML của Handbook sau chuyển đổi — dưới trần 500.000 ký tự của vam106_save_interview_handbook. */
export const HANDBOOK_MAX_HTML_CHARS = 450_000;

export type HandbookUpload = { ok: true; name: string; html: string } | { ok: false; message: string };

/**
 * Handbook phỏng vấn mentee: đúng MỘT file .docx, nhận diện bằng byte đầu, chuyển
 * sang HTML chữ + bảng (ảnh bị bỏ), lọc thẻ, trả về CHỮ. Không lưu byte ở đâu cả.
 */
export async function readHandbookDocx(formData: FormData, field: string): Promise<HandbookUpload> {
  const entries = formData.getAll(field).filter((value): value is File => value instanceof File && value.size > 0);
  if (entries.length !== 1) return { ok: false, message: "Chọn đúng một file Word (.docx)." };
  const file = entries[0];
  if (uploadExtension(file.name) !== "docx") return { ok: false, message: "Handbook phải là file Word .docx." };
  const read = await readVerifiedUpload(file, {
    format: "html",
    maxChars: HANDBOOK_MAX_HTML_CHARS,
    onlyMime: AI_UPLOAD_KINDS.docx
  });
  if (!read.ok) {
    const label = read.reason === "extension" ? "chỉ nhận file Word .docx" : AI_UPLOAD_REJECT_LABELS[read.reason];
    return { ok: false, message: `${displayUploadName(file.name)} (${label})` };
  }
  if (read.truncated) return { ok: false, message: "Handbook quá dài sau khi chuyển đổi — tách bớt nội dung rồi tải lại." };
  const html = sanitizeHandbookHtml(read.text);
  if (!html) return { ok: false, message: `${displayUploadName(file.name)} (không đọc được nội dung)` };
  return { ok: true, name: read.name, html };
}
