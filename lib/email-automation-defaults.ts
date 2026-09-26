import {
  buildApplicationConfirmationEmail,
  buildInterviewInviteEmail,
  buildInterviewRoundInviteEmail,
  buildInterviewScheduleEmail,
  buildInterviewSlotCancelledEmail,
  buildInterviewSlotInviteEmail,
  buildMenteeSessionConfirmedEmail,
  buildMenteeSessionInviteEmail,
  buildParticipantInviteEmail,
  buildReviewBatchAssignedEmail,
  buildReviewerInviteEmail,
  buildStaffInviteEmail
} from "@/lib/email-core";
import {
  type AutomationSlot,
  findAutomationSlot,
  placeholderSentinel,
  templateFromSentinelText
} from "@/lib/email-automation-core";

/**
 * lib/email-automation-defaults.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Bản mặc định của mỗi lá thư tự động, SUY RA từ chính hàm đang gửi thư thật.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO SUY RA CHỨ KHÔNG CHÉP TAY
 * ---------------------------------------------------------------------------
 * Chép câu chữ từ `lib/email-core.ts` sang đây thì ngày ai đó sửa một câu trong
 * hàm dựng thư, màn hình "Thư tự động" nói sai — và không có gì phát hiện ra:
 * người vận hành vẫn tin rằng người nhận đã đọc đúng những dòng hiện trên màn
 * hình. Cùng lý do với `lib/email-samples.ts`.
 *
 * Cách làm: gọi hàm dựng thư với giá trị mồi `@@ten_o@@`, rồi đổi mồi thành
 * `{{ten_o}}`. Bản mặc định vì thế LUÔN bằng đúng thư đang gửi.
 *
 * ---------------------------------------------------------------------------
 * HAI LƯỢT GỌI CHO NHỮNG LÁ THƯ CÓ NHÁNH
 * ---------------------------------------------------------------------------
 * Vài hàm dựng thư có nhánh: có hạn thì tiêu đề thêm "hạn ...", có số điện
 * thoại thì thân thư thêm một dòng. Không thể lấy một lượt gọi cho cả hai.
 *
 *   - TIÊU ĐỀ lấy từ lượt gọi KHÔNG có giá trị tuỳ chọn. Tiêu đề không có khái
 *     niệm "bỏ cả dòng", nên một ô tuỳ chọn nằm trong tiêu đề sẽ làm hỏng mọi
 *     lần gửi không có giá trị đó.
 *   - THÂN THƯ lấy từ lượt gọi CÓ đủ giá trị tuỳ chọn, để người vận hành nhìn
 *     thấy mọi dòng có thể xuất hiện và tự quyết giữ hay bỏ. Lần gửi nào không
 *     có giá trị thì dòng đó tự biến mất (xem `renderAutomationContent`).
 *
 * SỐ: mồi phải là SỐ, không phải chuỗi
 *   `buildReviewBatchAssignedEmail` và `buildInterviewSlotInviteEmail` đưa tham
 *   số qua `Number(...) || 0`, nên một chuỗi mồi biến thành `0` và mồi mất hút.
 *   Dùng một con số khó trùng, rồi đổi chính con số đó thành ô.
 */

/** Mồi cho tham số kiểu số. Khó trùng với bất kỳ con số nào có thật trong thư. */
const NUM_SENTINEL = 987654321;

const S = placeholderSentinel;

/** Hai nửa của một bản mặc định, trước khi đổi mồi thành ô. */
type Raw = { subject: string; body: string };

/**
 * Lấy tiêu đề của lượt gọi này và thân thư của lượt gọi kia.
 *
 * Tách ra thành một hàm có tên để chỗ gọi đọc được ý định, thay vì hai lời gọi
 * builder nằm cạnh nhau mà người đọc phải tự đoán vì sao có hai.
 */
function subjectFrom(noOptional: { subject: string }, bodyFrom: { text: string }): Raw {
  return { subject: noOptional.subject, body: bodyFrom.text };
}

function one(message: { subject: string; text: string }): Raw {
  return { subject: message.subject, body: message.text };
}

