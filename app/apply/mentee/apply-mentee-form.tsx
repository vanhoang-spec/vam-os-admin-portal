"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { submitMenteeApplicationAction } from "@/app/actions/apply";
import { initialApplyActionState, type ApplyActionState } from "@/lib/apply-types";
import {
  CheckboxGroupField,
  ConsentCheckbox,
  FormBanner,
  FormSection,
  RadioGroupField,
  SelectField,
  TextAreaField,
  TextField
} from "../_components/form-primitives";
import { ApplySubmitButton } from "../_components/submit-button";

const EMAIL_NOTIF_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "zalo", label: "Zalo" }
];

const GENDER_OPTIONS = [
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" },
  { value: "other", label: "Khác" },
  { value: "prefer_not_say", label: "Không muốn chia sẻ" }
];

const UNIVERSITY_OPTIONS = [
  { value: "UEH", label: "Đại học Kinh tế TP. Hồ Chí Minh (UEH)" },
  { value: "OTHER", label: "Trường khác" }
];

const FACULTY_OPTIONS = [
  { value: "tai_chinh", label: "Tài chính" },
  { value: "ke_toan", label: "Kế toán" },
  { value: "marketing", label: "Marketing" },
  { value: "kinh_doanh_quoc_te", label: "Kinh doanh quốc tế" },
  { value: "quan_tri", label: "Quản trị" },
  { value: "he_thong_thong_tin", label: "Hệ thống thông tin" },
  { value: "other", label: "Khác" }
];

const YEAR_OF_STUDY_OPTIONS = [
  { value: "1", label: "Năm 1" },
  { value: "2", label: "Năm 2" },
  { value: "3", label: "Năm 3" },
  { value: "4", label: "Năm 4" },
  { value: "graduated", label: "Đã tốt nghiệp" }
];

const TARGET_INDUSTRY_OPTIONS = [
  { value: "fmcg", label: "FMCG / Bán lẻ" },
  { value: "tech", label: "Công nghệ / Phần mềm" },
  { value: "finance_banking", label: "Tài chính / Ngân hàng" },
  { value: "consulting", label: "Tư vấn / Chiến lược" },
  { value: "manufacturing", label: "Sản xuất / Công nghiệp" },
  { value: "education", label: "Giáo dục / Đào tạo" },
  { value: "healthcare", label: "Y tế / Dược" },
  { value: "media_creative", label: "Truyền thông / Sáng tạo" },
  { value: "logistics", label: "Logistics / Vận chuyển" },
  { value: "real_estate", label: "Bất động sản / Xây dựng" },
  { value: "energy_environment", label: "Năng lượng / Môi trường" },
  { value: "public_nonprofit", label: "Khu vực công / Phi lợi nhuận" },
  { value: "undecided", label: "Chưa xác định rõ" },
  { value: "other", label: "Khác" }
];

const TARGET_FUNCTION_OPTIONS = [
  { value: "marketing", label: "Marketing / Brand" },
  { value: "sales_bd", label: "Sales / Business Development" },
  { value: "finance_accounting", label: "Tài chính / Kế toán" },
  { value: "hr_people", label: "Nhân sự / People" },
  { value: "operations", label: "Vận hành / Operations" },
  { value: "tech_engineering", label: "Tech / Engineering" },
  { value: "data_analytics", label: "Data / Analytics" },
  { value: "product", label: "Product Management" },
  { value: "strategy_consulting", label: "Strategy / Consulting" },
  { value: "supply_chain", label: "Supply Chain / Logistics" },
  { value: "general_management", label: "Quản trị tổng hợp" },
  { value: "undecided", label: "Chưa xác định rõ" },
  { value: "other", label: "Khác" }
];

const SOFT_SKILL_OPTIONS = [
  { value: "communication", label: "Communication" },
  { value: "leadership", label: "Leadership" },
  { value: "critical_thinking", label: "Critical thinking" },
  { value: "time_management", label: "Time management" },
  { value: "negotiation", label: "Negotiation" },
  { value: "public_speaking", label: "Public speaking" },
  { value: "other", label: "Khác" }
];

const MEETING_FORMAT_OPTIONS = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "both", label: "Cả hai" }
];

