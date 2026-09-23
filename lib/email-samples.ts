/**
 * Mẫu nội dung của từng lá thư hệ thống tự gửi.
 *
 * Dựng bằng CHÍNH các hàm đang gửi thư thật trong `lib/email-core.ts`, không chép
 * lại câu chữ: một bản chép sẽ nói sai ngay lần đầu ai đó sửa một câu trong hàm
 * dựng thư, và không có gì phát hiện ra cái sai đó — người đọc mẫu vẫn tin rằng
 * người nhận đã đọc đúng những dòng này.
 *
 * Mọi dữ liệu trong mẫu là dữ liệu bịa, ghi rõ "(ví dụ)": tên, email, đường dẫn,
 * mã vé đều không thuộc về ai. Sổ thư (`/operations/emails`) mới là nơi có người
 * nhận thật, và nó có cổng quyền riêng.
 *
 * Bốn lá thư sau ghép cặp và thư thông báo do Core Team tự soạn KHÔNG có mẫu ở
 * đây: thân thư của chúng đến từ mẫu thư đã duyệt trong mục "Mẫu thư", nên mẫu
 * duy nhất đúng là chính bản thảo đang nằm ở đó.
 */
import {
  buildApplicationConfirmationEmail,
  buildCrossInviteEmail,
  buildCrossNotSelectedEmail,
  buildCrossScheduledEmail,
  buildCrossSelectedEmail,
  buildEventRegistrationConfirmationEmail,
  buildEventReminderEmail,
  buildEventSurveyEmail,
  buildEventScheduleChangeEmail,
  buildInterviewInviteEmail,
  buildInterviewRoundInviteEmail,
  buildInterviewScheduleEmail,
  buildInterviewSlotCancelledEmail,
  buildInterviewSlotInviteEmail,
  buildMentorConfirmationLinkEmail,
  buildParticipantInviteEmail,
  buildRecapPeriodReminderEmail,
  buildReviewBatchAssignedEmail,
  buildReviewerInviteEmail,
  buildStaffInviteEmail,
  type EmailKind
} from "@/lib/email-core";
import { QUESTION_PROMPT, impressionQuestion, trackingNotice } from "@/lib/event-survey-core";

const ORIGIN = "https://os.alumni-mentoring.edu.vn";
const SEASON = "UEH Mentoring Mùa 12";
const MENTOR = "Trần Thị B (ví dụ)";
const MENTEE = "Nguyễn Văn A (ví dụ)";
const SAMPLE_EMAIL = "nguoinhan.vidu@example.com";
/** Đường dẫn trong mẫu là ví dụ và không mở được; link thật mang mã riêng của từng người. */
const SAMPLE_LINK = `${ORIGIN}/reset-password?ma=vi-du-khong-mo-duoc`;

export type EmailSampleGroup =
  | "Nộp đơn và tuyển chọn"
  | "Tài khoản đăng nhập"
  | "Sự kiện"
  | "Cross-mentoring"
  | "Vận hành nội bộ"
  | "Thư dùng mẫu do ban tổ chức soạn";

export const EMAIL_SAMPLE_GROUPS: readonly EmailSampleGroup[] = [
  "Nộp đơn và tuyển chọn",
  "Tài khoản đăng nhập",
  "Sự kiện",
  "Cross-mentoring",
  "Vận hành nội bộ",
  "Thư dùng mẫu do ban tổ chức soạn"
] as const;

export type EmailSample = {
  /** Trùng đúng giá trị cột `kind` trong sổ thư, để đối chiếu được với một dòng đã gửi. */
  kind: EmailKind;
  group: EmailSampleGroup;
  title: string;
  /** Ai nhận lá thư này. */
  audience: string;
  /** Thư đi vào lúc nào — thao tác nào trên app làm nó đi. */
  trigger: string;
  /** Thư có mẫu dựng sẵn; null nghĩa là thân thư đến từ mẫu thư đã duyệt. */
  body: { subject: string; text: string; html: string } | null;
  /** Ghi chú riêng của lá thư, ví dụ phần thay đổi theo dữ liệu thật. */
  note?: string;
};

function built(message: { subject: string; text: string; html: string }) {
  return { subject: message.subject, text: message.text, html: message.html };
}

const TEMPLATE_NOTE =
  'Thân thư lấy từ mẫu thư đã duyệt trong tab "Mẫu thư", nên nội dung đúng là bản thảo đang nằm ở đó.';

