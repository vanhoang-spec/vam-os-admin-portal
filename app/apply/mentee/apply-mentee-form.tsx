"use client";

import { useFormState } from "react-dom";
import { submitMenteeApplicationAction } from "@/app/actions/apply";
import { APPLY_TOKEN_FIELD, MENTEE_APPLY_SUCCESS_PATH, initialApplyActionState, type ApplyActionState } from "@/lib/apply-types";
import { AutosaveContext, AutosaveRegistryContext } from "../_components/form-primitives";
import { useApplyAutosave } from "../_components/use-apply-autosave";
import { ApplyDraftNotice } from "../_components/draft-notice";
import { MenteeSupportContacts } from "../_components/mentee-support-contacts";
import { DEFAULT_APPLICATION_FORM_TEXTS, type ApplicationFormTexts } from "@/lib/application-form-text-core";
import {
  ApplicationForm,
  CheckboxGroupField,
  ConsentCheckbox,
  FormSection,
  PhoneField,
  RadioGroupField,
  SelectField,
  TextAreaField,
  TextField
} from "../_components/form-primitives";
import {
  APPLICATION_ACKNOWLEDGEMENTS as ACK,
  MENTEE_CONFIRMATION_PHRASE
} from "@/lib/application-commitments";
import { MENTEE_FORM_OPTION_LISTS } from "@/lib/application-form-options";

// Danh sách lựa chọn nằm ở lib/application-form-options.ts — form và nơi hiển thị
// đơn (phiếu chấm, xem application, file xuất) đọc chung một nguồn.
const {
  EMAIL_NOTIF_OPTIONS,
  GENDER_OPTIONS,
  UNIVERSITY_OPTIONS,
  FACULTY_OPTIONS,
  YEAR_OF_STUDY_OPTIONS,
  TARGET_INDUSTRY_OPTIONS,
  TARGET_FUNCTION_OPTIONS,
  SOFT_SKILL_OPTIONS,
  MEETING_FORMAT_OPTIONS,
  MENTOR_GENDER_PREF_OPTIONS,
  TRAINING_TOPIC_OPTIONS,
  INTERVIEW_WINDOW_OPTIONS,
  KICKOFF_OPTIONS,
  REFERRER_OPTIONS
} = MENTEE_FORM_OPTION_LISTS;

