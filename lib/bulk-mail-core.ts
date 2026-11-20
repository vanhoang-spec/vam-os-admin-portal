/**
 * lib/bulk-mail-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phần thuần của một lượt gửi hàng loạt: gửi cho ai, điền gì vào thư, và một
 * lượt được phép làm bao nhiêu trong một lần chạy.
 *
 * Không I/O — để test chạy được mà không cần database và không gửi thư thật.
 */

import { normalizeEmailAddress } from "@/lib/email-core";
import { TEMPLATE_SPECS, type TemplateKind } from "@/lib/email-templates-core";
import { isRecapMonth } from "@/lib/bulk-mail-recap-core";

/**
 * Các nhóm nhận thư.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO MỖI NHÓM LÀ MỘT CÂU TRUY VẤN VIẾT SẴN, KHÔNG PHẢI MỘT BỘ LỌC TỰ DO
 * ---------------------------------------------------------------------------
 * Một lô không gửi xong trong một lần chạy, và lần "Gửi tiếp" dựng lại danh sách
 * từ nhóm đã chốt vào lô. Nhóm phải dựng lại được ĐÚNG như lần đầu, và con số
 * người bấm gõ xác nhận phải bằng đúng con số máy chủ tự đếm. Một bộ lọc tự do
 * gõ trên màn hình không giữ được cả hai lời hứa đó.
 *
 * Nhóm "đã đăng ký một sự kiện" mang tham số — sự kiện nào, có gồm cả chuỗi
 * không — để một nhóm phủ được mọi buổi: orientation của mentor, của mentee, và
 * mọi sự kiện sau này, mà không phải thêm mã cho từng buổi.
 */
export const BULK_AUDIENCES = [
  "mentee",
  "mentor",
  "both",
  "staff",
  "returning_mentor",
  "mentee_cv_rejected",
  "mentee_invite_withdrawn",
  "mentee_interview_rejected",
  "mentee_no_recap_month",
  "event",
  "custom"
] as const;
export type BulkAudience = (typeof BULK_AUDIENCES)[number];

/** Nhóm cố định: không mang tham số, nên đếm sẵn được để hiện ngay trong ô chọn. */
export const FIXED_BULK_AUDIENCES = [
  "mentee",
  "mentor",
  "both",
  "staff",
  "returning_mentor",
  "mentee_cv_rejected",
  "mentee_invite_withdrawn",
  "mentee_interview_rejected"
] as const;
export type FixedBulkAudience = (typeof FIXED_BULK_AUDIENCES)[number];

/**
 * Ba nhóm đầu nói rõ "đang tham gia": BTC 07/10/2026 suýt gửi thư rớt vòng hồ sơ
 * cho nhóm "Mentee" — tức 286 mentee ĐÃ ĐẬU — vì cái tên không nói đó là ai.
 */
export const BULK_AUDIENCE_LABELS: Record<BulkAudience, string> = {
  mentee: "Mentee đang tham gia mùa này",
  mentor: "Mentor đang tham gia mùa này",
  both: "Cả mentor và mentee đang tham gia mùa này",
  staff: "Ban tổ chức (admin, core team, support team)",
  returning_mentor: "Mentor đã xác nhận quay lại mùa này",
  mentee_cv_rejected: "Mentee rớt vòng hồ sơ (CV)",
  mentee_invite_withdrawn: "Mentee rớt CV sau khi đã nhận thư mời phỏng vấn",
  mentee_interview_rejected: "Mentee không trúng tuyển vòng phỏng vấn (rớt, không phỏng vấn, không chọn ca)",
  mentee_no_recap_month: "Mentee chưa có recap trong tháng",
  event: "Người đã đăng ký một sự kiện",
  custom: "Danh sách tùy chỉnh"
};

