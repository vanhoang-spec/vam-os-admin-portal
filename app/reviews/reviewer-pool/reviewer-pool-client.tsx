"use client";

import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { enableMentorAsReviewerAction } from "@/app/actions/enable-reviewer";
import {
  initialEnableReviewerActionState,
  type EnableReviewerActionState
} from "@/lib/enable-reviewer-action-types";
import type { ReviewerPoolRow } from "@/lib/types";

/**
 * A pool row, optionally carrying what the mentor said on the season
 * confirmation form. The season-sourced list fills these in; the older
 * batch-sourced fallback leaves them undefined.
 */
export type ReviewerPoolClientRow = ReviewerPoolRow & {
  agree_to_review?: boolean | null;
  agree_to_interview?: boolean | null;
  max_mentees?: number | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AccountStatus = "no_account" | "reviewer_active" | "reviewer_inactive" | "higher_active" | "higher_inactive" | "other";

/** Maps a pool row to a display status bucket. */
function getAccountStatus(row: ReviewerPoolClientRow): AccountStatus {
  if (!row.admin_user_id) return "no_account";
  const role = String(row.admin_user_role ?? "");
  const status = String(row.admin_user_status ?? "");
  const isHigher = ["super_admin", "admin", "core_team"].includes(role);
  if (isHigher) return status === "active" ? "higher_active" : "higher_inactive";
  if (role === "reviewer") return status === "active" ? "reviewer_active" : "reviewer_inactive";
  // viewer / support_team with an admin_users row → treat as no_account for display
  return "no_account";
}

const STATUS_LABELS: Record<AccountStatus, string> = {
  no_account: "Chưa có tài khoản",
  reviewer_active: "Reviewer (active)",
  reviewer_inactive: "Reviewer (inactive)",
  higher_active: "Admin / Core team",
  higher_inactive: "Admin (tạm khóa)",
  other: "Khác"
};

const STATUS_BADGE_CLASS: Record<AccountStatus, string> = {
  no_account: "border-slate-200 bg-slate-50 text-slate-500",
  reviewer_active: "border-green-200 bg-green-50 text-green-700",
  reviewer_inactive: "border-amber-200 bg-amber-50 text-amber-700",
  higher_active: "border-blue-200 bg-blue-50 text-blue-700",
  higher_inactive: "border-amber-200 bg-amber-50 text-amber-700",
  other: "border-slate-200 bg-slate-50 text-slate-500"
};

type FilterOption = "all" | AccountStatus;

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "no_account", label: "Chưa có tài khoản" },
  { value: "reviewer_active", label: "Reviewer active" },
  { value: "reviewer_inactive", label: "Reviewer inactive" },
  { value: "higher_active", label: "Admin / Core team" }
];

// ---------------------------------------------------------------------------
// Per-row enable button (isolated useFormState)
// ---------------------------------------------------------------------------

function EnableButtonInner({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex min-w-[7rem] justify-center rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Đang xử lý…" : "Cấp quyền reviewer"}
    </button>
  );
}

