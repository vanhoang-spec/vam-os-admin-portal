import "server-only";

/**
 * Banner và logo của form tùy chỉnh (VAM00009 mục 4.1) — chỗ DUY NHẤT chạm kho riêng 'form-anh'.
 *
 * Cùng khuôn với ảnh báo lỗi (lib/bao-loi-anh.ts): máy chủ VAM không bao giờ nhận byte ảnh, chỉ cấp link
 * TẢI LÊN ký sẵn cho đúng thư mục <mã form>/ và link XEM ký sẵn 1 giờ. Trình duyệt tự đẩy ảnh lên kho và
 * tải ảnh từ kho bằng thẻ <img> thường. Trang /f/<mã> dựng mới mỗi lần mở nên người điền luôn có link còn hạn.
 * Xem __tests__/image-optimizer-attack-surface.test.ts mục 3d.
 */
import { randomUUID } from "node:crypto";
import { CUSTOM_FORM_IMAGE_BUCKET, isFormImagePath, newFormImagePath, type CustomFormImageKind } from "@/lib/custom-form-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/** Link tải lên hiệu lực 2 giờ (do Supabase đặt) cho một ảnh của form. null = không cấp được. */
export async function capLinkTaiAnhForm(formId: string, kind: CustomFormImageKind): Promise<{ path: string; signedUrl: string } | null> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  const path = newFormImagePath(formId, kind, randomUUID());
  const { data, error } = await client.storage.from(CUSTOM_FORM_IMAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return null;
  return { path, signedUrl: data.signedUrl };
}

/** Link xem 1 giờ, theo đúng thứ tự paths. Không hợp lệ hay lỗi kho thì chuỗi rỗng: form vẫn mở được, chỉ thiếu ảnh. */
export async function linkXemAnhForm(formId: string, paths: Array<string | null>): Promise<string[]> {
  const blank = paths.map(() => "");
  const client = getSupabaseServiceRoleClient();
  const valid = paths.filter((p): p is string => isFormImagePath(formId, p));
  if (!client || valid.length === 0) return blank;
  try {
    const { data, error } = await client.storage.from(CUSTOM_FORM_IMAGE_BUCKET).createSignedUrls(valid, 3600);
    if (error || !data) return blank;
    const map = new Map(data.map((d) => [d.path ?? "", d.signedUrl ?? ""]));
    return paths.map((p) => (p ? map.get(p) ?? "" : ""));
  } catch {
    return blank;
  }
}
