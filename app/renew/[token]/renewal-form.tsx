"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { acceptRenewalAction, declineRenewalAction } from "@/app/actions/renewals";
import { SubmitButton } from "@/components/submit-button";
import { initialRenewalPublicActionState, type RenewalPublicDisplayDto } from "@/lib/renewal-types";
import {
  ACTIVE_READING_KEYS,
  CONFIRMATION_PHRASES,
  requiredCheckboxAcknowledgements
} from "@/lib/application-commitments";
import {
  RENEWAL_MAX_EXPERIENCE_YEARS,
  RENEWAL_MENTEE_CAPACITY_CHOICES,
  RENEWAL_MENTEE_CAPACITY_DEFAULT,
  RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD,
  RENEWAL_PROFILE_REVIEW_CONFIRMATION_TEXT
} from "@/lib/renewal-types";
import { MENTOR_PROGRAM_OPTIONS, MENTOR_UNIVERSITY_OPTIONS, MENTOR_FUNCTION_OPTIONS, MENTOR_INDUSTRY_OPTIONS } from "@/lib/mentor-intake-content";
import { MentorProfileIntro } from "@/app/apply/_components/mentor-profile-intro";
import { MentorSupportContacts } from "@/app/apply/_components/mentor-support-contacts";
import { DEFAULT_APPLICATION_FORM_TEXTS, type ApplicationFormTexts } from "@/lib/application-form-text-core";

function fieldClass() {
  return "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink focus:border-vam-green focus:outline-none focus:ring-2 focus:ring-vam-mint";
}

function RequiredIndicator() {
  return <span className="text-red-700"> — Bắt buộc</span>;
}

