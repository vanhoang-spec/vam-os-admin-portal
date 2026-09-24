"use client";

import { useFormState, useFormStatus } from "react-dom";
import { keepFormValues } from "@/lib/keep-form-values";
import { INITIAL_SURVEY_FORM_STATE } from "@/lib/event-survey-action-types";
import {
  MAX_ANSWER,
  MAX_NAME,
  MAX_PHONE,
  MAX_STUDENT_ID,
  QUESTION_PROMPT,
  SUBMITTED_CHECKED_OUT,
  SUBMITTED_HEADING,
  SUBMITTED_NO_CHECKIN,
  SUBMITTED_UNMATCHED
} from "@/lib/event-survey-core";
import { submitEventSurveyAction } from "./actions";

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2.5 text-base text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint sm:text-sm";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-vam-green px-4 py-3 text-base font-semibold text-white hover:bg-vam-green/90 disabled:opacity-60 sm:w-fit sm:text-sm"
    >
      {pending ? "Đang gửi..." : "Gửi phiếu & check out"}
    </button>
  );
}

/**
 * Phiếu khảo sát cuối buổi.
 *
 * ---------------------------------------------------------------------------
 * NÚT GỬI NÓI RÕ NÓ LÀM GÌ
 * ---------------------------------------------------------------------------
 * "Gửi phiếu & check out" chứ không phải "Gửi": với người điền, đây không phải
 * một khảo sát tuỳ tâm — nó là thao tác kết thúc buổi, và là căn cứ để ban tổ
 * chức đề xuất điểm rèn luyện. Một cái nút ghi "Gửi" thì người đọc lướt sẽ bỏ
 * qua và mất phần đó mà không biết.
 */
export function SurveyForm({
  token,
  source,
  impressionQuestion
}: {
  token: string;
  /** Giá trị `?tu=` trên đường dẫn: phiếu tới từ thư hay từ mã QR. */
  source: string;
  impressionQuestion: string;
}) {
  const [state, formAction] = useFormState(submitEventSurveyAction, INITIAL_SURVEY_FORM_STATE);

  if (state.status === "success") {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-green-900">
        <h2 className="text-lg font-semibold">{SUBMITTED_HEADING}</h2>
        <p className="mt-2 text-sm">
          {state.matched
            ? state.checkedIn
              ? SUBMITTED_CHECKED_OUT
              : SUBMITTED_NO_CHECKIN
            : SUBMITTED_UNMATCHED}
        </p>
        <p className="mt-3 text-sm">Cảm ơn bạn. Bạn có thể đóng trang này.</p>
      </div>
    );
  }

  const failed = state.status !== "idle";

  return (
    <form onReset={keepFormValues} action={formAction} className="grid gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="source" value={source} />

      {failed ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {state.message}
        </p>
      ) : null}

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Họ và tên *</span>
        <input
          name="full_name"
          required
          maxLength={MAX_NAME}
          autoComplete="name"
          defaultValue={state.values.full_name}
          className={INPUT_CLASS}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Email *</span>
        <input
          name="email"
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          defaultValue={state.values.email}
          className={INPUT_CLASS}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Điền đúng email bạn đã dùng khi đăng ký sự kiện, để ban tổ chức đối chiếu được với lượt check in.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">Số điện thoại *</span>
        <input
          name="phone"
          type="tel"
          required
          inputMode="tel"
          maxLength={MAX_PHONE}
          autoComplete="tel"
          defaultValue={state.values.phone}
          className={INPUT_CLASS}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">MSSV</span>
        <input
          name="student_id"
          maxLength={MAX_STUDENT_ID}
          defaultValue={state.values.student_id}
          className={INPUT_CLASS}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Không bắt buộc, nhưng có MSSV thì hồ sơ đề xuất điểm rèn luyện của bạn nhanh hơn.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">1. {impressionQuestion} *</span>
        <textarea
          name="impression"
          required
          rows={4}
          maxLength={MAX_ANSWER}
          defaultValue={state.values.impression}
          className={INPUT_CLASS}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-slate-700">2. {QUESTION_PROMPT}</span>
        <textarea
          name="question"
          rows={4}
          maxLength={MAX_ANSWER}
          defaultValue={state.values.question}
          className={INPUT_CLASS}
        />
        <span className="mt-1 block text-xs text-slate-500">
          Không bắt buộc. Ban tổ chức sẽ tổng hợp và giải đáp sau buổi.
        </span>
      </label>

      <SubmitButton />
    </form>
  );
}
