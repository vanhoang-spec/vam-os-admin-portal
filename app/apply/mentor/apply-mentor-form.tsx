"use client";

import { useRef, useState } from "react";
import { useFormState } from "react-dom";
import { submitMentorApplicationAction } from "@/app/actions/apply";
import { APPLY_TOKEN_FIELD, initialApplyActionState, type ApplyActionState } from "@/lib/apply-types";
import { DraftRecoveryBanner } from "../_components/draft-recovery-banner";
import { MentorProfileIntro } from "../_components/mentor-profile-intro";
import { useDraftRecovery } from "../_components/use-draft-recovery";
import {
  ApplicationForm,
  CheckboxGroupField,
  ConsentCheckbox,
  FormSection,
  NumberField,
  PhoneField,
  RadioGroupField,
  SelectField,
  TextAreaField,
  TextField
} from "../_components/form-primitives";
import {
  APPLICATION_ACKNOWLEDGEMENTS as ACK,
  MENTOR_CONFIRMATION_PHRASE
} from "@/lib/application-commitments";

const CONTACT_METHOD_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "zalo", label: "Zalo" },
  { value: "sms", label: "SMS" }
];

const GENDER_OPTIONS = [
  { value: "male", label: "Nam" },
  { value: "female", label: "Nữ" },
  { value: "other", label: "Khác" },
  { value: "prefer_not_say", label: "Không muốn chia sẻ" }
];

const CITY_OPTIONS = [
  { value: "hcm", label: "TP. Hồ Chí Minh" },
  { value: "hanoi", label: "Hà Nội" },
  { value: "danang", label: "Đà Nẵng" },
  { value: "other_vn", label: "Tỉnh thành khác (Việt Nam)" },
  { value: "overseas", label: "Nước ngoài" }
];

const YEARS_EXPERIENCE_OPTIONS = [
  { value: "1-3", label: "1-3 năm" },
  { value: "4-6", label: "4-6 năm" },
  { value: "7-10", label: "7-10 năm" },
  { value: "11-15", label: "11-15 năm" },
  { value: "16+", label: "16+ năm" }
];

const INDUSTRY_OPTIONS = [
  { value: "fmcg", label: "FMCG / Bán lẻ" },
  { value: "tech", label: "Công nghệ / Phần mềm" },
  { value: "finance_banking", label: "Tài chính / Ngân hàng" },
  { value: "consulting", label: "Tư vấn / Chiến lược" },
  { value: "manufacturing", label: "Sản xuất / Công nghiệp" },
  { value: "education", label: "Giáo dục / Đào tạo" },
  { value: "healthcare", label: "Y tế / Dược / Chăm sóc sức khoẻ" },
  { value: "media_creative", label: "Truyền thông / Sáng tạo" },
  { value: "logistics", label: "Logistics / Vận chuyển" },
  { value: "real_estate", label: "Bất động sản / Xây dựng" },
  { value: "energy_environment", label: "Năng lượng / Môi trường" },
  { value: "public_nonprofit", label: "Khu vực công / Phi lợi nhuận" },
  { value: "other", label: "Khác" }
];

const FUNCTION_OPTIONS = [
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
  { value: "legal_compliance", label: "Pháp lý / Compliance" },
  { value: "general_management", label: "Quản trị tổng hợp" },
  { value: "other", label: "Khác" }
];

const HIGHEST_DEGREE_OPTIONS = [
  { value: "bachelor", label: "Cử nhân" },
  { value: "master", label: "Thạc sĩ" },
  { value: "phd", label: "Tiến sĩ" },
  { value: "other", label: "Khác" }
];

const PRIOR_VAM_OPTIONS = [
  { value: "none", label: "Chưa từng" },
  { value: "1_season", label: "Đã từng (1 mùa)" },
  { value: "2_3_seasons", label: "Đã từng (2-3 mùa)" },
  { value: "4_plus_seasons", label: "Đã từng (4+ mùa)" }
];

const SME_OPTIONS = [
  { value: "yes", label: "Có" },
  { value: "no", label: "Không" },
  { value: "currently_doing", label: "Đang làm" }
];