function Feedback({ ok, message }: { ok: boolean; message: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${
        ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {message}
    </p>
  );
}

export function RenewalForm({
  token,
  display,
  texts = DEFAULT_APPLICATION_FORM_TEXTS
}: {
  token: string;
  display: RenewalPublicDisplayDto;
  /** Chữ phần chân dung và liên hệ, dùng chung với form nộp đơn mentor. */
  texts?: ApplicationFormTexts;
}) {
  const [university, setUniversity] = useState("");
  const [functionPrimary, setFunctionPrimary] = useState(() => {
    if (!display.functionArea) return "";
    const canonicalValues = new Set(MENTOR_FUNCTION_OPTIONS.map((o) => o.value));
    if (canonicalValues.has(display.functionArea)) return display.functionArea;
    const mapping = new Map(MENTOR_FUNCTION_OPTIONS.map((o) => [o.label, o.value]));
    return mapping.get(display.functionArea) || "";
  });
  const unmappedFunction = display.functionArea && !functionPrimary ? display.functionArea : null;

  const [industryPrimary, setIndustryPrimary] = useState(() => {
    if (!display.industry) return "";
    const canonicalValues = new Set(MENTOR_INDUSTRY_OPTIONS.map((o) => o.value));
    if (canonicalValues.has(display.industry)) return display.industry;
    const mapping = new Map(MENTOR_INDUSTRY_OPTIONS.map((o) => [o.label, o.value]));
    return mapping.get(display.industry) || "";
  });
  const unmappedIndustry = display.industry && !industryPrimary ? display.industry : null;
  const [acceptState, acceptAction] = useFormState(
    acceptRenewalAction.bind(null, token),
    initialRenewalPublicActionState
  );
  const [declineState, declineAction] = useFormState(
    declineRenewalAction.bind(null, token),
    initialRenewalPublicActionState
  );
  const completed = acceptState.ok || declineState.ok;

  if (completed) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5">
        <h2 className="text-lg font-semibold text-green-900">Đã ghi nhận phản hồi</h2>
        <p className="mt-2 text-sm text-green-800">
          {acceptState.ok ? acceptState.message : declineState.message}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <MentorProfileIntro texts={texts} includeApplicationProcess={false} />
      <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-vam-ink">Hồ sơ mentor hiện tại</h2>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><span className="font-medium">Họ tên:</span> {display.fullName || "—"}</div>
          <div><span className="font-medium">Mã mentor:</span> {display.mentorCode || "—"}</div>
          <div><span className="font-medium">Email:</span> {display.emailPrimary || "—"}</div>
          <div><span className="font-medium">SĐT:</span> {display.phonePrimary || "—"}</div>
          <div><span className="font-medium">Mùa đầu tham gia:</span> {String(display.firstVamSeason ?? "—")}</div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Thông tin lịch sử bên trên chỉ để tham khảo. Các trường lineage như mùa đầu tham gia và nội dung tham gia trước đây không thể chỉnh sửa qua quy trình gia hạn.
        </p>
      </section>

      <form action={acceptAction} className="grid gap-5 rounded-lg border border-vam-line bg-white p-5 shadow-soft">
        <div>
          <h2 className="text-lg font-semibold text-vam-ink">Tiếp tục đồng hành — Season 12</h2>
          <p className="mt-1 text-sm text-slate-600">
            Vui lòng kiểm tra và xác nhận lại các thông tin có thể thay đổi theo mùa. Các trường bắt buộc phải hợp lệ cho lần xác nhận Season 12 này.
          </p>
          <p className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            Các giá trị đã có trong hồ sơ được điền sẵn bên dưới. Nếu thông tin vẫn đúng, anh/chị chỉ cần kiểm tra và giữ nguyên; không cần nhập lại.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-vam-line bg-slate-50 p-3 text-sm">
          <input className="mt-0.5" type="checkbox" name="participation_confirmed" value="yes" required />
          <span>Tôi xác nhận tiếp tục tham gia với vai trò mentor trong Season 12.<RequiredIndicator /></span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-vam-ink">
            Công ty / Tổ chức hiện tại<RequiredIndicator />
            <input className={fieldClass()} name="company_current" defaultValue={display.companyCurrent ?? ""} required />
          </label>
          <label className="text-sm font-medium text-vam-ink">
            Chức danh / Vị trí hiện tại<RequiredIndicator />
            <input className={fieldClass()} name="title_current" defaultValue={display.titleCurrent ?? ""} required />
          </label>
          <label className="text-sm font-medium text-vam-ink">
            Số năm kinh nghiệm<RequiredIndicator />
            <select className={fieldClass()} name="mentor_total_work_years" required defaultValue={display.yearsExperienceMin ?? ""}>
              <option value="">-- Chọn --</option>
              {Array.from({ length: RENEWAL_MAX_EXPERIENCE_YEARS + 1 }, (_, i) => (
                <option key={i} value={i}>{i} năm</option>
              ))}
            </select>
          </label>
          <div className="flex flex-col">
            <label className="text-sm font-medium text-vam-ink mb-1">
              Ngành nghề chính (chọn 1)<RequiredIndicator />
            </label>
            {unmappedIndustry ? (
              <p className="mb-2 text-xs text-slate-500">Thông tin hiện tại: {unmappedIndustry}</p>
            ) : null}
            <select className={fieldClass()} name="industry_primary" required value={industryPrimary} onChange={(e) => setIndustryPrimary(e.target.value)}>
              <option value="">Chọn ngành nghề...</option>
              {MENTOR_INDUSTRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {industryPrimary === "other" ? (
            <label className="text-sm font-medium text-vam-ink mt-2">
              Vui lòng ghi rõ ngành nghề<RequiredIndicator />
              <input className={fieldClass()} name="industry_primary_other" required />
            </label>
          ) : null}
          <div className="flex flex-col">
            <label className="text-sm font-medium text-vam-ink mb-1">
              Chức năng / chuyên môn chính (chọn 1)<RequiredIndicator />
            </label>
            {unmappedFunction ? (
              <p className="mb-2 text-xs text-slate-500">Thông tin hiện tại: {unmappedFunction}</p>
            ) : null}
            <select className={fieldClass()} name="function_primary" required value={functionPrimary} onChange={(e) => setFunctionPrimary(e.target.value)}>
              <option value="">Chọn chức năng...</option>
              {MENTOR_FUNCTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {functionPrimary === "other" ? (
            <label className="text-sm font-medium text-vam-ink mt-2">
              Vui lòng ghi rõ chức năng / chuyên môn<RequiredIndicator />
              <input className={fieldClass()} name="function_primary_other" required />
            </label>
          ) : null}
          <label className="text-sm font-medium text-vam-ink">
            Tổng số năm kinh nghiệm quản lý con người / đội ngũ<RequiredIndicator />
            <input className={fieldClass()} type="number" min="0" max={RENEWAL_MAX_EXPERIENCE_YEARS} step="1" name="mentor_people_management_years" required />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-vam-ink mb-2">Số mentee có thể nhận trong Season 12<RequiredIndicator /></legend>
            <div className="flex gap-4">
              {RENEWAL_MENTEE_CAPACITY_CHOICES.map((num) => (
                <label key={num} className="flex items-center gap-2 text-sm text-vam-ink">
                  <input
                    type="radio"
                    name="mentoring_capacity_total"
                    value={num}
                    defaultChecked={num === RENEWAL_MENTEE_CAPACITY_DEFAULT}
                    required
                  />
                  {num} mentee
                </label>
              ))}
            </div>
            {display.capacityTarget ? (
              <p className="mt-1 text-xs text-slate-500">Mùa trước: {display.capacityTarget} mentee</p>
            ) : null}
          </fieldset>
          <label className="text-sm font-medium text-vam-ink sm:col-span-2">
            Chủ đề / lĩnh vực mentor có thể hỗ trợ
            <textarea
              className={fieldClass()}
              name="mentoring_topics"
              rows={4}
              maxLength={2000}
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Không bắt buộc. Anh/chị có thể chia sẻ các chủ đề hoặc hình thức hỗ trợ thêm, ví dụ: training/chia sẻ chuyên đề, career sharing, company visit, kết nối cơ hội thực tập, hoặc các lĩnh vực chuyên môn khác.
            </span>
          </label>
          <label className="text-sm font-medium text-vam-ink sm:col-span-2">
            Anh/chị tốt nghiệp trường đại học nào?<RequiredIndicator />
            <select className={fieldClass()} name="university" required value={university} onChange={(event) => setUniversity(event.target.value)}>
              <option value="">Chọn trường đại học…</option>
              {MENTOR_UNIVERSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {university === "OTHER" ? (
            <label className="text-sm font-medium text-vam-ink sm:col-span-2">
              Tên trường đại học
              <input className={fieldClass()} name="university_other" required />
            </label>
          ) : null}
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium text-vam-ink">Chương trình anh/chị sẵn sàng tham gia trong mùa hiện tại<RequiredIndicator /></legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {MENTOR_PROGRAM_OPTIONS.map((option) => (
                <label key={option.value} className="flex items-start gap-2 rounded-md border border-vam-line bg-slate-50 p-3 text-sm">
                  <input className="mt-0.5" type="checkbox" name="programs_willing_to_join" value={option.value} defaultChecked={option.value === "UEHM"} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="rounded-lg border-2 border-vam-green bg-vam-mint/40 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-vam-green">
            Cam kết Mentor — Bắt buộc
          </p>
          <p className="mb-3 text-sm text-vam-ink">
            Dành tối thiểu <strong className="text-base">1–2 giờ/tháng cho mỗi Mentee</strong> trong suốt mùa mentoring.
          </p>
          {/* Rendered from the canonical mentor acknowledgements. The form does
              not keep a list of its own, so a commitment added to the policy
              source appears here and is enforced server-side without an edit. */}
          {requiredCheckboxAcknowledgements("mentor").filter(entry => entry.category !== "professional_safety").map((entry) => (
            <label key={entry.key} className="mb-2 flex items-start gap-3 rounded-md border border-vam-line bg-white p-3 text-sm">
              <input className="mt-0.5" type="checkbox" name={entry.key} value="true" required />
              <span>{entry.wording}</span>
            </label>
          ))}
        </div>

        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-vam-ink">
            Ranh giới nghề nghiệp, an toàn và bảo mật
          </h3>
          {requiredCheckboxAcknowledgements("mentor").filter(entry => entry.category === "professional_safety").map((entry) => (
            <label key={entry.key} className="mb-2 flex items-start gap-3 rounded-md border border-vam-line bg-white p-3 text-sm">
              <input className="mt-0.5" type="checkbox" name={entry.key} value="true" required />
              <span>{entry.wording}</span>
            </label>
          ))}
        </div>

        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <label className="text-sm font-medium text-vam-ink block mb-2">
            Vui lòng nhập lại câu dưới đây để xác nhận bạn đã đọc và hiểu các nguyên tắc chính.
          </label>
          <p className="mb-3 text-sm italic text-slate-600">
            {CONFIRMATION_PHRASES.mentor}
          </p>
          <input className={fieldClass()} name={ACTIVE_READING_KEYS.mentor} required />
        </div>

        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <label className="text-sm font-medium text-vam-ink block mb-2">
            Ý kiến / Lưu ý cho Core Team (Không bắt buộc)
          </label>
          <textarea className={fieldClass()} name="core_team_note" rows={3} />
        </div>

        <label className="flex items-start gap-3 rounded-md border border-vam-line bg-slate-50 p-3 text-sm">
          <input className="mt-0.5" type="checkbox" name="consent_data_storage" value="yes" required />
          <span><strong>Quyền riêng tư:</strong> Tôi đồng ý để VAM lưu trữ và sử dụng dữ liệu này cho hoạt động Season 12.<RequiredIndicator /></span>
        </label>

        <label className="flex items-start gap-3 rounded-md border-2 border-vam-green bg-vam-mint/40 p-4 text-sm">
          <input
            className="mt-0.5"
            type="checkbox"
            name={RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD}
            value="yes"
            required
          />
          <span><strong>Xác nhận rà soát hồ sơ — Bắt buộc:</strong> {RENEWAL_PROFILE_REVIEW_CONFIRMATION_TEXT}</span>
        </label>

        <Feedback ok={acceptState.ok} message={acceptState.message} />
        <div>
          <SubmitButton pendingText="Đang gửi xác nhận...">Xác nhận tiếp tục</SubmitButton>
        </div>
      </form>

      <MentorSupportContacts texts={texts} />

      <form action={declineAction} className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-base font-semibold text-vam-ink">Không tiếp tục Season 12</h2>
        <p className="mt-1 text-sm text-slate-600">
          Chọn mục này nếu anh/chị chưa thể tiếp tục đồng hành trong mùa này.
        </p>
        <Feedback ok={declineState.ok} message={declineState.message} />
        <div className="mt-4 mb-4">
          <label className="text-sm font-medium text-vam-ink block mb-2">
            Ý kiến / Góp ý / Lý do chưa thể tiếp tục (Không bắt buộc)
          </label>
          <p className="mb-2 text-xs text-slate-500">
            Nếu thuận tiện, anh/chị có thể chia sẻ lý do chưa thể tiếp tục đồng hành trong Season 12 hoặc góp ý để chương trình cải thiện tốt hơn.
          </p>
          <textarea className={fieldClass()} name="decline_feedback" rows={3} placeholder="Ví dụ: chưa sắp xếp được thời gian, thay đổi công việc, chưa phù hợp với cách matching, mong muốn chương trình điều chỉnh..., hoặc góp ý khác." />
        </div>
        <div className="mt-3">
          <SubmitButton
            variant="danger"
            pendingText="Đang ghi nhận..."
            onClick={(event) => {
              if (!window.confirm("Anh/chị xác nhận không tiếp tục tham gia với vai trò Mentor trong Season 12?")) event.preventDefault();
            }}
          >
            Xác nhận không tiếp tục
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
