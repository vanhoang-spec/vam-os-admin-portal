"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { keepFormValues } from "@/lib/keep-form-values";
import { acceptRenewalAction, declineRenewalAction } from "@/app/actions/renewals";
import { SubmitButton } from "@/components/submit-button";
import { initialRenewalPublicActionState, type RenewalPublicDisplayDto } from "@/lib/renewal-types";
import { requiredCheckboxAcknowledgements } from "@/lib/application-commitments";
import {
  RENEWAL_MAX_EXPERIENCE_YEARS,
  RENEWAL_MENTEE_CAPACITY_CHOICES,
  RENEWAL_MENTEE_CAPACITY_DEFAULT
} from "@/lib/renewal-types";
import {
  profileOptionValue,
  RENEWAL_ONE_CLICK_BUTTON,
  RENEWAL_ONE_CLICK_NOTICE
} from "@/lib/renewal-one-click-core";
import { MENTOR_PROGRAM_OPTIONS, MENTOR_UNIVERSITY_OPTIONS, MENTOR_FUNCTION_OPTIONS, MENTOR_INDUSTRY_OPTIONS } from "@/lib/mentor-intake-content";
import { MentorProfileIntro } from "@/app/apply/_components/mentor-profile-intro";
import { MentorSupportContacts } from "@/app/apply/_components/mentor-support-contacts";
import { CheckboxGroupField } from "@/app/apply/_components/form-primitives";
import { DEFAULT_APPLICATION_FORM_TEXTS, type ApplicationFormTexts } from "@/lib/application-form-text-core";

