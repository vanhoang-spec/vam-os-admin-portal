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
import { adminRoleLabel, hasIntrinsicRecruitmentRights } from "@/lib/ui-labels";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AccountStatus = "no_account" | "reviewer_active" | "reviewer_inactive" | "higher_active" | "higher_inactive" | "other";

/** Maps a pool row to a display status bucket. */
function getAccountStatus(row: ReviewerPoolRow): AccountStatus {
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
  reviewer_active: "Đang có quyền đánh giá",
  reviewer_inactive: "Đã thu hồi quyền đánh giá",
  higher_active: "Quản trị / Ban Điều hành",
  higher_inactive: "Quản trị viên (tạm khóa)",
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
  { value: "reviewer_active", label: "Đang có quyền đánh giá" },
  { value: "reviewer_inactive", label: "Đã thu hồi quyền đánh giá" },
  { value: "higher_active", label: "Quản trị / Ban Điều hành" }
];

/**
 * What a privileged account may actually do this season, stated rather than
 * offered.
 *
 * The right is ROLE-derived, so there is nothing to grant and nothing a
 * participation revoke could take away — but it is not unconditional. The
 * canonical policy also requires an ACTIVE scope for the TARGET season, and
 * `profileEligible` / `interviewEligible` come from the same source the
 * assignment dropdowns read. Claiming "Có quyền theo vai trò" from role and
 * status alone is what let this screen disagree with the Interview dropdown
 * for the same person on the same batch.
 *
 * A privileged account with no target-season eligibility is most often simply
 * OUT OF SCOPE for this batch — a Super Admin sees accounts across programmes,
 * and a HAM Core Team member is correctly not a UEHM-S12 recruitment
 * participant. Visibility is not eligibility. Such a row is labelled as out of
 * scope and offered nothing: no badge, no participation grant, and no scope is
 * manufactured for it.
 */
