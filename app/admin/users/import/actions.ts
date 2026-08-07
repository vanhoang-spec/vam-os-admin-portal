"use server";

import { confirmAccountImport, previewAccountImport } from "@/lib/account-import-server";
import { initialImportState, type ImportActionState } from "./import-state";

export async function previewImportAction(_: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const file = formData.get("csv_file");
  if (!(file instanceof File)) return { ...initialImportState, message: "Vui lòng chọn tệp CSV." };
  const rawCsv = await file.text();
  try {
    const result = await previewAccountImport(rawCsv);
    return { phase: "preview", ok: result.ok, message: result.ok ? "Dữ liệu hợp lệ. Bản xem trước dùng một lần và hết hạn sau 10 phút." : [...result.errors, "Hãy sửa các dòng lỗi rồi tải lại."].filter(Boolean).join(" "), previewId: result.preview?.id, previewIntegrity: result.preview?.integrity, previewExpiresAt: result.preview?.expiresAt, rows: result.rows, outcomes: [] };
  } catch {
    return { ...initialImportState, message: "Không thể kiểm tra tệp. Không có dữ liệu hoặc lời mời nào được tạo." };
  }
}

export async function confirmImportAction(_: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const previewId = String(formData.get("preview_id") ?? "");
  const previewIntegrity = String(formData.get("preview_integrity") ?? "");
  if (!previewId || !previewIntegrity) return { ...initialImportState, message: "Phiên xem trước đã hết hạn. Vui lòng tải lại tệp." };
  try {
    const result = await confirmAccountImport(previewId, previewIntegrity);
    return { phase: "complete", ok: result.ok, message: result.message, rows: [], outcomes: result.outcomes };
  } catch {
    return { ...initialImportState, message: "Xác nhận thất bại an toàn. Kiểm tra cấu hình staging và thử lại." };
  }
}
