"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { SubmitButton } from "@/components/submit-button";
import { submitMentorConfirmationAction } from "./actions";
import {
  initialPublicConfirmationActionState,
  type PublicConfirmationActionState
} from "@/lib/mentor-confirmation-action-types";

/**
 * The mentor-facing form. Two questions decide everything downstream:
 * whether the mentor continues, and how many mentees they accept.
 *
 * The capacity control only appears once "tiếp tục" is chosen, so a mentor who
 * is leaving is never asked for a number they do not have.
 */
export function ConfirmForm({
  token,
  updatedAt,
  initialStatus,
  initialMaxMentees,
  initialAgreeToReview,
  initialAgreeToInterview,
  initialNote,
  alreadyAnswered
}: {
  token: string;
  updatedAt: string | null;
  initialStatus: string;
  initialMaxMentees: number | null;
  initialAgreeToReview: boolean | null;
  initialAgreeToInterview: boolean | null;
  initialNote: string | null;
  alreadyAnswered: boolean;
}) {
  const [state, formAction] = useFormState<PublicConfirmationActionState, FormData>(
    submitMentorConfirmationAction,
    initialPublicConfirmationActionState
  );

  const [decision, setDecision] = useState<string>(
    initialStatus === "confirmed" || initialStatus === "declined" ? initialStatus : ""
  );

  if (state.ok) {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-200 bg-green-50 p-5 text-green-800"
      >
        <h2 className="text-lg font-semibold">Đã ghi nhận</h2>
        <p className="mt-2 text-sm leading-6">{state.message}</p>
        <p className="mt-2 text-sm leading-6">
          Ban tổ chức sẽ liên hệ với anh/chị về các bước tiếp theo. Anh/chị có thể đóng trang này.
        </p>
      </div>
    );
  }

  // The link stopped being usable while the page was open (expired, or an
  // operator recorded the answer). Tell the mentor plainly instead of leaving a
  // form that can no longer be submitted.
  if (state.state === "expired" || state.state === "locked" || state.state === "not_found") {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
        <h2 className="text-lg font-semibold">Không thể ghi nhận</h2>
        <p className="mt-2 text-sm leading-6">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-5">
      <input type="hidden" name="token" value={token} />
      {/* Concurrency guard: refuses the write if somebody answered in the meantime. */}
      <input type="hidden" name="updated_at" value={updatedAt ?? ""} />

      {alreadyAnswered ? (
        <p className="rounded-md border border-vam-line bg-vam-mint px-3 py-2 text-sm text-vam-ink">
          Anh/chị đã trả lời trước đó. Gửi lại biểu mẫu sẽ cập nhật thông tin mới nhất.
        </p>
      ) : null}

      {state.message && !state.ok ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {state.message}
        </p>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium text-vam-ink">
          Anh/chị có tiếp tục đồng hành cùng chương trình mùa này không?{" "}
          <span className="text-red-600">*</span>
        </legend>

        <label className="flex items-start gap-3 rounded-md border border-vam-line bg-white px-3 py-3 text-sm">
          <input
            type="radio"
            name="decision"
            value="confirmed"
            required
            checked={decision === "confirmed"}
            onChange={() => setDecision("confirmed")}
            className="mt-0.5 h-4 w-4 text-vam-green focus:ring-vam-mint"
          />
          <span>
            <span className="font-medium text-vam-ink">Có, tôi tiếp tục tham gia</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Anh/chị sẽ được ghép cặp với mentee của mùa này.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-md border border-vam-line bg-white px-3 py-3 text-sm">
          <input
            type="radio"
            name="decision"
            value="declined"
            checked={decision === "declined"}
            onChange={() => setDecision("declined")}
            className="mt-0.5 h-4 w-4 text-vam-green focus:ring-vam-mint"
          />
          <span>
            <span className="font-medium text-vam-ink">Chưa, tôi tạm dừng mùa này</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Ban tổ chức sẽ giữ liên lạc và mời anh/chị ở mùa sau.
            </span>
          </span>
        </label>
      </fieldset>

      {decision === "confirmed" ? (
        <>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-vam-ink">
              Số mentee tối đa anh/chị có thể nhận mùa này <span className="text-red-600">*</span>
            </span>
            <select
              name="max_mentees"
              required
              defaultValue={initialMaxMentees ? String(initialMaxMentees) : "1"}
              className="h-11 rounded-md border border-vam-line bg-white px-3 text-sm text-vam-ink outline-none focus:border-vam-green"
            >
              <option value="1">1 mentee</option>
              <option value="2">2 mentee</option>
              <option value="3">3 mentee</option>
            </select>
            <span className="text-xs text-slate-500">
              Ban tổ chức sẽ không ghép quá số lượng anh/chị chọn.
            </span>
          </label>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-vam-ink">
              Anh/chị có thể hỗ trợ thêm ở khâu tuyển chọn không? (không bắt buộc)
            </legend>

            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                name="agree_to_review"
                defaultChecked={initialAgreeToReview === true}
                className="mt-0.5 h-4 w-4 rounded border-vam-line text-vam-green focus:ring-vam-mint"
              />
              <span>Tham gia chấm hồ sơ mentee (khoảng 10 hồ sơ mỗi lượt)</span>
            </label>

            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                name="agree_to_interview"
                defaultChecked={initialAgreeToInterview === true}
                className="mt-0.5 h-4 w-4 rounded border-vam-line text-vam-green focus:ring-vam-mint"
              />
              <span>Tham gia phỏng vấn mentee</span>
            </label>
          </fieldset>
        </>
      ) : null}

      <label className="grid gap-2">
        <span className="text-sm font-medium text-vam-ink">Ghi chú cho ban tổ chức (không bắt buộc)</span>
        <textarea
          name="note"
          rows={3}
          maxLength={1000}
          defaultValue={initialNote ?? ""}
          className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green"
          placeholder="Ví dụ: lịch bận trong tháng 10, mong ghép mentee ngành tài chính…"
        />
      </label>

      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Đang gửi...">Gửi xác nhận</SubmitButton>
        <span className="text-xs text-slate-500">Anh/chị có thể sửa lại nếu cần, đến khi hết hạn.</span>
      </div>
    </form>
  );
}