/** Một câu nói rõ nhóm đang chọn là ai — hiện ngay dưới ô "Gửi cho". */
export const BULK_AUDIENCE_HINTS: Record<FixedBulkAudience, string> = {
  mentee: "Mentee ĐÃ ĐẬU, đang tham gia mùa này. Không gồm người rớt hay đang chờ kết quả.",
  mentor: "Mentor đã duyệt, đang tham gia mùa này.",
  both: "Mentor và mentee đang tham gia mùa này; người mang cả hai vai trò chỉ nhận một lá.",
  staff: "Tài khoản admin, super admin, core team, support team đang hoạt động.",
  returning_mentor: "Mentor đã chấp nhận lời mời quay lại và vẫn đang tham gia mùa này.",
  mentee_cv_rejected:
    "Đơn mentee bị reviewer đề xuất reject, hoặc đề xuất khác dưới 13 điểm, và chưa từng được mời phỏng vấn. Không gồm người đã được mời, đã đậu, đang là mentor hay BTC, và người đã nhận thư ở một lô gửi trước của nhóm này.",
  mentee_invite_withdrawn:
    "Mentee đã nhận thư mời chọn ca phỏng vấn, sau đó BTC chuyển “Không đạt” vòng hồ sơ — chưa từng giữ chỗ hay check-in. Dùng mẫu thư có nhắc tới thư mời đã nhận. Không gồm người đã nhận thư rớt ở lô trước.",
  mentee_interview_rejected:
    "Mentee rớt phỏng vấn; đã check-in, đã phân bàn hoặc đã chọn ca mà không phỏng vấn; và người đã nhận thư mời mà không chọn ca. Không gồm người đã đậu, đang chờ BTC xem xét thêm, đã huỷ chỗ mà không chọn lại, đang tham gia mùa này, là BTC, người đã nhận thư rớt ở lô trước, và 5 bạn BTC giữ lại (24/10/2026)."
};

/** Câu nói rõ nhóm "Mentee chưa có recap trong tháng" là ai (nhóm có tham số tháng, nên không nằm trong bảng trên). */
export const NO_RECAP_AUDIENCE_HINT =
  "Mentee có cặp active vào ngày cuối tháng, chưa có recap hợp lệ (đã nộp hoặc cần duyệt) đăng trong tháng. Mỗi thư CC mentor của cặp active mới nhất. Danh sách chốt vào lô lúc bấm gửi.";

/**
 * Thư "không trúng tuyển vòng phỏng vấn" mentee mùa 12 (BTC 24/10/2026) — đơn nào vào nhóm nào.
 *
 * Khớp đúng con số BTC đếm: 197 bạn (rớt / check-in hoặc phân bàn mà không phỏng vấn / chọn ca mà
 * không đến) + 90 bạn được mời mà không chọn ca = 287. "Phân bàn" theo cách BTC đếm gồm cả người
 * đã chọn ca mà không đến.
 *
 * Ba nhóm đầu theo đúng cách trang Tiến độ phỏng vấn mentee tính (lib/mentee-progress-core.ts): đã
 * có kết quả thì theo kết quả; chưa có thì phân bàn → check-in. Không ai thuộc hai nhóm. KHÔNG vào
 * nhóm nào: đã đậu, "cần BTC xem xét thêm" (chưa chốt), đã huỷ chỗ / vắng đợt 1 rồi không chọn lại
 * (BTC không đếm), người chưa từng nhận thư mời, và người được mời nhưng đơn đã "Không đạt" (12 bạn
 * bị rút lời mời 08/10 — đã nhận thư riêng).
 */
export type MenteeInterviewLetterGroup = "failed" | "checked_in" | "assigned" | "booked_no_show" | "invited_no_booking";

export const MENTEE_INTERVIEW_LETTER_GROUP_LABELS: Record<MenteeInterviewLetterGroup, string> = {
  failed: "Rớt phỏng vấn",
  checked_in: "Đã check-in, không phỏng vấn",
  assigned: "Đã phân bàn, không phỏng vấn",
  booked_no_show: "Đã chọn ca, không đến",
  invited_no_booking: "Được mời, không chọn ca"
};

export function menteeInterviewLetterGroup(input: {
  applicationStatus: string | null;
  operation: { outcome: string | null; checked_in_at: string | null; interviewer_id: string | null } | null;
  /** Có một chỗ đang giữ (booked). */
  hasBookedSeat: boolean;
  /** Từng có bất kỳ chỗ nào (kể cả đã huỷ). */
  hadAnyBooking: boolean;
  /** Thư mời chọn ca đã thật sự gửi đi. */
  inviteSent: boolean;
}): MenteeInterviewLetterGroup | null {
  const op = input.operation;
  if (op?.outcome === "rejected") return "failed";
  if (op?.outcome) return null;
  if (op?.interviewer_id) return "assigned";
  if (op?.checked_in_at) return "checked_in";
  if (input.hasBookedSeat) return "booked_no_show";
  if (input.hadAnyBooking) return null;
  if (input.inviteSent && input.applicationStatus !== "rejected_or_not_fit") return "invited_no_booking";
  return null;
}

