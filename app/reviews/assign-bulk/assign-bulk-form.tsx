"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { bulkAssignApplicationReviewsAction } from "@/app/actions/bulk-assignment";
import { initialBulkAssignmentActionState, INTERVIEW_ELIGIBLE_STATUSES, PROFILE_ASSIGNMENT_STATUSES } from "@/lib/bulk-assignment-action-types";
import type { IntakeBatch, ReviewAssignableApplication, ReviewEligibleReviewer, Season } from "@/lib/types";
import { ErrorBox } from "@/components/ui";



function statusBadge(status: string | null) {
  if (!status) return "bg-slate-50 text-slate-500";
  if (status === "submitted") return "bg-blue-50 text-blue-700";
  if (status === "under_data_check") return "bg-amber-50 text-amber-700";
  if (status === "ready_for_screening") return "bg-sky-50 text-sky-700";
  if (status === "screening_assigned") return "bg-purple-50 text-purple-700";
  if (status === "invited_to_interview") return "bg-indigo-50 text-indigo-700";
  if (status === "interview_scheduled") return "bg-teal-50 text-teal-700";
  if (status === "interview_in_progress") return "bg-fuchsia-50 text-fuchsia-700";
  return "bg-slate-50 text-slate-500";
}

function SubmitButton({ disabled, label }: { disabled?: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md bg-vam-green px-5 py-2 text-sm font-semibold text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Đang xử lý…" : label}
    </button>
  );
}

type Props = {
  applications: ReviewAssignableApplication[];
  reviewers: ReviewEligibleReviewer[];
  intakeBatchId: string;
  roleApplied: string;
  reviewRound: "profile_screening" | "interview";
  intakeBatches: IntakeBatch[];
  seasons: Season[];
  adminUserId: string;
};

export function AssignBulkForm({
  applications,
  reviewers,
  intakeBatchId,
  roleApplied,
  reviewRound,
  intakeBatches,
  seasons,
  adminUserId
}: Props) {
  const [state, formAction] = useFormState(bulkAssignApplicationReviewsAction, initialBulkAssignmentActionState);
  
  const [selectedReviewerId, setSelectedReviewerId] = useState<string>("");
  const [selectedAppIds, setSelectedAppIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const allowedStatuses = reviewRound === "interview" ? INTERVIEW_ELIGIBLE_STATUSES : PROFILE_ASSIGNMENT_STATUSES;

  const validApps = useMemo(() => applications.filter((a) => a.status && allowedStatuses.has(a.status)), [applications, allowedStatuses]);

  const filteredApps = useMemo(() => {
    if (!searchQuery) return validApps;
    const q = searchQuery.toLowerCase();
    return validApps.filter((a) => (
      (a.full_name || "").toLowerCase().includes(q) ||
      (a.email_primary || "").toLowerCase().includes(q) ||
      (a.id || "").toLowerCase().includes(q)
    ));
  }, [validApps, searchQuery]);

  // Scroll to top on success
  useEffect(() => {
    if (state.ok) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setSelectedAppIds(new Set()); // Reset on success
    }
  }, [state.ok]);

  const toggleApp = (id: string) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const ids = filteredApps.filter(a => a.existing_review_count === 0).map(a => a.id);
    setSelectedAppIds(new Set(ids));
  };

  const deselectAll = () => {
    setSelectedAppIds(new Set());
  };

  const selectedReviewerName = useMemo(() => {
    const r = reviewers.find(r => r.id === selectedReviewerId);
    return r ? (r.full_name || r.email) : "";
  }, [reviewers, selectedReviewerId]);

  const canSubmit = selectedAppIds.size > 0 && !!selectedReviewerId;
  const submitLabel = reviewRound === "interview" ? "Xác nhận giao phỏng vấn" : "Xác nhận giao hồ sơ";

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="intake_batch_id" value={intakeBatchId} />
      <input type="hidden" name="role_applied" value={roleApplied} />
      <input type="hidden" name="review_round" value={reviewRound} />
      
      {state.ok && state.message && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">{state.message}</p>
        </div>
      )}
      {!state.ok && state.message && <ErrorBox message={state.message} />}

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-semibold text-slate-800">
          D. NGƯỜI PHỤ TRÁCH
        </h3>
        {reviewers.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p>Chưa có {reviewRound === "interview" ? "Interviewer" : "Reviewer"} cho mùa này.</p>
            <p className="mt-1">
              <Link href="/reviews/reviewer-pool" className="font-medium underline hover:text-amber-900">
                Vào Danh sách Reviewer để cấp quyền.
              </Link>
            </p>
          </div>
        ) : (
          <div className="max-w-md">
            <select
              name="reviewer_id"
              value={selectedReviewerId}
              onChange={(e) => setSelectedReviewerId(e.target.value)}
              className="w-full rounded-md border border-vam-line px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
              required
            >
              <option value="">-- Chọn người phụ trách --</option>
              {reviewers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.full_name ? `${r.full_name} (${r.email})` : r.email}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">
            E. DANH SÁCH ỨNG VIÊN ({filteredApps.length})
          </h3>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Tìm tên, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            />
            <button type="button" onClick={selectAll} className="text-sm font-medium text-vam-green hover:underline">
              Chọn tất cả đang hiển thị
            </button>
            <button type="button" onClick={deselectAll} className="text-sm font-medium text-slate-500 hover:underline">
              Bỏ chọn
            </button>
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-slate-500 w-10"></th>
                <th className="px-4 py-2 text-left font-medium text-slate-500">Ứng viên</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500">Trạng thái</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500">Người phụ trách</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {filteredApps.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    Không tìm thấy ứng viên hợp lệ nào.
                  </td>
                </tr>
              ) : (
                filteredApps.map((a) => {
                  const isAssigned = a.existing_review_count > 0;
                  const currentAssignee = isAssigned && a.existing_reviewer_id 
                    ? reviewers.find(r => r.id === a.existing_reviewer_id)?.full_name || "Đã phân công"
                    : (isAssigned ? "Đã phân công" : "");

                  return (
                    <tr key={a.id} className={isAssigned ? "bg-slate-50 opacity-75" : "hover:bg-slate-50"}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          name="application_ids"
                          value={a.id}
                          checked={selectedAppIds.has(a.id)}
                          onChange={() => toggleApp(a.id)}
                          disabled={isAssigned}
                          className="h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{a.full_name || "N/A"}</div>
                        <div className="text-xs text-slate-500">{a.email_primary}</div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(a.status)}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {isAssigned ? (
                          <div className="flex flex-col">
                            <span className="font-medium">{currentAssignee}</span>
                            <span className="text-xs text-slate-400">Muốn đổi người, mở Chi tiết ứng tuyển → Huỷ phân công hiện tại → giao lại.</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Chưa giao</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 flex flex-col items-center justify-center gap-4">
        <p className="text-sm font-medium text-slate-700">
          Bạn sắp giao <span className="font-bold text-vam-green">{selectedAppIds.size}</span> {reviewRound === "interview" ? "ứng viên phỏng vấn" : "hồ sơ"} cho <span className="font-bold text-slate-900">{selectedReviewerName || "..."}</span>.
        </p>
        <SubmitButton disabled={!canSubmit} label={submitLabel} />
      </div>
    </form>
  );
}
