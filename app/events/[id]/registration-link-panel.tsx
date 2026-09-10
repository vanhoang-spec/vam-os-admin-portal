"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { useFormState } from "react-dom";
import { createCheckinLinkAction, createRegistrationLinkAction, toggleRegistrationLinkAction } from "@/app/actions/events";
import { ConfirmActionDialog, InlineActionMessage, LoadingButton, useActionTiming } from "@/components/action-feedback";

const initialState = { ok: false, message: null as string | null };

function CreateLinkButton({ label }: { label: string }) {
  return (
    <LoadingButton pendingLabel="Đang tạo..." className="w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
      {label}
    </LoadingButton>
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
  qrDataUrl = null,
  seriesTotal = null
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
  /** Tong so buoi cua chuoi, null neu buoi nay dung mot minh. */
  seriesTotal?: number | null;
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
      {/*
        Chỉ hiện với buổi thuộc một chuỗi. Một buổi đơn lẻ không có chuỗi để
        nhận thay, và một ô tick không làm được gì là một ô tick sẽ bị bấm.
      */}
      {seriesTotal && seriesTotal > 1 ? (
        <label className="flex items-start gap-2 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="covers_series"
            value="true"
            defaultChecked
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green"
          />
          <span>
            <span className="block font-medium">
              Một link cho cả {seriesTotal} buổi
            </span>
            <span className="block text-xs text-slate-500">
              Người đăng ký chọn buổi ngay trên form, và mỗi người chỉ giữ được một chỗ trong
              cả chuỗi. Bỏ tick nếu muốn link này chỉ nhận đăng ký cho đúng buổi đang mở.
            </span>
          </span>
        </label>
      ) : null}
      <CreateLinkButton label={createLabel} />
      {state.message ? (
        <p className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{state.message}</p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Toggle button for the registration link is_active flag
// ---------------------------------------------------------------------------

function ToggleRegLinkButton({ isCurrentlyActive, capacityWarning }: { isCurrentlyActive: boolean; capacityWarning?: string | null }) {
  const triggerClassName = isCurrentlyActive
    ? "w-fit rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
    : "w-fit rounded-md border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100";

  return (
    <ConfirmActionDialog
      triggerLabel={isCurrentlyActive ? "Đóng đăng ký" : "Mở lại đăng ký"}
      pendingLabel={isCurrentlyActive ? "Đang đóng đăng ký..." : "Đang mở đăng ký..."}
      title={isCurrentlyActive ? "Đóng đăng ký công khai?" : "Mở lại đăng ký công khai?"}
      description={
        isCurrentlyActive
          ? "Đóng đăng ký sẽ ngăn tất cả đăng ký công khai mới. Các đăng ký hiện có không bị xóa."
          : "Mở lại đăng ký sẽ cho phép người dùng có link công khai gửi đăng ký mới cho sự kiện này."
      }
      warning={!isCurrentlyActive ? capacityWarning : null}
      confirmLabel={isCurrentlyActive ? "Đóng đăng ký" : "Mở lại đăng ký"}
      triggerClassName={triggerClassName}
      confirmClassName={isCurrentlyActive ? "bg-red-600 text-white hover:bg-red-700" : "bg-vam-green text-white hover:bg-vam-green/90"}
    />
  );
}

export function RegistrationLinkPanel({
  eventId,
  registrationUrl,
  registrationLinkIsActive,
  canCreate,
  capacityWarning = null,
  seriesTotal = null
}: {
  eventId: string;
  registrationUrl: string | null;
  /** is_active value from the event_links row; null when no link exists yet */
  registrationLinkIsActive: boolean | null;
  canCreate: boolean;
  capacityWarning?: string | null;
  /** Tong so buoi cua chuoi, null neu buoi nay dung mot minh. */
  seriesTotal?: number | null;
}) {
  const [toggleState, toggleAction] = useFormState(toggleRegistrationLinkAction, initialState);
  // null means no link yet -> treat as open for status label
  const isActive = registrationLinkIsActive !== false;
  const timing = useActionTiming(isActive ? "event.registration.close" : "event.registration.reopen", toggleState);

  return (
    <div className="grid gap-3">
      <PublicLinkPanel
        eventId={eventId}
        url={registrationUrl}
        canCreate={canCreate}
        action={createRegistrationLinkAction}
        createLabel="Tạo link đăng ký"
        noPermissionMessage="Bạn có thể xem sự kiện này nhưng không có quyền tạo link đăng ký."
        copyLabel="Sao chép link đăng ký"
        helperText="Dùng link này để người tham dự đăng ký trước sự kiện."
        seriesTotal={seriesTotal}
      />

      {/* Admin toggle: only shown when a link exists and admin has create/edit permission */}
      {registrationUrl && canCreate ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-vam-line bg-slate-50 px-3 py-2">
          <span className={isActive ? "text-xs font-medium text-green-700" : "text-xs font-medium text-red-700"}>
            {isActive ? "✅ Đăng ký đang mở" : "🔒 Đăng ký đã đóng"}
          </span>
          <form action={toggleAction} onSubmit={timing.markSubmitStart}>
            <input type="hidden" name="event_id" value={eventId} />
            {/* Pass the desired NEW state (opposite of current) */}
            <input type="hidden" name="is_active" value={isActive ? "false" : "true"} />
            <ToggleRegLinkButton isCurrentlyActive={isActive} capacityWarning={capacityWarning} />
          </form>
          <InlineActionMessage state={toggleState} errorFallback="Không thể cập nhật trạng thái đăng ký. Vui lòng thử lại." className="py-1 text-xs" />
        </div>
      ) : null}
    </div>
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
