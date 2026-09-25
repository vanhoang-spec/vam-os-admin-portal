import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  extractPlaceholders,
  placeholderToken
} from "@/lib/email-templates-core";

/**
 * lib/email-automation-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ban tổ chức tự sửa nội dung những lá thư HỆ THỐNG TỰ GỬI.
 *
 * Trước file này, câu chữ của 16 lá thư tự động nằm trong các hàm dựng thư ở
 * `lib/email-core.ts`, và đổi một câu là một lần deploy. Màn hình "Thư tự động"
 * giờ cho core team / support team sửa và lưu; từ sau lúc lưu, hệ thống gửi đi
 * nội dung mới.
 *
 * ---------------------------------------------------------------------------
 * BỐN LUẬT LÀM CHO VIỆC NÀY AN TOÀN
 * ---------------------------------------------------------------------------
 * 1. BẢN MẶC ĐỊNH SUY RA TỪ CHÍNH HÀM DỰNG THƯ, KHÔNG CHÉP TAY.
 *    Gọi hàm dựng thư với giá trị mồi `@@ten_o@@` rồi đổi mồi thành `{{ten_o}}`.
 *    Nhờ vậy bản mặc định KHÔNG THỂ lệch với thư đang gửi thật — chép tay câu
 *    chữ sang đây thì ngày ai đó sửa hàm dựng thư, màn hình này nói sai mà
 *    không có gì phát hiện ra.
 *
 * 2. Ô BẮT BUỘC MÀ THIẾU LÀ LỖI, KHÔNG PHẢI CẢNH BÁO.
 *    Khác `validateTemplate` của thư hàng loạt, nơi thiếu ô chỉ là nhắc nhở.
 *    Ở đó có người đọc lại trước mỗi lượt gửi; ở đây không có ai cả. Một thư
 *    mời đặt lịch không còn `{{link_dat_lich}}` là một lá thư không ai làm gì
 *    được, và nó sẽ đi im lặng tới từng người cho tới khi có người gọi điện hỏi.
 *
 * 3. DÒNG CHỨA Ô KHÔNG CÓ DỮ LIỆU THÌ BIẾN MẤT CẢ DÒNG.
 *    "Số điện thoại:" đứng trơ một mình còn tệ hơn là không có dòng đó. Luật
 *    này nói được thành một câu cho người vận hành, nên họ dựa vào được.
 *
 * 4. DỰNG KHÔNG ĐƯỢC THÌ GỬI BẢN MẶC ĐỊNH, KHÔNG PHẢI KHÔNG GỬI.
 *    Cưỡng chế ở `lib/email-automation.ts`. Một lá thư tự động không bao giờ
 *    được phép KHÔNG ĐI vì có người vừa sửa hỏng nội dung của nó.
 *
 * Module THUẦN, không I/O — để mọi luật trên kiểm được mà không cần database.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Ô điền
// ─────────────────────────────────────────────────────────────────────────────

export type AutomationPlaceholder = {
  /** Tên ô, đúng như khi gõ vào thư: `{{key}}`. */
  key: string;
  label: string;
  /**
   * Bắt buộc phải còn trong thư sau khi sửa.
   *
   * Đây là ô mà thiếu nó thì lá thư mất nghĩa: tên người nhận, đường dẫn riêng,
   * khung giờ đã hẹn. Lưu mà thiếu là bị từ chối.
   */
  required: boolean;
  /** Ô có thể không có dữ liệu ở một số lần gửi — khi đó cả dòng chứa nó biến mất. */
  optional?: boolean;
  hint: string;
};

export type AutomationGroup =
  | "Nộp đơn và tuyển chọn"
  | "Chấm hồ sơ"
  | "Tài khoản đăng nhập";

export const AUTOMATION_GROUPS: readonly AutomationGroup[] = [
  "Nộp đơn và tuyển chọn",
  "Chấm hồ sơ",
  "Tài khoản đăng nhập"
] as const;