/**
 * 5 bạn BTC dặn KHÔNG gửi thư này (24/10/2026) — cả năm đều "đã phân bàn, không phỏng vấn". Ghi đúng
 * tên trên hệ thống: BTC viết "Lê Hoàn Thịnh", hệ thống ghi "Lê Hoàng Thịnh" (người duy nhất gần giống ở
 * nhóm đó). So sau khi bỏ dấu, chữ hoa, khoảng trắng thừa — "Thúy" và "Thuý" là một.
 */
export const MENTEE_INTERVIEW_LETTER_HELD_NAMES = [
  "Vũ Thị Thúy Vy",
  "Đỗ Huỳnh Uyên Nhi",
  "Tống Huỳnh Phương Nguyên",
  "Đinh Ngọc Kim Hoàn",
  "Lê Hoàng Thịnh"
] as const;

const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Họ tên để so: bỏ dấu (cả vị trí dấu thanh), đ→d, chữ thường, gộp khoảng trắng. */
export function foldPersonName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

const HELD_NAME_KEYS = new Set(MENTEE_INTERVIEW_LETTER_HELD_NAMES.map(foldPersonName));

export function isHeldFromInterviewLetter(...names: unknown[]): boolean {
  return names.some((n) => {
    const key = foldPersonName(n);
    return key !== "" && HELD_NAME_KEYS.has(key);
  });
}

/**
 * Luật rớt vòng hồ sơ mentee (BTC 07/10/2026): reviewer đề xuất reject → rớt;
 * đề xuất khác mà tổng điểm dưới 13 → rớt.
 *
 * Hàm này chỉ trả lời "phiếu chấm nói rớt không". Ai thật sự nhận thư còn phải
 * qua các phép loại ở `lib/bulk-mail.ts` (đã được mời phỏng vấn, đã đậu, đang là
 * mentor/BTC…).
 *
 * Nghiêng về KHÔNG rớt khi phiếu chưa rõ: chưa có phiếu đã nộp, còn phiếu đang
 * chấm, hoặc có một reviewer đề xuất mời phỏng vấn → không tính là rớt. Một lá thư
 * rớt gửi nhầm không rút lại được; một người bị sót thì còn đợt gửi sau.
 */
export const CV_REJECT_SCORE_BELOW = 13;

export type ProfileReviewVerdict = {
  status: string | null;
  recommendation: string | null;
  total_score: number | null;
};

export function isCvRejected(reviews: readonly ProfileReviewVerdict[]): boolean {
  const submitted = reviews.filter((review) => review.status === "submitted");
  if (!submitted.length) return false;
  if (reviews.some((review) => review.status !== "submitted" && review.status !== "cancelled")) return false;
  return submitted.every((review) => {
    if (review.recommendation === "pass_to_interview") return false;
    if (review.recommendation === "reject") return true;
    return typeof review.total_score === "number" && review.total_score < CV_REJECT_SCORE_BELOW;
  });
}

export function isBulkAudience(value: unknown): value is BulkAudience {
  return typeof value === "string" && (BULK_AUDIENCES as readonly string[]).includes(value);
}

/** Ba nhóm đọc thẳng từ membership của mùa. */
export type MembershipAudience = "mentee" | "mentor" | "both";

export function isMembershipAudience(value: unknown): value is MembershipAudience {
  return value === "mentee" || value === "mentor" || value === "both";
}

/** Các vai trò membership mà một đối tượng nhận thư tương ứng. */
export function rolesForAudience(audience: MembershipAudience): Array<"mentor" | "mentee"> {
  if (audience === "both") return ["mentor", "mentee"];
  return [audience];
}

/**
 * Vai trò tài khoản được tính là "Ban tổ chức".
 *
 * Không gồm `reviewer` và `viewer`: reviewer là mentor được mở quyền chấm hồ sơ,
 * và thư gửi BTC thường nói việc nội bộ mà người chấm không cần nhận. Muốn gửi
 * cho reviewer thì đó là một nhóm riêng, có tên riêng — không phải một nhóm lặng
 * lẽ rộng hơn cái tên của nó.
 */
