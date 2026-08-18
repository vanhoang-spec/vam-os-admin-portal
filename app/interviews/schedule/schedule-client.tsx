"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import {
  cancelInterviewSlotAction,
  scheduleInterviewsAction
} from "@/app/actions/interview-scheduling";
import {
  initialInterviewScheduleActionState,
  type InterviewScheduleActionState
} from "@/lib/interview-scheduling-action-types";
import {
  DEFAULT_SLOT_MINUTES,
  formatInterviewTimeVi,
  INTERVIEW_MODE_LABELS
} from "@/lib/interview-scheduling-core";
import type { InterviewCandidateRow } from "@/lib/types";

/**
 * The booking surface: pick one interviewer, tick the candidates, set a time.
 *
 * Candidates already booked with somebody else are shown but not selectable —
 * the server refuses them anyway, and seeing why is more useful than a row that
 * silently does nothing.
 */

type InterviewerOption = {
  id: string;
  label: string;
  email: string;
  agreedToInterview: boolean;
};

type RowFilter = "unscheduled" | "scheduled" | "all";

const STATUS_LABELS: Record<string, string> = {
  invited_to_interview: "Đã mời PV",
  interview_scheduled: "Đã lên lịch",
  interview_in_progress: "Đang PV",
  interview_completed: "Đã hoàn thành"
};

function Feedback({ state }: { state: InterviewScheduleActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}
    >
      {state.message}
    </p>
  );
}

function CancelSlotButton({ reviewId, onDone }: { reviewId: string; onDone: () => void }) {
  const [state, formAction] = useFormState<InterviewScheduleActionState, FormData>(
    cancelInterviewSlotAction,
    initialInterviewScheduleActionState
  );
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!state.ok || !state.message) return;
    if (refreshedFor.current === state.message) return;
    refreshedFor.current = state.message;
    onDone();
  }, [state.ok, state.message, onDone]);

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="review_id" value={reviewId} />
      <SubmitButton variant="outline" className="h-7 px-2 text-xs" pendingText="Đang huỷ...">
        Huỷ lịch
      </SubmitButton>
      {state.message && !state.ok ? <span className="text-xs text-red-700">{state.message}</span> : null}
    </form>
  );
}