function IntrinsicRightsBadges({
  role,
  seasonSelected,
  profileEligible,
  interviewEligible
}: {
  role: string | null;
  seasonSelected: boolean;
  profileEligible: boolean;
  interviewEligible: boolean;
}) {
  if (!seasonSelected) {
    return (
      <span className="text-xs text-slate-500" data-testid="intrinsic-rights-unknown">
        Chọn đợt tuyển để xem quyền theo mùa.
      </span>
    );
  }

  if (!profileEligible && !interviewEligible) {
    return (
      <div className="flex flex-col gap-1" data-testid="intrinsic-rights-none">
        <span className="inline-flex w-fit items-center rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
          Không thuộc phạm vi đợt tuyển này
        </span>
        <span className="text-[11px] leading-4 text-slate-500">
          Tài khoản {adminRoleLabel(role)} của chương trình khác, hiển thị vì bạn có quyền xem toàn
          hệ thống. Không tham gia tuyển sinh của đợt này.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="intrinsic-rights">
      <RightBadge label="Đánh giá hồ sơ" granted={profileEligible} />
      <RightBadge label="Phỏng vấn" granted={interviewEligible} />
      <span className="text-[11px] leading-4 text-slate-500">
        Theo vai trò {adminRoleLabel(role)} và phạm vi mùa hiện tại. Hệ thống áp dụng tự động, không
        cần thao tác thủ công.
      </span>
    </div>
  );
}

function RightBadge({ label, granted }: { label: string; granted: boolean }) {
  return (
    <span
      data-testid={granted ? "right-granted" : "right-missing"}
      className={
        granted
          ? "inline-flex w-fit items-center rounded-md border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800"
          : "inline-flex w-fit items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500"
      }
    >
      {label}: {granted ? "Có quyền theo vai trò" : "Không thuộc phạm vi đợt tuyển này"}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Per-row enable button (isolated useFormState)
// ---------------------------------------------------------------------------

function EnableButtonInner({ disabled, label, revoke }: { disabled: boolean; label: string; revoke: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`inline-flex min-w-[7rem] justify-center rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${revoke ? "border-red-200 text-red-700 hover:bg-red-50" : "border-vam-line text-vam-green hover:bg-vam-mint"}`}
    >
      {pending ? "Đang xử lý…" : label}
    </button>
  );
}

function EnableReviewerButton({
  personId,
  accountStatus,
  seasonId,
  participationRole,
  active
}: {
  personId: string;
  accountStatus: AccountStatus;
  seasonId: string | null;
  participationRole: "reviewer" | "interviewer";
  active: boolean;
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
  const isDisabled = !seasonId;
  // "quyền đánh giá" / "quyền phỏng vấn" — the participation being granted,
  // not the English role noun.
  const rightLabel = participationRole === "reviewer" ? "quyền đánh giá" : "quyền phỏng vấn";
  const buttonLabel = active ? `Thu hồi ${rightLabel}` : `Cấp ${rightLabel}`;

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

      <form action={formAction}>
          <input type="hidden" name="person_id" value={personId} />
          <input type="hidden" name="season_id" value={seasonId ?? ""} />
          <input type="hidden" name="participation_role" value={participationRole} />
          <input type="hidden" name="operation" value={active ? "revoke" : "grant"} />
          <EnableButtonInner disabled={isDisabled} label={buttonLabel} revoke={active} />
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

export function ReviewerPoolClient({
  rows,
  seasonId,
  activeReviewerIds,
  activeInterviewerIds
}: {
  rows: ReviewerPoolRow[];
  seasonId: string | null;
  activeReviewerIds: string[];
  activeInterviewerIds: string[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterOption>("all");
  const activeReviewerSet = new Set(activeReviewerIds);
  const activeInterviewerSet = new Set(activeInterviewerIds);

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
          Đang có quyền đánh giá ({stats.reviewer_active})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("reviewer_inactive")}
          className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${statusFilter === "reviewer_inactive" ? "border-amber-600 bg-amber-600 text-white" : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
        >
          Đã thu hồi quyền đánh giá ({stats.reviewer_inactive})
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
              ? "Không có tài khoản nào có email trong hệ thống."
              : "Không có tài khoản nào khớp bộ lọc."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-vam-line">
          <table className="min-w-full divide-y divide-vam-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Tên</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Mã Mentor</th>
                <th className="px-4 py-3">Tài khoản hiện tại</th>
                <th className="px-4 py-3">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line bg-white">
              {filtered.map((row) => {
                const bucket = getAccountStatus(row);
                // Whether this account's authority is ROLE-derived decides
                // which control model applies: a privileged account's rights
                // are not a participation grant, so offering "Thu hồi" invites
                // an operator to try, fail, and lose confidence in the screen.
                const roleDerived = hasIntrinsicRecruitmentRights({
                  role: row.admin_user_role,
                  status: row.admin_user_status
                });
                // ...but whether the right currently HOLDS for this season is
                // never decided here. Both answers come from the same canonical
                // source the dropdowns use (vam084_recruitment_eligible_admins,
                // via getReviewEligibleReviewers). Deriving the badge from
                // role/status alone is what let the pool claim "Có quyền theo
                // vai trò" for an account the Interview dropdown did not list —
                // a privileged account with no ACTIVE scope for the target
                // season is eligible for neither round.
                const canonicalProfile = Boolean(row.admin_user_id && activeReviewerSet.has(row.admin_user_id));
                const canonicalInterview = Boolean(row.admin_user_id && activeInterviewerSet.has(row.admin_user_id));
                return (
                  <tr key={row.person_id ?? row.mentor_profile_id ?? row.email_primary ?? row.admin_user_id} className="hover:bg-vam-mint/30">
                    <td className="px-4 py-3 font-medium text-vam-ink">
                      {row.full_name ?? <span className="text-slate-400">(Chưa có tên)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.email_primary}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.mentor_code ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[bucket]}`}
                      >
                        {STATUS_LABELS[bucket]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {roleDerived ? (
                        <IntrinsicRightsBadges
                          role={row.admin_user_role}
                          seasonSelected={Boolean(seasonId)}
                          profileEligible={canonicalProfile}
                          interviewEligible={canonicalInterview}
                        />
                      ) : row.person_id ? (
                        <div className="flex flex-col gap-2">
                          <EnableReviewerButton personId={row.person_id} accountStatus={bucket} seasonId={seasonId} participationRole="reviewer" active={Boolean(row.admin_user_id && activeReviewerSet.has(row.admin_user_id))} />
                          <EnableReviewerButton personId={row.person_id} accountStatus={bucket} seasonId={seasonId} participationRole="interviewer" active={Boolean(row.admin_user_id && activeInterviewerSet.has(row.admin_user_id))} />
                        </div>
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
            Hiển thị {filtered.length} / {rows.length} tài khoản có email
          </p>
        </div>
      )}
    </div>
  );
}
