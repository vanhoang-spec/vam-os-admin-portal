"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { updateCheckinStepsAction } from "@/app/actions/event-scan";
import { InlineActionMessage, LoadingButton } from "@/components/action-feedback";
import type { EventActionState } from "@/lib/event-action-types";
import { CHECKIN_STEPS_PANEL_ID, type CheckinPurpose } from "@/lib/event-checkin-steps";
import { CheckinStepsField } from "../../checkin-steps-field";

const initialState: EventActionState = { ok: false, message: null };

/**
 * Khung "Thiết lập các lần quét" ở cuối trang máy quét.
 *
 * Gập sẵn: trang này mở trên điện thoại ở cửa, và thứ cần thấy đầu tiên là camera,
 * không phải một biểu mẫu.
 */
export function CheckinStepsPanel({
  eventId,
  initialSteps
}: {
  eventId: string;
  initialSteps: CheckinPurpose[];
}) {
  const [state, formAction] = useFormState(updateCheckinStepsAction, initialState);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // Link "Thiết lập các lần quét" trên máy quét trỏ về đây. Khung đang gập thì nhảy
  // tới cũng chỉ thấy một dòng tiêu đề, nên mở nó ra.
  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === `#${CHECKIN_STEPS_PANEL_ID}` && detailsRef.current) {
        detailsRef.current.open = true;
      }
    };
    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, []);

  return (
    <details
      ref={detailsRef}
      id={CHECKIN_STEPS_PANEL_ID}
      className="mt-6 rounded-lg border border-vam-line bg-white px-4 py-3"
    >
      <summary className="cursor-pointer text-sm font-semibold text-vam-ink">Thiết lập các lần quét</summary>

      <form action={formAction} className="mt-3">
        <input type="hidden" name="event_id" value={eventId} />
        <div className="mb-3">
          <InlineActionMessage
            state={state}
            successFallback="Đã lưu các lần quét."
            errorFallback="Không lưu được các lần quét. Thử lại."
          />
        </div>

        <CheckinStepsField initialSteps={initialSteps} hidden={false} />

        <LoadingButton
          pendingLabel="Đang lưu…"
          className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
        >
          Lưu các lần quét
        </LoadingButton>
      </form>
    </details>
  );
}