const ATTEND_ORIENTATION_OPTIONS = [
  { value: "yes", label: "Có" },
  { value: "if_scheduled_well", label: "Có nếu xếp lịch hợp lý" },
  { value: "no", label: "Không" }
];

const INTRO_CALL_OPTIONS = [
  { value: "yes", label: "Có" },
  { value: "depends_on_schedule", label: "Tùy lịch" },
  { value: "no", label: "Không" }
];

const CAPACITY_OPTIONS = [
  { value: "1", label: "1 mentee" },
  { value: "2", label: "2 mentee" },
  { value: "3", label: "3 mentee" }
];

const MEETING_FREQUENCY_OPTIONS = [
  { value: "twice_per_month", label: "2 lần/tháng" },
  { value: "once_per_month", label: "1 lần/tháng" },
  { value: "once_per_two_months", label: "1 lần/2 tháng" },
  { value: "depends_on_mentee", label: "Tùy mentee" }
];

const MEETING_FORMAT_OPTIONS = [
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "both", label: "Cả hai" }
];

const LANGUAGE_OPTIONS = [
  { value: "vi", label: "Tiếng Việt" },
  { value: "en", label: "English" }
];

const PROGRAM_OPTIONS = [
  { value: "UEHM", label: "UEH Mentoring (ĐH Kinh tế TP.HCM)" },
  { value: "HAM", label: "Hanoi Alumni Mentoring" },
  { value: "BK", label: "BK Mentoring (Đại học Bách Khoa TP.HCM)" },
  { value: "HUFLIT", label: "HUFLIT Mentoring (ĐH Ngoại ngữ - Tin học TP.HCM)" },
  { value: "HUB", label: "HUB Mentoring (ĐH Ngân hàng TP.HCM)" },
  { value: "DUE", label: "DUE Mentoring (Đại học Kinh tế Đà Nẵng)" }
];

const ACTIVITY_OPTIONS = [
  { value: "training_sharing", label: "Training / chia sẻ chuyên đề" },
  { value: "cross_mentoring", label: "Cross mentoring" },
  { value: "english_mentoring", label: "Mentoring bằng tiếng Anh" },
  { value: "mentor_gathering", label: "Mentor gathering" },
  { value: "company_visit", label: "Kết nối tham quan doanh nghiệp" },
  { value: "internship_referral", label: "Kết nối cơ hội thực tập" },
  { value: "scholarship_sponsorship", label: "Học bổng / tài trợ khoá học / hiện vật" },
  { value: "other", label: "Khác" }
];

const REFERRER_OPTIONS = [
  { value: "friend", label: "Bạn bè" },
  { value: "social_media", label: "Mạng xã hội" },
  { value: "website", label: "Website chương trình" },
  { value: "alumni_referral", label: "Cựu mentor giới thiệu" },
  { value: "other", label: "Khác" }
];

