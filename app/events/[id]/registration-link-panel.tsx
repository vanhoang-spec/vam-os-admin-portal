"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createCheckinLinkAction, createRegistrationLinkAction } from "@/app/actions/events";

const initialState = { ok: false, message: null as string | null };

function CreateLinkButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90 disabled:opacity-60"
    >
      {pending ? "Đang tạo..." : label}
    </button>
  );
}

function PublicLinkPanel({
  eventId,
  url,
  canCreate,
  action,
  createLabel,
  noPermissionMessage,
  copyLabel,
  helperText,
  qrDataUrl = null
}: {
  eventId: string;
  url: string | null;
  canCreate: boolean;
  action: typeof createRegistrationLinkAction;
  createLabel: string;
  noPermissionMessage: string;
  copyLabel: string;
  helperText: string;
  qrDataUrl?: string | null;
}) {
  const [state, formAction] = useFormState(action, initialState);
  const [copied, setCopied] = useState(false);
  const displayUrl = useMemo(() => url ?? "", [url]);

  async function copyUrl() {
    if (!displayUrl) return;
    await navigator.clipboard.writeText(displayUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  if (url) {
    return (
      <div className="grid gap-3">
        {qrDataUrl ? (
          <div className="flex justify-center rounded-md border border-vam-line bg-white p-3">
            <Image src={qrDataUrl} alt="QR check-in" width={176} height={176} unoptimized />
          </div>
        ) : null}
        <p className="text-xs text-slate-500">{helperText}</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            readOnly
            value={url}
            className="w-full rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm text-slate-700"
            aria-label={copyLabel}
          />
          <button
            type="button"
            onClick={copyUrl}
            className="inline-flex w-full items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint sm:w-fit"
          >
            {copied ? "Đã sao chép" : copyLabel}
          </button>
        </div>
      </div>
    );
  }

  if (!canCreate) {
    return <p className="text-sm text-slate-500">{noPermissionMessage}</p>;
  }

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="event_id" value={eventId} />
      <CreateLinkButton label={createLabel} />
      {state.message ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{state.message}</p>
      ) : null}
    </form>
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
  return (
    <PublicLinkPanel
      eventId={eventId}
      url={registrationUrl}
      canCreate={canCreate}
      action={createRegistrationLinkAction}
      createLabel="Tạo link đăng ký"
      noPermissionMessage="Bạn có thể xem sự kiện này nhưng không có quyền tạo link đăng ký."
      copyLabel="Sao chép link đăng ký"
      helperText="Dùng link này để người tham dự đăng ký trước sự kiện."
    />
  );
}

export function CheckinLinkPanel({
  eventId,
  checkinUrl,
  canCreate,
  qrDataUrl
}: {
  eventId: string;
  checkinUrl: string | null;
  canCreate: boolean;
  qrDataUrl: string | null;
}) {
  return (
    <PublicLinkPanel
      eventId={eventId}
      url={checkinUrl}
      canCreate={canCreate}
      action={createCheckinLinkAction}
      createLabel="Tạo link check-in"
      noPermissionMessage="Bạn có thể xem sự kiện này nhưng không có quyền tạo link check-in."
      copyLabel="Sao chép link check-in"
      helperText="Dùng QR hoặc link này để người tham dự check-in tại sự kiện."
      qrDataUrl={qrDataUrl}
    />
  );
}
