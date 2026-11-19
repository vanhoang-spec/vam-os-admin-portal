/**
 * Ảnh chèn trong thân thư (VAM00038) — phần thuần: loại ảnh nhận, giới hạn cỡ, đường dẫn trong kho.
 *
 * Kho 'mail-anh' là kho CÔNG KHAI (supabase/migrations/20261120090000_mail_soan_thao.sql): ứng dụng thư
 * tải ảnh lúc người nhận mở thư, có khi sau nhiều tuần, nên link ký có hạn không dùng được. Vì công khai,
 * kho chỉ nhận ảnh raster (không SVG: SVG chở được script), tối đa 3 MB, và tên tệp là uuid do MÁY CHỦ
 * sinh: không ai đoán được đường dẫn ảnh của thư chưa gửi. Ảnh của thư đã gửi thì người nhận vốn đã thấy.
 *
 * File này không import gì, để trình duyệt dùng chung được (ô chọn ảnh cần biết loại và cỡ).
 */

export const MAIL_ANH_BUCKET = "mail-anh";

/** Trùng với allowed_mime_types của kho; kho tự chặn lần nữa lúc tải lên. */
export const MAIL_ANH_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp"
};

export const MAIL_ANH_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** 3 MB: banner 1200px nén JPEG thường dưới 500 KB; ảnh to hơn làm thư nặng, tải chậm trên điện thoại. */
export const MAIL_ANH_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Bề rộng tối đa của ảnh trong thư (px): khung thư rộng 600px, trừ lề 24px mỗi bên. Outlook bản cài
 * đặt đọc thuộc tính `width` chứ không đọc `max-width`, nên bề rộng được kẹp ở đây chứ không chỉ bằng CSS.
 */
export const MAIL_ANH_MAX_WIDTH = 552;
export const MAIL_ANH_MIN_WIDTH = 24;

export type AnhKhaiBao = { name: string; size: number; mime: string };

/** Kiểm điều trình duyệt khai về một ảnh. Kho kiểm lại loại và cỡ lúc nhận byte. */
export function kiemAnhThu(input: AnhKhaiBao): { ok: true; ext: string } | { ok: false; message: string } {
  const mime = String(input?.mime ?? "").toLowerCase().trim();
  const ext = MAIL_ANH_MIME[mime];
  if (!ext) return { ok: false, message: "Chỉ chèn được ảnh PNG, JPG, GIF hoặc WebP." };
  const size = Number(input?.size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, message: "Tệp ảnh rỗng hoặc không đọc được." };
  if (size > MAIL_ANH_MAX_BYTES) return { ok: false, message: "Ảnh lớn hơn 3 MB. Vui lòng nén hoặc thu nhỏ ảnh rồi chèn lại." };
  return { ok: true, ext };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Đường dẫn trong kho: <mùa>/<uuid>.<đuôi>. Không mang tên tệp gốc (có thể chứa tên người). */
export function duongDanAnhMoi(seasonId: string, uuid: string, ext: string): string | null {
  if (!UUID.test(seasonId) || !UUID.test(uuid) || !Object.values(MAIL_ANH_MIME).includes(ext)) return null;
  return `${seasonId}/${uuid}.${ext}`;
}

/** Kẹp bề rộng ảnh (px) vào khoảng hiển thị được trong khung thư 600px. */
export function kepBeRongAnh(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return MAIL_ANH_MAX_WIDTH;
  return Math.min(MAIL_ANH_MAX_WIDTH, Math.max(MAIL_ANH_MIN_WIDTH, n));
}
