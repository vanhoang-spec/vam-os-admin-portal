/**
 * lib/password-link-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Link đặt mật khẩu mà VAM OS tự dựng cho lời mời mentor/mentee.
 *
 * Thuần, và dùng được cả ở trình duyệt: máy chủ dựng link, trang
 * `/reset-password` đọc lại đúng link đó bằng cùng một cặp hàm.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO LINK ĐỂ MÃ SAU DẤU #
 * ---------------------------------------------------------------------------
 * Phần sau `#` không bao giờ được gửi lên máy chủ, nên mã không nằm trong log
 * truy cập, không nằm trong tiêu đề Referer. Trang đọc nó bằng JavaScript.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO ĐÚNG ĐƯỜNG /reset-password
 * ---------------------------------------------------------------------------
 * Đó là đường duy nhất vừa được middleware bỏ qua vừa được khung ứng dụng cho
 * người chưa đăng nhập đi qua (SESSION_ESTABLISHING_PATHS trong
 * components/app-shell.tsx so bằng ĐÚNG đường, không so tiền tố). Một đường
 * con như /reset-password/moi sẽ hiện bảng "Cần đăng nhập" cho chính người
 * được mời.
 */

export const PASSWORD_LINK_PATH = "/reset-password";
export const PASSWORD_LINK_TYPES = ["invite", "recovery"] as const;
export type PasswordLinkType = (typeof PASSWORD_LINK_TYPES)[number];

function isPasswordLinkType(value: unknown): value is PasswordLinkType {
  return (PASSWORD_LINK_TYPES as readonly string[]).includes(String(value ?? ""));
}

/**
 * Dựng link. Trả về null nếu không dựng được một link an toàn — người gọi
 * phải dừng, không được gửi một lá thư mang link hỏng.
 */
export function buildPasswordLinkUrl(
  base: string,
  input: { tokenHash: string; type: PasswordLinkType }
): string | null {
  const root = String(base ?? "").trim().replace(/\/+$/, "");
  if (!root.startsWith("https://") && !root.startsWith("http://localhost")) return null;

  const tokenHash = String(input.tokenHash ?? "").trim();
  if (!tokenHash || /[\s\r\n]/.test(tokenHash)) return null;
  if (!isPasswordLinkType(input.type)) return null;

  return `${root}${PASSWORD_LINK_PATH}#token_hash=${encodeURIComponent(tokenHash)}&type=${input.type}`;
}

export type ParsedPasswordLink =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "ok"; tokenHash: string; type: PasswordLinkType };

/**
 * Đọc phần sau `#`.
 *
 * `none` nghĩa là không có `token_hash` nào — đó là link khôi phục mật khẩu
 * của nhân sự do Supabase gửi (mang `access_token`), và trang phải để nguyên
 * luồng cũ cho nó. Loại link khác `invite`/`recovery` bị từ chối: trang này
 * không phải chỗ để đổi email hay xác nhận đăng ký.
 */
export function parsePasswordLinkHash(hash: string): ParsedPasswordLink {
  const params = new URLSearchParams(String(hash ?? "").replace(/^#/, ""));
  if (!params.has("token_hash")) return { status: "none" };

  const tokenHash = String(params.get("token_hash") ?? "").trim();
  const type = params.get("type");
  if (!tokenHash || !isPasswordLinkType(type)) return { status: "invalid" };
  return { status: "ok", tokenHash, type };
}

export const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(password: string, confirm: string): string | null {
  if (String(password ?? "").length < MIN_PASSWORD_LENGTH) {
    return `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  }
  if (password !== confirm) return "Mật khẩu nhập lại không khớp.";
  return null;
}

export const LINK_EXPIRED_MESSAGE =
  "Phiên xác nhận đã hết hạn. Vui lòng liên hệ ban tổ chức để nhận đường dẫn mới.";

/**
 * Lỗi đặt mật khẩu → câu tiếng Việt.
 *
 * KHÔNG BAO GIỜ đưa nguyên câu tiếng Anh của Supabase ra màn hình: người đọc là
 * một mentor vừa bấm link trong thư, không phải người vận hành đang dò lỗi.
 */
export function mapPasswordUpdateError(
  error: { code?: string | null; status?: number | null; message?: string | null } | null | undefined
): { message: string; expired: boolean } {
  const code = String(error?.code ?? "").trim();
  const status = Number(error?.status ?? 0);

  if (code === "weak_password") {
    return { message: "Mật khẩu chưa đủ mạnh. Dùng ít nhất 8 ký tự, trộn chữ và số.", expired: false };
  }
  if (code === "same_password") {
    return { message: "Mật khẩu mới phải khác mật khẩu cũ.", expired: false };
  }
  if (code === "session_not_found" || code === "session_expired" || status === 401 || status === 403) {
    return { message: LINK_EXPIRED_MESSAGE, expired: true };
  }
  return { message: "Không đặt được mật khẩu. Vui lòng thử lại.", expired: false };
}

export type PasswordLinkCopy = {
  title: string;
  confirmBody: string;
  continueLabel: string;
  formBody: string;
  submitLabel: string;
  successTitle: string;
};

export function passwordLinkCopy(type: PasswordLinkType): PasswordLinkCopy {
  if (type === "invite") {
    return {
      title: "Kích hoạt tài khoản VAM OS",
      confirmBody:
        "Bấm Tiếp tục để xác nhận đường dẫn, rồi đặt mật khẩu cho tài khoản của anh/chị. Mỗi đường dẫn chỉ dùng được một lần.",
      continueLabel: "Tiếp tục",
      formBody: "Đặt mật khẩu anh/chị sẽ dùng để đăng nhập VAM OS từ nay về sau.",
      submitLabel: "Đặt mật khẩu",
      successTitle: "Đã kích hoạt tài khoản"
    };
  }
  return {
    title: "Đặt mật khẩu VAM OS",
    confirmBody:
      "Bấm Tiếp tục để xác nhận đường dẫn, rồi đặt mật khẩu mới. Mỗi đường dẫn chỉ dùng được một lần.",
    continueLabel: "Tiếp tục",
    formBody: "Nhập mật khẩu mới cho tài khoản VAM OS của anh/chị.",
    submitLabel: "Đặt mật khẩu",
    successTitle: "Đã đặt mật khẩu"
  };
}

export const LINK_USED_TITLE = "Đường dẫn đã hết hạn hoặc đã được dùng";
export const LINK_USED_BODY =
  "Nếu anh/chị đã đặt mật khẩu bằng đường dẫn này, hãy đăng nhập bằng mật khẩu ấy. Nếu chưa, vui lòng liên hệ ban tổ chức để nhận đường dẫn mới.";
export const LINK_MALFORMED_BODY =
  "Đường dẫn không đúng dạng. Vui lòng mở lại đường dẫn trong thư, hoặc liên hệ ban tổ chức để nhận đường dẫn mới.";
