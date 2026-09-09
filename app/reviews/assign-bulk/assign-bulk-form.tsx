"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { bulkAssignApplicationReviewsAction } from "@/app/actions/bulk-assignment";
import { bulkCancelApplicationReviewsAction } from "@/app/actions/bulk-cancel";
import { initialBulkAssignmentActionState } from "@/lib/bulk-assignment-action-types";
import { initialBulkCancelActionState } from "@/lib/bulk-cancel-action-types";
import { INTERVIEW_ELIGIBLE_STATUSES, PROFILE_ASSIGNMENT_STATUSES } from "@/lib/application-review-assignability";
import type { IntakeBatch, ReviewAssignableApplication, ReviewEligibleReviewer, Season } from "@/lib/types";
import { ErrorBox } from "@/components/ui";
import { applicationStatusLabel, staffDisplayLabel } from "@/lib/ui-labels";
import { formatDate } from "@/lib/utils";

/**
 * One page is one lot.
 *
 * Core Team hands out review work in lots of ten. The list used to render the
 * whole intake — ninety rows in a scrolling well — so "select all showing"
 * meant ninety applications for one reviewer, which is not a thing anyone
 * wants to do. Paging at the lot size makes the obvious action the correct
 * one: open the page, select all, assign.
 */
const LOT_SIZE = 10;

type PoolTab = "unassigned" | "assigned" | "all";

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

