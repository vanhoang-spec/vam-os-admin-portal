"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { selectMenteeAction } from "@/app/actions/mentor-selection";
import {
  initialMentorSelectionActionState,
  type MentorSelectionActionState
} from "@/lib/mentor-selection-action-types";

/**
 * "Chọn làm mentee của tôi" — the step that turns a finished interview into a
 * match, on the interviewer's own screen.
 *
 * The mentor's remaining capacity is shown before they press anything, and a
 * refusal for being full is displayed in red with the one thing that fixes it:
 * asking the organisers for another place. The server checks all of this again.
 */
export function SelectMenteePanel({
  applicationId,
  candidateName,
  cap,
  activeCount,
  canSelect,
  capExceeded,
  alreadyMine,
  blockedMessage
}: {
  applicationId: string;
  candidateName: string;
  cap: number;
  activeCount: number;
  canSelect: boolean;
  capExceeded: boolean;
  alreadyMine: boolean;
  blockedMessage: string | null;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState<MentorSelectionActionState, FormData>(
    selectMenteeAction,
    initialMentorSelectionActionState
  );

  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!state.ok || !state.message) return;
    if (refreshedFor.current === state.message) return;
    refreshedFor.current = state.message;
    router.refresh();
  }, [state.ok, state.message, router]);

  const showCap = cap > 0;
  const full = capExceeded || state.capExceeded === true;

  return (
    <div className="rounded-md border border-vam-line bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-vam-ink">Nhận ứng viên này làm mentee</h3>
        {showCap ? (
          <span className={`text-xs ${full ? "font-medium text-red-700" : "text-slate-500"}`}>
            Đã nhận {activeCount}/{cap} mentee
          </span>
        ) : null}
      </div>

      {alreadyMine ? (
        <p className="mt-2 text-sm text-green-700">
          {candidateName} đã là mentee của anh/chị trong mùa này.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-500">
            Chỉ bấm sau khi đã nộp điểm phỏng vấn. Hệ thống sẽ tạo cặp mentor – mentee ngay và trừ vào
            hạn mức của anh/chị.
          </p>

          {full ? (
            <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {state.message ??
                blockedMessage ??
                `Anh/chị đã nhận đủ ${activeCount}/${cap} mentee của mùa này. Vui lòng liên hệ ban tổ chức để được cấp thêm suất.`}
            </p>
          ) : null}

          {!full && blockedMessage && !state.message ? (
            <p className="mt-2 text-sm text-amber-700">{blockedMessage}</p>
          ) : null}

          {!full && state.message ? (
            <p
              role={state.ok ? "status" : "alert"}
              className={`mt-2 text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}
            >
              {state.message}
            </p>
          ) : null}

          <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="application_id" value={applicationId} />
            <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs text-slate-500">
              Ghi chú cho ban tổ chức (không bắt buộc)
              <input
                type="text"
                name="note"
                maxLength={500}
                placeholder="Ví dụ: phù hợp định hướng tài chính"
                className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
              />
            </label>
            <SubmitButton pendingText="Đang xử lý..." disabled={!canSelect || full}>
              Chọn làm mentee của tôi
            </SubmitButton>
          </form>
        </>
      )}
    </div>
  );
}