export type AutomationSlot = {
  /**
   * Khoá bền của một lá thư.
   *
   * CỐ Ý KHÔNG dùng `kind` của sổ thư: một `kind` có thể mang hai lá thư khác
   * nhau (`interview_scheduled` gửi ứng viên và gửi người phỏng vấn là hai nội
   * dung), nên lấy `kind` làm khoá là để hai lá thư giẫm lên nhau.
   */
  id: string;
  /** Trùng cột `kind` trong sổ thư, để đối chiếu được với một dòng đã gửi. */
  kind: string;
  group: AutomationGroup;
  title: string;
  audience: string;
  trigger: string;
  note?: string;
  placeholders: readonly AutomationPlaceholder[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Ô dùng lại nhiều lá thư
// ─────────────────────────────────────────────────────────────────────────────

const P_TEN_NGUOI_NHAN: AutomationPlaceholder = {
  key: "ten_nguoi_nhan",
  label: "Tên người nhận",
  required: true,
  hint: "Họ tên đang lưu trong hệ thống. Không có tên thì hệ thống dùng 'anh/chị'."
};

const P_MUA: AutomationPlaceholder = {
  key: "mua",
  label: "Tên mùa",
  required: true,
  hint: "Ví dụ: UEH Mentoring Mùa 12."
};

const P_ZALO: AutomationPlaceholder = {
  key: "zalo_ho_tro",
  label: "Zalo hỗ trợ",
  required: false,
  hint: "Số Zalo của ban tổ chức, lấy từ cấu hình hệ thống."
};

const P_KHUNG_GIO: AutomationPlaceholder = {
  key: "khung_gio",
  label: "Khung giờ đã hẹn",
  required: true,
  hint: "Ví dụ: Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)."
};

const P_EMAIL_DANG_NHAP: AutomationPlaceholder = {
  key: "email_dang_nhap",
  label: "Email đăng nhập",
  required: true,
  hint: "Địa chỉ dùng để đăng nhập VAM OS."
};

const P_LINK_DAT_MAT_KHAU: AutomationPlaceholder = {
  key: "link_dat_mat_khau",
  label: "Đường dẫn đặt mật khẩu",
  required: true,
  hint: "Đường dẫn riêng, dùng một lần. Bỏ ô này là người nhận không vào được."
};

const P_LINK_DANG_NHAP: AutomationPlaceholder = {
  key: "link_dang_nhap",
  label: "Đường dẫn đăng nhập",
  required: true,
  hint: "Trang đăng nhập VAM OS."
};

// ─────────────────────────────────────────────────────────────────────────────
// Danh mục 16 lá thư
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DANH SÁCH ĐÓNG, và chỉ gồm những lá thư MAIN THỰC SỰ GỬI ĐƯỢC hôm nay.
 *
 * Bốn lá cross-mentoring, thư nhắc thu recap và thư link gia hạn mentor có hàm
 * dựng sẵn trong `lib/email-core.ts` nhưng KHÔNG có chỗ nào trên main gọi tới —
 * mở ô sửa cho một lá thư không gửi được là hứa một việc mà hệ thống không làm,
 * đúng thứ mục "nav không được hứa" trong CLAUDE.md cấm.
 *
 * Bốn lá thư sự kiện cũng không ở đây: thân thư của chúng có mã QR và bảng buổi
 * sinh ra tự động, nên chúng cần một thiết kế riêng chứ không phải một ô chữ.
 */
export const AUTOMATION_SLOTS: readonly AutomationSlot[] = [
  {
    id: "mentee_application_confirmation",
    kind: "mentee_application_confirmation",
    group: "Nộp đơn và tuyển chọn",
    title: "Xác nhận đã nhận đơn mentee",
    audience: "Bạn vừa nộp đơn mentee",
    trigger: "Ngay sau khi bấm gửi đơn ở form đăng ký mentee.",
    placeholders: [P_TEN_NGUOI_NHAN, P_MUA]
  },
  {
    id: "mentor_application_confirmation",
    kind: "mentor_application_confirmation",
    group: "Nộp đơn và tuyển chọn",
    title: "Xác nhận đã nhận đơn mentor — kèm nút chọn giờ",
    audience: "Anh/chị vừa nộp đơn mentor, khi đợt đặt lịch đang mở",
    trigger: "Ngay sau khi bấm gửi đơn, nếu đơn đã có mã đặt lịch.",
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_MUA,
      {
        key: "link_dat_lich",
        label: "Đường dẫn đặt lịch",
        required: true,
        hint: "Đường dẫn riêng của từng mentor để chọn giờ trao đổi ngay từ thư xác nhận."
      }
    ]
  },
  {
    // TÁCH RIÊNG, không phải một dòng tuỳ chọn của lá trên: hàm dựng thư có hai
    // NHÁNH với nhiều đoạn khác hẳn nhau, không phải một dòng thêm bớt. Gộp
    // chúng thành một ô sửa được là để người vận hành sửa một bản rồi bản kia
    // âm thầm vẫn là câu chữ cũ.
    id: "mentor_application_confirmation_no_booking",
    kind: "mentor_application_confirmation",
    group: "Nộp đơn và tuyển chọn",
    title: "Xác nhận đã nhận đơn mentor — chưa mở đặt lịch",
    audience: "Anh/chị vừa nộp đơn mentor, khi đợt đặt lịch chưa mở",
    trigger: "Ngay sau khi bấm gửi đơn, nếu đơn chưa có mã đặt lịch.",
    placeholders: [P_TEN_NGUOI_NHAN, P_MUA]
  },
  {
    id: "interview_round_invite",
    kind: "interview_round_invite",
    group: "Nộp đơn và tuyển chọn",
    title: "Mời vào vòng phỏng vấn",
    audience: "Ứng viên đã qua vòng hồ sơ",
    trigger: 'Khi ban tổ chức chọn "Mời phỏng vấn" cho một hoặc nhiều hồ sơ.',
    note: "Thư này cố ý không mang đường dẫn nào: ứng viên chưa có màn hình nào để tự chọn lịch.",
    placeholders: [P_TEN_NGUOI_NHAN, P_MUA]
  },
  {
    id: "interview_slot_invite",
    kind: "interview_slot_invite",
    group: "Nộp đơn và tuyển chọn",
    title: "Mời mentor tự chọn giờ trao đổi — thư đầu",
    audience: "Mentor đã nộp đơn, chưa đặt lịch",
    trigger: "Khi có interviewer đăng khung giờ rảnh đầu tiên.",
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_MUA,
      {
        key: "link_dat_lich",
        label: "Đường dẫn đặt lịch",
        required: true,
        hint: "Đường dẫn riêng của từng mentor. Bỏ ô này là thư không còn tác dụng gì."
      },
      {
        key: "han_chot",
        label: "Hạn chót của đợt",
        required: true,
        hint: "Ngày cuối cùng còn đặt được lịch."
      },
      P_ZALO
    ]
  },
  {
    id: "interview_slot_reminder",
    kind: "interview_slot_invite",
    group: "Nộp đơn và tuyển chọn",
    title: "Nhắc mentor chưa chọn giờ trao đổi",
    audience: "Mentor đã nhận thư mời mà chưa đặt lịch",
    trigger: "Nhắc sau mỗi 3 ngày, tối đa 3 lần (lần 3 CC hộp thư ban tổ chức).",
    note: 'Cùng loại "interview_slot_invite" trong sổ thư với thư mời đầu, nhưng là hai nội dung khác nhau.',
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_MUA,
      {
        key: "lan_nhac",
        label: "Lần nhắc thứ mấy",
        required: true,
        hint: "1, 2 hoặc 3. Nói rõ đây là lần thứ mấy để người nhận hiểu không phải máy gửi trùng."
      },
      {
        key: "link_dat_lich",
        label: "Đường dẫn đặt lịch",
        required: true,
        hint: "Đường dẫn riêng của từng mentor."
      },
      { key: "han_chot", label: "Hạn chót của đợt", required: true, hint: "Ngày cuối cùng còn đặt được lịch." },
      P_ZALO
    ]
  },
  {
    id: "interview_scheduled_candidate",
    kind: "interview_scheduled",
    group: "Nộp đơn và tuyển chọn",
    title: "Xác nhận buổi hẹn — gửi ứng viên",
    audience: "Mentor vừa chọn xong một khung giờ",
    trigger: "Ngay khi mentor bấm giữ một khung giờ trên trang đặt lịch.",
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_MUA,
      P_KHUNG_GIO,
      { key: "ten_nguoi_trao_doi", label: "Tên người trao đổi", required: true, hint: "Người của core team phụ trách buổi này." },
      { key: "email_nguoi_trao_doi", label: "Email người trao đổi", required: true, hint: "Để ứng viên liên hệ được." },
      {
        key: "sdt_nguoi_trao_doi",
        label: "SĐT người trao đổi",
        required: false,
        optional: true,
        hint: "Không phải ai cũng khai số. Dòng chứa ô này biến mất khi không có số."
      },
      { key: "link_doi_lich", label: "Đường dẫn đổi lịch", required: true, hint: "Đường dẫn riêng để ứng viên tự huỷ và chọn giờ khác." },
      P_ZALO
    ]
  },
  {
    id: "interview_scheduled_interviewer",
    kind: "interview_scheduled",
    group: "Nộp đơn và tuyển chọn",
    title: "Báo có mentor vừa đặt lịch — gửi người phỏng vấn",
    audience: "Người phỏng vấn của khung giờ vừa được đặt, và bản CC về hộp thư ban tổ chức",
    trigger: "Ngay khi mentor bấm giữ một khung giờ trên trang đặt lịch.",
    note: 'Cùng loại "interview_scheduled" trong sổ thư với lá thư gửi ứng viên, nhưng là hai nội dung khác nhau.',
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_MUA,
      P_KHUNG_GIO,
      { key: "ten_ung_vien", label: "Tên ứng viên", required: true, hint: "Mentor đã đặt khung giờ này." },
      { key: "email_ung_vien", label: "Email ứng viên", required: true, hint: "Để người phỏng vấn liên hệ hẹn kênh gọi." },
      {
        key: "sdt_ung_vien",
        label: "SĐT ứng viên",
        required: false,
        optional: true,
        hint: "Dòng chứa ô này biến mất khi ứng viên không khai số."
      },
      { key: "link_cham_diem", label: "Đường dẫn chấm điểm", required: true, hint: "Trang phiếu đánh giá trong VAM OS." },
      P_ZALO
    ]
  },
  {
    id: "interview_slot_cancelled_candidate",
    kind: "interview_slot_cancelled",
    group: "Nộp đơn và tuyển chọn",
    title: "Báo huỷ buổi hẹn — gửi ứng viên",
    audience: "Mentor của buổi vừa bị huỷ",
    trigger: "Khi mentor tự huỷ (còn hơn 24 giờ) hoặc ban tổ chức huỷ trên trang Lịch phỏng vấn.",
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_KHUNG_GIO,
      { key: "ten_nguoi_trao_doi", label: "Tên người trao đổi", required: true, hint: "Người của core team đã nhận buổi này." },
      { key: "nguoi_huy", label: "Ai huỷ", required: true, hint: "Ví dụ: do anh/chị huỷ, hoặc do ban tổ chức huỷ." },
      { key: "link_dat_lai", label: "Đường dẫn đặt lại", required: true, hint: "Để ứng viên chọn giờ khác. Bỏ ô này là buộc họ phải gọi điện." },
      P_ZALO
    ]
  },
  {
    id: "interview_slot_cancelled_interviewer",
    kind: "interview_slot_cancelled",
    group: "Nộp đơn và tuyển chọn",
    title: "Báo huỷ buổi hẹn — gửi người phỏng vấn",
    audience: "Người phỏng vấn của buổi vừa bị huỷ",
    trigger: "Cùng lúc với thư gửi ứng viên.",
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_KHUNG_GIO,
      { key: "ten_ung_vien", label: "Tên ứng viên", required: true, hint: "Mentor của buổi bị huỷ." },
      { key: "nguoi_huy", label: "Ai huỷ", required: true, hint: "Ví dụ: do ứng viên huỷ, hoặc do ban tổ chức huỷ." },
      P_ZALO
    ]
  },
  {
    id: "reviewer_invite_new",
    kind: "reviewer_invite",
    group: "Chấm hồ sơ",
    title: "Mời mentor chấm hồ sơ — tài khoản mới",
    audience: "Mentor vừa được cấp quyền chấm, chưa có tài khoản",
    trigger: 'Khi ban tổ chức cấp quyền chấm trên "Danh sách nhân sự tuyển sinh".',
    placeholders: [P_TEN_NGUOI_NHAN, P_MUA, P_LINK_DAT_MAT_KHAU, P_LINK_DANG_NHAP, P_EMAIL_DANG_NHAP]
  },
  {
    id: "reviewer_invite_recovery",
    kind: "reviewer_invite",
    group: "Chấm hồ sơ",
    title: "Gửi lại đường dẫn đặt mật khẩu cho người chấm",
    audience: "Mentor đã có tài khoản, cần đường dẫn mới",
    trigger: "Khi ban tổ chức gửi lại đường dẫn cho một người đã có tài khoản.",
    note: "Đường dẫn trong các thư trước hết tác dụng ngay khi thư này đi.",
    placeholders: [P_TEN_NGUOI_NHAN, P_MUA, P_LINK_DAT_MAT_KHAU, P_LINK_DANG_NHAP, P_EMAIL_DANG_NHAP]
  },
  {
    id: "review_batch_assigned",
    kind: "review_batch_assigned",
    group: "Chấm hồ sơ",
    title: "Báo đã giao một lô hồ sơ cần chấm",
    audience: "Người chấm vừa được giao hồ sơ",
    trigger: "Khi ban tổ chức giao hồ sơ, từng phiếu hoặc theo lô.",
    placeholders: [
      P_TEN_NGUOI_NHAN,
      P_MUA,
      { key: "so_ho_so", label: "Số hồ sơ được giao", required: true, hint: "Số phiếu trong lô vừa giao." },
      {
        key: "loai_ho_so",
        label: "Loại hồ sơ",
        required: true,
        hint: 'Hệ thống điền "hồ sơ mentor", "hồ sơ mentee", hoặc "hồ sơ" khi chưa rõ loại — luôn có giá trị.'
      },
      { key: "link_cham_diem", label: "Đường dẫn chấm điểm", required: true, hint: "Trang danh sách việc cần chấm." },
      {
        key: "han_cham",
        label: "Hạn chấm",
        required: false,
        optional: true,
        hint: "Dòng chứa ô này biến mất khi lô không đặt hạn."
      }
    ]
  },
  {
    id: "staff_invite_new",
    kind: "staff_invite",
    group: "Tài khoản đăng nhập",
    title: "Mời vào ban tổ chức — tài khoản mới",
    audience: "Người vừa được tạo tài khoản ban tổ chức",
    trigger: "Khi super admin tạo một tài khoản mới ở Quản lý người dùng.",
    placeholders: [
      P_TEN_NGUOI_NHAN,
      { key: "vai_tro", label: "Vai trò được cấp", required: true, hint: "Ví dụ: Core Team, Support Team." },
      P_LINK_DAT_MAT_KHAU,
      P_LINK_DANG_NHAP,
      P_EMAIL_DANG_NHAP
    ]
  },
  {
    id: "staff_invite_recovery",
    kind: "staff_invite",
    group: "Tài khoản đăng nhập",
    title: "Gửi lại đường dẫn đặt mật khẩu cho ban tổ chức",
    audience: "Thành viên ban tổ chức cần đường dẫn mới",
    trigger: "Khi super admin gửi lại đường dẫn cho một tài khoản đã có.",
    // CỐ Ý KHÔNG có {{vai_tro}}: thư gửi lại đường dẫn không nhắc vai trò —
    // người nhận đã biết mình làm gì, câu "đã tạo tài khoản với vai trò X" chỉ
    // đúng ở lần mời đầu. Bài test đối chiếu bản mặc định với danh mục ô đã bắt
    // được đúng chỗ này.
    placeholders: [P_TEN_NGUOI_NHAN, P_LINK_DAT_MAT_KHAU, P_LINK_DANG_NHAP, P_EMAIL_DANG_NHAP]
  },
  {
    id: "participant_invite_new",
    kind: "participant_invite",
    group: "Tài khoản đăng nhập",
    title: "Mời mentor / mentee lập tài khoản",
    audience: "Mentor hoặc mentee của một mùa",
    trigger: 'Khi ban tổ chức mời lập tài khoản ở "Tài khoản đăng nhập".',
    placeholders: [P_TEN_NGUOI_NHAN, P_LINK_DAT_MAT_KHAU, P_LINK_DANG_NHAP, P_EMAIL_DANG_NHAP]
  },
  {
    id: "participant_invite_recovery",
    kind: "participant_invite",
    group: "Tài khoản đăng nhập",
    title: "Gửi lại đường dẫn đặt mật khẩu cho mentor / mentee",
    audience: "Mentor hoặc mentee đã có tài khoản",
    trigger: "Khi ban tổ chức gửi lại đường dẫn cho một người đã có tài khoản.",
    note: "Đường dẫn trong các thư trước hết tác dụng ngay khi thư này đi.",
    placeholders: [P_TEN_NGUOI_NHAN, P_LINK_DAT_MAT_KHAU, P_LINK_DANG_NHAP, P_EMAIL_DANG_NHAP]
  }
] as const;

