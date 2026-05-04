"use client";

import { useRef } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { cancelEventAction } from "@/app/actions/events";
import type { EventActionState } from "@/lib/event-action-types";

const initialState: EventActionState = { ok: false, message: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-fit rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
    >
      {pending ? "Đang hủy..." : "Hủy sự kiện này"}
    </button>
  );
}

export function CancelEventButton({ eventId }: { eventId: string }) {
  const [state, formAction] = useFormState(cancelEventAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      "Bạn có chắc chắn muốn hủy sự kiện này?\n\nSự kiện sẽ được đánh dấu là 'cancelled' và ẩn khỏi danh sách mặc định. Dữ liệu tham gia không bị xóa."
    );
    if (!confirmed) {
      e.preventDefault();
    }
  }

  if (state.ok) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
        {state.message ?? "Đã hủy sự kiện."}
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit}>
      <input type="hidden" name="id" value={eventId} />
      {state.message && !state.ok ? (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {state.message}
        </div>
      ) : null}
      <SubmitButton />
    </form>
  );
}
