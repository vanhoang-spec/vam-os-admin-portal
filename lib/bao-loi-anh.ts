import "server-only";

/**
 * Báo lỗi — chỗ DUY NHẤT trong mã chạm kho ảnh Supabase Storage (kho riêng 'bao-loi').
 *
 * Máy chủ VAM không bao giờ nhận byte ảnh: nó chỉ cấp link TẢI LÊN ký sẵn cho đúng thư mục
 * <id tài khoản>/ của người đang đăng nhập (trình duyệt tự đẩy ảnh thẳng lên kho), và cấp link XEM
 * ký sẵn 1 giờ (trình duyệt tải ảnh thẳng từ kho bằng thẻ <img> thường). Không ảnh nào đi qua
 * bộ tối ưu ảnh của Next hay thư viện giải mã ảnh — điều kiện 1–4 của __tests__/image-optimizer-attack-surface.test.ts giữ
 * nguyên; mục 3c của test đó khoá file này.
 */
import { randomUUID } from "node:crypto";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { BAO_LOI_KHO_ANH, SO_ANH_TOI_DA, duongDanAnhMoi, laAnhCuaNguoiGui } from "@/lib/bao-loi-core";

export type LinkTaiAnh = { path: string; signedUrl: string };

/** Cấp tối đa SO_ANH_TOI_DA link tải lên (hiệu lực 2 giờ, do Supabase đặt) trong thư mục của actorId. */
export async function capLinkTaiAnh(actorId: string, soAnh: number): Promise<LinkTaiAnh[] | null> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  const n = Math.max(0, Math.min(SO_ANH_TOI_DA, Math.floor(soAnh)));
  const out: LinkTaiAnh[] = [];
  for (let i = 0; i < n; i += 1) {
    const path = duongDanAnhMoi(actorId, randomUUID());
    const { data, error } = await client.storage.from(BAO_LOI_KHO_ANH).createSignedUploadUrl(path);
    if (error || !data?.signedUrl) return null;
    out.push({ path, signedUrl: data.signedUrl });
  }
  return out;
}

/** Link xem ảnh 1 giờ. Đường dẫn không đúng dạng ảnh báo lỗi thì bỏ (trả chuỗi rỗng ở vị trí đó). */
export async function linkXemAnh(paths: string[]): Promise<string[]> {
  const client = getSupabaseServiceRoleClient();
  if (!client || paths.length === 0) return paths.map(() => "");
  const hopLe = paths.filter((p) => {
    const actor = p.split("/")[0] ?? "";
    return laAnhCuaNguoiGui(actor, p);
  });
  if (hopLe.length === 0) return paths.map(() => "");
  const { data, error } = await client.storage.from(BAO_LOI_KHO_ANH).createSignedUrls(hopLe, 3600);
  if (error || !data) return paths.map(() => "");
  const map = new Map(data.map((d) => [d.path ?? "", d.signedUrl ?? ""]));
  return paths.map((p) => map.get(p) ?? "");
}