export const AUTOMATION_SLOT_IDS: readonly string[] = AUTOMATION_SLOTS.map((slot) => slot.id);

export function findAutomationSlot(id: unknown): AutomationSlot | null {
  const text = String(id ?? "").trim();
  return AUTOMATION_SLOTS.find((slot) => slot.id === text) ?? null;
}

export function automationSlotsByGroup(): Array<{ group: AutomationGroup; slots: AutomationSlot[] }> {
  return AUTOMATION_GROUPS.map((group) => ({
    group,
    slots: AUTOMATION_SLOTS.filter((slot) => slot.group === group)
  })).filter((row) => row.slots.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Giá trị mồi: cầu nối giữa hàm dựng thư và bản mặc định sửa được
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Giá trị mồi của một ô.
 *
 * Dùng `@@` chứ không phải `{{`: hàm dựng thư đưa vài giá trị qua `escapeHtml`,
 * và ta chỉ muốn đổi mồi thành ô sau khi hàm đã chạy xong. `@@` đi qua
 * `safeDisplayName` và `escapeHtml` nguyên vẹn, còn `{` `}` thì không có gì bảo
 * đảm như vậy về sau.
 */
export function placeholderSentinel(key: string): string {
  return `@@${key}@@`;
}

/**
 * Đổi chuỗi mồi trong một bản thư đã dựng thành ô điền.
 *
 * Dùng `split`/`join` chứ không phải regex, có chủ ý: khoá ô do file này đặt
 * nên không cần biểu thức, và một regex dựng bằng ghép chuỗi là đúng loại lỗi
 * mà CLAUDE.md đã ghi (mất một dấu gạch chéo ngược thì vẫn hợp lệ, chỉ làm sai
 * việc, và qua được cả bốn cổng).
 */
export function templateFromSentinelText(text: string, keys: readonly string[]): string {
  let out = String(text ?? "");
  for (const key of keys) {
    out = out.split(placeholderSentinel(key)).join(placeholderToken(key));
  }
  return out;
}

/** Bộ giá trị mồi cho một lá thư, đưa thẳng vào hàm dựng thư. */
export function sentinelValues(slot: AutomationSlot): Record<string, string> {
  const values: Record<string, string> = {};
  for (const placeholder of slot.placeholders) {
    values[placeholder.key] = placeholderSentinel(placeholder.key);
  }
  return values;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kiểm nội dung người vận hành vừa gõ
// ─────────────────────────────────────────────────────────────────────────────

export type AutomationValidation =
  | { ok: true; subject: string; body: string }
  | { ok: false; message: string };

/**
 * Kiểm trước khi lưu.
 *
 * Ba phép từ chối, theo đúng thứ tự cái giá của chúng:
 *   - Thẻ HTML: thư chỉ nhận chữ thuần, phần định dạng do hệ thống dựng.
 *   - Ô lạ: không gì điền được nó, nên nó sẽ sống sót vào thư gửi đi.
 *   - Thiếu ô bắt buộc: lá thư mất nghĩa, và không có ai đọc lại trước khi gửi.
 */
export function validateAutomationContent(input: {
  slotId: unknown;
  subject?: unknown;
  body?: unknown;
}): AutomationValidation {
  const slot = findAutomationSlot(input.slotId);
  if (!slot) return { ok: false, message: "Không xác định được lá thư cần lưu." };

  // Xuống dòng trong tiêu đề bị một số máy chủ thư hiểu là ranh giới header.
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  if (!subject) return { ok: false, message: "Vui lòng nhập tiêu đề thư." };
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, message: `Tiêu đề không được dài quá ${MAX_SUBJECT_LENGTH} ký tự.` };
  }

  const body = String(input.body ?? "").replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, message: "Vui lòng nhập nội dung thư." };
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, message: `Nội dung không được dài quá ${MAX_BODY_LENGTH} ký tự.` };
  }

  if (subject.includes("<") || subject.includes(">") || body.includes("<") || body.includes(">")) {
    return {
      ok: false,
      message:
        "Thư chỉ nhận văn bản thuần, không nhận thẻ HTML (dấu < và >). Phần định dạng do hệ thống tự dựng."
    };
  }

  const known = new Set(slot.placeholders.map((row) => row.key));
  const used = extractPlaceholders(`${subject}\n${body}`);

  const unknown = used.filter((key) => !known.has(key));
  if (unknown.length) {
    return {
      ok: false,
      message: `Thư đang dùng ô không có dữ liệu: ${unknown
        .map(placeholderToken)
        .join(", ")}. Vui lòng xoá hoặc thay bằng ô hợp lệ.`
    };
  }

  // Ở thư hàng loạt, thiếu ô bắt buộc chỉ là cảnh báo vì có người đọc lại trước
  // mỗi lượt gửi. Thư tự động không có ai đọc lại, nên đây là LỖI.
  const missing = slot.placeholders.filter((row) => row.required && !used.includes(row.key));
  if (missing.length) {
    return {
      ok: false,
      message: `Thư bắt buộc phải còn ${missing
        .map((row) => `${placeholderToken(row.key)} (${row.label})`)
        .join(", ")}. Thiếu ô này thì người nhận không làm gì được với lá thư.`
    };
  }

  return { ok: true, subject, body };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dựng thư thật từ nội dung đã lưu