function rawDefaultFor(slot: AutomationSlot): Raw | null {
  switch (slot.id) {
    case "mentee_application_confirmation":
      return one(
        buildApplicationConfirmationEmail({
          applicantName: S("ten_nguoi_nhan"),
          role: "mentee",
          seasonLabel: S("mua")
        })
      );

    case "mentor_application_confirmation":
      return one(
        buildApplicationConfirmationEmail({
          applicantName: S("ten_nguoi_nhan"),
          role: "mentor",
          seasonLabel: S("mua"),
          bookingUrl: S("link_dat_lich")
        })
      );

    case "mentor_application_confirmation_no_booking":
      return one(
        buildApplicationConfirmationEmail({
          applicantName: S("ten_nguoi_nhan"),
          role: "mentor",
          seasonLabel: S("mua"),
          bookingUrl: null
        })
      );

    case "interview_round_invite":
      return one(
        buildInterviewRoundInviteEmail({
          candidateName: S("ten_nguoi_nhan"),
          seasonLabel: S("mua")
        })
      );

    case "interview_slot_invite":
      return one(
        buildInterviewSlotInviteEmail({
          candidateName: S("ten_nguoi_nhan"),
          seasonLabel: S("mua"),
          bookingUrl: S("link_dat_lich"),
          reminderNumber: 0,
          windowEndLabel: S("han_chot"),
          hotlineZalo: S("zalo_ho_tro")
        })
      );

    case "interview_slot_reminder":
      return one(
        buildInterviewSlotInviteEmail({
          candidateName: S("ten_nguoi_nhan"),
          seasonLabel: S("mua"),
          bookingUrl: S("link_dat_lich"),
          // Phải > 0 để rơi vào nhánh nhắc; con số này sau đó thành {{lan_nhac}}.
          reminderNumber: NUM_SENTINEL,
          windowEndLabel: S("han_chot"),
          hotlineZalo: S("zalo_ho_tro")
        })
      );

    case "interview_scheduled_candidate": {
      const base = {
        candidateName: S("ten_nguoi_nhan"),
        seasonLabel: S("mua"),
        slotLabel: S("khung_gio"),
        interviewerName: S("ten_nguoi_trao_doi"),
        interviewerEmail: S("email_nguoi_trao_doi"),
        manageUrl: S("link_doi_lich"),
        hotlineZalo: S("zalo_ho_tro")
      };
      return subjectFrom(
        buildInterviewInviteEmail({ ...base, interviewerPhone: null }),
        buildInterviewInviteEmail({ ...base, interviewerPhone: S("sdt_nguoi_trao_doi") })
      );
    }

    case "interview_scheduled_interviewer": {
      const base = {
        interviewerName: S("ten_nguoi_nhan"),
        seasonLabel: S("mua"),
        slotLabel: S("khung_gio"),
        candidateName: S("ten_ung_vien"),
        candidateEmail: S("email_ung_vien"),
        reviewsUrl: S("link_cham_diem"),
        hotlineZalo: S("zalo_ho_tro")
      };
      return subjectFrom(
        buildInterviewScheduleEmail({ ...base, candidatePhone: null }),
        buildInterviewScheduleEmail({ ...base, candidatePhone: S("sdt_ung_vien") })
      );
    }

    case "interview_slot_cancelled_candidate":
      return one(
        buildInterviewSlotCancelledEmail({
          audience: "candidate",
          recipientName: S("ten_nguoi_nhan"),
          otherPartyName: S("ten_nguoi_trao_doi"),
          slotLabel: S("khung_gio"),
          cancelledByLabel: S("nguoi_huy"),
          rebookUrl: S("link_dat_lai"),
          hotlineZalo: S("zalo_ho_tro")
        })
      );

    case "interview_slot_cancelled_interviewer":
      return one(
        buildInterviewSlotCancelledEmail({
          audience: "interviewer",
          recipientName: S("ten_nguoi_nhan"),
          otherPartyName: S("ten_ung_vien"),
          slotLabel: S("khung_gio"),
          cancelledByLabel: S("nguoi_huy"),
          rebookUrl: null,
          hotlineZalo: S("zalo_ho_tro")
        })
      );

    case "mentee_session_invite":
      return one(
        buildMenteeSessionInviteEmail({
          candidateName: S("ten_nguoi_nhan"),
          seasonLabel: S("mua"),
          interviewDaysLabel: S("ngay_phong_van"),
          bookingUrl: S("link_dat_ca"),
          deadlineLabel: S("han_chon_ca"),
          hotlineZalo: S("zalo_ho_tro")
        })
      );

    case "mentee_session_confirmed":
      return one(
        buildMenteeSessionConfirmedEmail({
          candidateName: S("ten_nguoi_nhan"),
          sessionLabel: S("ca_phong_van"),
          venueLabel: S("dia_diem"),
          manageUrl: S("link_doi_ca"),
          hotlineZalo: S("zalo_ho_tro")
        })
      );

    case "reviewer_invite_new":
    case "reviewer_invite_recovery":
      return one(
        buildReviewerInviteEmail({
          mentorName: S("ten_nguoi_nhan"),
          seasonLabel: S("mua"),
          linkUrl: S("link_dat_mat_khau"),
          linkType: slot.id === "reviewer_invite_recovery" ? "recovery" : "invite",
          loginUrl: S("link_dang_nhap"),
          loginEmail: S("email_dang_nhap")
        })
      );

    case "review_batch_assigned": {
      const base = {
        reviewerName: S("ten_nguoi_nhan"),
        seasonLabel: S("mua"),
        assignmentCount: NUM_SENTINEL,
        reviewsUrl: S("link_cham_diem"),
        roleApplied: "mentor"
      };
      const withDue = buildReviewBatchAssignedEmail({ ...base, dueLabel: S("han_cham") });
      const noDue = buildReviewBatchAssignedEmail({ ...base, dueLabel: null });
      const raw = subjectFrom(noDue, withDue);

      // `loai_ho_so` KHÔNG đi mồi qua được: hàm dựng thư tự chọn chữ ("hồ sơ
      // mentor" / "hồ sơ mentee" / "hồ sơ"), và một mồi lạ rơi vào nhánh
      // "hồ sơ" — trùng với hai chỗ khác trong thư, nên không đổi ngược lại
      // được. Chạy với `roleApplied: "mentor"` rồi đổi đúng cụm hai chữ đó.
      const UNIT = "hồ sơ mentor";
      return {
        subject: raw.subject.split(UNIT).join("{{loai_ho_so}}"),
        body: raw.body.split(UNIT).join("{{loai_ho_so}}")
      };
    }

    case "staff_invite_new":
    case "staff_invite_recovery":
      return one(
        buildStaffInviteEmail({
          fullName: S("ten_nguoi_nhan"),
          roleLabel: S("vai_tro"),
          linkUrl: S("link_dat_mat_khau"),
          linkType: slot.id === "staff_invite_recovery" ? "recovery" : "invite",
          loginUrl: S("link_dang_nhap"),
          loginEmail: S("email_dang_nhap")
        })
      );

    case "participant_invite_new":
    case "participant_invite_recovery":
      return one(
        buildParticipantInviteEmail({
          recipientName: S("ten_nguoi_nhan"),
          linkUrl: S("link_dat_mat_khau"),
          linkType: slot.id === "participant_invite_recovery" ? "recovery" : "invite",
          loginUrl: S("link_dang_nhap"),
          loginEmail: S("email_dang_nhap")
        })
      );

    default:
      return null;
  }
}

