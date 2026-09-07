"use client";

import { useFormStatus } from "react-dom";

/**
 * The few pieces every MKT screen repeats.
 *
 * Kept in one client module so a button that says "Đang lưu…" says it the same
 * way on all four tabs, and so each page file stays about its own subject.
 */

export function SubmitButton({
  label,
  pendingLabel,
  tone = "primary",
  confirm
}: {
  label: string;
  pendingLabel: string;
  tone?: "primary" | "quiet" | "danger";
  confirm?: string;
}) {
  const { pending } = useFormStatus();

  const className =
    tone === "primary"
      ? "rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      : tone === "danger"
        ? "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-60"
        : "rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-vam-ink disabled:opacity-60";

  return (
    <button
      type="submit"
      disabled={pending}
      className={className}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function Feedback({ state }: { state: { ok: boolean; message: string | null } }) {
  if (!state.message) return null;

  return (
    <p
      role="status"
      className={`rounded-md border px-3 py-2 text-sm ${
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      {state.message}
    </p>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-vam-ink">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-vam-muted">{hint}</span> : null}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-vam-line px-3 py-2 text-sm";
