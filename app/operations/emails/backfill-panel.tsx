"use client";

import { useFormState } from "react-dom";
import { AlertTriangle, MailCheck } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { runConfirmationBackfillAction } from "@/app/actions/confirmation-backfill";
import { initialConfirmationBackfillActionState } from "@/lib/confirmation-backfill-types";
import {
  CONFIRMATION_BACKFILL_MAX_PER_RUN,
  CONFIRMATION_BACKFILL_SINCE
} from "@/lib/confirmation-backfill-core";

export type BackfillPanelProps = {
  pending: number;
  pendingCapped: boolean;
  byRole: { mentor: number; mentee: number };
  canRun: boolean;
  gate: { canSend: boolean; reason: string | null };
};

export function BackfillPanel({ pending, pendingCapped, byRole, canRun, gate }: BackfillPanelProps) {
  const [state, formAction] = useFormState(
    runConfirmationBackfillAction,
    initialConfirmationBackfillActionState
  );

  const batch = Math.min(pending, CONFIRMATION_BACKFILL_MAX_PER_RUN);

  return (
    <div className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
      <div className="flex items-start gap-3">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-vam-green" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-vam-ink">Gửi bù thư xác nhận</h2>
          <p className="mt-1 text-sm text-slate-600">
            Đơn nộp từ {CONFIRMATION_BACKFILL_SINCE} tới trước khi hệ thống có tầng email đều
            chưa nhận được thư nào. Thao tác này gửi đúng lá thư xác nhận mà hôm nay một đơn
            mới sẽ nhận được, và chỉ gửi cho đơn <strong>chưa vào vòng phỏng vấn</strong> — vì
            thư viết &ldquo;bước tiếp theo là chấm hồ sơ và mời phỏng vấn&rdquo;.
          </p>

          <p className="mt-3 text-sm text-vam-ink">
            Còn <strong>{pendingCapped ? `hơn ${pending}` : pending}</strong> đơn chờ
            {pending > 0 ? (
              <>
                {" "}
                ({byRole.mentor} mentor, {byRole.mentee} mentee)
              </>
            ) : null}
            . Mỗi lần bấm gửi tối đa {CONFIRMATION_BACKFILL_MAX_PER_RUN} thư, ưu tiên đơn nộp
            sớm nhất.
          </p>

          {!gate.canSend ? (
            <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Gửi email đang <strong>TẮT</strong>
                {gate.reason ? ` (${gate.reason})` : ""}. Chạy lúc này sẽ không có thư nào rời
                hệ thống — chỉ ghi các dòng trạng thái &ldquo;Bỏ qua&rdquo; để bạn thấy trước
                thư sẽ đi tới đâu khi bật.
              </span>
            </p>
          ) : null}

          {state.message ? (
            <p
              className={`mt-3 rounded-md border p-3 text-sm ${
                state.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              {state.message}
            </p>
          ) : null}

          {canRun ? (
            <form
              action={formAction}
              className="mt-4"
              onSubmit={(event) => {
                const ok = window.confirm(
                  `Gửi thư xác nhận tới ${batch} ứng viên (ưu tiên đơn nộp sớm nhất)?\n\n` +
                    "Thư đi thật tới hộp thư của họ và không thu hồi được."
                );
                if (!ok) event.preventDefault();
              }}
            >
              <input type="hidden" name="confirm" value="yes" />
              <SubmitButton pendingText="Đang gửi…" disabled={pending === 0}>
                {pending === 0 ? "Không còn đơn nào chờ" : `Gửi ${batch} thư`}
              </SubmitButton>
            </form>
          ) : (
            <p className="mt-4 text-sm text-slate-500">
              Bạn xem được sổ này nhưng không có quyền gửi. Cần vai trò quản trị và quyền trên
              mùa đang mở.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
