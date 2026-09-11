"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { runBulkInviteAction } from "@/app/actions/participants";
import { SubmitButton } from "@/components/submit-button";
import { initialBulkInviteState, type BulkInviteState } from "@/lib/participant-action-types";

/**
 * Mời hàng loạt, hai bước.
 *
 * Bước đầu không có nút gửi — chỉ có nút mở ô xác nhận. Bước hai bắt gõ lại
 * đúng số người sẽ nhận thư: không có đường thu hồi một lá thư đã vào hộp thư,
 * và gõ lại con số buộc mắt nhìn vào quy mô của việc sắp làm.
 */
export function BulkInvitePanel({
  seasonId,
  seasonLabel,
  eligible,
  budgetLeft,
  gateOpen,
  batchMax
}: {
  seasonId: string;
  seasonLabel: string;
  eligible: number;
  budgetLeft: number | null;
  gateOpen: boolean;
  batchMax: number;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState<BulkInviteState, FormData>(runBulkInviteAction, initialBulkInviteState);
  const [confirming, setConfirming] = useState(false);

  const lastAt = useRef(0);
  useEffect(() => {
    if (state.at && state.at !== lastAt.current) {
      lastAt.current = state.at;
      if (state.ok) setConfirming(false);
      router.refresh();
    }
  }, [router, state.at, state.ok]);

  const blockedReason = !gateOpen
    ? "Hệ thống đang tắt gửi thư trên môi trường này, nên chưa mời hàng loạt được."
    : budgetLeft === null
      ? "Không đọc được số thư đã gửi trong 24 giờ qua, nên chưa mở lượt mời hàng loạt."
      : budgetLeft <= 0
        ? "Đã chạm hạn mức thư trong 24 giờ qua. Tiếp tục vào ngày mai."
        : eligible === 0
          ? "Không còn ai chưa mời trong mùa này."
          : null;

  return (
    <section
      aria-labelledby="bulk-invite-title"
      className="mb-6 rounded-lg border border-vam-line bg-white p-4 shadow-soft"
    >
      <h2 id="bulk-invite-title" className="text-base font-semibold text-vam-ink">
        Mời hàng loạt
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {eligible} người của {seasonLabel} chưa từng được gửi thư mời. Mỗi lượt gửi tối đa {batchMax} thư
        {budgetLeft !== null ? `, và còn gửi được ${budgetLeft} thư mời trong 24 giờ này` : ""}. Lượt hàng loạt không
        bao giờ gửi lại cho người đã nhận thư — muốn gửi lại, bấm trên dòng của người đó.
      </p>

      {blockedReason ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {blockedReason}
        </p>
      ) : !confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 inline-flex h-11 items-center rounded-md border border-vam-line bg-white px-4 text-sm font-medium text-vam-green hover:bg-slate-50"
        >
          Mời hàng loạt…
        </button>
      ) : (
        <form action={formAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="season_id" value={seasonId} />
          <input type="hidden" name="phase" value="start" />
          <label className="text-sm text-slate-700">
            Gõ lại số người ({eligible}) để xác nhận
            <input
              name="typed_count"
              inputMode="numeric"
              autoComplete="off"
              className="mt-1 block w-32 rounded-md border border-vam-line px-3 py-2 text-sm"
            />
          </label>
          <SubmitButton pendingText="Đang gửi… (tối đa khoảng 40 giây)">Bắt đầu gửi</SubmitButton>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="inline-flex h-11 items-center rounded-md px-4 text-sm text-slate-600 hover:bg-slate-100"
          >
            Huỷ
          </button>
        </form>
      )}

      {state.message ? (
        <div
          role="status"
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            state.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      ) : null}

      {state.problems.length ? (
        <details className="mt-2 text-sm text-slate-600">
          <summary className="cursor-pointer">Chi tiết {state.problems.length} trường hợp</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {state.problems.map((problem, index) => (
              <li key={index}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {state.canContinue && state.remaining !== null ? (
        <form action={formAction} className="mt-3">
          <input type="hidden" name="season_id" value={seasonId} />
          <input type="hidden" name="phase" value="continue" />
          <input type="hidden" name="previous_remaining" value={state.remaining} />
          <SubmitButton pendingText="Đang gửi…">Gửi tiếp {Math.min(batchMax, state.remaining)} người</SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