export const STAFF_ROLES = ["super_admin", "admin", "core_team", "support_team"] as const;

export type AudienceChoice = {
  audience: BulkAudience;
  /** Chỉ có với nhóm `event`. */
  eventId: string | null;
  /** Chỉ có nghĩa với nhóm `event`: gồm cả các buổi khác cùng chuỗi. */
  coversSeries: boolean;
  /** Chỉ có với nhóm `mentee_no_recap_month`: tháng `YYYY-MM`. */
  month?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Đọc nhóm nhận thư từ những gì form gửi lên.
 *
 * Nhóm không mang tham số thì BỎ mọi tham số đi kèm, kể cả khi form lỡ gửi: một
 * lô "Mentor" mà mang theo một event id là một lô mà lần gửi tiếp có thể đọc
 * nhầm. Nhóm `event` mà thiếu sự kiện thì từ chối, không đoán.
 *
 * Hàm này chỉ kiểm HÌNH DẠNG. Sự kiện có thuộc mùa đang gửi không là việc của
 * đường đọc danh sách — event id là thứ người gửi form tự đặt được.
 */
export function resolveAudienceChoice(input: {
  audience: unknown;
  eventId?: unknown;
  coversSeries?: unknown;
  month?: unknown;
}): { ok: true; choice: AudienceChoice } | { ok: false; message: string } {
  const audience = String(input.audience ?? "").trim();
  if (!isBulkAudience(audience)) return { ok: false, message: "Chưa chọn đối tượng nhận thư." };
  // Danh sách tùy chỉnh không dựng lại được từ tên nhóm: nó đi qua bước xem trước và lệnh gửi
  // riêng (startCustomBulkSendAction), nơi danh sách được kiểm lại và chốt vào lô.
  if (audience === "custom") {
    return { ok: false, message: "Danh sách tùy chỉnh phải xem trước rồi gửi bằng nút của nó." };
  }

  // Nhóm "chưa có recap" mà thiếu tháng thì từ chối, không đoán "tháng này": đoán sai là gửi
  // thư nhắc cho người đã đăng bài của tháng họ đang nghĩ tới.
  if (audience === "mentee_no_recap_month") {
    const month = String(input.month ?? "").trim();
    if (!isRecapMonth(month)) {
      return { ok: false, message: "Chưa chọn tháng cho nhóm mentee chưa có recap." };
    }
    return { ok: true, choice: { audience, eventId: null, coversSeries: false, month } };
  }

  if (audience !== "event") {
    return { ok: true, choice: { audience, eventId: null, coversSeries: false } };
  }

  const eventId = String(input.eventId ?? "").trim();
  if (!UUID_PATTERN.test(eventId)) {
    return { ok: false, message: "Chưa chọn sự kiện cho nhóm người đã đăng ký." };
  }
  return {
    ok: true,
    choice: { audience, eventId, coversSeries: String(input.coversSeries ?? "").trim() === "true" }
  };
}

/** Một sự kiện chọn được cho nhóm `event`, kèm số người nhận đã đếm sẵn. */
export type BulkEventOption = {
  id: string;
  label: string;
  seriesId: string | null;
  /** Số người nhận nếu chỉ lấy đúng buổi này. */
  sendable: number;
  unreachable: number;
  /** Số người nhận nếu lấy cả chuỗi; null khi buổi này không thuộc chuỗi nào. */
  seriesSendable: number | null;
  seriesUnreachable: number | null;
};

/**
 * Số thư tối đa một lần chạy được gửi.
 *
 * Các lời gọi nhà cung cấp email chạy tuần tự, và một request phải kết thúc
 * trước khi Vercel cắt. Lô còn dư thì lần chạy sau đi tiếp — trạng thái nằm
 * trong `outbound_emails`, không nằm trong bộ nhớ của tiến trình.
 *
 * 85 (trước 20/11/2026 là 25): đo 6.794 thư hàng loạt qua Resend trong 45
 * ngày, mỗi thư ~0,35 giây (p90 0,38), không lá nào lỗi — 85 thư ≈ 30 giây,
 * vừa ngân sách BULK_TIME_BUDGET_MS bên dưới. Ngân sách mới là thứ thật sự giữ
 * một lần chạy trong giới hạn; con số này là trần, để một lần bấm không đi quá
 * xa khi nhà cung cấp nhanh bất thường. Lô 509 thư từng phải bấm "Gửi tiếp" 21
 * lần; nay 6 lần, hoặc một lần "Gửi tiếp tới hết".
 */
export const BULK_SEND_CHUNK = 85;

/**
 * Ngân sách thời gian của một lần chạy: hết ngân sách thì KHÔNG BẮT ĐẦU thư mới.
 *
 * Tính từ lúc lệnh bắt đầu (cả phần dựng danh sách, mở lô), không chỉ từ vòng
 * gửi. 30 giây = `maxDuration` 60 giây của trang Mail − 20 giây một lời gọi nhà
 * cung cấp có thể treo (TRANSPORT_TIMEOUT_MS) − 10 giây cho dòng ghi sổ cuối,
 * cập nhật lô, và phần vẽ lại trang Mail (revalidatePath đếm người nhận của mọi
 * nhóm, chạy trong CÙNG request khi bấm tay). Bị cắt giữa chừng nghĩa là dòng
 * ghi sổ của bức thư cuối không kịp viết xong, và bức thư đó biến mất khỏi mọi
 * câu trả lời cho "đã gửi cho ai".
 */
export const BULK_TIME_BUDGET_MS = 30_000;

/**
 * Người nhận thuộc về dòng dữ liệu nào — để sổ thư nối lá thư về đúng chỗ.
 *
 * `external` (VAM00027): email nhập tay hoặc tải từ Excel, KHÔNG có hồ sơ nào trong VAM OS. Dòng
 * này không trỏ vào bảng nào; sau khi chốt vào lô, sổ thư nối lá thư về chính dòng chốt của nó
 * (`email_batch_recipients`) — xem lib/bulk-mail-external-core.ts.
 */
export type RecipientSource = "people" | "admin_users" | "event_registrations" | "applications" | "external";

/**
 * Vai trò của người nhận trong lô, dùng để điền ô {{vai_tro}}.
 *
 * `staff` và `attendee` có mặt vì BTC và người đăng ký sự kiện không phải mentor
 * hay mentee. Ô đã dùng trong thư mà để trống thì cả lá thư bị chặn — nên nhóm
 * nào cũng phải có một chữ để điền vào đó.
 */
export type RecipientRole = "mentor" | "mentee" | "staff" | "attendee" | "external";

/**
 * `external` là "khách mời": người nhận ngoài VAM (VAM00027) không giữ vai trò nào trong chương
 * trình, và "người tham dự" thì nói sai với người chưa đăng ký gì.
 */
export const RECIPIENT_ROLE_WORDS: Record<RecipientRole, string> = {
  mentor: "mentor",
  mentee: "mentee",
  staff: "ban tổ chức",
  attendee: "người tham dự",
  external: "khách mời"
};

export type BulkRecipient = {
  /**
   * Id của dòng nguồn — người trong danh bạ, tài khoản BTC, hoặc phiếu đăng ký
   * sự kiện, tuỳ `relationTable`. Giữ tên cũ vì mọi nhóm có trước đều là người.
   */
  personId: string;
  fullName: string;
  email: string;
  role: RecipientRole;
  /** Vắng mặt nghĩa là `people`, như mọi nhóm trước khi có nhóm BTC và sự kiện. */
  relationTable?: RecipientSource;
  /**
   * Mã thành viên để điền ô {{ma_thanh_vien}}: mã mới, chưa có thì mã cũ — đúng
   * như cột "Mã thành viên" ở trang Mentor/Mentee. Nhóm đọc từ danh bạ (mentor,
   * mentee đang tham gia, mentor quay lại) có; lô Danh sách tùy chỉnh thì đọc lúc gửi,
   * kể cả dòng đăng ký sự kiện có email khớp đúng một hồ sơ (VAM00029).
   */
  memberCode?: string | null;
  /** `people.gender` nguyên văn, để suy ra ô {{xung_ho}}. */
  gender?: string | null;
  /**
   * Địa chỉ CC của RIÊNG thư này (nhóm "Mentee chưa có recap": mentor của cặp). Đã chuẩn hoá;
   * chốt vào lô cùng người nhận, nên mọi lần "Gửi tiếp" mang đúng CC đã thấy lúc xác nhận.
   */
  ccEmails?: string[];
  /** Thư vẫn đi nhưng thiếu CC lẽ ra phải có — nói ra trước khi bấm gửi, không lặng lẽ bỏ. */
  ccWarning?: string;
};

/**
 * Xưng hô theo giới tính, chỉ cho mentor (VAM00024): nữ là "Chị", nam là "Anh".
 *
 * `people.gender` là enum male | female | other | undisclosed, nhưng vẫn nhận
 * thêm "Nam"/"Nữ" và mọi kiểu hoa thường, khoảng trắng — dữ liệu cũ không chắc
 * đã đi qua bước chuẩn hoá. Giá trị nào khác (other, undisclosed, trống) trả về
 * chuỗi rỗng: gọi nhầm "Anh" một chị mentor tệ hơn là chỉ gọi tên.
 */
export function formOfAddressForGender(gender: string | null | undefined): string {
  const value = String(gender ?? "").normalize("NFC").trim().toLowerCase();
  if (value === "female" || value === "nữ" || value === "nu") return "Chị";
  if (value === "male" || value === "nam") return "Anh";
  return "";
}

/**
 * Giá trị điền vào thư cho MỘT người nhận.
 *
 * Chỉ trả về đúng các ô mà loại thư ấy khai báo. Đây là nửa còn lại của lời hứa
 * "danh mục ô điền là danh sách đóng": danh mục nói được phép dùng ô nào, còn
 * hàm này quyết định ô đó lấy dữ liệu ở đâu. Thêm một ô vào một chỗ mà quên chỗ
 * kia thì `renderTemplate` chặn bức thư lại chứ không gửi ra một chỗ trống.
 */
export function buildRecipientValues(input: {
  kind: TemplateKind;
  recipient: BulkRecipient;
  seasonCode: string;
}): Record<string, string> {
  const source: Record<string, string> = {
    ten_nguoi_nhan: input.recipient.fullName,
    mua: input.seasonCode,
    vai_tro: RECIPIENT_ROLE_WORDS[input.recipient.role] ?? RECIPIENT_ROLE_WORDS.mentee,
    ma_thanh_vien: String(input.recipient.memberCode ?? "").trim(),
    // Mentee được gọi là "Bạn" trong thư; BTC và người tham dự sự kiện không
    // mang giới tính trong lô. Chỉ mentor có xưng hô — còn lại để trống, và ô
    // `emptyAllowed` tự gộp khoảng trắng thừa.
    xung_ho: input.recipient.role === "mentor" ? formOfAddressForGender(input.recipient.gender) : ""
  };

  const values: Record<string, string> = {};
  for (const placeholder of TEMPLATE_SPECS[input.kind]?.placeholders ?? []) {
    values[placeholder.key] = source[placeholder.key] ?? "";
  }
  return values;
}

export type RecipientPartition = {
  /** Gửi được: có tên và có địa chỉ hợp lệ, mỗi địa chỉ đúng một lần. */
  sendable: BulkRecipient[];
  /** Không gửi được, kèm lý do — để nói ra chứ không lặng lẽ bỏ qua. */
  unreachable: Array<{ personId: string; fullName: string; reason: string }>;
};

/**
 * Tách danh sách thành gửi được và không gửi được.
 *
 * Người thiếu địa chỉ hoặc thiếu tên KHÔNG bị lặng lẽ bỏ qua: họ đi vào
 * `unreachable` và được đếm, vì "gửi cho 180 người" mà thật ra là 174 là một
 * câu trả lời sai cho câu hỏi quan trọng nhất sau một lượt gửi.
 *
 * Trùng địa chỉ chỉ nhận một lá. Một người vừa là mentor vừa là mentee của cùng
 * một mùa là chuyện có thật, và họ không nên nhận hai bản của cùng một thông
 * báo. Bản giữ lại là bản gặp trước — thứ tự gọi hàm quyết định, nên nơi gọi
 * sắp xếp trước khi đưa vào.
 */
export function partitionRecipients(rows: BulkRecipient[]): RecipientPartition {
  const sendable: BulkRecipient[] = [];
  const unreachable: RecipientPartition["unreachable"] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const fullName = String(row.fullName ?? "").trim();
    const email = normalizeEmailAddress(row.email);

    if (!email) {
      unreachable.push({
        personId: row.personId,
        fullName: fullName || "(chưa có tên)",
        reason: "Chưa có địa chỉ email hợp lệ"
      });
      continue;
    }
    if (!fullName) {
      // Thư mở đầu bằng "Chào ," thì thà không gửi. `renderTemplate` cũng sẽ
      // chặn, nhưng chặn ở đây thì đếm được và nói ra được trước khi bấm gửi.
      unreachable.push({
        personId: row.personId,
        fullName: email,
        reason: "Chưa có họ tên trong hệ thống"
      });
      continue;
    }
    if (seen.has(email)) continue;

    seen.add(email);
    // CC trùng chính người nhận thì bỏ: cùng một hộp thư nhận hai bản là thứ người ta hỏi lại.
    const ccEmails = Array.from(
      new Set((row.ccEmails ?? []).map((cc) => normalizeEmailAddress(cc)).filter((cc): cc is string => Boolean(cc) && cc !== email))
    );
    sendable.push({
      personId: row.personId,
      fullName,
      email,
      role: row.role,
      ...(row.relationTable ? { relationTable: row.relationTable } : {}),
      ...(row.memberCode ? { memberCode: row.memberCode } : {}),
      ...(row.gender ? { gender: row.gender } : {}),
      ...(ccEmails.length ? { ccEmails } : {}),
      ...(row.ccWarning ? { ccWarning: row.ccWarning } : {})
    });
  }

  return { sendable, unreachable };
}