export const EMAIL_SAMPLES: readonly EmailSample[] = [
  {
    kind: "mentee_application_confirmation",
    group: "Nộp đơn và tuyển chọn",
    title: "Xác nhận đã nhận đơn mentee",
    audience: "Bạn vừa nộp đơn mentee",
    trigger: "Ngay sau khi bấm gửi đơn ở form đăng ký mentee.",
    body: built(
      buildApplicationConfirmationEmail({ applicantName: MENTEE, role: "mentee", seasonLabel: SEASON })
    )
  },
  {
    kind: "mentor_application_confirmation",
    group: "Nộp đơn và tuyển chọn",
    title: "Xác nhận đã nhận đơn mentor",
    audience: "Anh/chị vừa nộp đơn mentor",
    trigger: "Ngay sau khi bấm gửi đơn ở form đăng ký mentor.",
    body: built(
      buildApplicationConfirmationEmail({ applicantName: MENTOR, role: "mentor", seasonLabel: SEASON })
    )
  },
  {
    kind: "mentor_confirmation_link",
    group: "Nộp đơn và tuyển chọn",
    title: "Link xác nhận tiếp tục mùa mới cho mentor cũ",
    audience: "Mentor các mùa trước",
    trigger: "Khi ban tổ chức gửi lời mời gia hạn ở mục Gia hạn mentor.",
    note: "Mỗi mentor nhận một đường dẫn riêng; mở link của người khác không dùng được.",
    body: built(
      buildMentorConfirmationLinkEmail({
        mentorName: MENTOR,
        seasonLabel: SEASON,
        confirmUrl: `${ORIGIN}/renew/ma-vi-du`,
        deadlineLabel: "25/09/2026"
      })
    )
  },
  {
    kind: "interview_round_invite",
    group: "Nộp đơn và tuyển chọn",
    title: "Mời vào vòng phỏng vấn",
    audience: "Ứng viên đã qua vòng hồ sơ",
    trigger: 'Khi ban tổ chức chọn "Mời phỏng vấn" cho một hoặc nhiều hồ sơ.',
    body: built(buildInterviewRoundInviteEmail({ candidateName: MENTOR, seasonLabel: SEASON }))
  },
  {
    kind: "interview_slot_invite",
    group: "Nộp đơn và tuyển chọn",
    title: "Mời mentor mới tự chọn giờ trao đổi với core team",
    audience: "Mentor đã nộp đơn, chưa trao đổi và chưa đặt lịch",
    trigger:
      "Khi có interviewer đăng giờ rảnh đầu tiên; nhắc lại sau mỗi 3 ngày nếu chưa chọn, tối đa 3 lần (lần 3 CC hộp thư ban tổ chức).",
    note: "Mỗi mentor nhận một đường dẫn riêng; mở link của người khác không đặt được.",
    body: built(
      buildInterviewSlotInviteEmail({
        candidateName: MENTOR,
        seasonLabel: SEASON,
        bookingUrl: `${ORIGIN}/dat-lich/ma-vi-du`,
        reminderNumber: 0,
        windowEndLabel: "05/10/2026",
        hotlineZalo: "0919144638"
      })
    )
  },
  {
    kind: "interview_scheduled",
    group: "Nộp đơn và tuyển chọn",
    title: "Xác nhận buổi hẹn cho mentor vừa đặt lịch",
    audience: "Mentor vừa chọn xong một khung giờ trao đổi",
    trigger: "Ngay khi mentor bấm giữ một khung giờ trên trang đặt lịch.",
    body: built(
      buildInterviewInviteEmail({
        candidateName: MENTOR,
        seasonLabel: SEASON,
        slotLabel: "Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)",
        interviewerName: MENTEE,
        interviewerEmail: SAMPLE_EMAIL,
        interviewerPhone: "0900000000",
        manageUrl: `${ORIGIN}/dat-lich/ma-vi-du`,
        hotlineZalo: "0919144638"
      })
    )
  },
  {
    kind: "interview_scheduled",
    group: "Nộp đơn và tuyển chọn",
    title: "Báo interviewer có mentor vừa đặt lịch",
    audience: "Người phỏng vấn của khung giờ vừa được đặt — và bản CC về hộp thư ban tổ chức",
    trigger: "Ngay khi mentor bấm giữ một khung giờ trên trang đặt lịch.",
    note: 'Cùng loại "interview_scheduled" trong sổ thư với lá thư gửi ứng viên, nhưng là hai nội dung khác nhau.',
    body: built(
      buildInterviewScheduleEmail({
        interviewerName: MENTEE,
        seasonLabel: SEASON,
        slotLabel: "Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)",
        candidateName: MENTOR,
        candidateEmail: SAMPLE_EMAIL,
        candidatePhone: "0900000000",
        reviewsUrl: `${ORIGIN}/reviews`,
        hotlineZalo: "0919144638"
      })
    )
  },
  {
    kind: "interview_slot_cancelled",
    group: "Nộp đơn và tuyển chọn",
    title: "Báo huỷ một buổi phỏng vấn",
    audience: "Cả interviewer lẫn mentor của buổi bị huỷ (mỗi bên một bản)",
    trigger:
      "Khi mentor tự huỷ (còn hơn 24 giờ trước buổi hẹn) hoặc ban tổ chức huỷ trên trang Lịch phỏng vấn.",
    body: built(
      buildInterviewSlotCancelledEmail({
        audience: "candidate",
        recipientName: MENTOR,
        otherPartyName: MENTEE,
        slotLabel: "Thứ Năm 24/09/2026, 19:30–20:30 (giờ Việt Nam)",
        cancelledByLabel: "ban tổ chức huỷ",
        rebookUrl: `${ORIGIN}/dat-lich/ma-vi-du`,
        hotlineZalo: "0919144638"
      })
    )
  },
  {
    kind: "review_batch_assigned",
    group: "Nộp đơn và tuyển chọn",
    title: "Giao một lô hồ sơ để chấm",
    audience: "Người chấm hồ sơ",
    trigger: "Khi ban tổ chức giao hồ sơ cho một người chấm.",
    body: built(
      buildReviewBatchAssignedEmail({
        reviewerName: MENTOR,
        seasonLabel: SEASON,
        assignmentCount: 8,
        reviewsUrl: `${ORIGIN}/reviews`,
        dueLabel: "23/09/2026",
        roleApplied: "mentee"
      })
    )
  },
  {
    kind: "reviewer_invite",
    group: "Tài khoản đăng nhập",
    title: "Mời mentor tham gia chấm hồ sơ hoặc phỏng vấn",
    audience: "Mentor được cấp quyền đánh giá hoặc phỏng vấn",
    trigger: 'Khi ban tổ chức bấm "Cấp quyền đánh giá" hoặc "Cấp quyền phỏng vấn".',
    note: "Đường dẫn trong thư chỉ dùng để đặt mật khẩu, mỗi người một link riêng.",
    body: built(
      buildReviewerInviteEmail({
        mentorName: MENTOR,
        seasonLabel: SEASON,
        linkUrl: SAMPLE_LINK,
        linkType: "invite",
        loginUrl: `${ORIGIN}/login`,
        loginEmail: SAMPLE_EMAIL
      })
    )
  },
  {
    kind: "participant_invite",
    group: "Tài khoản đăng nhập",
    title: "Mời mentor hoặc mentee tạo tài khoản đăng nhập",
    audience: "Thành viên chính thức của mùa",
    trigger: "Khi ban tổ chức mời tạo tài khoản ở mục Tài khoản đăng nhập.",
    body: built(
      buildParticipantInviteEmail({
        recipientName: MENTEE,
        linkUrl: SAMPLE_LINK,
        linkType: "invite",
        loginUrl: `${ORIGIN}/login`,
        loginEmail: SAMPLE_EMAIL
      })
    )
  },
  {
    kind: "staff_invite",
    group: "Tài khoản đăng nhập",
    title: "Mời một người vào ban tổ chức",
    audience: "Người được tạo tài khoản quản trị",
    trigger: "Khi tạo một tài khoản mới ở mục Quản lý người dùng.",
    body: built(
      buildStaffInviteEmail({
        fullName: MENTEE,
        roleLabel: "Support Team",
        linkUrl: SAMPLE_LINK,
        linkType: "invite",
        loginUrl: `${ORIGIN}/login`,
        loginEmail: SAMPLE_EMAIL
      })
    )
  },
  {
    kind: "event_registration_confirmation",
    group: "Sự kiện",
    title: "Xác nhận đăng ký sự kiện, kèm vé",
    audience: "Người vừa đăng ký một sự kiện",
    trigger: "Ngay sau khi đăng ký qua link sự kiện.",
    note: "Thư thật còn đính kèm ảnh mã QR để người nhận lưu về máy.",
    body: built(
      buildEventRegistrationConfirmationEmail({
        recipientName: MENTEE,
        eventName: "Mentor Orientation (ví dụ)",
        whenLabel: "08:00 – 11:30, thứ Bảy 27/09/2026",
        placeLabel: "Hội trường A, UEH (ví dụ)",
        mapUrl: "https://maps.app.goo.gl/vi-du",
        ticketUrl: `${ORIGIN}/ve/ma-vi-du`,
        ticketCode: "VIDU123456",
        shortCode: "VD12",
        qrPngBase64: null
      })
    )
  },
  {
    kind: "event_reminder",
    group: "Sự kiện",
    title: "Nhắc lịch trước sự kiện",
    audience: "Người đã đăng ký sự kiện",
    trigger: 'Khi ban tổ chức bấm "Gửi nhắc lịch" trên trang sự kiện.',
    body: built(
      buildEventReminderEmail({
        recipientName: MENTEE,
        eventName: "Mentor Orientation (ví dụ)",
        whenLabel: "08:00 – 11:30, thứ Bảy 27/09/2026",
        placeLabel: "Hội trường A, UEH (ví dụ)",
        mapUrl: "https://maps.app.goo.gl/vi-du",
        description: "Mang theo laptop và đến sớm 15 phút để check-in.",
        qrCheckin: true,
        ticketUrl: `${ORIGIN}/ve/ma-vi-du`,
        ticketCode: "VIDU123456",
        shortCode: "VD12",
        qrPngBase64: null
      })
    )
  },
  {
    kind: "event_survey",
    group: "Sự kiện",
    title: "Khảo sát cuối buổi (cũng là check out)",
    audience: "Người đã được check in ở buổi đó",
    trigger:
      'Tới giờ đã đặt ở khung "Khảo sát cuối buổi" trên trang sự kiện, hoặc khi ban tổ chức bấm "Gửi khảo sát ngay".',
    body: built(
      buildEventSurveyEmail({
        recipientName: MENTEE,
        eventName: "Mentee Orientation (ví dụ)",
        impressionQuestion: impressionQuestion("Mentee Orientation (ví dụ)"),
        question: QUESTION_PROMPT,
        trackingNotice: trackingNotice("Mentee Orientation (ví dụ)", "19/09/2026"),
        surveyUrl: `${ORIGIN}/khao-sat/ma-vi-du?tu=thu`
      })
    )
  },
  {
    kind: "event_schedule_change",
    group: "Sự kiện",
    title: "Báo đổi giờ hoặc đổi chỗ một buổi",
    audience: "Người đang giữ vé của buổi đó",
    trigger: "Khi ban tổ chức sửa giờ hoặc địa điểm và chọn gửi thư báo.",
    body: built(
      buildEventScheduleChangeEmail({
        recipientName: MENTEE,
        eventName: "Mentor Orientation (ví dụ)",
        whenLabel: "13:30 – 17:00, Chủ nhật 28/09/2026",
        previousWhenLabel: "08:00 – 11:30, thứ Bảy 27/09/2026",
        placeLabel: "Hội trường A, UEH (ví dụ)",
        mapUrl: "https://maps.app.goo.gl/vi-du",
        ticketUrl: `${ORIGIN}/ve/ma-vi-du`,
        shortCode: "VD12"
      })
    )
  },
  {
    kind: "cross_invite",
    group: "Cross-mentoring",
    title: "Mời mentor nhận một lượt cross-mentoring",
    audience: "Mentor phù hợp lĩnh vực",
    trigger: "Khi ban tổ chức mở một lượt cross-mentoring.",
    body: built(
      buildCrossInviteEmail({
        mentorName: MENTOR,
        fieldLabel: "Marketing",
        topic: "Định hướng nghề nghiệp ngành hàng tiêu dùng",
        seasonLabel: SEASON,
        respondUrl: `${ORIGIN}/cross/ma-vi-du`,
        deadlineLabel: "22/09/2026"
      })
    )
  },
  {
    kind: "cross_selected",
    group: "Cross-mentoring",
    title: "Báo mentor được chọn cho lượt cross-mentoring",
    audience: "Mentor đã nhận lời",
    trigger: "Khi ban tổ chức chốt người đồng hành cho một lượt.",
    body: built(
      buildCrossSelectedEmail({
        mentorName: MENTOR,
        fieldLabel: "Marketing",
        seasonLabel: SEASON,
        timeLabel: "20:00, thứ Ba 29/09/2026",
        location: `${ORIGIN}/vi-du-link-hop`
      })
    )
  },
  {
    kind: "cross_not_selected",
    group: "Cross-mentoring",
    title: "Báo mentor chưa được chọn lượt này",
    audience: "Mentor đã nhận lời nhưng lượt đã đủ người",
    trigger: "Khi ban tổ chức chốt người khác cho lượt đó.",
    body: built(
      buildCrossNotSelectedEmail({ mentorName: MENTOR, fieldLabel: "Marketing", seasonLabel: SEASON })
    )
  },
  {
    kind: "cross_scheduled",
    group: "Cross-mentoring",
    title: "Báo mentee lịch buổi cross-mentoring",
    audience: "Mentee của lượt cross-mentoring",
    trigger: "Khi buổi cross-mentoring đã có giờ.",
    body: built(
      buildCrossScheduledEmail({
        menteeName: MENTEE,
        fieldLabel: "Marketing",
        timeLabel: "20:00, thứ Ba 29/09/2026",
        location: `${ORIGIN}/vi-du-link-hop`,
        registerUrl: `${ORIGIN}/register/ma-vi-du`
      })
    )
  },
  {
    kind: "recap_period_reminder",
    group: "Vận hành nội bộ",
    title: "Nhắc ban tổ chức thu recap trong kỳ",
    audience: "Ban tổ chức",
    trigger: "Khi tới hạn thu recap của một kỳ.",
    body: built(
      buildRecapPeriodReminderEmail({
        recipientName: MENTEE,
        periodLabel: "Tháng 9/2026",
        periodStart: "01/09/2026",
        periodEnd: "30/09/2026",
        importUrl: `${ORIGIN}/recaps/create`
      })
    )
  },
  {
    kind: "mentee_selected",
    group: "Thư dùng mẫu do ban tổ chức soạn",
    title: "Báo mentee được chọn",
    audience: "Mentee trúng tuyển",
    trigger: "Sau khi chốt kết quả và bấm gửi hàng loạt.",
    body: null,
    note: TEMPLATE_NOTE
  },
  {
    kind: "mentee_mentor_intro",
    group: "Thư dùng mẫu do ban tổ chức soạn",
    title: "Giới thiệu mentor cho mentee",
    audience: "Mentee đã được ghép cặp",
    trigger: "Sau khi ghép cặp và bấm gửi hàng loạt.",
    body: null,
    note: TEMPLATE_NOTE
  },
  {
    kind: "mentor_mentee_package",
    group: "Thư dùng mẫu do ban tổ chức soạn",
    title: "Gửi mentor thông tin mentee được ghép",
    audience: "Mentor đã được ghép cặp",
    trigger: "Sau khi ghép cặp và bấm gửi hàng loạt.",
    body: null,
    note: TEMPLATE_NOTE
  },
  {
    kind: "kickoff_invite",
    group: "Thư dùng mẫu do ban tổ chức soạn",
    title: "Mời dự lễ khởi động mùa",
    audience: "Mentor và mentee của mùa",
    trigger: "Khi ban tổ chức gửi thư mời kickoff.",
    body: null,
    note: TEMPLATE_NOTE
  },
  {
    kind: "general_announcement",
    group: "Thư dùng mẫu do ban tổ chức soạn",
    title: "Thông báo chung",
    audience: "Nhóm người nhận do ban tổ chức chọn",
    trigger: "Khi ban tổ chức gửi một thông báo tự soạn.",
    body: null,
    note: TEMPLATE_NOTE
  }
];

/** Mẫu theo từng nhóm, giữ nguyên thứ tự khai báo. */
export function emailSamplesByGroup(): Array<{ group: EmailSampleGroup; samples: EmailSample[] }> {
  return EMAIL_SAMPLE_GROUPS.map((group) => ({
    group,
    samples: EMAIL_SAMPLES.filter((sample) => sample.group === group)
  })).filter((entry) => entry.samples.length > 0);
}