function fieldClass() {
  return "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink focus:border-vam-green focus:outline-none focus:ring-2 focus:ring-vam-mint";
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

/** Nhãn của một lựa chọn nếu hồ sơ lưu bằng mã; không nhận ra thì hiện nguyên chữ đang lưu. */
function optionLabel(stored: string | null, options: readonly { value: string; label: string }[]) {
  if (!stored) return "—";
  return options.find((option) => option.value === stored)?.label ?? stored;
}

/**
 * Phần cập nhật hồ sơ — KHÔNG bắt buộc, và chỉ có mặt trong form khi mentor bấm mở.
 *
 * Tách thành component riêng để việc đóng lại là gỡ hẳn khỏi form: ô đã gõ dở không được
 * lặng lẽ đi theo lần bấm Gia hạn sau khi người dùng đã chọn "giữ nguyên hồ sơ". Không ô
 * nào ở đây mang `required`: để trống là giữ hồ sơ mùa trước, và máy chủ chỉ kiểm những ô
 * thật sự được gửi lên.
 */
function ProfileUpdateFields({ display, onCancel }: { display: RenewalPublicDisplayDto; onCancel: () => void }) {
  const [university, setUniversity] = useState("");
  const [functionPrimary, setFunctionPrimary] = useState(() => profileOptionValue(display.functionArea, MENTOR_FUNCTION_OPTIONS));
  const unmappedFunction = display.functionArea && !functionPrimary ? display.functionArea : null;
  const [industryPrimary, setIndustryPrimary] = useState(() => profileOptionValue(display.industry, MENTOR_INDUSTRY_OPTIONS));
  const unmappedIndustry = display.industry && !industryPrimary ? display.industry : null;

  return (
    <div data-testid="renewal-profile-update" className="grid gap-4 rounded-md border border-vam-line bg-slate-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-vam-ink">Cập nhật hồ sơ (không bắt buộc)</h3>
          <p className="mt-1 text-xs text-slate-600">
            Các giá trị đang có trong hồ sơ được điền sẵn. Chỉ sửa những gì đã thay đổi; ô nào để trống thì hồ sơ mùa trước được giữ nguyên.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-vam-line bg-white px-3 py-1.5 text-xs font-medium text-vam-green hover:bg-slate-50"
        >
          Bỏ cập nhật, giữ nguyên hồ sơ
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-vam-ink">
          Công ty / Tổ chức hiện tại
          <input className={fieldClass()} name="company_current" defaultValue={display.companyCurrent ?? ""} />
        </label>
        <label className="text-sm font-medium text-vam-ink">
          Chức danh / Vị trí hiện tại
          <input className={fieldClass()} name="title_current" defaultValue={display.titleCurrent ?? ""} />
        </label>
        <div className="flex flex-col">
          <label className="mb-1 text-sm font-medium text-vam-ink" htmlFor="renewal-industry-primary">
            Ngành nghề chính (chọn 1)
          </label>
          {unmappedIndustry ? (
            <p className="mb-2 text-xs text-slate-500">Thông tin hiện tại: {unmappedIndustry}</p>
          ) : null}
          <select id="renewal-industry-primary" className={fieldClass()} name="industry_primary" value={industryPrimary} onChange={(e) => setIndustryPrimary(e.target.value)}>
            <option value="">Giữ nguyên như hồ sơ</option>
            {MENTOR_INDUSTRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        {industryPrimary === "other" ? (
          <label className="mt-2 text-sm font-medium text-vam-ink">
            Vui lòng ghi rõ ngành nghề
            <input className={fieldClass()} name="industry_primary_other" />
          </label>
        ) : null}
        <div className="flex flex-col">
          <label className="mb-1 text-sm font-medium text-vam-ink" htmlFor="renewal-function-primary">
            Chức năng / chuyên môn chính (chọn 1)
          </label>
          {unmappedFunction ? (
            <p className="mb-2 text-xs text-slate-500">Thông tin hiện tại: {unmappedFunction}</p>
          ) : null}
          <select id="renewal-function-primary" className={fieldClass()} name="function_primary" value={functionPrimary} onChange={(e) => setFunctionPrimary(e.target.value)}>
            <option value="">Giữ nguyên như hồ sơ</option>
            {MENTOR_FUNCTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        {functionPrimary === "other" ? (
          <label className="mt-2 text-sm font-medium text-vam-ink">
            Vui lòng ghi rõ chức năng / chuyên môn
            <input className={fieldClass()} name="function_primary_other" />
          </label>
        ) : null}
        {/*
          Một ngành chính và một chức năng chính vẫn chỉ chọn 1: Vòng 2 xếp nhóm ngành theo
          đúng hai ô đó. Mentor có nhiều lĩnh vực chọn thêm ở đây — không giới hạn số lượng
          (BTC 13/10/2026 bỏ trần 3), "Khác" phải ghi rõ, cùng luật với form đăng ký mới.
        */}
        <div className="sm:col-span-2">
          <CheckboxGroupField
            name="secondary_industries_functions"
            label="Ngành / chức năng phụ (nếu có)"
            options={[...MENTOR_INDUSTRY_OPTIONS, ...MENTOR_FUNCTION_OPTIONS]}
            helpText="Chọn thêm nếu anh/chị có thể mentoring ở nhiều lĩnh vực — không bắt buộc, chọn bao nhiêu cũng được."
            otherInput={{
              name: "secondary_industries_functions_other",
              label: "Vui lòng ghi rõ kỹ năng/lĩnh vực khác"
            }}
          />
        </div>
        <label className="text-sm font-medium text-vam-ink">
          Số năm kinh nghiệm
          {/*
            Ô nhập số, không phải danh sách chọn: danh sách 0–80 năm chỉ hiện chừng 20 dòng
            đầu, nên mentor nhiều năm kinh nghiệm tưởng form chỉ cho chọn tới 20 (BTC
            11/10/2026). Giới hạn thật là RENEWAL_MAX_EXPERIENCE_YEARS, máy chủ kiểm lại.
          */}
          <input
            className={fieldClass()}
            type="number"
            inputMode="numeric"
            min="0"
            max={RENEWAL_MAX_EXPERIENCE_YEARS}
            step="1"
            name="mentor_total_work_years"
            defaultValue={display.yearsExperienceMin ?? ""}
            placeholder="VD: 25"
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Nhập số năm, không giới hạn ở 20. Ví dụ: 8, 15, 25, 32.
          </span>
        </label>
        <label className="text-sm font-medium text-vam-ink">
          Tổng số năm kinh nghiệm quản lý con người / đội ngũ
          <input className={fieldClass()} type="number" inputMode="numeric" min="0" max={RENEWAL_MAX_EXPERIENCE_YEARS} step="1" name="mentor_people_management_years" />
        </label>
        <label className="text-sm font-medium text-vam-ink sm:col-span-2">
          Chủ đề / lĩnh vực mentor có thể hỗ trợ
          <textarea className={fieldClass()} name="mentoring_topics" rows={4} maxLength={2000} />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            Anh/chị có thể chia sẻ các chủ đề hoặc hình thức hỗ trợ thêm, ví dụ: training/chia sẻ chuyên đề, career sharing, company visit, kết nối cơ hội thực tập, hoặc các lĩnh vực chuyên môn khác.
          </span>
        </label>
        <label className="text-sm font-medium text-vam-ink sm:col-span-2">
          Anh/chị tốt nghiệp trường đại học nào?
          <select className={fieldClass()} name="university" value={university} onChange={(event) => setUniversity(event.target.value)}>
            <option value="">Không cập nhật</option>
            {MENTOR_UNIVERSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {university === "OTHER" ? (
          <label className="text-sm font-medium text-vam-ink sm:col-span-2">
            Tên trường đại học
            <input className={fieldClass()} name="university_other" />
          </label>
        ) : null}
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-vam-ink">Chương trình anh/chị sẵn sàng tham gia trong mùa hiện tại</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MENTOR_PROGRAM_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-start gap-2 rounded-md border border-vam-line bg-white p-3 text-sm">
                <input className="mt-0.5" type="checkbox" name="programs_willing_to_join" value={option.value} defaultChecked={option.value === "UEHM"} />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-sm font-medium text-vam-ink sm:col-span-2">
          Ý kiến / Lưu ý cho Core Team
          <textarea className={fieldClass()} name="core_team_note" rows={3} />
        </label>
      </div>
    </div>
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
  const [acceptState, acceptAction] = useFormState(
    acceptRenewalAction.bind(null, token),
    initialRenewalPublicActionState
  );
  const [declineState, declineAction] = useFormState(
    declineRenewalAction.bind(null, token),
    initialRenewalPublicActionState
  );
  // Phần cập nhật hồ sơ chỉ nằm trong form khi mentor mở nó ra. Đóng = gỡ khỏi form.
  const [updating, setUpdating] = useState(false);
  const completed = acceptState.ok || declineState.ok;
  const commitments = requiredCheckboxAcknowledgements("mentor");

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
      <section data-testid="renewal-current-profile" className="rounded-lg border border-vam-line bg-white p-5 shadow-soft">
        <h2 className="text-lg font-semibold text-vam-ink">Hồ sơ mentor hiện tại</h2>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><span className="font-medium">Họ tên:</span> {display.fullName || "—"}</div>
          <div><span className="font-medium">Mã mentor:</span> {display.mentorCode || "—"}</div>
          <div><span className="font-medium">Email:</span> {display.emailPrimary || "—"}</div>
          <div><span className="font-medium">SĐT:</span> {display.phonePrimary || "—"}</div>
          <div><span className="font-medium">Công ty / Tổ chức:</span> {display.companyCurrent || "—"}</div>
          <div><span className="font-medium">Chức danh:</span> {display.titleCurrent || "—"}</div>
          <div><span className="font-medium">Ngành nghề chính:</span> {optionLabel(display.industry, MENTOR_INDUSTRY_OPTIONS)}</div>
          <div><span className="font-medium">Chức năng chính:</span> {optionLabel(display.functionArea, MENTOR_FUNCTION_OPTIONS)}</div>
          <div><span className="font-medium">Mùa đầu tham gia:</span> {String(display.firstVamSeason ?? "—")}</div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Hồ sơ này được giữ nguyên khi anh/chị gia hạn. Mùa đầu tham gia và nội dung tham gia trước đây là thông tin lịch sử, không chỉnh sửa qua quy trình gia hạn.
        </p>
      </section>

      {/*
        Gia hạn một nút (BTC 13/10/2026). Form này cố ý KHÔNG có ô `required` nào: mọi thứ
        bấm Gia hạn cần đều đã có sẵn giá trị (số mentee mặc định 1), và một ô bắt buộc nằm
        trong phần cập nhật đang đóng sẽ chặn nút mà không hiện lý do.
      */}
      <form onReset={keepFormValues} action={acceptAction} data-testid="renewal-accept"
        className="grid gap-5 rounded-lg border border-vam-line bg-white p-5 shadow-soft"
      >
        <div>
          <h2 className="text-lg font-semibold text-vam-ink">Tiếp tục đồng hành — Season 12</h2>
          <p className="mt-1 text-sm text-slate-600">
            Anh/chị chỉ cần chọn số mentee nhận trong mùa này rồi bấm nút gia hạn. Hồ sơ mùa trước được giữ nguyên.
          </p>
        </div>

        {/*
          Thứ duy nhất vẫn hỏi lại: số mentee là cam kết của TỪNG mùa. Mặc định luôn là 1;
          con số mùa trước chỉ hiện để tham khảo, không bao giờ được chọn sẵn.
        */}
        <fieldset data-testid="renewal-capacity">
          <legend className="mb-2 text-sm font-medium text-vam-ink">Số mentee anh/chị nhận trong Season 12</legend>
          <div className="flex gap-4">
            {RENEWAL_MENTEE_CAPACITY_CHOICES.map((num) => (
              <label key={num} className="flex items-center gap-2 text-sm text-vam-ink">
                <input
                  type="radio"
                  name="mentoring_capacity_total"
                  value={num}
                  defaultChecked={num === RENEWAL_MENTEE_CAPACITY_DEFAULT}
                />
                {num} mentee
              </label>
            ))}
          </div>
          {display.capacityTarget ? (
            <p className="mt-1 text-xs text-slate-500">Mùa trước: {display.capacityTarget} mentee</p>
          ) : null}
        </fieldset>

        {updating ? (
          <ProfileUpdateFields display={display} onCancel={() => setUpdating(false)} />
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setUpdating(true)}
              className="text-sm font-medium text-vam-green underline underline-offset-2 hover:text-vam-green/80"
            >
              Cập nhật hồ sơ hoặc nhắn Ban Tổ chức (không bắt buộc)
            </button>
          </div>
        )}

        <Feedback ok={acceptState.ok} message={acceptState.message} />

        <div className="rounded-lg border-2 border-vam-green bg-vam-mint/40 p-4">
          <p data-testid="renewal-notice" className="text-sm text-vam-ink">{RENEWAL_ONE_CLICK_NOTICE}</p>
          <div className="mt-3">
            <SubmitButton pendingText="Đang gửi xác nhận...">{RENEWAL_ONE_CLICK_BUTTON}</SubmitButton>
          </div>
        </div>

        {/* Rendered from the canonical mentor acknowledgements. The form does not keep a
            list of its own, so a commitment added to the policy source appears here — and
            is recorded with the renewal — without an edit. */}
        <details data-testid="renewal-commitments" className="rounded-md border border-vam-line bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-vam-ink">
            Các cam kết của mentor ({commitments.length} điều) — bấm để xem
          </summary>
          <p className="mt-3 text-sm text-vam-ink">
            Dành tối thiểu <strong>1–2 giờ/tháng cho mỗi Mentee</strong> trong suốt mùa mentoring.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            {commitments.map((entry) => (
              <li key={entry.key} data-commitment={entry.key}>{entry.wording}</li>
            ))}
          </ul>
        </details>
      </form>

      <MentorSupportContacts texts={texts} />

      <form onReset={keepFormValues} action={declineAction} className="rounded-lg border border-slate-200 bg-slate-50 p-5">
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
