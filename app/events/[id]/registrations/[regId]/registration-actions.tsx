"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormState } from "react-dom";
import {
  acceptRegistrationProofAction,
  cancelEventRegistrationAction,
  confirmEventRegistrationAction,
  confirmRegistrationPaymentAction,
  rejectEventRegistrationAction,
  rejectRegistrationPaymentAction,
  rejectRegistrationProofAction,
  updateRegistrationReviewNoteAction,
  waitlistEventRegistrationAction
} from "@/app/actions/event-registrations";
import { ConfirmActionDialog, InlineActionMessage, LoadingButton, useActionTiming } from "@/components/action-feedback";
import type { RegistrationOperationActionState } from "@/lib/event-action-types";
import type { EventRegistration } from "@/lib/types";
import { cn, formatDate } from "@/lib/utils";

const initialState: RegistrationOperationActionState = { ok: false, message: null };

type RegistrationOperation =
  | "confirm-registration"
  | "waitlist-registration"
  | "reject-registration"
  | "cancel-registration"
  | "confirm-payment"
  | "reject-payment"
  | "accept-proof"
  | "reject-proof";

const operationMeta: Record<RegistrationOperation, {
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  triggerLabel: string;
  tone?: "danger" | "primary" | "neutral";
}> = {
  "confirm-registration": {
    title: "Xác nhận đăng ký",
    description: "Xác nhận đăng ký sẽ giữ một chỗ trong sức chứa của sự kiện. Hệ thống sẽ kiểm tra lại số chỗ còn trống trước khi lưu.",
    confirmLabel: "Xác nhận đăng ký",
    pendingLabel: "Đang xác nhận...",
    triggerLabel: "Xác nhận đăng ký",
    tone: "primary"
  },
  "waitlist-registration": {
    title: "Chuyển vào danh sách chờ",
    description: "Chuyển người đăng ký vào danh sách chờ sẽ giải phóng chỗ đã xác nhận, nếu có. Hệ thống sẽ không tự động đôn người khác trong sprint này.",
    confirmLabel: "Chuyển vào waitlist",
    pendingLabel: "Đang chuyển...",
    triggerLabel: "Chuyển vào waitlist",
    tone: "neutral"
  },
  "reject-registration": {
    title: "Từ chối đăng ký",
    description: "Từ chối đăng ký sẽ chuyển hồ sơ sang trạng thái kết thúc. Dữ liệu đăng ký không bị xóa.",
    confirmLabel: "Từ chối đăng ký",
    pendingLabel: "Đang từ chối...",
    triggerLabel: "Từ chối đăng ký",
    tone: "danger"
  },
  "cancel-registration": {
    title: "Hủy đăng ký",
    description: "Hủy đăng ký sẽ giải phóng chỗ đã xác nhận, nếu có. Người trong danh sách chờ sẽ không được tự động đôn lên.",
    confirmLabel: "Hủy đăng ký",
    pendingLabel: "Đang hủy...",
    triggerLabel: "Hủy đăng ký",
    tone: "danger"
  },
  "confirm-payment": {
    title: "Xác nhận thanh toán",
    description: "Xác nhận thanh toán cho biết admin đã kiểm tra và chấp nhận thông tin thanh toán hiện có.",
    confirmLabel: "Xác nhận thanh toán",
    pendingLabel: "Đang xác nhận...",
    triggerLabel: "Xác nhận thanh toán",
    tone: "primary"
  },
  "reject-payment": {
    title: "Từ chối thanh toán",
    description: "Từ chối thanh toán yêu cầu ghi rõ lý do để core team có thể xử lý tiếp.",
    confirmLabel: "Từ chối thanh toán",
    pendingLabel: "Đang từ chối...",
    triggerLabel: "Từ chối thanh toán",
    tone: "danger"
  },
  "accept-proof": {
    title: "Chấp nhận minh chứng",
    description: "Chấp nhận minh chứng cho biết admin đã kiểm tra và đồng ý với minh chứng hiện có.",
    confirmLabel: "Chấp nhận minh chứng",
    pendingLabel: "Đang lưu...",
    triggerLabel: "Chấp nhận minh chứng",
    tone: "primary"
  },
  "reject-proof": {
    title: "Từ chối minh chứng",
    description: "Từ chối minh chứng yêu cầu ghi rõ lý do để core team có thể xử lý tiếp.",
    confirmLabel: "Từ chối minh chứng",
    pendingLabel: "Đang từ chối...",
    triggerLabel: "Từ chối minh chứng",
    tone: "danger"
  }
};