// ─────────────────────────────────────────────────────────────────────────────

export type AutomationRender =
  | { ok: true; subject: string; text: string }
  | { ok: false; reason: string };

/**
 * Kết quả điền MỘT dòng.
 *
 * Ba nhánh, không phải hai — và đó là chỗ dễ sai nhất của cả file. Một dòng
 * TRỐNG là dòng ngăn đoạn hợp lệ, không phải một dòng thiếu dữ liệu; gộp hai
 * thứ đó vào một giá trị `""` là mọi thư có đoạn văn đều hỏng.
 */
type LineFill =
  | { kind: "ok"; text: string }
  /** Dòng chứa một ô optional không có dữ liệu — bỏ cả dòng. */
  | { kind: "drop" }
  /** Dòng chứa một ô bắt buộc không có dữ liệu — hỏng cả bức thư. */
  | { kind: "missing" };

function fillLine(line: string, slot: AutomationSlot, values: Record<string, unknown>): LineFill {
  const used = extractPlaceholders(line);
  let out = line;
  for (const key of used) {
    const spec = slot.placeholders.find((row) => row.key === key);
    const raw = values[key];
    const filled = raw === null || raw === undefined ? "" : String(raw).trim();
    if (!filled) {
      // Ô có dữ liệu ở lần gửi này thì thôi; không có thì cả DÒNG biến mất.
      // "Số điện thoại:" đứng trơ một mình còn tệ hơn là không có dòng đó.
      if (spec?.optional) return { kind: "drop" };
      return { kind: "missing" };
    }
    out = out.split(placeholderToken(key)).join(filled);
  }
  return { kind: "ok", text: out };
}