export function ScheduleClient({
  rows,
  interviewers,
  seasonLabel,
  currentAdminUserId
}: {
  rows: InterviewCandidateRow[];
  interviewers: InterviewerOption[];
  seasonLabel: string;
  currentAdminUserId: string;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);

  const [state, formAction] = useFormState<InterviewScheduleActionState, FormData>(
    scheduleInterviewsAction,
    initialInterviewScheduleActionState
  );

  const [interviewerId, setInterviewerId] = useState(interviewers[0]?.id ?? "");
  const [filter, setFilter] = useState<RowFilter>("unscheduled");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const refreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!state.ok || !state.message) return;
    if (refreshedFor.current === state.message) return;
    refreshedFor.current = state.message;
    setSelected(new Set());
    refresh();
  }, [state.ok, state.message, refresh]);

  const counts = useMemo(
    () => ({
      unscheduled: rows.filter((row) => !row.interview_scheduled_at).length,
      scheduled: rows.filter((row) => row.interview_scheduled_at).length,
      all: rows.length
    }),
    [rows]
  );

  const visible = useMemo(() => {
    const filtered =
      filter === "all"
        ? rows
        : filter === "scheduled"
        ? rows.filter((row) => row.interview_scheduled_at)
        : rows.filter((row) => !row.interview_scheduled_at);

    return [...filtered].sort((a, b) => {
      const aTime = a.interview_scheduled_at ?? "";
      const bTime = b.interview_scheduled_at ?? "";
      if (aTime && bTime && aTime !== bTime) return aTime.localeCompare(bTime);
      if (aTime && !bTime) return -1;
      if (!aTime && bTime) return 1;
      return (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "");
    });
  }, [rows, filter]);

  /** A candidate booked with another interviewer cannot be moved from here. */
  const isLocked = useCallback(
    (row: InterviewCandidateRow) =>
      Boolean(
        row.interview_reviewer_admin_user_id &&
          interviewerId &&
          row.interview_reviewer_admin_user_id !== interviewerId
      ),
    [interviewerId]
  );

  const selectable = useMemo(() => visible.filter((row) => !isLocked(row)), [visible, isLocked]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.id));
  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        selectable.forEach((row) => next.delete(row.id));
        return next;
      }
      const next = new Set(prev);
      selectable.forEach((row) => next.add(row.id));
      return next;
    });
  };

  const selectedCount = selectable.filter((row) => selected.has(row.id)).length;

  return (
    <div className="grid gap-4">
      <form action={formAction} className="grid gap-4 rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <input type="hidden" name="season_label" value={seasonLabel} />

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Người phỏng vấn
            <select
              name="interviewer_admin_user_id"
              value={interviewerId}
              onChange={(event) => setInterviewerId(event.target.value)}
              className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
            >
              <option value="">-- Chọn người phỏng vấn --</option>
              {interviewers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.agreedToInterview ? "✓ " : ""}
                  {option.label}
                  {option.id === currentAdminUserId ? " (bạn)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Giờ bắt đầu (giờ Việt Nam)
            <input
              type="datetime-local"
              name="start_at"
              required
              className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Mỗi ca cách nhau (phút)
            <input
              type="number"
              name="slot_minutes"
              min={0}
              max={240}
              defaultValue={DEFAULT_SLOT_MINUTES}
              className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
            Hình thức
            <select
              name="mode"
              defaultValue="online"
              className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
            >
              <option value="">-- Chưa xác định --</option>
              <option value="online">{INTERVIEW_MODE_LABELS.online}</option>
              <option value="offline">{INTERVIEW_MODE_LABELS.offline}</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
          Đường dẫn phòng họp hoặc địa điểm
          <input
            type="text"
            name="location"
            maxLength={300}
            placeholder="https://meet.google.com/... hoặc P.501, 279 Nguyễn Tri Phương"
            className="h-9 rounded-md border border-vam-line px-2 text-sm text-vam-ink"
          />
        </label>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="notify_interviewer" defaultChecked className="h-4 w-4" />
            Gửi lịch cho người phỏng vấn
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" name="notify_candidates" defaultChecked className="h-4 w-4" />
            Gửi giờ hẹn cho từng ứng viên
          </label>
        </div>

        {selectable
          .filter((row) => selected.has(row.id))
          .map((row) => (
            <input key={row.id} type="hidden" name="application_ids" value={row.id} />
          ))}

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="Đang xếp lịch..." disabled={!interviewerId || selectedCount === 0}>
            Xếp lịch cho {selectedCount} ứng viên
          </SubmitButton>
          {!interviewerId ? (
            <span className="text-xs text-slate-500">Chọn người phỏng vấn trước.</span>
          ) : null}
          {selectedCount === 0 ? (
            <span className="text-xs text-slate-500">Tích chọn ít nhất một ứng viên bên dưới.</span>
          ) : null}
        </div>

        <Feedback state={state} />
      </form>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        {(
          [
            ["unscheduled", "Chưa có lịch"],
            ["scheduled", "Đã có lịch"],
            ["all", "Tất cả"]
          ] as Array<[RowFilter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1 font-medium ${
              filter === value
                ? "bg-vam-green text-white"
                : "border border-vam-line bg-white text-slate-600 hover:bg-vam-mint"
            }`}
          >
            {label} ({counts[value]})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-vam-line bg-white shadow-soft">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-vam-mint text-left text-xs uppercase tracking-wide text-vam-ink">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={selectable.length === 0}
                  aria-label="Chọn tất cả"
                  className="h-4 w-4"
                />
              </th>
              <th className="px-3 py-2 font-semibold">Ứng viên</th>
              <th className="px-3 py-2 font-semibold">Trạng thái</th>
              <th className="px-3 py-2 font-semibold">Lịch phỏng vấn</th>
              <th className="px-3 py-2 font-semibold">Người phỏng vấn</th>
              <th className="px-3 py-2 font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                  Không có ứng viên nào trong nhóm này.
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const locked = isLocked(row);
                const timeLabel = formatInterviewTimeVi(row.interview_scheduled_at);
                return (
                  <tr key={row.id} className={`border-b border-vam-line ${locked ? "bg-slate-50" : ""}`}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        disabled={locked}
                        aria-label={`Chọn ${row.full_name ?? row.id}`}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-vam-ink">{row.full_name ?? "(chưa có tên)"}</div>
                      <div className="text-xs text-slate-500">{row.email_primary ?? "—"}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {STATUS_LABELS[row.status ?? ""] ?? row.status ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {timeLabel ? (
                        <>
                          <div className="text-vam-ink">{timeLabel}</div>
                          <div className="text-slate-500">
                            {row.interview_mode
                              ? INTERVIEW_MODE_LABELS[row.interview_mode as "online" | "offline"] ?? row.interview_mode
                              : ""}
                            {row.interview_location ? ` · ${row.interview_location}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">Chưa xếp</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {row.interview_reviewer_name ?? (row.interview_review_id ? "—" : "")}
                      {locked ? (
                        <div className="mt-1 text-amber-700">Đã giao cho người khác</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {row.interview_review_id && row.interview_review_status !== "submitted" ? (
                        <CancelSlotButton reviewId={row.interview_review_id} onDone={refresh} />
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
