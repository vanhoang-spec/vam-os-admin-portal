"use client";

import { useFormState, useFormStatus } from "react-dom";
import { initialPublicCheckinActionState } from "@/lib/event-action-types";
import { submitEventCheckinAction } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-vam-green px-4 py-3 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60 sm:w-fit"
    >
      {pending ? "Đang check-in..." : "Check-in"}
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

export function CheckinForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(submitEventCheckinAction, initialPublicCheckinActionState);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />

      {state.message ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </div>
      ) : null}

      <Field label="Email" name="email" type="email" required autoComplete="email" defaultValue={state.values?.email} />
      <Field label="Họ và tên" name="full_name" autoComplete="name" defaultValue={state.values?.full_name} />
      <Field label="Số điện thoại" name="phone" type="tel" autoComplete="tel" defaultValue={state.values?.phone} />
      <Field label="Mã số sinh viên" name="student_id" defaultValue={state.values?.student_id} />

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Ghi chú</span>
        <textarea
          name="notes"
          rows={3}
          defaultValue={state.values?.notes}
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2.5 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint sm:text-sm"
        />
      </label>

      <p className="text-xs text-slate-500">
        Nếu bạn chưa đăng ký trước, vui lòng nhập họ và tên để check-in walk-in.
      </p>

      <SubmitButton />
    </form>
  );
}