/**
 * Điền nội dung đã lưu cho MỘT người nhận.
 *
 * Trả `ok: false` khi một ô KHÔNG optional không có dữ liệu. Nơi gọi
 * (`lib/email-automation.ts`) khi đó gửi bản mặc định của hàm dựng thư — lá thư
 * vẫn đi, và sự cố được ghi lại thay vì biến thành một người không nhận được gì.
 */
export function renderAutomationContent(input: {
  slotId: unknown;
  subject: string;
  body: string;
  values: Record<string, unknown>;
}): AutomationRender {
  const slot = findAutomationSlot(input.slotId);
  if (!slot) return { ok: false, reason: "slot_unknown" };

  // Tiêu đề không có khái niệm "bỏ cả dòng": một tiêu đề biến mất là một bức
  // thư không có tiêu đề, nên ô optional trong tiêu đề cũng tính là thiếu.
  const subjectFill = fillLine(String(input.subject ?? ""), slot, input.values);
  if (subjectFill.kind !== "ok") return { ok: false, reason: "missing_value" };
  const subject = subjectFill.text.replace(/\s+/g, " ").trim();
  if (!subject) return { ok: false, reason: "missing_value" };

  const lines: string[] = [];
  for (const line of String(input.body ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const filled = fillLine(line, slot, input.values);
    if (filled.kind === "drop") continue;
    if (filled.kind === "missing") return { ok: false, reason: "missing_value" };
    lines.push(filled.text);
  }

  const text = lines.join("\n").trim();
  if (!text) return { ok: false, reason: "missing_value" };

  return { ok: true, subject, text };
}
