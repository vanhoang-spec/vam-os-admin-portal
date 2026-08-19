"use client";

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
  RENEWAL_MENTEE_CAPACITY_CHOICES,
  RENEWAL_MENTEE_CAPACITY_DEFAULT
} from "@/lib/renewal-types";

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

export function RenewalForm({
  token,
  display
}: {
  token: string;
  display: RenewalPublicDisplayDto;
}) {
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
            Chỉ nhập những thông tin cần cập nhật. Ô để trống sẽ giữ nguyên dữ liệu hiện tại.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-md border border-vam-line bg-slate-50 p-3 text-sm">
          <input className="mt-0.5" type="checkbox" name="participation_confirmed" value="yes" required />
          <span>Tôi xác nhận tiếp tục tham gia với vai trò mentor trong Season 12.</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-vam-ink">
            Công ty hiện tại
            <input className={fieldClass()} name="company_current" defaultValue={display.companyCurrent ?? ""} />
          </label>
          <label className="text-sm font-medium text-vam-ink">
            Chức danh hiện tại
            <input className={fieldClass()} name="title_current" defaultValue={display.titleCurrent ?? ""} />
          </label>
          <label className="text-sm font-medium text-vam-ink">
            Lĩnh vực chuyên môn
            <input className={fieldClass()} name="function_primary" defaultValue={display.functionArea ?? ""} />
          </label>
          <label className="text-sm font-medium text-vam-ink">
            Ngành
            <input className={fieldClass()} name="industry_primary" defaultValue={display.industry ?? ""} />
          </label>
          <label className="text-sm font-medium text-vam-ink">
            Số năm kinh nghiệm chính xác
            <input className={fieldClass()} type="number" min="0" step="1" name="mentor_total_work_years" defaultValue={display.yearsExperienceMin ?? ""} />
          </label>
          <label className="text-sm font-medium text-vam-ink">
            Nhóm kinh nghiệm
            <input className={fieldClass()} name="years_of_experience" defaultValue={display.yearsExperienceText ?? ""} />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium text-vam-ink mb-2">Số mentee có thể đồng hành tối đa trong mùa này</legend>
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
          {requiredCheckboxAcknowledgements("mentor").filter(entry => !["MENTOR_BOUNDARIES_V1", "MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1", "MENTOR_CONFLICT_ESCALATION_V1"].includes(entry.key)).map((entry) => (
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
          {requiredCheckboxAcknowledgements("mentor").filter(entry => ["MENTOR_BOUNDARIES_V1", "MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1", "MENTOR_CONFLICT_ESCALATION_V1"].includes(entry.key)).map((entry) => (
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
          <textarea className={fieldClass()} name="core_team_note" rows={3} placeholder="Ví dụ: Anh có mentor cũ năm ngoái, em ưu tiên match bạn đó nhé..." />
        </div>

        <label className="flex items-start gap-3 rounded-md border border-vam-line bg-slate-50 p-3 text-sm">
          <input className="mt-0.5" type="checkbox" name="consent_data_storage" value="yes" required />
          <span>Tôi đồng ý để VAM lưu trữ và sử dụng dữ liệu này cho hoạt động Season 12.</span>
        </label>

        <Feedback ok={acceptState.ok} message={acceptState.message} />
        <div>
          <SubmitButton pendingText="Đang gửi xác nhận...">Xác nhận tiếp tục</SubmitButton>
        </div>
      </form>

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
