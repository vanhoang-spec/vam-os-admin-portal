/**
 * lib/participant-auth-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Người vừa đăng nhập bằng email này là ai trong chương trình?
 *
 * Đây là chỗ nguy hiểm nhất của tính năng đăng nhập cho mentor và mentee. Tài
 * khoản đăng nhập và hồ sơ trong danh bạ là hai thứ tách rời; nối sai một lần
 * là một người mở ra và thấy dữ liệu của người khác — thông tin liên lạc, đơn
 * ứng tuyển, ghi chú của ban tổ chức về họ.
 *
 * Module thuần, không I/O. Nó nhận vào những gì đã đọc được từ database và trả
 * về một QUYẾT ĐỊNH. Nhờ vậy quyết định ấy thử được đầy đủ mà không phải dựng
 * bản giả của cả một tầng dữ liệu — và nó là thứ đáng thử kỹ nhất trong cả lát
 * cắt này.
 */

/** Email đem so sánh: bỏ khoảng trắng thừa, không phân biệt hoa thường. */
export function normalizeLoginEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Một dòng trong danh bạ, chỉ những gì phép nối cần nhìn. */
export type PersonCandidate = {
  id: string;
  /** `people.email_primary`, y như đang lưu — hàm này tự chuẩn hoá. */
  emailPrimary: string | null;
};

export type IdentityDecision =
  /** Đã có mối nối từ trước. Không dò email nữa. */
  | { kind: "linked"; personId: string }
  /** Chưa có nối, và email khớp đúng một người. Nối lại. */
  | { kind: "link_now"; personId: string }
  /** Email không khớp ai trong danh bạ. */
  | { kind: "no_match" }
  /** Email khớp nhiều người. KHÔNG đoán. */
  | { kind: "ambiguous"; personIds: string[] }
  /** Tài khoản đăng nhập không mang email — không có gì để dò. */
  | { kind: "no_email" };

/**
 * Quyết định nối tài khoản đăng nhập với một người trong danh bạ.
 *
 * ---------------------------------------------------------------------------
 * KHÔNG ĐOÁN
 * ---------------------------------------------------------------------------
 * Khớp nhiều người thì từ chối, chứ không lấy người đầu tiên, không lấy người
 * tạo sớm nhất, không lấy người "có vẻ đúng hơn". Một phép chọn như vậy đúng
 * chín lần rồi lần thứ mười cho người ta xem nhầm hồ sơ của người khác — và
 * chín lần đúng kia không ai ghi nhận, còn lần sai thì không sửa lại được.
 *
 * Thà chặn một người thật và để ban tổ chức nối tay.
 *
 * Số đo trên production ngày 10/09/2026: 449 mentor, tất cả đều có email riêng,
 * không ai trùng, không ai thiếu — nên tấm lưới này hiện không bắt phải ai. Nó
 * ở đây cho ngày dữ liệu không còn sạch như vậy.
 *
 * ---------------------------------------------------------------------------
 * MỐI NỐI ĐÃ CÓ THÌ THẮNG
 * ---------------------------------------------------------------------------
 * Có `linkedPersonId` là không dò email nữa. Ai đó đổi email trong danh bạ
 * không được phép làm người đang đăng nhập biến thành một người khác.
 */
export function decideIdentity(input: {
  /** Email trên tài khoản đăng nhập. */
  authEmail: string | null;
  /** `person_id` của mối nối đã có, nếu tra được. */
  linkedPersonId: string | null;
  /** Mọi dòng danh bạ đã đọc về để đối chiếu. */
  candidates: PersonCandidate[];
}): IdentityDecision {
  const linked = String(input.linkedPersonId ?? "").trim();
  if (linked) return { kind: "linked", personId: linked };

  const email = normalizeLoginEmail(input.authEmail);
  if (!email) return { kind: "no_email" };

  const matches = input.candidates.filter(
    (person) => normalizeLoginEmail(person.emailPrimary) === email
  );

  if (matches.length === 0) return { kind: "no_match" };
  if (matches.length > 1) {
    return { kind: "ambiguous", personIds: matches.map((person) => person.id) };
  }
  return { kind: "link_now", personId: matches[0].id };
}

/**
 * Lời báo cho người bị chặn.
 *
 * Nói được việc gì đang xảy ra và làm gì tiếp, nhưng KHÔNG nói vì sao chi tiết:
 * "email của bạn khớp với hai người" là một câu tiết lộ chuyện của người khác
 * cho một người chưa chứng minh được mình là ai.
 */
export function identityRefusalMessage(decision: IdentityDecision): string | null {
  switch (decision.kind) {
    case "linked":
    case "link_now":
      return null;
    case "no_email":
      return "Tài khoản này chưa có địa chỉ email. Vui lòng liên hệ ban tổ chức.";
    case "no_match":
    case "ambiguous":
      return "Chưa nhận ra bạn trong danh sách chương trình. Vui lòng liên hệ ban tổ chức để được hỗ trợ.";
  }
}

/**
 * Có cần ban tổ chức xử lý tay không.
 *
 * Tách khỏi lời báo vì hai câu hỏi khác nhau: người dùng cần biết làm gì tiếp,
 * còn ban tổ chức cần biết có việc đang chờ mình. `no_match` thường chỉ là
 * người chưa có trong danh bạ; `ambiguous` là dữ liệu cần dọn.
 */
export function needsOperatorAttention(decision: IdentityDecision): boolean {
  return decision.kind === "ambiguous";
}
