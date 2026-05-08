"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createRegistrationLinkAction } from "@/app/actions/events";

const initialState = { ok: false, message: null as string | null };

function CreateLinkButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-60"
    >
      {pending ? "Đang tạo..." : "Tạo link đăng ký"}
    </button>
  );
}

export function RegistrationLinkPanel({
  eventId,
  registrationUrl,
  canCreate
}: {
  eventId: string;
  registrationUrl: string | null;
  canCreate: boolean;
}) {
  const [state, formAction] = useFormState(createRegistrationLinkAction, initialState);
  const [copied, setCopied] = useState(false);
  const displayUrl = useMemo(() => registrationUrl ?? "", [registrationUrl]);

  async function copyUrl() {
    if (!displayUrl) return;
    await navigator.clipboard.writeText(displayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (registrationUrl) {
    return (
      <div className="grid gap-3">
        <div className="break-all rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {registrationUrl}
        </div>
        <button
          type="button"
          onClick={copyUrl}
          className="inline-flex w-fit rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
        >
          {copied ? "Đã sao chép" : "Sao chép link"}
        </button>
      </div>
    );
  }

  if (!canCreate) {
    return <p className="text-sm text-slate-500">Bạn có thể xem sự kiện này nhưng không có quyền tạo link đăng ký.</p>;
  }

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <CreateLinkButton />
      {state.message ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{state.message}</p>
      ) : null}
    </form>
  );
}
