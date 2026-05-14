"use client";

import { useFormState, useFormStatus } from "react-dom";
import { initialPublicRegistrationActionState } from "@/lib/event-action-types";
import { submitEventRegistrationAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-vam-green px-4 py-3 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60 sm:w-fit"
    >
      {pending ? "Đang gửi..." : "Gửi đăng ký"}
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  autoComplete,
  defaultValue
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}{required ? " *" : ""}</span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2.5 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint sm:text-sm"
      />
    </label>
  );
}

import type { Event } from "@/lib/types";

export function RegistrationForm({ token, eventName, event }: { token: string; eventName: string; event: Event }) {
  const [state, formAction] = useFormState(submitEventRegistrationAction, initialPublicRegistrationActionState);
  const displayEventName = state.eventName || eventName;

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-green-800">
        <h2 className="text-lg font-semibold">Đăng ký thành công</h2>
        <p className="mt-2 text-base font-medium">{displayEventName}</p>
        <p className="mt-2 text-sm">VAM đã nhận được đăng ký của bạn.</p>
      </div>
    );
  }

  if (state.status === "already_registered") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <h2 className="text-lg font-semibold">Bạn đã đăng ký sự kiện này rồi</h2>
        <p className="mt-2 text-base font-medium">{displayEventName}</p>
        <p className="mt-2 text-sm">Không cần gửi lại biểu mẫu. VAM đã có đăng ký của bạn.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />

      {state.message ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </div>
      ) : null}

      <Field label="Họ và tên / Full name" name="full_name" required autoComplete="name" defaultValue={state.values?.full_name} />
      <Field label="Email" name="email" type="email" required autoComplete="email" defaultValue={state.values?.email} />
      <Field label="Số điện thoại" name="phone" type="tel" autoComplete="tel" defaultValue={state.values?.phone} />
      {event.show_student_id_field !== false && (
        <Field label="Mã số sinh viên / MSSV" name="student_id" required={event.student_id_required === true} defaultValue={state.values?.student_id} />
      )}
      {event.show_mentee_code_field && (
        <Field label="Mã Mentee (Mentee Code)" name="mentee_code" required={event.mentee_code_required === true} defaultValue={state.values?.mentee_code} />
      )}
      {event.show_school_field && (
        <Field label="Trường" name="school" autoComplete="organization" defaultValue={state.values?.school} />
      )}
      {event.show_program_field && (
        <Field label="Ngành học" name="program_of_study" defaultValue={state.values?.program_of_study} />
      )}
      {event.show_role_text_field && (
        <Field label="Vai trò / nhóm tham gia" name="role_text" defaultValue={state.values?.role_text} />
      )}
      
      {(event.proof_required || event.proof_required_for_registration) && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="mb-3 text-sm font-medium text-slate-800">{event.proof_label || "Minh chứng (Screenshot URL)"} *</p>
          <Field label="Đường dẫn minh chứng (Google Drive, Imgur...)" name="proof_url" required />
          <div className="mt-2 text-xs text-slate-500 whitespace-pre-wrap">{event.proof_description}</div>
          <div className="mt-3">
            <Field label="Ghi chú thêm về minh chứng (tuỳ chọn)" name="proof_note" />
          </div>
        </div>
      )}

      {event.question_collection_enabled && (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">{event.speaker_question_label || "Câu hỏi cho diễn giả"}</span>
          <textarea
            name="speaker_question"
            rows={2}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2.5 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint sm:text-sm"
          />
        </label>
      )}

      {(event.fee_required || event.payment_proof_required) && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-sm font-medium text-slate-800">Thông tin thanh toán</p>
          {event.fee_amount && (
            <p className="mb-1 text-sm"><span className="font-medium">Số tiền:</span> {new Intl.NumberFormat("vi-VN").format(event.fee_amount)} {event.fee_currency || "VND"}</p>
          )}
          {event.fee_description && <p className="mb-2 text-sm text-slate-600">{event.fee_description}</p>}
          {event.payment_instruction && (
            <div className="mb-4 rounded bg-white p-3 text-sm whitespace-pre-wrap border border-slate-200">
              {event.payment_instruction}
            </div>
          )}
          {event.payment_proof_required && (
            <>
              <Field label="Đường dẫn ảnh chuyển khoản (Screenshot URL) *" name="payment_proof_url" required />
              <div className="mt-3">
                <Field label="Ghi chú thanh toán (tuỳ chọn)" name="payment_proof_note" />
              </div>
            </>
          )}
        </div>
      )}

      {event.show_notes_field && (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Ghi chú chung</span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={state.values?.notes}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2.5 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint sm:text-sm"
          />
        </label>
      )}

      {event.no_show_policy_enabled && event.no_show_policy_text && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold mb-2">Chính sách tham dự:</p>
          <p className="whitespace-pre-wrap mb-3">{event.no_show_policy_text}</p>
          <label className="flex gap-3 mt-2">
            <input
              name="no_show_policy_accepted"
              type="checkbox"
              required
              className="mt-1 h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green shrink-0"
            />
            <span className="font-medium">Tôi đã đọc và đồng ý với chính sách tham dự này. *</span>
          </label>
        </div>
      )}

      <label className="flex gap-3 rounded-md border border-vam-line bg-slate-50 p-3 text-sm text-slate-700">
        <input
          name="consent_given"
          type="checkbox"
          required
          className="mt-1 h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green"
        />
        <span>Tôi đồng ý gửi thông tin đăng ký cho ban tổ chức sự kiện.</span>
      </label>

      <SubmitButton />
    </form>
  );
}
