"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { initialCrossActionState } from "@/lib/cross-action-types";
import { submitInvitationResponseAction } from "./actions";

/**
 * The mentor's reply.
 *
 * Two buttons and, if they say yes, up to five optional hours. Optional means
 * optional: a mentor who can only say "yes, ring me" must be able to finish
 * this form in one click, because the alternative is that they don't finish it.
 */

function SubmitButton({
  decision,
  label,
  tone
}: {
  decision: "accepted" | "declined";
  label: string;
  tone: "primary" | "quiet";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="decision"
      value={decision}
      disabled={pending}
      className={
        tone === "primary"
          ? "rounded-md bg-vam-green px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          : "rounded-md border border-vam-line bg-white px-5 py-2.5 text-sm font-medium text-vam-ink disabled:opacity-60"
      }
    >
      {pending ? "Đang gửi…" : label}
    </button>
  );
}

export function InvitationForm({
  token,
  updatedAt
}: {
  token: string;
  updatedAt: string | null;
}) {
  const [state, formAction] = useFormState(
    submitInvitationResponseAction,
    initialCrossActionState
  );
  const [slotCount, setSlotCount] = useState(2);

  if (state.ok) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-lg font-semibold text-emerald-900">Đã ghi nhận</h2>
        <p className="mt-2 text-sm leading-6 text-emerald-800">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6 rounded-lg border border-vam-line bg-white p-5">
      <input type="hidden" name="token" value={token} />
      {updatedAt ? <input type="hidden" name="updated_at" value={updatedAt} /> : null}

      <fieldset>
        <legend className="text-sm font-medium text-vam-ink">
          Khung giờ anh/chị có thể tham gia
          <span className="ml-1 font-normal text-vam-muted">(không bắt buộc)</span>
        </legend>
        <p className="mt-1 text-sm text-vam-muted">
          Điền vài khung giờ rảnh thì ban tổ chức xếp lịch dễ hơn. Bỏ trống cũng được — ban tổ chức
          sẽ liên hệ để thống nhất.
        </p>

        <div className="mt-3 space-y-2">
          {Array.from({ length: slotCount }, (_, index) => (
            <div key={index} className="flex items-center gap-2">
              <label htmlFor={`slot_${index + 1}`} className="w-20 text-sm text-vam-muted">
                Khung {index + 1}
              </label>
              <input
                id={`slot_${index + 1}`}
                name={`slot_${index + 1}`}
                type="datetime-local"
                className="flex-1 rounded-md border border-vam-line px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>

        {slotCount < 5 ? (
          <button
            type="button"
            onClick={() => setSlotCount((count) => Math.min(count + 1, 5))}
            className="mt-2 text-sm font-medium text-vam-green hover:underline"
          >
            + Thêm khung giờ
          </button>
        ) : null}
      </fieldset>

      <div>
        <label htmlFor="note" className="block text-sm font-medium text-vam-ink">
          Ghi chú cho ban tổ chức
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={1000}
          placeholder="Ví dụ: em ưu tiên buổi tối, hoặc em nhận online thì thuận hơn."
          className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
        />
      </div>

      {state.message ? (
        <p
          role="status"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <SubmitButton decision="accepted" label="Tôi nhận lời" tone="primary" />
        <SubmitButton decision="declined" label="Lần này tôi chưa sắp xếp được" tone="quiet" />
      </div>

      <p className="text-xs leading-5 text-vam-muted">
        Có thể nhiều mentor cùng nhận lời cho một buổi, nên ban tổ chức sẽ chọn một người và báo lại
        anh/chị. Nhận lời mà chưa được xếp lần này thì lần sau anh/chị vẫn nằm trong danh sách mời.
      </p>
    </form>
  );
}