/**
 * Những người còn phải gửi trong một lô đang chạy dở.
 *
 * `done` là các địa chỉ đã có dòng kết quả trong `outbound_emails` của lô này.
 * Lọc theo đó chứ không theo số đếm: một lần chạy bị cắt giữa chừng vẫn để lại
 * đúng những dòng nó đã ghi, nên lần chạy sau đi tiếp từ đúng chỗ đó và không
 * ai nhận hai lá.
 */
export function remainingRecipients(
  all: BulkRecipient[],
  done: Iterable<string>
): BulkRecipient[] {
  const sent = new Set(Array.from(done, (email) => normalizeEmailAddress(email) ?? ""));
  return all.filter((row) => !sent.has(row.email));
}

export type BulkSendConfirmation =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Kiểm câu xác nhận trước khi gửi.
 *
 * Người bấm phải gõ lại đúng số người sẽ nhận thư. Đây là nút có sức công phá
 * lớn nhất trong app: không có đường thu hồi một lá thư đã vào hộp thư của một
 * sinh viên, và một cú bấm nhầm là hàng trăm lá. Gõ lại con số buộc mắt nhìn
 * vào quy mô của việc mình đang làm.
 */
export function confirmBulkSend(input: {
  typed: unknown;
  expected: number;
}): BulkSendConfirmation {
  if (input.expected <= 0) {
    return { ok: false, message: "Không có ai để gửi." };
  }

  const typed = String(input.typed ?? "").trim();
  if (!typed) {
    return { ok: false, message: `Gõ lại số người nhận (${input.expected}) để xác nhận.` };
  }
  if (!/^\d+$/.test(typed) || Number(typed) !== input.expected) {
    return {
      ok: false,
      message: `Số xác nhận chưa khớp. Lượt gửi này có ${input.expected} người nhận.`
    };
  }

  return { ok: true };
}

