/**
 * lib/event-checkin-code.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Mã điểm danh cá nhân: sinh ra, in thành QR, và đọc lại từ thứ máy quét thấy.
 *
 * Module thuần, không I/O — dùng ở cả máy chủ (sinh mã, đổi mã lấy một lượt
 * điểm danh) lẫn trình duyệt (đọc mã vừa quét được), nên nó phải chạy được ở
 * cả hai nơi.
 */

/**
 * Bảng chữ cái của mã.
 *
 * Bỏ `0`, `O`, `1`, `I`, `L` — không phải để làm đẹp mà vì mã này được đọc
 * bằng mắt và gõ tay khi máy quét chịu thua: hàng người đang chờ, camera bẩn,
 * màn hình vỡ. Một mã mà `0` với `O` phân biệt được chỉ bằng phông chữ là một
 * mã sẽ bị gõ sai.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Độ dài mã.
 *
 * 10 ký tự trên bảng 31 ký tự là khoảng 2^49 khả năng — đủ để đoán mò không
 * phải là một cách vào cửa, kể cả khi ai đó thử liên tục suốt buổi.
 */
export const CHECKIN_CODE_LENGTH = 10;

const CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${CHECKIN_CODE_LENGTH}}$`);

/**
 * Sinh một mã mới.
 *
 * Nhận hàm lấy số ngẫu nhiên từ bên ngoài để test được: nơi gọi truyền
 * `crypto.getRandomValues`, còn ca test truyền một chuỗi số biết trước.
 */
export function generateCheckinCode(
  randomBytes: (size: number) => Uint8Array
): string {
  // Lấy dư nhiều byte hơn cần rồi loại các byte rơi vào phần dư của phép chia,
  // thay vì `% ALPHABET.length` trên mọi byte: phép chia dư đơn thuần làm các
  // ký tự đầu bảng xuất hiện nhiều hơn phần còn lại.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let code = "";

  while (code.length < CHECKIN_CODE_LENGTH) {
    const bytes = randomBytes(CHECKIN_CODE_LENGTH);
    for (let index = 0; index < bytes.length && code.length < CHECKIN_CODE_LENGTH; index += 1) {
      const byte = bytes[index];
      if (byte >= limit) continue;
      code += ALPHABET[byte % ALPHABET.length];
    }
  }

  return code;
}

export function isCheckinCode(value: unknown): boolean {
  return typeof value === "string" && CODE_PATTERN.test(value);
}

/**
 * Nội dung được in vào mã QR.
 *
 * Một ĐƯỜNG DẪN, không phải mã trần. Ai đó quét nhầm bằng camera của điện
 * thoại — chuyện chắc chắn xảy ra — sẽ mở ra trang vé của chính mình và đọc
 * được "đưa mã này cho ban tổ chức quét", thay vì nhìn một chuỗi mười ký tự
 * không biết là gì.
 */
export function checkinCodeUrl(origin: string, code: string): string {
  const base = String(origin ?? "").replace(/\/+$/, "");
  return `${base}/ve/${code}`;
}

/**
 * Đọc mã từ thứ máy quét vừa thấy.
 *
 * Máy quét trả về đúng chuỗi nằm trong mã QR, và chuỗi đó có thể là:
 *   * đường dẫn vé của chính hệ thống này;
 *   * đường dẫn vé sinh ra từ một môi trường khác (staging, tên miền cũ);
 *   * chính mã trần, khi ai đó gõ tay vì camera chịu thua.
 *
 * Cả ba đều dẫn tới cùng một mã. Ngược lại, một mã QR bất kỳ ngoài đời — vé xe
 * buýt, mã thanh toán — phải trả về null chứ không được đoán bừa.
 */
export function readCheckinCode(scanned: unknown): string | null {
  const raw = String(scanned ?? "").trim();
  if (!raw) return null;

  const direct = raw.toUpperCase();
  if (isCheckinCode(direct)) return direct;

  // Chỉ lấy đoạn cuối của đường dẫn có dạng `/ve/<mã>`; không dò tìm khắp
  // chuỗi, vì một mã QR lạ tình cờ chứa mười ký tự hợp lệ không phải là vé.
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    return null;
  }

  const match = /\/ve\/([^/?#]+)\/?$/.exec(path);
  if (!match) return null;

  const candidate = match[1].toUpperCase();
  return isCheckinCode(candidate) ? candidate : null;
}

// Quét ở đâu, quét lần mấy, nhãn và huy hiệu của từng lần quét: xem
// `lib/event-checkin-steps.ts`. Module này chỉ lo chính cái mã.

/**
 * Độ dài mã ngắn — đường lùi khi máy quét chịu thua.
 *
 * Bốn ký tự gõ được trong ba giây, giữa một hàng người đang chờ ở cửa. Mã đầy
 * đủ 10 ký tự cũng gõ được nhưng chậm, và ở đúng lúc đó thì chậm là hỏng.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO 4 KÝ TỰ AN TOÀN Ở ĐÂY, VÀ CHỈ Ở ĐÂY
 * ---------------------------------------------------------------------------
 * 4 ký tự trên bảng 31 ký tự là khoảng 923 nghìn tổ hợp. Với 200 người đăng
 * ký, đoán mò trúng MỘT mã bất kỳ là khoảng 1/4.600 — tức là đoán được.
 *
 * Nên mã này chỉ được nhận ở ô gõ tay của máy quét: một trang đã đăng nhập, do
 * người hỗ trợ được ghép vào đúng buổi đó mở, với người tham dự đứng trước mặt
 * và tên hiện lên ngay sau khi gõ. Gõ trúng mã của người khác thì người đứng
 * quét thấy ngay một cái tên lạ.
 *
 * `readCheckinCode` — đường công khai — KHÔNG bao giờ nhận nó.
 */
export const SHORT_CODE_LENGTH = 4;

const SHORT_CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${SHORT_CODE_LENGTH}}$`);

