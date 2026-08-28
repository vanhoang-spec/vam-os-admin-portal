"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { bulkAssignApplicationReviewsAction } from "@/app/actions/bulk-assignment";
import { initialBulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";
import type { IntakeBatch, InterviewCandidateRow, ReviewEligibleReviewer, Season } from "@/lib/types";
import { ErrorBox } from "@/components/ui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STATUSES = new Set(["invited_to_interview", "interview_scheduled"]);

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "invited_to_interview", label: "Đã mời phỏng vấn (invited_to_interview)" },
  { value: "interview_scheduled", label: "Đã lên lịch (interview_scheduled)" },
  { value: "interview_in_progress", label: "Đang phỏng vấn (interview_in_progress)" }
];

function statusBadge(status: string | null) {
  if (!status) return "bg-slate-50 text-slate-500";
  if (status === "invited_to_interview") return "bg-blue-50 text-blue-700";
  if (status === "interview_scheduled") return "bg-amber-50 text-amber-700";
  if (status === "interview_in_progress") return "bg-purple-50 text-purple-700";
  return "bg-slate-50 text-slate-500";
}

// ---------------------------------------------------------------------------
// Submit button (needs useFormStatus inside form)
// ---------------------------------------------------------------------------

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-vam-green px-5 py-2 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Đang giao…" : "Xác nhận giao phỏng vấn"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type Props = {
  candidates: InterviewCandidateRow[];
  reviewers: ReviewEligibleReviewer[];
  intakeBatchId: string;
  roleApplied: string;
  intakeBatches: IntakeBatch[];
  seasons: Season[];
  adminUserId: string;
};

// ---------------------------------------------------------------------------
// Main form component
// ---------------------------------------------------------------------------