/** Câu tóm tắt sau một lần chạy, dùng chung cho action và cho màn hình. */
export function describeRunResult(input: {
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  rateLimited?: boolean;
  providerTrouble?: boolean;
  configBlocked?: boolean;
  /** Số lá lỗi điền ô của lần chạy (không ghi sổ, còn trong `remaining`). */
  fillFailed?: number;
}): string {
  const parts = [`Đã gửi ${input.sent} thư`];
  if (input.skipped) parts.push(`${input.skipped} thư bị cấu hình chặn`);
  if (input.failed) parts.push(`${input.failed} thư lỗi`);

  const head = parts.join(", ") + ".";
  // Ba câu dừng giữa chừng chỉ có nghĩa khi lô còn người; hết người rồi thì nói "đã gửi xong" như thường.
  if (input.configBlocked && input.remaining > 0) {
    return `${head} Cấu hình đang chặn gửi thư nên đã dừng. Còn ${input.remaining} người chưa nhận — bật lại gửi thư rồi bấm “Gửi tiếp”.`;
  }
  if (input.rateLimited && input.remaining > 0) {
    return `${head} Nhà cung cấp email báo chạm giới hạn gửi nên đã dừng. Còn ${input.remaining} người chưa nhận — chờ ít phút (nếu là hạn mức trong ngày thì chờ sang ngày) rồi bấm “Gửi tiếp”.`;
  }
  // Còn lại chỉ toàn người lỗi điền ô: bấm "Gửi tiếp" không giúp gì, phải sửa mẫu hoặc dữ liệu trước.
  if (input.fillFailed && input.remaining > 0 && input.remaining <= input.fillFailed) {
    return `${head} Còn ${input.remaining} người chưa nhận vì thiếu dữ liệu điền ô — sửa mẫu thư hoặc dữ liệu của họ rồi mới bấm “Gửi tiếp”.`;
  }
  if (input.providerTrouble && input.remaining > 0) {
    return `${head} Nhiều thư lỗi liên tiếp nên đã dừng để không ghi lỗi cả lô. Còn ${input.remaining} người chưa nhận — kiểm Nhật ký gửi rồi bấm “Gửi tiếp”.`;
  }
  if (input.remaining > 0) {
    return `${head} Còn ${input.remaining} người chưa nhận — bấm “Gửi tiếp” để đi tiếp.`;
  }
  return `${head} Lô này đã gửi xong.`;
}

