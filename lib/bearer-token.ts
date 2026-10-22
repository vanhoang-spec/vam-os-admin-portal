import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Token mang quyền ("ai cầm link là vào được") — dùng cho link hồ sơ trong thư kết quả ghép cặp.
 *
 * Cùng mô hình với lib/renewal-invite-token.ts (đã chạy thật cho link gia hạn mentor):
 *   tạo     randomBytes(32).toString("base64url")  → đúng 43 ký tự
 *   gửi     một lần, trong URL, tới đúng một hộp thư
 *   lưu     sha256(token) dạng 64 ký tự hex thường — và KHÔNG gì khác
 *   tra     bằng index unique trên cột hash
 *
 * Vì sao chỉ lưu hash dù token đã không đoán được: ai đọc được bảng — một bản xuất database, một
 * trang báo cáo về sau — cũng không cầm được link nào hiện SĐT/email của người khác. Token gốc chỉ
 * nằm trong thư; gửi lại là tạo token mới, link trong thư cũ hết hiệu lực.
 *
 * Module gia hạn giữ nguyên chỗ cũ: gộp hai nơi về một là việc riêng, không làm lẫn vào đây.
 */

export const BEARER_TOKEN_BYTES = 32;
export const BEARER_TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export type MintedBearerToken = {
  /** Chỉ đưa vào URL gửi đúng một người. Không bao giờ lưu, không ghi log. */
  token: string;
  /** Nửa duy nhất được ghi vào database. */
  tokenHash: string;
};

export function isCanonicalBearerToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function isCanonicalBearerTokenHash(value: unknown): value is string {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

/**
 * sha256 của một token ĐÚNG định dạng. Ném lỗi với đầu vào lạ thay vì băm nó: băm bừa thì chuỗi
 * rỗng hay một đoạn 5000 byte cũng ra một hash hợp lệ rồi thành câu truy vấn database.
 */
export function hashBearerToken(token: string): string {
  if (!isCanonicalBearerToken(token)) throw new Error("bearer token is not canonical");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Null thay vì ném lỗi — cho đường xử lý request. */
export function safeHashBearerToken(token: unknown): string | null {
  return isCanonicalBearerToken(token) ? hashBearerToken(token) : null;
}

export function mintBearerToken(): MintedBearerToken {
  const token = randomBytes(BEARER_TOKEN_BYTES).toString("base64url");
  // Không phải trang trí: một bản Node đổi cách đệm base64url sẽ lộ ra ở đây trước, và tạo ra một
  // token mà cổng sẽ từ chối là tệ hơn dừng ngay tại chỗ.
  if (!isCanonicalBearerToken(token)) throw new Error("bearer token mint produced a non-canonical token");
  return { token, tokenHash: hashBearerToken(token) };
}

/** So hai hash trong thời gian hằng — kiểm lại dòng database trả về đúng là dòng được hỏi. */
export function bearerTokenHashEquals(a: unknown, b: unknown): boolean {
  if (!isCanonicalBearerTokenHash(a) || !isCanonicalBearerTokenHash(b)) return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
