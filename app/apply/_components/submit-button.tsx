"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself while the server action is running.
 * Prevents double-submit per requirement.
 */
export function ApplySubmitButton({
  idleLabel,
  pendingLabel = "Đang gửi..."
}: {
  idleLabel: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-vam-green px-5 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
