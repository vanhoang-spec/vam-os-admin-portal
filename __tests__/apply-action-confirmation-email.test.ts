/**
 * Thư xác nhận gửi ngay sau khi nộp đơn — cả hai vai trò.
 *
 * Điều cần khoá không phải là "có gọi hàm gửi không", mà là ba tính chất mà
 * một lần sửa vô ý rất dễ phá:
 *   1. Chỉ gửi khi đơn đã thật sự nằm trong database. Gửi thư báo "đã nhận đơn"
 *      cho một lần nộp bị từ chối là nói dối người nộp.
 *   2. Đúng vai trò. Hai điểm chèn là hai đoạn gần như giống hệt nhau, nên chép
 *      nhầm `role: "mentor"` sang nhánh mentee sẽ không có gì báo.
 *   3. Nhà cung cấp email hỏng KHÔNG được làm hỏng lần nộp. Đơn đã lưu rồi.
 *
 * Phân loại: DIRECT PRODUCTION TESTS (gọi thẳng Server Action thật).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateApplyGate: vi.fn(),
  submitPilotApplication: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  sendApplicationConfirmation: vi.fn(),
  ensureInterviewInviteToken: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/apply-gate", () => ({ evaluateApplyGate: mocks.evaluateApplyGate }));
vi.mock("@/lib/applications-create", () => ({
  submitPilotApplication: mocks.submitPilotApplication
}));
vi.mock("@/lib/email", () => ({
  sendApplicationConfirmation: mocks.sendApplicationConfirmation
}));
// Bộ lịch phỏng vấn kéo theo cả lib/events (React cache) — với bài kiểm thư
// xác nhận thì thứ cần khoá chỉ là: mentor được cấp mã đặt lịch, mentee không.
vi.mock("@/lib/interview-schedule", () => ({
  ensureInterviewInviteToken: mocks.ensureInterviewInviteToken
}));

import {
  submitMenteeApplicationAction,
  submitMentorApplicationAction
} from "@/app/actions/apply";
import {
  ACTIVE_READING_KEYS,
  CONFIRMATION_PHRASES,
  requiredCheckboxAcknowledgements
} from "@/lib/application-commitments";

const APPLICATION_ID = "00000000-0000-4000-8000-000000000a01";
const SEASON_LABEL = "Mùa 12";

function long(text: string, min: number) {
  let out = text;
  while (out.length < min) out += ` ${text}`;
  return out;
}

function validMentorForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    full_name: "Mentor Test",
    email_primary: "mentor@example.com",
    phone_primary: "0901234567",
    consent_data_storage: "true",
    company_current: "Acme",
    title_current: "Director",
    years_of_experience: "11-15",
    industry_primary: "technology",
    function_primary: "marketing",
    university: "UEH",
    motivation_text: "Support the next generation",
    can_attend_orientation: "yes",
    open_to_intro_call: "yes",
    mentoring_capacity_total: "2",
    mentor_total_work_years: "12",
    mentor_people_management_years: "5",
    mentor_largest_team_size: "8",
    [ACTIVE_READING_KEYS.mentor]: CONFIRMATION_PHRASES.mentor
  })) {
    form.set(key, value);
  }
  form.set("consent_contact_methods", "email");
  form.set("programs_willing_to_join", "UEHM");
  for (const entry of requiredCheckboxAcknowledgements("mentor")) form.set(entry.key, "true");
  return form;
}

function validMenteeForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    full_name: "Mentee Test",
    email_primary: "mentee@example.com",
    phone_primary: "0907654321",
    consent_data_storage: "true",
    university: "UEH",
    school_or_faculty: "Kinh doanh quốc tế",
    major: "Marketing",
    class_cohort: "K47",
    year_of_study: "3",
    target_industry: "technology",
    target_function: "marketing",
    one_year_vision_text: long("Trở thành một marketer có nền tảng dữ liệu vững", 100),
    mentoring_goals_text: long("Xây dựng lộ trình nghề nghiệp rõ ràng cho hai năm tới", 100),
    top_3_questions_for_mentor: long("Làm sao chọn ngành phù hợp với thế mạnh", 50),
    current_difficulty_text: long("Chưa biết bắt đầu từ đâu khi tìm thực tập", 100),
    why_uem_text: long("Chương trình có mentor thực chiến và cộng đồng cựu sinh viên", 100),
    mentoring_plan_text: long("Chuẩn bị câu hỏi trước mỗi buổi và ghi lại hành động", 100),
    if_not_effective_text: long("Chủ động trao đổi lại với mentor và ban tổ chức", 100),
    available_for_kickoff: "yes",
    commitment_understanding: "true",
    [ACTIVE_READING_KEYS.mentee]: CONFIRMATION_PHRASES.mentee
  })) {
    form.set(key, value);
  }
  form.set("available_for_interview", "weekday_evening");
  form.set("email_notification_consent", "email");
  for (const entry of requiredCheckboxAcknowledgements("mentee")) form.set(entry.key, "true");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evaluateApplyGate.mockResolvedValue({ status: "open", state: "open" });
  mocks.submitPilotApplication.mockResolvedValue({ ok: true, applicationId: APPLICATION_ID });
  mocks.sendApplicationConfirmation.mockResolvedValue({ ok: true, skipped: false });
  mocks.ensureInterviewInviteToken.mockResolvedValue("ma-dat-lich-vi-du");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("thư xác nhận sau khi nộp đơn", () => {
  it("mentor nộp thành công thì gửi đúng một thư, đúng vai trò và đúng mã đơn", async () => {
    const state = await submitMentorApplicationAction({ ok: false, message: "" }, validMentorForm());

    expect(state.ok).toBe(true);
    expect(mocks.sendApplicationConfirmation).toHaveBeenCalledTimes(1);
    expect(mocks.sendApplicationConfirmation).toHaveBeenCalledWith({
      toEmail: "mentor@example.com",
      applicantName: "Mentor Test",
      role: "mentor",
      seasonLabel: SEASON_LABEL,
      applicationId: APPLICATION_ID,
      // Mentor được cấp mã đặt lịch phỏng vấn ngay trong thư xác nhận (22/09/2026).
      bookingToken: "ma-dat-lich-vi-du"
    });
    expect(mocks.ensureInterviewInviteToken).toHaveBeenCalledWith(APPLICATION_ID);
  });

  it("hết đợt phỏng vấn (không cấp được mã) thì thư mentor vẫn đi, chỉ vắng nút", async () => {
    mocks.ensureInterviewInviteToken.mockResolvedValue(null);
    const state = await submitMentorApplicationAction({ ok: false, message: "" }, validMentorForm());

    expect(state.ok).toBe(true);
    const arg = mocks.sendApplicationConfirmation.mock.calls[0][0] as { bookingToken: string | null };
    expect(arg.bookingToken).toBeNull();
  });

  it("mentee nộp thành công thì gửi thư với vai trò mentee, không phải mentor", async () => {
    const state = await submitMenteeApplicationAction({ ok: false, message: "" }, validMenteeForm());

    expect(state.ok).toBe(true);
    expect(mocks.sendApplicationConfirmation).toHaveBeenCalledTimes(1);
    expect(mocks.sendApplicationConfirmation).toHaveBeenCalledWith({
      toEmail: "mentee@example.com",
      applicantName: "Mentee Test",
      role: "mentee",
      seasonLabel: SEASON_LABEL,
      applicationId: APPLICATION_ID,
      bookingToken: null
    });
    // Mentee không có vòng đặt lịch — không được phép tốn một dòng invite nào.
    expect(mocks.ensureInterviewInviteToken).not.toHaveBeenCalled();
  });

  it("nhãn mùa là tên người đọc được, không phải mã nội bộ", async () => {
    await submitMentorApplicationAction({ ok: false, message: "" }, validMentorForm());

    const arg = mocks.sendApplicationConfirmation.mock.calls[0][0] as { seasonLabel: string };
    expect(arg.seasonLabel).not.toContain("UEHM-S12");
    expect(arg.seasonLabel).toContain("Mùa 12");
    // Tiêu đề thư đã mở đầu bằng "[UEH Mentoring]", nên nhãn mùa không được
    // mang tên chương trình lần nữa.
    expect(arg.seasonLabel).not.toContain("UEH Mentoring");
  });

  it("form đóng thì không gửi gì cả", async () => {
    mocks.evaluateApplyGate.mockResolvedValue({
      status: "closed",
      state: "closed",
      reason: "Form đang đóng"
    });

    const state = await submitMentorApplicationAction({ ok: false, message: "" }, validMentorForm());

    expect(state.ok).toBe(false);
    expect(mocks.sendApplicationConfirmation).not.toHaveBeenCalled();
  });

  it("ghi đơn thất bại thì không gửi thư báo đã nhận đơn", async () => {
    mocks.submitPilotApplication.mockResolvedValue({
      ok: false,
      message: "Trùng đơn đã nộp trước đó."
    });

    const state = await submitMentorApplicationAction({ ok: false, message: "" }, validMentorForm());

    expect(state.ok).toBe(false);
    expect(mocks.sendApplicationConfirmation).not.toHaveBeenCalled();
  });

  it("thiếu trường bắt buộc thì dừng trước cả lúc ghi đơn, nên cũng không gửi thư", async () => {
    const form = validMentorForm();
    form.set("full_name", "");

    const state = await submitMentorApplicationAction({ ok: false, message: "" }, form);

    expect(state.ok).toBe(false);
    expect(mocks.submitPilotApplication).not.toHaveBeenCalled();
    expect(mocks.sendApplicationConfirmation).not.toHaveBeenCalled();
  });

  it("nhà cung cấp email hỏng KHÔNG làm hỏng lần nộp", async () => {
    mocks.sendApplicationConfirmation.mockRejectedValue(new Error("Brevo unreachable"));

    const state = await submitMentorApplicationAction({ ok: false, message: "" }, validMentorForm());

    expect(state.ok).toBe(true);
    expect(state.applicationId).toBe(APPLICATION_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/applications");
  });
});