const MENTOR_GENDER_PREF_OPTIONS = [
  { value: "no_preference", label: "Không quan trọng" },
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" }
];

const TRAINING_TOPIC_OPTIONS = [
  { value: "cv_interview", label: "CV / Interview" },
  { value: "data_skills", label: "Excel / Power BI / Data skills" },
  { value: "communication_presentation", label: "Communication / Presentation" },
  { value: "personal_branding", label: "Personal branding / LinkedIn" },
  { value: "problem_solving", label: "Problem solving / Critical thinking" },
  { value: "career_orientation", label: "Career orientation" },
  { value: "networking", label: "Networking" },
  { value: "wellbeing", label: "Mental well-being / emotional management" },
  { value: "other", label: "Khác" }
];

const INTERVIEW_WINDOW_OPTIONS = [
  { value: "week_1", label: "Tuần 1 (BTC sẽ thông báo lịch chính thức)" },
  { value: "week_2", label: "Tuần 2" },
  { value: "both_weeks", label: "Cả hai tuần đều được" }
];

const KICKOFF_OPTIONS = [
  { value: "yes", label: "Có" },
  { value: "if_scheduled_well", label: "Có nếu xếp lịch hợp lý" },
  { value: "no", label: "Không" }
];

const REFERRER_OPTIONS = [
  { value: "friend", label: "Bạn bè" },
  { value: "social_media", label: "Mạng xã hội" },
  { value: "school_referral", label: "Khoa / trường giới thiệu" },
  { value: "email", label: "Email từ chương trình" },
  { value: "other", label: "Khác" }
];

