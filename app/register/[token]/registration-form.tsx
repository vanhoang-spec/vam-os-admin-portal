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

export function RegistrationForm({ token, eventName }: { token: string; eventName: string }) {
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

      <Field label="Họ và tên" name="full_name" required autoComplete="name" defaultValue={state.values?.full_name} />
      <Field label="Email" name="email" type="email" required autoComplete="email" defaultValue={state.values?.email} />
      <Field label="Số điện thoại" name="phone" type="tel" autoComplete="tel" defaultValue={state.values?.phone} />
      <Field label="Mã số sinh viên" name="student_id" defaultValue={state.values?.student_id} />
      <Field label="Trường" name="school" autoComplete="organization" defaultValue={state.values?.school} />
      <Field label="Ngành học" name="program_of_study" defaultValue={state.values?.program_of_study} />
      <Field label="Vai trò / nhóm tham gia" name="role_text" defaultValue={state.values?.role_text} />

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Ghi chú</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={state.values?.notes}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2.5 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint sm:text-sm"
        />
      </label>

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
