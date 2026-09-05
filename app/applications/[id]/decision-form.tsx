"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateApplicationDecisionAction } from "@/app/actions/application-decisions";
import { ConfirmActionDialog } from "@/components/action-feedback";
import {
  DESTRUCTIVE_DECISION_STATUSES,
  initialDecisionActionState
} from "@/lib/decision-action-types";

// ---------------------------------------------------------------------------
// Options — values must exactly match migration 041 allowed statuses
// ---------------------------------------------------------------------------

// `screening_passed` is deliberately absent. It was never a judgement Core Team
// made separately from "Mời phỏng vấn", and the profile round is now closed by
// ScreeningDecisionPanel in one action. The status remains legal in the
// database and a legal source for the invite, so records already holding it
// still move forward — nothing needs to CREATE it any more.
const DECISION_OPTIONS: { value: string; label: string }[] = [
  { value: "invited_to_interview", label: "Mời phỏng vấn" },
  { value: "waitlisted",          label: "Đưa vào danh sách chờ" },
  { value: "rejected_or_not_fit", label: "Không phù hợp / từ chối" },
  { value: "under_data_check",    label: "Cần kiểm tra dữ liệu" },
  { value: "needs_more_review",   label: "Cần review thêm" },
  { value: "withdrawn",           label: "Ứng viên rút đơn" },
  { value: "interview_scheduled", label: "Đã đặt lịch phỏng vấn" },
  { value: "interview_passed", label: "Qua vòng phỏng vấn" }
];

// ---------------------------------------------------------------------------
// Submit button
// ---------------------------------------------------------------------------

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-ink disabled:opacity-50"
    >
      {pending ? "Đang lưu…" : "Ghi nhận quyết định"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type DecisionFormProps = {
  applicationId: string;
  currentStatus: string | null;
  hasSubmittedReview: boolean;
  latestRecommendation?: string | null;
  latestTotalScore?: number | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DecisionForm({
  applicationId,
  currentStatus,
  hasSubmittedReview,
  latestRecommendation,
  latestTotalScore
}: DecisionFormProps) {
  const [state, action] = useFormState(
    updateApplicationDecisionAction,
    initialDecisionActionState
  );
  const [selectedStatus, setSelectedStatus] = useState("");

  const showNoReviewWarning = !hasSubmittedReview;
  const isDestructive = DESTRUCTIVE_DECISION_STATUSES.has(selectedStatus);
  const selectedLabel = DECISION_OPTIONS.find((o) => o.value === selectedStatus)?.label ?? selectedStatus;

  return (
    <div className="space-y-4">
      {/* Action feedback banner */}
      {state.message && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            state.ok
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {state.message}
        </div>
      )}

      {/* Context: current status + latest review summary */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium uppercase text-slate-500">Trạng thái hiện tại</div>
          <div className="mt-1 text-sm font-medium text-vam-ink">
            {currentStatus ?? "-"}
          </div>
        </div>
        <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium uppercase text-slate-500">Review mới nhất</div>
          <div className="mt-1 text-sm text-vam-ink">
            {hasSubmittedReview ? (
              <>
                {latestRecommendation ?? "-"}
                {latestTotalScore !== null && latestTotalScore !== undefined
                  ? ` · Điểm: ${latestTotalScore}`
                  : ""}
              </>
            ) : (
              <span className="text-slate-400 italic">Chưa có review được nộp</span>
            )}
          </div>
        </div>
      </div>

      {/* Warning when advancing without a submitted review */}
      {showNoReviewWarning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Chưa có review nào được nộp cho đơn này. Các quyết định cần review sẽ
          bị hệ thống từ chối cho đến khi đạt số lượng tối thiểu của mùa và vòng.
        </div>
      )}

      {/* Decision form */}
      <form action={action} className="space-y-3">
        <input type="hidden" name="application_id" value={applicationId} />
        <input
          type="hidden"
          name="previous_status"
          value={currentStatus ?? ""}
        />

        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Quyết định <span className="text-red-500">*</span>
          </label>
          <select
            name="new_status"
            required
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink focus:outline-none focus:ring-1 focus:ring-vam-green"
          >
            <option value="" disabled>-- Chọn quyết định --</option>
            {DECISION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium uppercase text-slate-500">
            Ghi chú (tuỳ chọn)
          </label>
          <textarea
            name="decision_note"
            rows={3}
            placeholder="Lý do, ghi chú thêm về quyết định này…"
            className="mt-1 w-full rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm text-vam-ink placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-vam-green"
          />
        </div>

        {isDestructive ? (
          <ConfirmActionDialog
            triggerLabel="Ghi nhận quyết định"
            pendingLabel="Đang lưu…"
            title="Xác nhận quyết định"
            description={`Bạn đang chọn: "${selectedLabel}". Đây là quyết định có tính kết thúc cho hồ sơ ứng viên này. Vui lòng xác nhận trước khi ghi nhận.`}
            confirmLabel="Xác nhận"
            triggerClassName="inline-flex h-9 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
          />
        ) : (
          <SubmitButton />
        )}
      </form>
    </div>
  );
}
