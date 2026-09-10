"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { initialPublicRegistrationActionState } from "@/lib/event-action-types";
import { submitEventRegistrationAction } from "./actions";
import type { SessionOption } from "@/lib/events";
import { formatDateTime, formatTime } from "@/lib/utils";

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

export function RegistrationForm({
  token,
  eventName,
  event,
  sessions = null
}: {
  token: string;
  eventName: string;
  event: Event;
  /**
   * Các buổi để chọn, khi link nhận đăng ký cho cả chuỗi.
   *
   * Null với link thường — và khi đó form không hỏi gì về buổi, vì buổi đã do
   * chính link quyết định.
   */
  sessions?: SessionOption[] | null;
}) {
  const [state, formAction] = useFormState(submitEventRegistrationAction, initialPublicRegistrationActionState);
  const [mealSelected, setMealSelected] = useState(false);
  const displayEventName = state.eventName || eventName;

  // Buổi còn chỗ đầu tiên được chọn sẵn — không phải buổi đầu tiên.
  //
  // Chọn sẵn một buổi đã đầy nghĩa là người bấm "Gửi đăng ký" ngay lập tức sẽ
  // rơi vào danh sách chờ mà không hề chọn điều đó. BTC cũng khuyến khích buổi
  // 1, nên "buổi còn chỗ sớm nhất" khớp luôn với ý định của họ.
  const firstOpen = sessions?.find((session) => !session.full) ?? sessions?.[0] ?? null;
  const [chosenSession, setChosenSession] = useState(firstOpen?.id ?? "");

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

      {sessions && sessions.length ? (
        <fieldset className="rounded-md border border-vam-line bg-slate-50 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">
            Bạn đăng ký tham dự buổi nào?
          </legend>
          <p className="mb-2 text-xs text-slate-500">
            Mỗi người chỉ đăng ký một buổi. Nội dung hai buổi giống nhau, chỉ khác ngày.
          </p>
          <div className="flex flex-col gap-2">
            {sessions.map((session, index) => {
              const label = `Buổi ${session.seriesIndex ?? index + 1}`;
              const when = session.endsAt
                ? `${formatDateTime(session.startsAt)} – ${formatTime(session.endsAt)}`
                : formatDateTime(session.startsAt);
              // Buổi đầy mà KHÔNG có danh sách chờ thì không chọn được: hiện nó
              // ra để người ta biết buổi đó tồn tại và đã hết chỗ, thay vì thấy
              // một danh sách tự nhiên thiếu mất một dòng.
              const disabled = session.full && !session.waitlistEnabled;
              return (
                <label
                  key={session.id}
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                    disabled
                      ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                      : "cursor-pointer border-vam-line bg-white text-slate-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="session_event_id"
                    value={session.id}
                    checked={chosenSession === session.id}
                    disabled={disabled}
                    onChange={() => setChosenSession(session.id)}
                    className="mt-0.5 h-4 w-4 border-slate-300 text-vam-green focus:ring-vam-green"
                  />
                  <span>
                    <span className="block font-medium">
                      {label} — {when}
                    </span>
                    <span className="block text-xs">
                      {session.full
                        ? session.waitlistEnabled
                          ? "Đã đủ chỗ — đăng ký buổi này sẽ vào danh sách chờ"
                          : "Đã đủ chỗ"
                        : session.seatsLeft === null
                          ? "Còn nhận đăng ký"
                          : `Còn ${session.seatsLeft} chỗ`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
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
      {event.show_school_field !== false && (
        <Field label="Trường" name="school" autoComplete="organization" defaultValue={state.values?.school} />
      )}
      {event.show_program_field !== false && (
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

      {/* Phase 2B: optional meal / lunch add-on */}
      {event.meal_option_enabled && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={mealSelected}
              onChange={(e) => setMealSelected(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green shrink-0"
            />
            <div>
              <span className="text-sm font-medium text-slate-800">
                {event.meal_label || "Đăng ký bữa trưa"}
                {event.meal_fee_amount ? (
                  <> &mdash; {new Intl.NumberFormat("vi-VN").format(event.meal_fee_amount)}&nbsp;{event.meal_fee_currency || "VND"}</>
                ) : null}
              </span>
            </div>
          </label>
        </div>
      )}
      {/* Hidden input carries meal_selected regardless of whether event has meal option */}
      <input type="hidden" name="meal_selected" value={mealSelected ? "true" : "false"} />

      {/* Payment section: shown when event fee applies OR meal is selected */}
      {(event.fee_required || event.payment_proof_required || (mealSelected && event.meal_option_enabled)) && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-sm font-medium text-slate-800">Thông tin thanh toán</p>
          {event.fee_amount && (
            <p className="mb-1 text-sm">
              <span className="font-medium">Phí sự kiện:</span>{" "}
              {new Intl.NumberFormat("vi-VN").format(event.fee_amount)}&nbsp;{event.fee_currency || "VND"}
            </p>
          )}
          {mealSelected && event.meal_fee_amount && (
            <p className="mb-1 text-sm">
              <span className="font-medium">Phí bữa trưa:</span>{" "}
              {new Intl.NumberFormat("vi-VN").format(event.meal_fee_amount)}&nbsp;{event.meal_fee_currency || "VND"}
            </p>
          )}
          {event.fee_description && <p className="mb-2 text-sm text-slate-600">{event.fee_description}</p>}
          {event.payment_instruction && (
            <div className="mb-3 rounded bg-white p-3 text-sm whitespace-pre-wrap border border-slate-200">
              {event.payment_instruction}
            </div>
          )}
          {mealSelected && event.meal_payment_instruction && (
            <div className="mb-3 rounded bg-white p-3 text-sm whitespace-pre-wrap border border-slate-200">
              <p className="mb-1 font-medium text-slate-700">Thanh toán bữa trưa:</p>
              {event.meal_payment_instruction}
            </div>
          )}
          {(event.payment_proof_required || (mealSelected && event.meal_option_enabled && event.meal_payment_proof_required !== false)) && (
            <>
              <div className="rounded bg-slate-100 p-3 text-xs text-slate-700 leading-relaxed">
                <p className="font-semibold mb-1">📸 Cách lấy link ảnh biên lai:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Chụp màn hình biên lai chuyển khoản.</li>
                  <li>Tải ảnh lên <strong>Google Drive</strong> hoặc <strong>Google Photos</strong>.</li>
                  <li>Nhấn chuột phải → <em>Lấy liên kết / Get link</em> → chọn <strong>Bất kỳ ai có đường link</strong>.</li>
                  <li>Dán link vào ô bên dưới.</li>
                </ol>
                <p className="mt-1 text-slate-500">Nếu không có Google Drive, bạn có thể dùng <strong>Imgur</strong> (imgur.com) hoặc gửi ảnh qua Zalo cho ban tổ chức và ghi chú tên + SĐT vào ô ghi chú.</p>
              </div>
              <Field label="Link ảnh biên lai chuyển khoản *" name="payment_proof_url" required />
              <div className="mt-3">
                <Field label="Ghi chú thanh toán (tuỳ chọn — ví dụ: tên người chuyển, thời gian)" name="payment_proof_note" />
              </div>
            </>
          )}
        </div>
      )}

      {event.show_notes_field !== false && (
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
