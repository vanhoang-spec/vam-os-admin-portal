"use server";

import { confirmAccountImport, previewAccountImport, type AccountImportOutcome } from "@/lib/account-import-server";
import type { AccountImportRow } from "@/lib/account-import";

export type ImportActionState = {
  phase: "idle" | "preview" | "complete";
  ok: boolean;
  message: string;
  rawCsv?: string;
  rows: AccountImportRow[];
  outcomes: AccountImportOutcome[];
};

export const initialImportState: ImportActionState = { phase: "idle", ok: false, message: "", rows: [], outcomes: [] };

export async function previewImportAction(_: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const file = formData.get("csv_file");
  if (!(file instanceof File)) return { ...initialImportState, message: "Vui lòng chọn tệp CSV." };
  const rawCsv = await file.text();
  try {
    const result = await previewAccountImport(rawCsv);
    return { phase: "preview", ok: result.ok, message: result.ok ? "Dữ liệu hợp lệ. Hãy kiểm tra kỹ trước khi xác nhận." : [...result.errors, "Hãy sửa các dòng lỗi rồi tải lại."].filter(Boolean).join(" "), rawCsv, rows: result.rows, outcomes: [] };
  } catch {
    return { ...initialImportState, message: "Không thể kiểm tra tệp. Không có dữ liệu hoặc lời mời nào được tạo." };
  }
}

export async function confirmImportAction(_: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const rawCsv = String(formData.get("raw_csv") ?? "");
  if (!rawCsv) return { ...initialImportState, message: "Phiên xem trước đã hết hạn. Vui lòng tải lại tệp." };
  try {
    const result = await confirmAccountImport(rawCsv);
    return { phase: "complete", ok: result.ok, message: result.message, rows: [], outcomes: result.outcomes };
  } catch {
    return { ...initialImportState, message: "Xác nhận thất bại an toàn. Kiểm tra cấu hình staging và thử lại." };
  }
}