export function generateShortCode(randomBytes: (size: number) => Uint8Array): string {
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let code = "";
  while (code.length < SHORT_CODE_LENGTH) {
    const bytes = randomBytes(SHORT_CODE_LENGTH);
    for (let index = 0; index < bytes.length && code.length < SHORT_CODE_LENGTH; index += 1) {
      const byte = bytes[index];
      if (byte >= limit) continue;
      code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

export function isShortCode(value: unknown): boolean {
  return typeof value === "string" && SHORT_CODE_PATTERN.test(value);
}

/**
 * Thứ người hỗ trợ vừa gõ hoặc vừa quét, phân loại.
 *
 * Hai đường tra khác nhau: mã đầy đủ tra trên toàn hệ thống, mã ngắn chỉ tra
 * trong đúng sự kiện đang mở. Trả về loại nào để nơi gọi tra đúng đường — chứ
 * không phải thử lần lượt cả hai, vì thử mã ngắn trên toàn hệ thống là mở đúng
 * cái cửa mà mã ngắn không được phép mở.
 */
export type ScannedInput =
  | { kind: "full"; code: string }
  | { kind: "short"; code: string }
  | { kind: "unreadable" };

export function classifyScannedInput(scanned: unknown): ScannedInput {
  const full = readCheckinCode(scanned);
  if (full) return { kind: "full", code: full };

  const raw = String(scanned ?? "").trim().toUpperCase();
  if (isShortCode(raw)) return { kind: "short", code: raw };

  return { kind: "unreadable" };
}

/**
 * Sự kiện này có dùng mã QR check-in cá nhân không.
 *
 * BTC chọn khi tạo hoặc sửa sự kiện. Tắt thì lượt đăng ký mới không được cấp mã,
 * thư xác nhận không kèm QR, và trang sự kiện không vẽ mã nào.
 *
 * Chỉ `false` mới là tắt. Vắng mặt — dòng tạo trước khi có cột, hoặc một câu
 * select không lấy cột này — là BẬT, đúng như mọi sự kiện đã chạy trước đây:
 * tắt QR vì thiếu một cột trong câu select là lặng lẽ lấy mất tấm vé của người
 * đăng ký mà không ai quyết định chuyện đó.
 */
export function usesQrCheckin(event: { qr_checkin_enabled?: unknown } | null | undefined): boolean {
  return event?.qr_checkin_enabled !== false;
}
