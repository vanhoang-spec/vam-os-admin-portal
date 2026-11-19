import "server-only";

/**
 * Mail › ảnh trong thân thư (VAM00038) — chỗ DUY NHẤT trong mã chạm kho công khai 'mail-anh'.
 *
 * Máy chủ VAM không bao giờ nhận, đọc hay phục vụ byte ảnh. Nó chỉ:
 *   - cấp link TẢI LÊN ký sẵn cho đường dẫn do chính nó sinh (<mùa>/<uuid>.<đuôi>);
 *   - dựng địa chỉ công khai của đúng đường dẫn đó (getPublicUrl chỉ ghép chuỗi, không gọi mạng).
 * Trình duyệt tự PUT ảnh lên kho; ứng dụng thư của người nhận tự tải ảnh từ kho. Kho tự chặn loại và cỡ
 * (png/jpeg/gif/webp, 3 MB). Mục 3f của __tests__/image-optimizer-attack-surface.test.ts khoá file này.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { MAIL_ANH_BUCKET, duongDanAnhMoi, kiemAnhThu, type AnhKhaiBao } from "@/lib/mail-anh-core";

const LOI_KHO =
  "Chưa mở được kho ảnh của thư. Nếu hệ thống vừa cập nhật, có thể kho chưa được tạo (migration 20261120090000); báo quản trị kỹ thuật.";

export type LinkTaiAnh = { path: string; signedUrl: string; publicUrl: string };

export async function capLinkTaiAnhThu(input: {
  seasonId: string;
  file: AnhKhaiBao;
}): Promise<({ ok: true } & LinkTaiAnh) | { ok: false; message: string }> {
  const checked = kiemAnhThu(input.file);
  if (!checked.ok) return checked;

  const path = duongDanAnhMoi(input.seasonId, randomUUID(), checked.ext);
  if (!path) return { ok: false, message: LOI_KHO };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: LOI_KHO };

  const bucket = client.storage.from(MAIL_ANH_BUCKET);
  const { data, error } = await bucket.createSignedUploadUrl(path);
  if (error || !data?.signedUrl) {
    const e = error as { message?: string } | null;
    console.error("[mail-anh] createSignedUploadUrl", { message: e?.message ?? null });
    return { ok: false, message: LOI_KHO };
  }
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  if (!/^https:\/\//.test(publicUrl)) return { ok: false, message: LOI_KHO };

  return { ok: true, path, signedUrl: data.signedUrl, publicUrl };
}