function EnableReviewerButton({
  personId,
  accountStatus
}: {
  personId: string;
  accountStatus: AccountStatus;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState<EnableReviewerActionState, FormData>(
    enableMentorAsReviewerAction,
    initialEnableReviewerActionState
  );

  // Auto-refresh server data on success
  const lastMsg = useRef("");
  useEffect(() => {
    if (state.ok && state.message && state.message !== lastMsg.current) {
      lastMsg.current = state.message ?? "";
      router.refresh();
    }
  }, [router, state.ok, state.message]);

  // Derive button label + disabled state from current account status
  const alreadyDone = accountStatus === "reviewer_active";
  const higherRole = accountStatus === "higher_active";
  const isDisabled = alreadyDone || higherRole;

  const buttonLabel = alreadyDone
    ? "Đã là reviewer"
    : higherRole
    ? "Quyền cao hơn"
    : accountStatus === "reviewer_inactive" || accountStatus === "higher_inactive"
    ? "Kích hoạt lại"
    : "Cấp quyền reviewer";

  return (
    <div className="flex flex-col gap-1">
      {/* Show feedback from last action */}
      {state.message ? (
        <p
          className={`text-xs ${state.ok ? "text-green-600" : "text-red-600"}`}
          title={state.message}
        >
          {state.ok ? "✓" : "✗"} {state.message.length > 60 ? `${state.message.slice(0, 60)}…` : state.message}
        </p>
      ) : null}

      {isDisabled ? (
        <span className="inline-flex min-w-[7rem] justify-center rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-400">
          {buttonLabel}
        </span>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="person_id" value={personId} />
          <EnableButtonInner disabled={false} />
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function ReviewerPoolClient({
  rows,
  showAgreementColumns = false
}: {
  rows: ReviewerPoolClientRow[];
  showAgreementColumns?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterOption>("all");

  // --- Client-side filter
  const filtered = rows.filter((row) => {
    const bucket = getAccountStatus(row);
    if (statusFilter !== "all" && bucket !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !row.full_name?.toLowerCase().includes(q) &&
        !row.email_primary?.toLowerCase().includes(q) &&
        !row.mentor_code?.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // --- Summary stats
  const stats = {
    total: rows.length,
    no_account: rows.filter((r) => getAccountStatus(r) === "no_account").length,
    reviewer_active: rows.filter((r) => getAccountStatus(r) === "reviewer_active").length,
    reviewer_inactive: rows.filter((r) => getAccountStatus(r) === "reviewer_inactive").length,
    higher: rows.filter((r) => ["higher_active", "higher_inactive"].includes(getAccountStatus(r))).length
  };

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${statusFilter === "all" ? "border-vam-green bg-vam-green text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
        >
          Tất cả ({stats.total})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("no_account")}
          className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${statusFilter === "no_account" ? "border-slate-600 bg-slate-600 text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
        >
          Chưa có tài khoản ({stats.no_account})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("reviewer_active")}
          className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${statusFilter === "reviewer_active" ? "border-green-600 bg-green-600 text-white" : "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"}`}
        >
          Reviewer active ({stats.reviewer_active})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("reviewer_inactive")}
          className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${statusFilter === "reviewer_inactive" ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
        >
          Reviewer inactive ({stats.reviewer_inactive})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("higher_active")}
          className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${statusFilter === "higher_active" ? "border-blue-600 bg-blue-600 text-white" : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"}`}
        >
          Admin / Core team ({stats.higher})
        </button>
      </div>

      {/* Search input */}
      <input
        type="search"
        placeholder="Tìm theo tên, email, mentor code…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
      />

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-vam-line px-4 py-8 text-center text-sm text-slate-400">
          {rows.length === 0
            ? "Không có mentor nào có email trong hệ thống."
            : "Không có mentor nào khớp bộ lọc."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-vam-line">
          <table className="min-w-full divide-y divide-vam-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Tên mentor</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Mentor code</th>
                {showAgreementColumns ? (
                  <>
                    <th className="px-4 py-3">Đồng ý chấm</th>
                    <th className="px-4 py-3">Đồng ý phỏng vấn</th>
                    <th className="px-4 py-3">Nhận tối đa</th>
                  </>
                ) : null}
                <th className="px-4 py-3">Tài khoản hiện tại</th>
                <th className="px-4 py-3">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line bg-white">
              {filtered.map((row) => {
                const bucket = getAccountStatus(row);
                return (
                  <tr key={row.mentor_profile_id} className="hover:bg-vam-mint/30">
                    <td className="px-4 py-3 font-medium text-vam-ink">
                      {row.full_name ?? <span className="text-slate-400">(Chưa có tên)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.email_primary}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.mentor_code ?? <span className="text-slate-300">—</span>}
                    </td>
                    {showAgreementColumns ? (
                      <>
                        <td className="px-4 py-3 text-xs">
                          {row.agree_to_review === true ? (
                            <span className="font-medium text-vam-green">Có</span>
                          ) : row.agree_to_review === false ? (
                            <span className="text-slate-500">Không</span>
                          ) : (
                            <span className="text-slate-300">Chưa trả lời</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {row.agree_to_interview === true ? (
                            <span className="font-medium text-vam-green">Có</span>
                          ) : row.agree_to_interview === false ? (
                            <span className="text-slate-500">Không</span>
                          ) : (
                            <span className="text-slate-300">Chưa trả lời</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {row.max_mentees ? `${row.max_mentees} mentee` : "—"}
                        </td>
                      </>
                    ) : null}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[bucket]}`}
                      >
                        {STATUS_LABELS[bucket]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.person_id ? (
                        <EnableReviewerButton
                          personId={row.person_id}
                          accountStatus={bucket}
                        />
                      ) : (
                        <span className="text-xs text-slate-300">Thiếu person_id</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-slate-400">
            Hiển thị {filtered.length} / {rows.length} mentor có email
          </p>
        </div>
      )}
    </div>
  );
}