function SubmitButton({ disabled, label, tone = "green" }: { disabled?: boolean; label: string; tone?: "green" | "amber" }) {
  const { pending } = useFormStatus();
  const palette =
    tone === "amber"
      ? "bg-amber-600 hover:bg-amber-700"
      : "bg-vam-green hover:bg-vam-green/90";
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`rounded-md px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${palette}`}
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
  const [cancelState, cancelAction] = useFormState(bulkCancelApplicationReviewsAction, initialBulkCancelActionState);

  const [selectedReviewerId, setSelectedReviewerId] = useState<string>("");
  const [selectedAppIds, setSelectedAppIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<PoolTab>("unassigned");
  const [page, setPage] = useState(1);

  const allowedStatuses = reviewRound === "interview" ? INTERVIEW_ELIGIBLE_STATUSES : PROFILE_ASSIGNMENT_STATUSES;

  const validApps = useMemo(
    () => applications.filter((a) => a.status && allowedStatuses.has(a.status)),
    [applications, allowedStatuses]
  );

  const unassignedCount = useMemo(() => validApps.filter((a) => a.existing_review_count === 0).length, [validApps]);
  const assignedCount = validApps.length - unassignedCount;

  const tabbedApps = useMemo(() => {
    if (tab === "unassigned") return validApps.filter((a) => a.existing_review_count === 0);
    if (tab === "assigned") return validApps.filter((a) => a.existing_review_count > 0);
    return validApps;
  }, [validApps, tab]);

  const filteredApps = useMemo(() => {
    if (!searchQuery) return tabbedApps;
    const q = searchQuery.toLowerCase();
    return tabbedApps.filter((a) => (
      (a.full_name || "").toLowerCase().includes(q) ||
      (a.email_primary || "").toLowerCase().includes(q) ||
      (a.id || "").toLowerCase().includes(q)
    ));
  }, [tabbedApps, searchQuery]);

  const pageCount = Math.max(1, Math.ceil(filteredApps.length / LOT_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedApps = useMemo(
    () => filteredApps.slice((safePage - 1) * LOT_SIZE, safePage * LOT_SIZE),
    [filteredApps, safePage]
  );

  // Paging only. The SELECTION is deliberately additive and survives both the
  // search box and the tabs: an operator narrows the list, ticks a few, narrows
  // again, ticks more, then assigns the lot. Nothing unsafe can follow from a
  // stale tick, because `submittableIds` and `cancellableReviewIds` re-derive
  // eligibility from the data rather than trusting the checkbox.
  useEffect(() => {
    setPage(1);
  }, [tab, searchQuery]);

  useEffect(() => {
    if (state.ok || cancelState.ok) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setSelectedAppIds(new Set());
    }
  }, [state.ok, cancelState.ok]);

  const toggleApp = (id: string) => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Selects the lot on screen — not the whole intake behind it. */
  const selectPage = () => {
    setSelectedAppIds((prev) => {
      const next = new Set(prev);
      for (const a of pagedApps) next.add(a.id);
      return next;
    });
  };

  const deselectAll = () => setSelectedAppIds(new Set());

  const selectedReviewerName = useMemo(() => {
    const r = reviewers.find((r) => r.id === selectedReviewerId);
    return r ? staffDisplayLabel({ adminFullName: r.full_name, email: r.email, role: r.role }) : "";
  }, [reviewers, selectedReviewerId]);

  const reviewerNameById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of reviewers) {
      byId.set(r.id, staffDisplayLabel({ adminFullName: r.full_name, email: r.email, role: r.role }));
    }
    return byId;
  }, [reviewers]);

  // The sets actually submitted. Checkboxes are UI only: a checkbox for a row
  // hidden by the search filter or by paging is unmounted, and an unmounted
  // input is never serialised into FormData. Submitting straight from the
  // checkboxes would therefore silently act on fewer applications than the
  // operator selected. Hidden inputs rendered from these sets keep each
  // submitted payload equal to the confirmed selection.
  const submittableIds = useMemo(() => {
    const assignable = new Set(validApps.filter((a) => a.existing_review_count === 0).map((a) => a.id));
    return Array.from(selectedAppIds).filter((id) => assignable.has(id));
  }, [validApps, selectedAppIds]);

  const cancellableReviewIds = useMemo(() => {
    const byAppId = new Map<string, string>();
    for (const a of validApps) {
      if (a.existing_review_count > 0 && a.existing_review_id) byAppId.set(a.id, a.existing_review_id);
    }
    return Array.from(selectedAppIds)
      .map((id) => byAppId.get(id))
      .filter((reviewId): reviewId is string => Boolean(reviewId));
  }, [validApps, selectedAppIds]);

  const canSubmit = submittableIds.length > 0 && !!selectedReviewerId;
  const submitLabel = reviewRound === "interview" ? "Xác nhận giao phỏng vấn" : "Xác nhận giao hồ sơ";
  const unitLabel = reviewRound === "interview" ? "ứng viên phỏng vấn" : "hồ sơ";

  const tabs: Array<{ key: PoolTab; label: string; count: number }> = [
    { key: "unassigned", label: "Chưa giao", count: unassignedCount },
    { key: "assigned", label: "Đã giao", count: assignedCount },
    { key: "all", label: "Tất cả", count: validApps.length }
  ];

  return (
    <div className="space-y-6">
      {state.ok && state.message && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">{state.message}</p>
        </div>
      )}
      {!state.ok && state.message && <ErrorBox message={state.message} />}

      {cancelState.ok && cancelState.message && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <p className="font-medium">{cancelState.message}</p>
        </div>
      )}
      {!cancelState.ok && cancelState.message && <ErrorBox message={cancelState.message} />}
      {cancelState.failures.length > 0 && (
        <ul className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {cancelState.failures.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {/* ── The shared list ────────────────────────────────────────────── */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-800">DANH SÁCH ỨNG VIÊN</h3>
          <input
            type="text"
            placeholder="Tìm tên, email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>

        {/*
          Assigned work disappearing from the list is what made handing an
          application back impossible to find: once given out, it was simply
          gone from the only screen an admin opens for this job.
        */}
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Trạng thái phân công">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              data-testid={`pool-tab-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                tab === t.key
                  ? "border-vam-green bg-vam-mint text-vam-ink"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-slate-500">
            Hiển thị {pagedApps.length} / {filteredApps.length} · trang {safePage}/{pageCount}
            {selectedAppIds.size > 0 ? (
              <span className="ml-2 font-medium text-vam-ink">Đang chọn {selectedAppIds.size}</span>
            ) : null}
          </span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={selectPage} className="font-medium text-vam-green hover:underline">
              Chọn cả trang ({pagedApps.length})
            </button>
            <button type="button" onClick={deselectAll} className="font-medium text-slate-500 hover:underline">
              Bỏ chọn
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-10 px-4 py-2 text-left font-medium text-slate-500"></th>
                <th className="px-4 py-2 text-left font-medium text-slate-500">Ứng viên</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500">Nộp lúc</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500">Trạng thái</th>
                <th className="px-4 py-2 text-left font-medium text-slate-500">Người phụ trách</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {pagedApps.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {tab === "unassigned"
                      ? "Đã giao hết hồ sơ hợp lệ trong đợt này."
                      : "Không tìm thấy ứng viên nào."}
                  </td>
                </tr>
              ) : (
                pagedApps.map((a) => {
                  const isAssigned = a.existing_review_count > 0;
                  const assignee = isAssigned
                    ? (a.existing_reviewer_id ? reviewerNameById.get(a.existing_reviewer_id) : null) ?? "Đã phân công"
                    : null;
                  return (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${a.full_name || a.id}`}
                          checked={selectedAppIds.has(a.id)}
                          onChange={() => toggleApp(a.id)}
                          className="h-4 w-4 rounded border-slate-300 text-vam-green focus:ring-vam-green"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{a.full_name || "N/A"}</div>
                        <div className="text-xs text-slate-500">{a.email_primary}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {a.submitted_at ? formatDate(a.submitted_at) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadge(a.status)}`}>
                          {applicationStatusLabel(a.status)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {isAssigned ? (
                          <span className="font-medium">{assignee}</span>
                        ) : (
                          <span className="italic text-slate-400">Chưa giao</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="mt-3 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-600 disabled:opacity-40"
            >
              ← Lô trước
            </button>
            <span className="text-slate-500">
              Mỗi trang {LOT_SIZE} hồ sơ, cũ nhất trước
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={safePage >= pageCount}
              className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-600 disabled:opacity-40"
            >
              Lô sau →
            </button>
          </div>
        )}
      </div>

      {/* ── Assign ─────────────────────────────────────────────────────── */}
      <form action={formAction} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <input type="hidden" name="intake_batch_id" value={intakeBatchId} />
        <input type="hidden" name="role_applied" value={roleApplied} />
        <input type="hidden" name="review_round" value={reviewRound} />
        {submittableIds.map((id) => (
          <input key={id} type="hidden" name="application_ids" value={id} />
        ))}

        <h3 className="text-base font-semibold text-slate-800">GIAO CHO NGƯỜI PHỤ TRÁCH</h3>

        {reviewers.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p>Chưa có {reviewRound === "interview" ? "Người phỏng vấn" : "Người đánh giá hồ sơ"} cho mùa này.</p>
            <p className="mt-1">
              <Link href="/reviews/reviewer-pool" className="font-medium underline hover:text-amber-900">
                Mở Danh sách nhân sự tuyển sinh để cấp quyền.
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
              <option value="">
                {reviewRound === "interview" ? "-- Chọn người phỏng vấn --" : "-- Chọn người đánh giá hồ sơ --"}
              </option>
              {reviewers.map((r) => (
                <option key={r.id} value={r.id}>
                  {staffDisplayLabel({ adminFullName: r.full_name, email: r.email, role: r.role })}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-700">
            Bạn sắp giao <span className="font-bold text-vam-green">{submittableIds.length}</span> {unitLabel} cho{" "}
            <span className="font-bold text-slate-900">{selectedReviewerName || "…"}</span>.
          </p>
          <SubmitButton disabled={!canSubmit} label={submitLabel} />
        </div>
      </form>

      {/* ── Hand back ──────────────────────────────────────────────────── */}
      <form action={cancelAction} className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
        {cancellableReviewIds.map((id) => (
          <input key={id} type="hidden" name="review_id" value={id} />
        ))}

        <div>
          <h3 className="text-base font-semibold text-slate-800">HUỶ PHÂN CÔNG</h3>
          <p className="mt-1 text-sm text-slate-600">
            Chọn hồ sơ ở tab <b>Đã giao</b> rồi huỷ để trả chúng về hàng chờ. Hồ sơ quay lại tab{" "}
            <b>Chưa giao</b> và giao lại được cho người khác. Điểm và ghi chú người cũ đã nhập vẫn
            được giữ trong lịch sử, không bị xoá.
          </p>
        </div>

        <div className="max-w-lg">
          <label htmlFor="cancel-reason" className="block text-sm font-medium text-slate-700">
            Lý do huỷ <span className="text-red-600">*</span>
          </label>
          <input
            id="cancel-reason"
            name="reason"
            type="text"
            minLength={3}
            placeholder="VD: Reviewer bận, chia lại cho người khác"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-600"
          />
          <p className="mt-1 text-xs text-slate-500">
            Lý do được lưu vào lịch sử phân công của từng hồ sơ.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-200 pt-4">
          <p className="text-sm text-slate-700">
            Sắp trả <span className="font-bold text-amber-700">{cancellableReviewIds.length}</span> {unitLabel} về hàng chờ.
          </p>
          <SubmitButton
            tone="amber"
            disabled={cancellableReviewIds.length === 0}
            label="Huỷ phân công đã chọn"
          />
        </div>
      </form>
    </div>
  );
}