const actionByOperation = {
  "confirm-registration": confirmEventRegistrationAction,
  "waitlist-registration": waitlistEventRegistrationAction,
  "reject-registration": rejectEventRegistrationAction,
  "cancel-registration": cancelEventRegistrationAction,
  "confirm-payment": confirmRegistrationPaymentAction,
  "reject-payment": rejectRegistrationPaymentAction,
  "accept-proof": acceptRegistrationProofAction,
  "reject-proof": rejectRegistrationProofAction
};

function statusPill(value: string, tone: "green" | "amber" | "blue" | "red" | "slate" = "slate") {
  return (
    <span
      className={cn(
        "inline-block rounded px-2 py-0.5 text-xs font-medium",
        tone === "green" && "bg-green-100 text-green-800",
        tone === "amber" && "bg-amber-100 text-amber-800",
        tone === "blue" && "bg-blue-100 text-blue-800",
        tone === "red" && "bg-red-100 text-red-800",
        tone === "slate" && "bg-slate-100 text-slate-700"
      )}
    >
      {value}
    </span>
  );
}

function registrationStatusLabel(value: unknown) {
  const status = String(value ?? "");
  if (status === "registered") return "Đã đăng ký";
  if (status === "pending_review") return "Chờ duyệt";
  if (status === "confirmed") return "Đã xác nhận";
  if (status === "waitlisted") return "Danh sách chờ";
  if (status === "rejected") return "Đã từ chối";
  if (status === "cancelled") return "Đã hủy";
  return status || "-";
}

function paymentStatusLabel(value: unknown) {
  const status = String(value ?? "");
  if (status === "not_required") return "Không yêu cầu";
  if (status === "pending") return "Chờ nộp";
  if (status === "submitted") return "Đã nộp";
  if (status === "confirmed") return "Đã xác nhận thanh toán";
  if (status === "rejected") return "Đã từ chối";
  return status || "-";
}

function proofStatusLabel(value: unknown) {
  const status = String(value ?? "");
  if (status === "not_required") return "Không yêu cầu";
  if (status === "submitted") return "Đã nộp";
  if (status === "accepted") return "Đã chấp nhận";
  if (status === "rejected") return "Đã từ chối";
  return status || "-";
}

function attendanceStatusLabel(value: unknown) {
  const status = String(value ?? "");
  if (status === "pending") return "Chưa check-in";
  if (status === "checked_in") return "Đã check-in";
  if (status === "no_show") return "Không tham dự";
  if (status === "cancelled") return "Đã hủy";
  return status || "-";
}

function registrationTone(value: unknown) {
  const status = String(value ?? "");
  if (status === "confirmed") return "green" as const;
  if (status === "pending_review") return "amber" as const;
  if (status === "waitlisted") return "blue" as const;
  if (status === "rejected" || status === "cancelled") return "red" as const;
  return "slate" as const;
}

function reviewTone(value: unknown) {
  const status = String(value ?? "");
  if (status === "confirmed" || status === "accepted") return "green" as const;
  if (status === "submitted" || status === "pending") return "amber" as const;
  if (status === "rejected") return "red" as const;
  return "slate" as const;
}

function actionClass(tone: "danger" | "primary" | "neutral" = "neutral") {
  if (tone === "primary") return "rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90";
  if (tone === "danger") return "rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700";
  return "rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";
}

function HiddenIds({ eventId, registrationId }: { eventId: string; registrationId: string }) {
  return (
    <>
      <input type="hidden" name="event_id" value={eventId} />
      <input type="hidden" name="registration_id" value={registrationId} />
    </>
  );
}

