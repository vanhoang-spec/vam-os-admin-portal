"use server";

import { revalidatePath } from "next/cache";
import {
  applyLegacyMentorImport,
  createLegacyMentorManually,
  previewLegacyMentorImport
} from "@/lib/legacy-mentor-service";
import {
  initialLegacyImportState,
  initialLegacyManualState,
  type LegacyImportState,
  type LegacyManualState
} from "./state";

export async function previewLegacyImportAction(
  _: LegacyImportState,
  formData: FormData
): Promise<LegacyImportState> {
  const file = formData.get("csv_file");
  if (!(file instanceof File)) return { ...initialLegacyImportState, message: "Vui lòng chọn tệp CSV." };
  try {
    const result = await previewLegacyMentorImport(await file.text());
    return {
      phase: "preview",
      ok: result.ok,
      message: result.ok
        ? "Bản xem trước hợp lệ. Chưa có person, profile, invitation hoặc membership nào được tạo."
        : [...result.errors, "Các dòng lỗi phải được sửa trước khi áp dụng."].join(" "),
      previewId: result.preview?.id,
      previewIntegrity: result.preview?.integrity,
      rows: result.rows,
      outcomes: []
    };
  } catch {
    return { ...initialLegacyImportState, message: "Không thể tạo bản xem trước an toàn." };
  }
}

export async function applyLegacyImportAction(
  _: LegacyImportState,
  formData: FormData
): Promise<LegacyImportState> {
  const previewId = String(formData.get("preview_id") ?? "");
  const integrity = String(formData.get("preview_integrity") ?? "");
  if (!previewId || !integrity) return { ...initialLegacyImportState, message: "Bản xem trước đã hết hạn." };
  try {
    const result = await applyLegacyMentorImport(previewId, integrity);
    if (result.ok) revalidatePath("/admin/renewals");
    return { phase: "complete", ok: result.ok, message: result.message, rows: [], outcomes: result.outcomes };
  } catch {
    return { ...initialLegacyImportState, message: "Áp dụng thất bại an toàn." };
  }
}

export async function createLegacyMentorManualAction(
  _: LegacyManualState,
  formData: FormData
): Promise<LegacyManualState> {
  try {
    const outcome = await createLegacyMentorManually({
      fullName: String(formData.get("full_name") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      legacyMentorCode: String(formData.get("legacy_mentor_code") ?? ""),
      priorSeason: String(formData.get("prior_season") ?? ""),
      notes: String(formData.get("notes") ?? "")
    });
    if (outcome.ok) revalidatePath("/admin/renewals");
    return {
      ok: outcome.ok,
      message: outcome.ok
        ? "Đã tạo/reuse ứng viên legacy mentor. Chưa tạo invitation hoặc membership."
        : `Không thể thêm legacy mentor: ${outcome.reason}`,
      outcome
    };
  } catch {
    return { ...initialLegacyManualState, message: "Không thể thêm legacy mentor an toàn." };
  }
}