export type AutomationContent = { subject: string; body: string };

/**
 * Bản mặc định của một lá thư, ở dạng sửa được.
 *
 * Trả `null` cho id không có trong danh mục — nơi gọi phải xử lý, chứ không
 * nhận một bản thư rỗng trông như hợp lệ.
 */
export function defaultAutomationContent(slotId: unknown): AutomationContent | null {
  const slot = findAutomationSlot(slotId);
  if (!slot) return null;
  const raw = rawDefaultFor(slot);
  if (!raw) return null;

  const keys = slot.placeholders.map((row) => row.key);
  // Mồi số đổi trước: nó là một chuỗi chữ số, nên đổi sau khi các ô chữ đã
  // thành `{{...}}` thì vẫn đúng, nhưng đổi trước giữ thứ tự dễ đọc hơn.
  const numKey = slot.placeholders.find((row) => row.key === "so_ho_so" || row.key === "lan_nhac");
  const swapNumber = (text: string) =>
    numKey ? text.split(String(NUM_SENTINEL)).join(`{{${numKey.key}}}`) : text;

  return {
    subject: templateFromSentinelText(swapNumber(raw.subject), keys).replace(/\s+/g, " ").trim(),
    body: templateFromSentinelText(swapNumber(raw.body), keys).trim()
  };
}