export function ApplyMenteeForm() {
  const [state, formAction] = useFormState<ApplyActionState, FormData>(
    submitMenteeApplicationAction,
    initialApplyActionState
  );
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.applicationId) {
      router.push("/apply/thanks?role=mentee");
    }
  }, [state.ok, state.applicationId, router]);

  return (
    <form action={formAction} className="grid gap-6">
      <FormBanner state={state} />

      <FormSection title="1. Đồng ý & quyền riêng tư">
        <ConsentCheckbox
          name="consent_data_storage"
          required
          label="Tôi đồng ý cho VAM OS lưu trữ và xử lý dữ liệu cá nhân của tôi cho mục đích chương trình."
        />
        <CheckboxGroupField
          name="email_notification_consent"
          label="Tôi đồng ý nhận thông báo từ chương trình qua các kênh sau"
          required
          options={EMAIL_NOTIF_OPTIONS}
        />
      </FormSection>

      <FormSection title="2. Thông tin định danh">
        <TextField name="full_name" label="Họ và tên" required />
        <SelectField name="gender" label="Giới tính" options={GENDER_OPTIONS} />
        <TextField name="year_of_birth" label="Năm sinh" placeholder="VD: 2003" />
      </FormSection>

      <FormSection title="3. Liên hệ">
        <TextField name="email_primary" label="Email" type="email" required />
        <TextField
          name="phone_primary"
          label="Số điện thoại"
          type="tel"
          required
          placeholder="VD: 0901234567"
        />
        <TextField
          name="social_contact"
          label="Facebook hoặc Zalo (nếu có)"
          placeholder="Link Facebook hoặc số Zalo"
        />
      </FormSection>

      <FormSection title="4. Học vấn">
        <SelectField name="university" label="Trường đại học" required options={UNIVERSITY_OPTIONS} />
        <SelectField
          name="school_or_faculty"
          label="Khoa / viện (nếu là UEH)"
          required
          options={FACULTY_OPTIONS}
        />
        <TextField name="major" label="Ngành học" required placeholder="VD: Marketing số" />
        <TextField name="class_cohort" label="Khoá (VD: K48)" required placeholder="K48" />
        <SelectField
          name="year_of_study"
          label="Năm học hiện tại"
          required
          options={YEAR_OF_STUDY_OPTIONS}
        />
        <TextField name="mssv" label="MSSV (nếu là UEH)" placeholder="Optional" />
        <TextField
          name="gpa_4"
          label="GPA hệ 4 (nếu sẵn sàng chia sẻ)"
          placeholder="VD: 3.4"
          helpText="Optional — không bắt buộc và không phải tiêu chí xét chính."
        />
      </FormSection>

      <FormSection title="5. Mục tiêu & định hướng">
        <SelectField
          name="target_industry"
          label="Ngành nghề bạn muốn theo đuổi"
          required
          options={TARGET_INDUSTRY_OPTIONS}
        />
        <SelectField
          name="target_function"
          label="Chức năng / vị trí công việc bạn quan tâm"
          required
          options={TARGET_FUNCTION_OPTIONS}
        />
        <TextAreaField
          name="one_year_vision_text"
          label='Mô tả "phiên bản tốt nhất của bạn sau 1 năm"'
          required
          minLength={100}
          rows={5}
          helpText="Tối thiểu ~100 ký tự. Nói rõ bạn muốn đạt gì trong 1 năm tới."
        />
      </FormSection>

      <FormSection title="6. Kỳ vọng từ mentoring">
        <TextAreaField
          name="mentoring_goals_text"
          label="Mục tiêu cụ thể bạn muốn đạt được qua mentoring (3-6 tháng)"
          required
          minLength={100}
          rows={5}
          helpText="Tối thiểu ~100 ký tự. Tránh viết chung chung."
        />
        <TextAreaField
          name="top_3_questions_for_mentor"
          label="3 câu hỏi cụ thể bạn muốn hỏi mentor"
          required
          minLength={50}
          rows={4}
          helpText="VD: 1) Làm sao để... 2) Mentor đã trải qua... 3) Lời khuyên về..."
        />
        <TextAreaField
          name="current_difficulty_text"
          label="Khó khăn cụ thể bạn đang cần mentor hỗ trợ"
          rows={3}
        />
        <CheckboxGroupField
          name="target_soft_skills"
          label="Soft skills bạn muốn phát triển (chọn tối đa 3)"
          options={SOFT_SKILL_OPTIONS}
        />
        <SelectField
          name="meeting_format_preference"
          label="Hình thức mentoring bạn ưu tiên"
          options={MEETING_FORMAT_OPTIONS}
        />
        <SelectField
          name="mentor_gender_preference"
          label="Bạn có ưu tiên giới tính mentor không?"
          options={MENTOR_GENDER_PREF_OPTIONS}
        />
        <CheckboxGroupField
          name="training_topics_interest"
          label="Chủ đề training / workshop bạn quan tâm"
          options={TRAINING_TOPIC_OPTIONS}
          helpText="BTC dùng tín hiệu này để tổ chức workshop, không phải tiêu chí xét hồ sơ."
        />
      </FormSection>

      <FormSection title="7. Tự sự & cam kết">
        <TextAreaField
          name="why_uem_text"
          label="Vì sao bạn chọn UEH Mentoring?"
          rows={4}
        />
        <TextAreaField
          name="mentoring_plan_text"
          label="Kế hoạch của bạn để tận dụng mentoring"
          rows={3}
        />
        <TextAreaField
          name="if_not_effective_text"
          label="Nếu mentoring không hiệu quả như mong đợi, bạn sẽ làm gì?"
          rows={3}
        />
        <ConsentCheckbox
          name="commitment_understanding"
          required
          label="Tôi đã đọc và cam kết tham gia tối thiểu 6 tháng + recap mỗi tháng + đến kickoff."
        />
      </FormSection>

      <FormSection title="8. Sẵn sàng tham gia">
        <CheckboxGroupField
          name="available_for_interview"
          label="Bạn sẵn sàng phỏng vấn 30 phút (nếu được mời) trong khoảng nào?"
          required
          options={INTERVIEW_WINDOW_OPTIONS}
        />
        <RadioGroupField
          name="available_for_kickoff"
          label="Bạn sẵn sàng tham gia kickoff event của chương trình không?"
          required
          options={KICKOFF_OPTIONS}
        />
        <SelectField
          name="referrer_or_source"
          label="Bạn biết đến chương trình qua đâu?"
          options={REFERRER_OPTIONS}
        />
        <TextAreaField
          name="additional_notes"
          label="Câu hỏi / ghi chú gửi core team"
          rows={3}
        />
      </FormSection>

      <div className="flex justify-end pt-2">
        <ApplySubmitButton idleLabel="Gửi đơn đăng ký mentee" />
      </div>
    </form>
  );
}
