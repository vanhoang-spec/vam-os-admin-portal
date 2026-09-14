import "server-only";

import { extractTextFromFile } from "./extract-text";
import {
  AI_UPLOAD_REJECT_LABELS,
  MAX_AI_FILE_BYTES,
  MAX_AI_FILES,
  displayUploadName,
  sniffAiUpload,
  type AiUploadRejectReason
} from "./upload-core";

/**
 * CỬA DUY NHẤT lấy byte của file người dùng tải lên.
 *
 * `__tests__/image-optimizer-attack-surface.test.ts` khoá rằng trong app/, lib/,
 * components/ chỉ file này được gọi `arrayBuffer()`. Byte đi đúng một đường:
 * kiểm kích thước → kiểm byte đầu (upload-core) → bộ lấy chữ → trả về CHỮ. Không lưu
 * xuống đâu, không trả byte ra ngoài, không đưa cho thư viện ảnh nào.
 *
 * Không bao giờ ném lỗi vì một file hỏng: file bị từ chối được ghi tên kèm lý do để
 * màn hình báo lại, và công cụ vẫn chạy với phần còn lại — bắt người dùng làm lại cả
 * lượt vì một file hỏng là tệ hơn.
 */

export type AiUploadText = { name: string; text: string; truncated: boolean };
export type AiUploadResult = { files: AiUploadText[]; rejected: string[] };

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
    // Kiểm kích thước TRƯỚC khi đọc byte: đọc cả file lớn vào bộ nhớ rồi mới từ chối
    // là tự làm đầy RAM của function.
    if (file.size > MAX_AI_FILE_BYTES) {
      reject(file, "too_large");
      continue;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const verdict = sniffAiUpload(bytes, file.name);
      if (!verdict.ok) {
        reject(file, verdict.reason);
        continue;
      }
      const extracted = await extractTextFromFile(Buffer.from(bytes), verdict.mime, { maxChars: opts.maxChars });
      if (!extracted || !extracted.text.trim()) {
        reject(file, "unreadable");
        continue;
      }
      files.push({ name: displayUploadName(file.name), text: extracted.text, truncated: extracted.truncated });
    } catch (error) {
      console.error("[AI] đọc file tải lên lỗi (bỏ qua file này):", error);
      reject(file, "unreadable");
    }
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
