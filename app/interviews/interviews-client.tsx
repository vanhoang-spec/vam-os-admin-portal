"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { claimInterviewReviewAction } from "@/app/actions/interview-claim";
import {
  initialClaimInterviewActionState,
  type ClaimInterviewActionState
} from "@/lib/interview-claim-action-types";
import type { InterviewCandidateRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusFilter =
  | "all"
  | "invited_to_interview"
  | "interview_scheduled"
  | "interview_in_progress"
  | "interview_completed";

const STATUS_LABELS: Record<string, string> = {
  invited_to_interview: "Đã mời PV",
  interview_scheduled: "Đã lên lịch",
  interview_in_progress: "Đang PV",
  interview_completed: "Đã hoàn thành"
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  invited_to_interview: "border-blue-200 bg-blue-50 text-blue-700",
  interview_scheduled: "border-purple-200 bg-purple-50 text-purple-700",
  interview_in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  interview_completed: "border-green-200 bg-green-50 text-green-700"
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  assigned: "Được giao",
  in_progress: "Đang làm",
  submitted: "Đã nộp",
  returned_for_clarification: "Cần làm rõ",
  cancelled: "Đã huỷ"
};

// ---------------------------------------------------------------------------
// Per-row claim button
// ---------------------------------------------------------------------------

function ClaimButtonInner({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-w-[9rem] justify-center rounded-md bg-vam-green px-3 py-1.5 text-xs font-medium text-white hover:bg-vam-green/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Đang xử lý…" : label}
    </button>
  );
}

function ClaimInterviewButton({
  row,
  currentUserId
}: {
  row: InterviewCandidateRow;
  currentUserId: string;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState<ClaimInterviewActionState, FormData>(
    claimInterviewReviewAction,
    initialClaimInterviewActionState
  );

  // Redirect to review page on success
  const lastReviewId = useRef("");
  useEffect(() => {
    if (state.ok && state.reviewId && state.reviewId !== lastReviewId.current) {
      lastReviewId.current = state.reviewId;
      router.push(`/reviews/${state.reviewId}`);
    }
  }, [router, state.ok, state.reviewId]);

  const myReviewId =
    row.interview_reviewer_admin_user_id === currentUserId
      ? row.interview_review_id
      : null;

  // Current user already has an active review → show continue link
  if (myReviewId) {
    return (
      <Link
        href={`/reviews/${myReviewId}`}
        className="inline-flex min-w-[9rem] justify-center rounded-md border border-vam-green px-3 py-1.5 text-xs font-medium text-vam-green hover:bg-vam-mint"
      >
        Tiếp tục phỏng vấn
      </Link>
    );
  }

  const buttonLabel =
    row.interview_review_id && !myReviewId ? "Bắt đầu (song song)" : "Bắt đầu phỏng vấn";

  return (
    <div className="flex flex-col gap-1.5">
      {/* Inline feedback */}
      {state.message && (
        <p
          className={`max-w-[14rem] text-xs ${state.ok ? "text-green-600" : "text-red-600"}`}
        >
          {state.ok ? "✓" : "✗"} {state.message.length > 70 ? `${state.message.slice(0, 70)}…` : state.message}
        </p>
      )}
      <form action={formAction}>
        <input type="hidden" name="application_id" value={row.id} />
        <ClaimButtonInner label={buttonLabel} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function InterviewsClient({
  rows,
  currentUserId
}: {
  rows: InterviewCandidateRow[];
  currentUserId: string;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Client-side filter
  const filtered = rows.filter((row) => {
    const s = row.status ?? "";
    if (statusFilter !== "all" && s !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchName = row.full_name?.toLowerCase().includes(q);
      const matchEmail = row.email_primary?.toLowerCase().includes(q);
      const matchPhone = row.phone_primary?.toLowerCase().includes(q);
      const matchSbd = row.sbd?.toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchPhone && !matchSbd) return false;
    }
    return true;
  });

  // Summary counts
  const counts = {
    all: rows.length,
    invited_to_interview: rows.filter((r) => r.status === "invited_to_interview").length,
    interview_scheduled: rows.filter((r) => r.status === "interview_scheduled").length,
    interview_in_progress: rows.filter((r) => r.status === "interview_in_progress").length,
    interview_completed: rows.filter((r) => r.status === "interview_completed").length
  };

  const filterPills: { value: StatusFilter; label: string; activeClass: string; inactiveClass: string }[] = [
    {
      value: "all",
      label: `Tất cả (${counts.all})`,
      activeClass: "border-vam-green bg-vam-green text-white",
      inactiveClass: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
    },
    {
      value: "invited_to_interview",
      label: `Đã mời (${counts.invited_to_interview})`,
      activeClass: "border-blue-600 bg-blue-600 text-white",
      inactiveClass: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
    },
    {
      value: "interview_scheduled",
      label: `Đã lên lịch (${counts.interview_scheduled})`,
      activeClass: "border-purple-600 bg-purple-600 text-white",
      inactiveClass: "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
    },
    {
      value: "interview_in_progress",
      label: `Đang PV (${counts.interview_in_progress})`,
      activeClass: "border-amber-600 bg-amber-600 text-white",
      inactiveClass: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
    },
    {
      value: "interview_completed",
      label: `Đã hoàn thành (${counts.interview_completed})`,
      activeClass: "border-green-600 bg-green-600 text-white",
      inactiveClass: "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
    }
  ];

  return (
    <div className="space-y-4">
      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {filterPills.map((pill) => (
          <button
            key={pill.value}
            type="button"
            onClick={() => setStatusFilter(pill.value)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              statusFilter === pill.value ? pill.activeClass : pill.inactiveClass
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="search"
        placeholder="Tìm theo tên, email, SĐT, SBD…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
      />

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-vam-line px-4 py-10 text-center text-sm text-slate-400">
          {rows.length === 0
            ? "Không có ứng viên nào được mời phỏng vấn trong batch này."
            : "Không có ứng viên nào khớp bộ lọc."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-vam-line">
          <table className="min-w-full divide-y divide-vam-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Ứng viên</th>
                <th className="px-4 py-3">Email / SĐT</th>
                <th className="px-4 py-3">SBD</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Review PV</th>
                <th className="px-4 py-3">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line bg-white">
              {filtered.map((row) => {
                const statusKey = row.status ?? "";
                const reviewStatusKey = row.interview_review_status ?? "";
                return (
                  <tr key={row.id} className="hover:bg-vam-mint/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/applications/${row.id}`}
                        className="font-medium text-vam-ink hover:text-vam-green hover:underline"
                      >
                        {row.full_name ?? <span className="text-slate-400">(Chưa có tên)</span>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{row.email_primary ?? <span className="text-slate-300">—</span>}</div>
                      {row.phone_primary && (
                        <div className="text-xs text-slate-400">{row.phone_primary}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.sbd ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                          STATUS_BADGE_CLASS[statusKey] ?? "border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        {STATUS_LABELS[statusKey] ?? statusKey}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.interview_review_id ? (
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${
                            reviewStatusKey === "submitted"
                              ? "border-green-200 bg-green-50 text-green-700"
                              : reviewStatusKey === "in_progress"
                              ? "border-amber-200 bg-amber-50 text-amber-700"
                              : "border-slate-200 bg-slate-50 text-slate-500"
                          }`}
                        >
                          {REVIEW_STATUS_LABELS[reviewStatusKey] ?? reviewStatusKey}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">Chưa có</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ClaimInterviewButton row={row} currentUserId={currentUserId} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-slate-400">
            Hiển thị {filtered.length} / {rows.length} ứng viên
          </p>
        </div>
      )}
    </div>
  );
}