export function AssignInterviewForm({
  candidates,
  reviewers,
  intakeBatchId,
  roleApplied,
  intakeBatches,
  seasons,
  adminUserId
}: Props) {
  const router = useRouter();
  const [state, formAction] = useFormState(bulkAssignApplicationReviewsAction, initialBulkAssignmentActionState);

  // Filter state
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(new Set(DEFAULT_STATUSES));
  const [excludeAlreadyAssigned, setExcludeAlreadyAssigned] = useState(true);

  // Reviewer selection state
  const [selectedReviewerIds, setSelectedReviewerIds] = useState<Set<string>>(new Set());

  // Confirmation gate before submit
  const [confirmed, setConfirmed] = useState(false);

  // Reset confirmation when selection changes
  const prevSelectionRef = useRef({ statuses: "", reviewers: "" });
  const selectionKey = useMemo(
    () => JSON.stringify(Array.from(selectedStatuses).sort()) + "|" + JSON.stringify(Array.from(selectedReviewerIds).sort()),
    [selectedStatuses, selectedReviewerIds]
  );
  useEffect(() => {
    if (prevSelectionRef.current.statuses !== selectionKey) {
      setConfirmed(false);
      prevSelectionRef.current = { statuses: selectionKey, reviewers: selectionKey };
    }
  }, [selectionKey]);

  // Scroll to top on success
  useEffect(() => {
    if (state.ok) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [state.ok]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const filteredApps = useMemo(() => {
    const afterStatus = candidates.filter((a) => selectedStatuses.has(a.status ?? ""));
    if (!excludeAlreadyAssigned) return afterStatus;
    // For interviews, we consider already assigned if they have at least one reviewer
    // Wait, the prompt says "Do NOT block multiple DIFFERENT reviewers interviewing the same candidate".
    // "Exclude already assigned" means if they have >= 1 reviewer.
    return afterStatus.filter((a) => (a.reviewers?.length ?? 0) === 0);
  }, [candidates, selectedStatuses, excludeAlreadyAssigned]);

  const alreadyAssignedCount = useMemo(
    () => candidates.filter((a) => selectedStatuses.has(a.status ?? "") && (a.reviewers?.length ?? 0) > 0).length,
    [candidates, selectedStatuses]
  );

  const selectedReviewers = useMemo(
    () => reviewers.filter((r) => selectedReviewerIds.has(r.id)),
    [reviewers, selectedReviewerIds]
  );

  // Distribution preview (round-robin formula, mirrors lib/bulk-assignment.ts)
  const distribution = useMemo(() => {
    const n = selectedReviewers.length;
    const total = filteredApps.length;
    if (!n || !total) return [];
    // Sort by workload ASC, email ASC — mirrors server-side sort
    const sorted = [...selectedReviewers].sort((a, b) => {
      const wDiff = a.current_workload - b.current_workload;
      if (wDiff !== 0) return wDiff;
      return a.email.localeCompare(b.email);
    });
    return sorted.map((reviewer, i) => {
      const base = Math.floor(total / n);
      const extra = i < total % n ? 1 : 0;
      return { reviewer, count: base + extra };
    });
  }, [filteredApps.length, selectedReviewers]);

  const minPerReviewer = distribution.length ? Math.min(...distribution.map((d) => d.count)) : 0;
  const maxPerReviewer = distribution.length ? Math.max(...distribution.map((d) => d.count)) : 0;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function toggleStatus(value: string) {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleReviewer(id: string) {
    setSelectedReviewerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllReviewers() {
    setSelectedReviewerIds(new Set(reviewers.map((r) => r.id)));
  }
  function clearAllReviewers() {
    setSelectedReviewerIds(new Set());
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canSubmit = filteredApps.length > 0 && selectedReviewers.length > 0 && confirmed;

  return (
    <form action={formAction} className="space-y-6">
      {/* Hidden scalar fields */}
      <input type="hidden" name="intake_batch_id" value={intakeBatchId} />
      <input type="hidden" name="role_applied" value={roleApplied} />
      <input type="hidden" name="exclude_already_assigned" value={excludeAlreadyAssigned ? "1" : "0"} />
      <input type="hidden" name="review_round" value="interview" />

      {/* Success banner */}
      {state.ok && state.message && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">{state.message}</p>
          {state.applicationsAssigned !== undefined && (
            <ul className="mt-1 list-inside list-disc text-xs text-green-700">
              <li>Hồ sơ được giao: {state.applicationsAssigned}</li>
              <li>Số reviewer: {state.reviewersCount}</li>
              <li>
                Phân bổ: min {state.minPerReviewer} — max {state.maxPerReviewer} / reviewer
              </li>
              {(state.skippedAlreadyAssigned ?? 0) > 0 && (
                <li>Bỏ qua (đã giao): {state.skippedAlreadyAssigned}</li>
              )}
            </ul>
          )}
        </div>
      )}

      <ErrorBox message={state.ok ? null : state.message} />

      {/* ── Section A: Status filter ─────────────────────────────── */}
      <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">A — Lọc theo trạng thái ứng viên</h2>
        <div className="flex flex-wrap gap-3">
          {STATUS_OPTIONS.map((opt) => {
            const checked = selectedStatuses.has(opt.value);
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-vam-line px-3 py-1.5 text-sm hover:bg-vam-mint/50"
              >
                <input
                  type="checkbox"
                  name="statuses"
                  value={opt.value}
                  checked={checked}
                  onChange={() => toggleStatus(opt.value)}
                  className="accent-vam-green"
                />
                <span>{opt.label}</span>
              </label>
            );
          })}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={excludeAlreadyAssigned}
            onChange={(e) => setExcludeAlreadyAssigned(e.target.checked)}
            className="accent-vam-green"
          />
          Bỏ qua ứng viên đã được chia người phỏng vấn (không hủy lịch cũ)
        </label>
      </section>

      {/* ── Section B: Application pool preview ─────────────────── */}
      <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <h2 className="mb-1 text-sm font-semibold text-slate-700">B — Ứng viên sẽ được giao phỏng vấn</h2>
        <p className="mb-3 text-xs text-slate-500">
          {filteredApps.length} ứng viên phù hợp
          {excludeAlreadyAssigned && alreadyAssignedCount > 0 && (
            <span className="ml-1 text-amber-600">
              · {alreadyAssignedCount} ứng viên đã có người PV bị bỏ qua
            </span>
          )}
        </p>
        {filteredApps.length === 0 ? (
          <p className="rounded-md border border-dashed border-vam-line px-4 py-6 text-center text-sm text-slate-400">
            Không có ứng viên nào khớp bộ lọc.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-md border border-vam-line">
            <table className="min-w-full divide-y divide-vam-line text-xs">
              <thead className="bg-slate-50 text-left font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Tên</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Trạng thái</th>
                  <th className="px-3 py-2">Interviewer hiện tại</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line">
                {filteredApps.map((app, idx) => (
                  <tr key={app.id} className="hover:bg-vam-mint/30">
                    <td className="px-3 py-1.5 text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-1.5 font-medium text-vam-ink">
                      {app.full_name ?? app.email_primary ?? app.id}
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{app.email_primary ?? "-"}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ${statusBadge(app.status)}`}>
                        {app.status ?? "-"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {(app.reviewers?.length ?? 0) > 0 ? (
                        <span className="text-amber-600">
                          {app.reviewers?.map(r => r.reviewer_name || r.reviewer_email).join(", ")}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section C: Reviewer checklist ───────────────────────── */}
      <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            C — Chọn người phỏng vấn ({selectedReviewerIds.size}/{reviewers.length})
          </h2>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={selectAllReviewers} className="text-vam-green hover:underline">
              Chọn tất cả
            </button>
            <span className="text-slate-300">|</span>
            <button type="button" onClick={clearAllReviewers} className="text-slate-500 hover:underline">
              Bỏ chọn
            </button>
          </div>
        </div>
        {reviewers.length === 0 ? (
          <p className="text-sm text-slate-400">Không có reviewer nào khả dụng.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {reviewers.map((reviewer) => {
                const checked = selectedReviewerIds.has(reviewer.id);
                return (
                  <label
                    key={reviewer.id}
                    className="flex cursor-pointer items-start gap-2 rounded-md border border-vam-line p-2 text-sm hover:bg-vam-mint/40"
                  >
                    <input
                      type="checkbox"
                      name="reviewer_ids"
                      value={reviewer.id}
                      checked={checked}
                      onChange={() => toggleReviewer(reviewer.id)}
                      className="mt-0.5 accent-vam-green"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-vam-ink">
                        {reviewer.full_name ?? reviewer.email}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {reviewer.email} · {reviewer.role}
                      </p>
                      <p className="text-xs text-slate-400">
                        Workload hiện tại: {reviewer.current_workload}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── Section D: Options (due date, note) ─────────────────── */}
      <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">D — Tuỳ chọn</h2>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Hạn hoàn thành (tuỳ chọn)</label>
            <input
              type="datetime-local"
              name="due_at"
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Ghi chú phân công (tuỳ chọn)</label>
            <input
              type="text"
              name="assignment_note"
              maxLength={500}
              placeholder="VD: Phỏng vấn S12 - Tuần 1"
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            />
          </div>
        </div>
      </section>

      {/* ── Section E: Distribution preview + confirm ────────────── */}
      <section className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">E — Xem trước phân bổ</h2>
        {distribution.length === 0 ? (
          <p className="text-sm text-slate-400">
            Chọn ít nhất một người phỏng vấn và có ứng viên phù hợp để xem phân bổ.
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-3 text-sm">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                Tổng ứng viên: <strong>{filteredApps.length}</strong>
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                Interviewer: <strong>{selectedReviewers.length}</strong>
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                Min/Max: <strong>{minPerReviewer} – {maxPerReviewer}</strong> ứng viên/người
              </span>
            </div>

            <div className="overflow-x-auto rounded-md border border-vam-line">
              <table className="min-w-full divide-y divide-vam-line text-xs">
                <thead className="bg-slate-50 text-left font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Interviewer</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Workload hiện tại</th>
                    <th className="px-3 py-2">Ứng viên sẽ giao</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {distribution.map(({ reviewer, count }) => (
                    <tr key={reviewer.id} className="hover:bg-vam-mint/30">
                      <td className="px-3 py-1.5 font-medium text-vam-ink">
                        {reviewer.full_name ?? reviewer.email}
                      </td>
                      <td className="px-3 py-1.5 text-slate-500">{reviewer.email}</td>
                      <td className="px-3 py-1.5 text-slate-500">{reviewer.role}</td>
                      <td className="px-3 py-1.5 text-slate-500">{reviewer.current_workload}</td>
                      <td className="px-3 py-1.5 font-semibold text-vam-green">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 accent-vam-green"
              />
              <span>
                Tôi đã kiểm tra phân bổ trên và xác nhận giao{" "}
                <strong>{filteredApps.length} ứng viên</strong> cho{" "}
                <strong>{selectedReviewers.length} người phỏng vấn</strong>.
              </span>
            </label>
          </>
        )}
      </section>

      {/* Submit row */}
      <div className="flex items-center gap-4 pb-8">
        <SubmitButton disabled={!canSubmit} />
        {!canSubmit && distribution.length > 0 && !confirmed && (
          <p className="text-xs text-slate-400">Vui lòng xác nhận ở mục E trước khi giao.</p>
        )}
      </div>
    </form>
  );
}