function OperationForm({
  operation,
  eventId,
  registrationId,
  disabled,
  noteLabel,
  notePlaceholder,
  noteRequired = false
}: {
  operation: RegistrationOperation;
  eventId: string;
  registrationId: string;
  disabled?: boolean;
  noteLabel?: string;
  notePlaceholder?: string;
  noteRequired?: boolean;
}) {
  const meta = operationMeta[operation];
  const [state, formAction] = useFormState(actionByOperation[operation], initialState);
  const [note, setNote] = useState("");
  const timing = useActionTiming(`registration.${operation}`, state);
  const trimmedNote = note.trim();
  const reasonMissing = noteRequired && !trimmedNote;

  useEffect(() => {
    if (state.ok) setNote("");
  }, [state.ok]);

  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-2 rounded-md border border-vam-line bg-slate-50 p-3">
      <HiddenIds eventId={eventId} registrationId={registrationId} />
      {noteLabel ? (
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">{noteLabel}</span>
          <textarea
            name="note"
            required={noteRequired}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder={notePlaceholder}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
          />
          {noteRequired ? <span className="mt-1 block text-xs text-slate-500">Bắt buộc nhập lý do.</span> : null}
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ConfirmActionDialog
          triggerLabel={meta.triggerLabel}
          pendingLabel={meta.pendingLabel}
          title={meta.title}
          description={meta.description}
          confirmLabel={meta.confirmLabel}
          triggerClassName={actionClass(meta.tone)}
          confirmClassName={actionClass(meta.tone)}
          disabled={disabled || reasonMissing}
          warning={reasonMissing ? "Vui lòng nhập lý do trước khi tiếp tục." : null}
        />
      </div>
      <InlineActionMessage state={state} showSavedAt />
    </form>
  );
}

function ReviewNoteForm({ eventId, registrationId, initialNote }: { eventId: string; registrationId: string; initialNote: string }) {
  const [state, formAction] = useFormState(updateRegistrationReviewNoteAction, initialState);
  const [note, setNote] = useState(initialNote);
  const timing = useActionTiming("registration.review-note", state);

  useEffect(() => {
    if (state.ok) setNote((current) => current.trim());
  }, [state.ok]);

  return (
    <form action={formAction} onSubmit={timing.markSubmitStart} className="grid gap-2 rounded-md border border-vam-line bg-slate-50 p-3">
      <HiddenIds eventId={eventId} registrationId={registrationId} />
      <label className="block">
        <span className="text-xs font-medium uppercase text-slate-500">Ghi chú rà soát nội bộ</span>
        <textarea
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          placeholder="Ghi chú dành cho admin/core team. Không chỉnh sửa ghi chú người đăng ký đã gửi."
          className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
        />
      </label>
      <div>
        <LoadingButton pendingLabel="Đang lưu..." className="rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
          Lưu ghi chú nội bộ
        </LoadingButton>
      </div>
      <InlineActionMessage state={state} showSavedAt />
    </form>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-vam-line py-2 last:border-b-0">
      <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
      <span className="text-sm text-vam-ink">{value}</span>
    </div>
  );
}

export function RegistrationActionsPanel({
  eventId,
  registration
}: {
  eventId: string;
  registration: EventRegistration;
}) {
  const registrationId = registration.id;
  const registrationStatus = String(registration.registration_status ?? "");
  const paymentStatus = String(registration.payment_status ?? "not_required");
  const proofStatus = String(registration.proof_status ?? "not_required");

  const registrationActions = useMemo(() => ({
    canConfirm: ["registered", "pending_review", "waitlisted"].includes(registrationStatus),
    canWaitlist: ["registered", "pending_review", "confirmed"].includes(registrationStatus),
    canReject: ["registered", "pending_review", "confirmed", "waitlisted"].includes(registrationStatus),
    canCancel: ["registered", "pending_review", "confirmed", "waitlisted"].includes(registrationStatus)
  }), [registrationStatus]);

  const paymentActions = useMemo(() => ({
    canConfirm: ["pending", "submitted", "rejected"].includes(paymentStatus),
    canReject: ["pending", "submitted", "confirmed"].includes(paymentStatus)
  }), [paymentStatus]);

  const proofActions = useMemo(() => ({
    canAccept: ["submitted", "accepted", "rejected"].includes(proofStatus),
    canReject: ["submitted", "accepted", "rejected"].includes(proofStatus)
  }), [proofStatus]);

  const terminal = registrationStatus === "rejected" || registrationStatus === "cancelled";

  return (
    <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-vam-ink">Admin actions</h2>
        <p className="mt-1 text-sm text-slate-500">
          Thao tác một đăng ký. Không gửi email, không đổi trạng thái check-in, không tự động đôn waitlist.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3">
          <div className="rounded-md border border-vam-line p-3">
            <h3 className="text-sm font-semibold text-vam-ink">1. Trạng thái đăng ký</h3>
            <div className="mt-2">
              <InfoRow label="Hiện tại" value={statusPill(registrationStatusLabel(registrationStatus), registrationTone(registrationStatus))} />
              <InfoRow label="Xác nhận lúc" value={registration.confirmed_at ? formatDate(registration.confirmed_at) : "-"} />
              <InfoRow label="Waitlist lúc" value={registration.waitlisted_at ? formatDate(registration.waitlisted_at) : "-"} />
            </div>
            {terminal ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Đăng ký đã ở trạng thái kết thúc. Sprint này không hỗ trợ khôi phục rejected/cancelled.
              </div>
            ) : null}
            <div className="mt-3 grid gap-2">
              <OperationForm operation="confirm-registration" eventId={eventId} registrationId={registrationId} disabled={!registrationActions.canConfirm} />
              <OperationForm operation="waitlist-registration" eventId={eventId} registrationId={registrationId} disabled={!registrationActions.canWaitlist} />
              <OperationForm
                operation="reject-registration"
                eventId={eventId}
                registrationId={registrationId}
                disabled={!registrationActions.canReject}
                noteRequired
                noteLabel="Lý do từ chối đăng ký"
                notePlaceholder="Nhập lý do từ chối để core team theo dõi."
              />
              <OperationForm
                operation="cancel-registration"
                eventId={eventId}
                registrationId={registrationId}
                disabled={!registrationActions.canCancel}
                noteRequired
                noteLabel="Lý do hủy đăng ký"
                notePlaceholder="Nhập lý do hủy đăng ký."
              />
            </div>
          </div>

          <div className="rounded-md border border-vam-line p-3">
            <h3 className="text-sm font-semibold text-vam-ink">2. Thanh toán</h3>
            <div className="mt-2">
              <InfoRow label="Hiện tại" value={statusPill(paymentStatusLabel(paymentStatus), reviewTone(paymentStatus))} />
              <InfoRow label="Xác nhận lúc" value={registration.payment_confirmed_at ? formatDate(registration.payment_confirmed_at) : "-"} />
              <InfoRow label="Từ chối lúc" value={registration.payment_rejected_at ? formatDate(registration.payment_rejected_at) : "-"} />
            </div>
            <div className="mt-3 grid gap-2">
              <OperationForm operation="confirm-payment" eventId={eventId} registrationId={registrationId} disabled={!paymentActions.canConfirm} />
              <OperationForm
                operation="reject-payment"
                eventId={eventId}
                registrationId={registrationId}
                disabled={!paymentActions.canReject}
                noteRequired
                noteLabel="Lý do từ chối thanh toán"
                notePlaceholder="Nhập lý do để core team xử lý tiếp."
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-md border border-vam-line p-3">
            <h3 className="text-sm font-semibold text-vam-ink">3. Minh chứng</h3>
            <div className="mt-2">
              <InfoRow label="Hiện tại" value={statusPill(proofStatusLabel(proofStatus), reviewTone(proofStatus))} />
              <InfoRow label="Rà soát lúc" value={registration.proof_reviewed_at ? formatDate(registration.proof_reviewed_at) : "-"} />
            </div>
            <div className="mt-3 grid gap-2">
              <OperationForm operation="accept-proof" eventId={eventId} registrationId={registrationId} disabled={!proofActions.canAccept} />
              <OperationForm
                operation="reject-proof"
                eventId={eventId}
                registrationId={registrationId}
                disabled={!proofActions.canReject}
                noteRequired
                noteLabel="Ghi chú từ chối minh chứng"
                notePlaceholder="Nhập lý do từ chối minh chứng."
              />
            </div>
          </div>

          <div className="rounded-md border border-vam-line p-3">
            <h3 className="text-sm font-semibold text-vam-ink">4. Ghi chú rà soát nội bộ</h3>
            <p className="mt-1 text-xs text-slate-500">Trường này lưu vào review_note, tách biệt với ghi chú người đăng ký đã gửi.</p>
            <div className="mt-3">
              <ReviewNoteForm eventId={eventId} registrationId={registrationId} initialNote={registration.review_note ?? ""} />
            </div>
          </div>

          <div className="rounded-md border border-vam-line p-3">
            <h3 className="text-sm font-semibold text-vam-ink">5. Check-in / attendance</h3>
            <div className="mt-2">
              <InfoRow label="Trạng thái" value={attendanceStatusLabel(registration.attendance_status)} />
              <InfoRow label="Check-in lúc" value={registration.checked_in_at ? formatDate(registration.checked_in_at) : "-"} />
              <InfoRow label="Nguồn check-in" value={registration.checkin_source ?? "-"} />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Các thao tác đăng ký, thanh toán và minh chứng ở trên không tự động thay đổi attendance_status.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}