export function ApplyMentorForm({ applyToken }: { applyToken?: string | null }) {
  // Redirect on success is handled server-side via redirect() in the action.
  // useFormState is kept only to surface error states (validation / duplicate / db).
  const [state, formAction] = useFormState<ApplyActionState, FormData>(
    submitMentorApplicationAction,
    initialApplyActionState
  );
  const [workYears, setWorkYears] = useState<number | null>(null);
  const [managementYears, setManagementYears] = useState<number | null>(null);
  const belowThreshold =
    workYears !== null && managementYears !== null && (workYears < 8 || managementYears < 3);

  const formRef = useRef<HTMLFormElement>(null);
  const draft = useDraftRecovery({ role: "mentor", formRef, submissionOk: state.ok });

  return (
    <>
      <DraftRecoveryBanner
        status={draft.status}
        savedAt={draft.savedAt}
        hasDraft={draft.hasDraft}
        onRestore={draft.restore}
        onDiscard={() => {
          draft.discard();
          setWorkYears(null);
          setManagementYears(null);
        }}
      />
      {/* key: discarding remounts the subtree so field-level state resets with the DOM */}
      <ApplicationForm
        key={draft.resetKey}
        formRef={formRef}
        action={formAction}
        state={state}
        submitLabel="Gửi đơn đăng ký mentor"
      >
      {/*
        Pilot token relay. Rendered only while the form is in pilot state, so
        the Server Action can re-run the identical gate the page ran. The
        server reads this field explicitly and never copies it into
        raw_payload or an answer row.
      */}
      {applyToken ? <input type="hidden" name={APPLY_TOKEN_FIELD} value={applyToken} /> : null}

      {/* Content-only section. Renders no inputs and cannot affect submission. */}
      <MentorProfileIntro />

      <FormSection title="1. Đồng ý & quyền riêng tư">
        <ConsentCheckbox
          name="consent_data_storage"
          required
          label="Tôi đồng ý cho VAM OS lưu trữ và xử lý dữ liệu cá nhân của tôi cho mục đích chương trình mentoring."
        />
        <CheckboxGroupField
          name="consent_contact_methods"
          label="Tôi đồng ý nhận thông tin chương trình qua các kênh sau"
          required
          options={CONTACT_METHOD_OPTIONS}
        />
      </FormSection>

      <FormSection title="2. Thông tin định danh">
        <TextField name="full_name" label="Họ và tên (đầy đủ)" required />
        <TextField name="preferred_name" label="Tên thường gọi (nếu khác họ tên)" />
        <SelectField
          name="gender"
          label="Giới tính"
          options={GENDER_OPTIONS}
          otherInput={{ name: "gender_other", label: "Vui lòng ghi rõ" }}
        />
        <TextField name="year_of_birth" label="Năm sinh" placeholder="VD: 1990" />
        <SelectField name="current_city" label="Thành phố hiện tại" options={CITY_OPTIONS} />
      </FormSection>

      <FormSection title="3. Liên hệ">
        <TextField name="email_primary" label="Email" type="email" required />
        <PhoneField
          name="phone_primary"
          label="Số điện thoại"
          required
          placeholder="VD: 0901234567"
        />
        <TextField name="linkedin_url" label="LinkedIn URL" type="url" placeholder="https://linkedin.com/in/..." />
      </FormSection>

      <FormSection title="4. Nghề nghiệp & chuyên môn">
        <TextField name="company_current" label="Công ty hiện tại" required />
        <TextField name="title_current" label="Chức danh hiện tại" required />
        <SelectField
          name="years_of_experience"
          label="Số năm kinh nghiệm"
          required
          options={YEARS_EXPERIENCE_OPTIONS}
        />
        <SelectField
          name="industry_primary"
          label="Ngành nghề chính (chọn 1)"
          required
          options={INDUSTRY_OPTIONS}
          otherInput={{ name: "industry_primary_other", label: "Vui lòng ghi rõ" }}
        />
        <SelectField
          name="function_primary"
          label="Chức năng / chuyên môn chính (chọn 1)"
          required
          options={FUNCTION_OPTIONS}
          otherInput={{ name: "function_primary_other", label: "Vui lòng ghi rõ" }}
        />
        <CheckboxGroupField
          name="secondary_industries_functions"
          label="Ngành / chức năng phụ (nếu có, chọn tối đa 3)"
          options={[...INDUSTRY_OPTIONS, ...FUNCTION_OPTIONS]}
          helpText="Chỉ chọn nếu có thêm chuyên môn phụ — không bắt buộc."
          maxSelections={3}
          otherInput={{
            name: "secondary_industries_functions_other",
            label: "Vui lòng ghi rõ kỹ năng/lĩnh vực khác"
          }}
        />
        <SelectField
          name="highest_degree"
          label="Bằng cấp cao nhất"
          options={HIGHEST_DEGREE_OPTIONS}
          otherInput={{ name: "highest_degree_other", label: "Vui lòng ghi rõ" }}
        />
      </FormSection>

      <FormSection title="5. Kinh nghiệm mentoring & sẵn sàng">
        <SelectField
          name="prior_vam_involvement"
          label="Anh/chị đã từng làm mentor trong chương trình nào của VAM/UEH chưa?"
          options={PRIOR_VAM_OPTIONS}
        />
        <TextField
          name="first_vam_season"
          label="Mùa VAM đầu tiên anh/chị tham gia (nếu có)"
          placeholder="VD: S10"
        />
        <SelectField
          name="sme_mentoring_experience"
          label="Anh/chị đã từng mentor cho doanh nghiệp SMEs hoặc startup chưa?"
          options={SME_OPTIONS}
        />
        <TextAreaField
          name="motivation_text"
          label="Lý do anh/chị muốn tham gia làm mentor"
          required
          minLength={100}
          rows={5}
          helpText="Tối thiểu ~100 ký tự. Đây là phần BTC sẽ đọc kỹ khi review."
        />
        <RadioGroupField
          name="can_attend_orientation"
          label="Anh/chị sẵn sàng tham gia buổi orientation cho mentor mới không?"
          required
          options={ATTEND_ORIENTATION_OPTIONS}
        />
        <RadioGroupField
          name="open_to_intro_call"
          label="Sẵn sàng có 1 buổi intro call ngắn (15-30 phút) với core team trước khi chính thức?"
          required
          options={INTRO_CALL_OPTIONS}
        />
      </FormSection>

      <FormSection title="6. Khả năng & cam kết">
        <RadioGroupField
          name="mentoring_capacity_total"
          label="Số mentee tối đa anh/chị có thể nhận trong mùa này"
          required
          options={CAPACITY_OPTIONS}
        />
        <SelectField
          name="meeting_frequency"
          label="Tần suất gặp mentee anh/chị có thể cam kết"
          options={MEETING_FREQUENCY_OPTIONS}
        />
        <CheckboxGroupField
          name="meeting_format_preference"
          label="Hình thức gặp ưu tiên"
          options={MEETING_FORMAT_OPTIONS}
        />
        <TextAreaField
          name="preferred_mentee_persona"
          label="Đối tượng mentee anh/chị ưu tiên hỗ trợ (nếu có)"
          rows={3}
          helpText="Mô tả ngắn gọn nếu có hình dung cụ thể (VD: sinh viên năm 3-4 quan tâm Marketing B2B)."
        />
        <CheckboxGroupField
          name="preferred_language"
          label="Ngôn ngữ mentoring"
          options={LANGUAGE_OPTIONS}
        />
        <CheckboxGroupField
          name="programs_willing_to_join"
          label="Chương trình anh/chị sẵn sàng tham gia (chọn 1 hoặc nhiều)"
          required
          options={PROGRAM_OPTIONS}
          defaultSelected={["UEHM"]}
        />
        <CheckboxGroupField
          name="activities_willing_to_support"
          label="Ngoài mentoring 1:1, anh/chị có thể hỗ trợ hoạt động nào?"
          options={ACTIVITY_OPTIONS}
          otherInput={{ name: "activities_willing_to_support_other", label: "Vui lòng ghi rõ" }}
        />
      </FormSection>

      <FormSection title="7. Tài liệu kèm theo (tuỳ chọn)">
        <TextField
          name="bio_or_cv_url"
          label="Link CV / Bio (Google Drive, LinkedIn, Notion, blog...)"
          type="url"
          placeholder="https://..."
          helpText="Có thể bổ sung sau khi được duyệt — không bắt buộc."
        />
        <TextField
          name="profile_picture_url"
          label="Ảnh profile (link Drive / Imgur...)"
          type="url"
          placeholder="https://..."
        />
      </FormSection>

      <FormSection title="8. Khác">
        <SelectField
          name="referrer_or_source"
          label="Anh/chị biết đến chương trình qua đâu?"
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
        title="Xác nhận điều kiện và cam kết tham gia"
        description="Để đảm bảo chất lượng của UEH Mentoring và trải nghiệm tốt cho cả Mentor và Mentee, vui lòng đọc và xác nhận các nội dung dưới đây."
      >
        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-vam-ink">Điều kiện kinh nghiệm</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              name="mentor_total_work_years"
              label="Tổng số năm kinh nghiệm làm việc"
              required
              min={0}
              onChange={(event) => setWorkYears(event.target.value === "" ? null : Number(event.target.value))}
            />
            <NumberField
              name="mentor_people_management_years"
              label="Tổng số năm kinh nghiệm quản lý con người/đội ngũ"
              required
              min={0}
              helpText="Quản lý con người/đội ngũ nghĩa là từng trực tiếp chịu trách nhiệm dẫn dắt, đánh giá, phát triển hoặc quản lý nhân sự. Nếu chỉ có chức danh nhưng chưa từng trực tiếp dẫn dắt, đánh giá hoặc phát triển nhân sự trực thuộc thì chưa được tính là kinh nghiệm quản lý đội ngũ."
              onChange={(event) =>
                setManagementYears(event.target.value === "" ? null : Number(event.target.value))
              }
            />
            <NumberField
              name="mentor_largest_team_size"
              label="Quy mô đội ngũ lớn nhất đã trực tiếp quản lý"
              required={(managementYears ?? 0) > 0}
              min={1}
            />
            <TextField
              name="mentor_reference"
              label="Người giới thiệu/người tham chiếu"
              helpText="Có thể ghi tên + tổ chức + mối quan hệ nếu phù hợp."
            />
          </div>
          <p className="mt-3 text-sm text-slate-700">
            Tiêu chí chuẩn của Mentor Mùa 12: tối thiểu <strong>8 năm kinh nghiệm làm việc</strong> và ít nhất <strong>3 năm kinh nghiệm trực tiếp quản lý con người/đội ngũ</strong>. Các trường hợp đặc biệt có thể được Core Team xem xét riêng.
          </p>
          {belowThreshold ? (
            <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-900" role="status">
              Theo tiêu chí chung của Mùa 12, Mentor cần có tối thiểu 8 năm kinh nghiệm làm việc và ít nhất 3 năm kinh nghiệm quản lý con người. Nếu bạn được Core Team giới thiệu/xét trường hợp đặc biệt, Ban Tổ chức sẽ xem xét riêng.
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border-2 border-vam-green bg-vam-mint/40 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-vam-green">
            Cam kết thời gian — Bắt buộc
          </p>
          <p className="mb-3 text-sm text-vam-ink">
            Dành tối thiểu <strong className="text-base">1–2 giờ/tháng cho mỗi Mentee</strong> trong suốt mùa mentoring.
          </p>
          <ConsentCheckbox name={ACK.MENTOR_TIME_COMMITMENT_V1.key} required label={ACK.MENTOR_TIME_COMMITMENT_V1.wording} />
        </div>

        {[
          ACK.MENTOR_ELIGIBILITY_V1,
          ACK.MENTOR_MATCH_EXPECTATION_V1,
          ACK.MENTOR_MENTORING_PRINCIPLE_V1,
          ACK.MENTOR_NO_GHOST_V1
        ].map((entry) => (
          <div key={entry.key} className="rounded-md border border-vam-line bg-white p-2">
            <ConsentCheckbox name={entry.key} required label={entry.wording} />
          </div>
        ))}
        <h3 className="mt-2 border-t border-vam-line pt-4 text-sm font-semibold text-vam-ink">
          Ranh giới nghề nghiệp, an toàn và bảo mật
        </h3>
        {[
          ACK.MENTOR_BOUNDARIES_V1,
          ACK.MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1,
          ACK.MENTOR_CONFLICT_ESCALATION_V1
        ].map((entry) => (
          <div key={entry.key} className="rounded-md border border-vam-line bg-white p-2">
            <ConsentCheckbox name={entry.key} required label={entry.wording} />
          </div>
        ))}
        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <TextField
            name="MENTOR_ACTIVE_READING_V1"
            label="Vui lòng nhập lại câu dưới đây để xác nhận bạn đã đọc và hiểu các nguyên tắc chính."
            required
            helpText={MENTOR_CONFIRMATION_PHRASE}
          />
        </div>
      </FormSection>

      </ApplicationForm>
    </>
  );
}