/** Trần số lần chạy của một lượt "Gửi tiếp tới hết": 60 × BULK_SEND_CHUNK là hơn hạn mức cả ngày. */
export const AUTO_CONTINUE_MAX_ROUNDS = 60;

export type AutoContinueStep =
  | "continue"
  | "done"
  | "stopped"
  | "error"
  | "rate_limited"
  | "provider_trouble"
  | "config_blocked"
  | "stuck"
  | "round_limit";

/**
 * Sau mỗi lần chạy, nút "Gửi tiếp tới hết" có bấm tiếp hay không.
 *
 * Chỉ đi tiếp khi lần chạy vừa rồi CHẮC CHẮN tiến được: thành công, còn người, có xử lý ít nhất một
 * lá, không bị nhà cung cấp chặn, người bấm chưa bảo dừng. Mọi trường hợp khác dừng lại và nói vì
 * sao — một vòng lặp tự bấm mà không tiến được là một vòng lặp gọi máy chủ mãi mãi, còn một vòng
 * lặp đi tiếp sau lỗi là gửi thư trong khi người bấm tưởng nó đã dừng.
 */
export function autoContinueStep(input: {
  ok: boolean;
  remaining?: number;
  processed?: number;
  rateLimited?: boolean;
  providerTrouble?: boolean;
  configBlocked?: boolean;
  stopRequested: boolean;
  round: number;
}): AutoContinueStep {
  if (!input.ok) return "error";
  if (typeof input.remaining !== "number" || !Number.isFinite(input.remaining)) return "error";
  if (input.remaining <= 0) return "done";
  if (input.configBlocked) return "config_blocked";
  if (input.rateLimited) return "rate_limited";
  if (input.providerTrouble) return "provider_trouble";
  if (!input.processed || input.processed <= 0) return "stuck";
  if (input.stopRequested) return "stopped";
  if (input.round + 1 >= AUTO_CONTINUE_MAX_ROUNDS) return "round_limit";
  return "continue";
}

/** Câu báo khi lượt "Gửi tiếp tới hết" dừng (không có câu cho "continue"). */
export const AUTO_CONTINUE_END_WORDS: Record<Exclude<AutoContinueStep, "continue">, string> = {
  done: "Lô đã gửi xong.",
  stopped: "Đã dừng theo yêu cầu. Phần còn lại vẫn nằm trong lô.",
  error: "Đã dừng vì lần chạy vừa rồi báo lỗi.",
  rate_limited: "Đã dừng vì nhà cung cấp email báo chạm giới hạn gửi. Chờ ít phút rồi bấm lại.",
  provider_trouble: "Đã dừng vì nhiều thư lỗi liên tiếp. Kiểm Nhật ký gửi trước khi bấm lại.",
  config_blocked: "Đã dừng vì cấu hình đang chặn gửi thư. Bật lại gửi thư rồi bấm lại.",
  stuck: "Đã dừng vì lần chạy vừa rồi không gửi thêm được lá nào (thường do thiếu dữ liệu điền ô của vài người).",
  round_limit: "Đã dừng sau số lần chạy tối đa của một lượt. Bấm lại để đi tiếp."
};
