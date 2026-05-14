"use client";

import { useFormState, useFormStatus } from "react-dom";
import { initialPublicCheckinActionState } from "@/lib/event-action-types";
import type { CheckinActionStatus } from "@/lib/event-action-types";
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

/**
 * Phase 2A: Status-aware message banner.
 *
 * - Informational (amber)  — registration state issues the user can act on:
 *   not_registered, pending_approval, registration_waitlisted,
 *   registration_cancelled_status, not_confirmed
 * - Time/policy (blue)     — window or mode blocks:
 *   checkin_not_open, checkin_closed, self_checkin_disabled, walk_in_blocked,
 *   event_full
 * - Error (red)            — validation or server errors:
 *   validation_error, server_error, link_error
 */
function statusBannerStyle(status: CheckinActionStatus): {
  container: string;
  icon: string;
} {
  switch (status) {
    // ── Informational: registration state ──────────────────────────────────
    case "not_registered":
    case "pending_approval":
    case "registration_waitlisted":
    case "registration_cancelled_status":
    case "not_confirmed":
    case "registration_rejected":
      return {
        container: "rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800",
        icon: "⚠️"
      };

    // ── Policy / time-gate ──────────────────────────────────────────────────
    case "checkin_not_open":
    case "checkin_closed":
    case "self_checkin_disabled":
    case "walk_in_blocked":
    case "event_full":
      return {
        container: "rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-800",
        icon: "ℹ️"
      };

    // ── Errors ──────────────────────────────────────────────────────────────
    default:
      return {
        container: "rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700",
        icon: "❌"
      };
  }
}

/**
 * Whether the current status requires the form to still be shown for
 * correction (validation/server errors only). For all Phase 2 status errors
 * the user cannot fix their input to resolve — show message only.
 */
function shouldShowForm(status: CheckinActionStatus): boolean {
  return (
    status === "idle" ||
    status === "validation_error" ||
    status === "server_error"
  );
}

/**
 * Whether to show the walk-in hint. Hide it for statuses / modes where
 * walk-in is explicitly blocked, to avoid confusing guidance.
 * (We infer from the returned status; the form doesn't receive event config directly.)
 */
function shouldShowWalkinHint(status: CheckinActionStatus): boolean {
  const blockingStatuses: CheckinActionStatus[] = [
    "walk_in_blocked",
    "self_checkin_disabled",
    "not_registered",
    "pending_approval",
    "not_confirmed",
    "registration_rejected",
    "registration_waitlisted",
    "registration_cancelled_status",
    "checkin_not_open",
    "checkin_closed",
    "event_full"
  ];
  return !blockingStatuses.includes(status);
}

export function CheckinForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(submitEventCheckinAction, initialPublicCheckinActionState);

  const showForm = shouldShowForm(state.status);
  const showHint = shouldShowWalkinHint(state.status);

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />

      {/* Status-aware message banner */}
      {state.message && state.status !== "idle" ? (() => {
        const style = statusBannerStyle(state.status);
        return (
          <div className={style.container} role="alert">
            <span className="mr-1">{style.icon}</span>
            {state.message}
          </div>
        );
      })() : null}

      {showForm ? (
        <>
          {showHint ? (
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <p>Nếu bạn đã đăng ký trước, chỉ cần nhập email.</p>
              <p className="mt-1">Nếu bạn chưa đăng ký trước, vui lòng nhập thêm họ và tên để check-in walk-in.</p>
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

          <SubmitButton />
        </>
      ) : null}
    </form>
  );
}