export function ApplyMenteeForm({
  applyToken,
  texts = DEFAULT_APPLICATION_FORM_TEXTS
}: {
  applyToken?: string | null;
  /** Chữ admin sửa được — xem lib/application-form-text-core.ts. */
  texts?: ApplicationFormTexts;
}) {
  // The action no longer redirects. It returns a state carrying
  // `applicationId` on a confirmed create, which is the only signal that
  // clears the local draft — see use-apply-autosave.ts.
  const [state, formAction] = useFormState<ApplyActionState, FormData>(
    submitMenteeApplicationAction,
    initialApplyActionState
  );

  const autosave = useApplyAutosave({
    role: "mentee",
    state,
    successPath: MENTEE_APPLY_SUCCESS_PATH
  });

  if (!autosave.isMounted) {
    return <div className="flex h-96 items-center justify-center text-slate-500">Đang tải form...</div>;
  }

  return (
    <AutosaveContext.Provider value={autosave.draftData}>
      <AutosaveRegistryContext.Provider value={autosave.registry}>
        <ApplicationForm
          key={autosave.formKey}
          action={formAction}
          state={state}
          submitLabel="Gửi đơn đăng ký mentee"
          onChangeCapture={autosave.handleFormChange}
          onSubmitCapture={autosave.handleFormSubmit}
        >
          <ApplyDraftNotice
            restored={autosave.restored}
            ttlDays={autosave.ttlDays}
            onClear={autosave.handleClearDraft}
          />
      {/*
        Pilot token relay. Rendered only while the form is in pilot state, so
        the Server Action can re-run the identical gate the page ran. The
        server reads this field explicitly and never copies it into
        raw_payload or an answer row.
      */}
      {applyToken ? <input type="hidden" name={APPLY_TOKEN_FIELD} value={applyToken} /> : null}

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
        <SelectField
          name="gender"
          label="Giới tính"
          options={GENDER_OPTIONS}
          otherInput={{ name: "gender_other", label: "Vui lòng ghi rõ" }}
        />
        <TextField name="year_of_birth" label="Năm sinh" placeholder="VD: 2003" />
      </FormSection>

      <FormSection title="3. Liên hệ">
        <TextField name="email_primary" label="Email" type="email" required />
        <PhoneField
          name="phone_primary"
          label="Số điện thoại"
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
        <SelectField
          name="university"
          label="Trường đại học"
          required
          options={UNIVERSITY_OPTIONS}
          otherInput={{ name: "university_other", label: "Vui lòng ghi rõ", triggerValue: "OTHER" }}
        />
        <SelectField
          name="school_or_faculty"
          label="Khoa / viện (nếu là UEH)"
          required
          options={FACULTY_OPTIONS}
          otherInput={{ name: "school_or_faculty_other", label: "Vui lòng ghi rõ" }}
        />
        <TextField name="major" label="Ngành học" required placeholder="VD: Marketing số" />
        <TextField name="class_cohort" label="Khoá (VD: K48)" required placeholder="K48" />
        <SelectField
          name="year_of_study"
          label="Năm học hiện tại"
          required
          options={YEAR_OF_STUDY_OPTIONS}
        />
        <TextField
          name="mssv"
          label="MSSV (nếu là UEH)"
          placeholder="VD: 31231020001"
          helpText="Không bắt buộc. Nếu điền, vui lòng gõ đầy đủ mã số sinh viên, không viết tắt."
        />
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
          otherInput={{ name: "target_industry_other", label: "Vui lòng ghi rõ" }}
        />
        <SelectField
          name="target_function"
          label="Chức năng / vị trí công việc bạn quan tâm"
          required
          options={TARGET_FUNCTION_OPTIONS}
          otherInput={{ name: "target_function_other", label: "Vui lòng ghi rõ" }}
        />
        <TextAreaField
          name="one_year_vision_text"
          label='Mô tả "phiên bản tốt nhất của bạn sau 1 năm"'
          required
          minLength={100}
          rows={5}
          helpText="Nói rõ bạn muốn đạt gì trong 1 năm tới."
        />
      </FormSection>

      <FormSection title="6. Kỳ vọng từ mentoring">
        <TextAreaField
          name="mentoring_goals_text"
          label="Mục tiêu cụ thể bạn muốn đạt được qua mentoring (3-6 tháng)"
          required
          minLength={100}
          rows={5}
          helpText="Tránh viết chung chung."
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
          required
          minLength={100}
          rows={4}
          helpText="Nêu tình huống cụ thể, điều bạn đã thử và điều bạn mong Mentor hỗ trợ."
        />
        <CheckboxGroupField
          name="target_soft_skills"
          label="Soft skills bạn muốn phát triển (chọn tối đa 3)"
          options={SOFT_SKILL_OPTIONS}
          maxSelections={3}
          otherInput={{
            name: "target_soft_skills_other",
            label: "Vui lòng ghi rõ kỹ năng/lĩnh vực khác"
          }}
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
          otherInput={{ name: "training_topics_interest_other", label: "Vui lòng ghi rõ" }}
        />
      </FormSection>

      <FormSection title="7. Tự sự & cam kết">
        <TextAreaField
          name="why_uem_text"
          label="Vì sao bạn chọn UEH Mentoring?"
          required
          minLength={100}
          rows={4}
          helpText="Chia sẻ điều bạn thực sự kỳ vọng ở hành trình mentoring này."
        />
        <TextAreaField
          name="mentoring_plan_text"
          label="Kế hoạch của bạn để tận dụng mentoring"
          required
          minLength={100}
          rows={4}
          helpText="Nêu cách bạn sẽ chuẩn bị, hành động và theo dõi tiến bộ giữa các buổi mentoring."
        />
        <TextAreaField
          name="if_not_effective_text"
          label="Nếu mentoring không hiệu quả như mong đợi, bạn sẽ làm gì?"
          required
          minLength={100}
          rows={4}
          helpText="Hãy mô tả cách bạn sẽ chủ động xử lý trước khi nghĩ đến việc dừng mentoring."
        />
        <TextField
          name="profile_or_cv_url"
          label="CV / LinkedIn / portfolio / profile (không bắt buộc)"
          type="url"
          placeholder="https://..."
          helpText="Không bắt buộc — khuyến khích nếu bạn muốn BTC và Mentor hiểu thêm về trải nghiệm, hoạt động hoặc dự án của bạn."
        />
        <ConsentCheckbox
          name="commitment_understanding"
          required
          label="Tôi đã đọc và cam kết tham gia tối thiểu 6 tháng + hoàn thành recap trong 48 giờ sau mỗi buổi gặp + đến kickoff."
        />
      </FormSection>

      <FormSection title="8. Sẵn sàng tham gia">
        <CheckboxGroupField
          name="available_for_interview"
          label="Bạn sẵn sàng phỏng vấn 30 phút (nếu được mời) trong đợt nào?"
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
          otherInput={{ name: "referrer_or_source_other", label: "Vui lòng ghi rõ" }}
        />
        <TextAreaField
          name="additional_notes"
          label="Câu hỏi / ghi chú gửi core team"
          rows={3}
        />
      </FormSection>

      <FormSection
        title="Xác nhận cách UEH Mentoring hoạt động"
        description="Mentoring hiệu quả phụ thuộc rất nhiều vào sự chủ động và kỳ vọng phù hợp của Mentee. Vui lòng đọc kỹ và xác nhận các nội dung sau."
      >
        <p className="rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Mentee cần <strong>chủ động liên hệ Mentor</strong>; <strong>Cross-mentoring</strong> là nguồn lực bổ sung.
        </p>
        <h3 className="text-sm font-semibold text-vam-ink">Cam kết tham gia và chủ động</h3>
        {[
          ACK.MENTEE_CROSS_INDUSTRY_V1,
          ACK.MENTEE_MENTOR_LEVEL_EXPECTATION_V1,
          ACK.MENTEE_PROACTIVE_SCHEDULING_V1,
          ACK.MENTEE_RECAP_48H_V1,
          ACK.MENTEE_CROSS_MENTORING_V1,
          ACK.MENTEE_OWNERSHIP_V1
        ].map((entry) => (
          <div key={entry.key} className="rounded-md border border-vam-line bg-white p-2">
            <ConsentCheckbox name={entry.key} required label={entry.wording} />
            {(entry as { helper?: string }).helper ? (
              <p className="px-3 pb-2 text-xs leading-5 text-slate-500">
                {(entry as { helper?: string }).helper}
              </p>
            ) : null}
          </div>
        ))}
        <h3 className="mt-2 border-t border-vam-line pt-4 text-sm font-semibold text-vam-ink">
          Ranh giới, bảo mật và an toàn
        </h3>
        {[
          ACK.MENTEE_RELATIONSHIP_BOUNDARIES_V1,
          ACK.MENTEE_CONFIDENTIALITY_V1,
          ACK.MENTEE_NO_GHOST_V1
        ].map((entry) => (
          <div key={entry.key} className="rounded-md border border-vam-line bg-white p-2">
            <ConsentCheckbox name={entry.key} required label={entry.wording} />
          </div>
        ))}
        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <TextField
            name="MENTEE_ACTIVE_READING_V1"
            label="Vui lòng nhập lại câu dưới đây để xác nhận bạn đã đọc và hiểu các nguyên tắc chính."
            required
            repeatPhrase={MENTEE_CONFIRMATION_PHRASE}
          />
        </div>
      </FormSection>

      <MenteeSupportContacts texts={texts} />

        </ApplicationForm>
      </AutosaveRegistryContext.Provider>
    </AutosaveContext.Provider>
  );
}
