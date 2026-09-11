"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { useRouter } from "next/navigation";
import { inviteParticipantAction } from "@/app/actions/participants";
import { SubmitButton } from "@/components/submit-button";
import { initialParticipantInviteState, type ParticipantInviteState } from "@/lib/participant-action-types";
import type { AccountStatus, InvitableRole, RosterRowAction } from "@/lib/participant-invite-core";
import { matchesMentorQuery } from "@/lib/renewal-search";

/**
 * Một dòng đã dựng sẵn trên máy chủ.
 *
 * Nhãn, mốc giờ và nút nào được hiện đều tính ở máy chủ, bằng đúng các hàm máy
 * chủ dùng khi nhận lời mời. Trình duyệt chỉ lọc và hiển thị.
 */
export type RosterViewRow = {
  personId: string;
  fullName: string;
  email: string | null;
  roles: InvitableRole[];
  roleLabel: string;
  status: AccountStatus;
  statusLabel: string;
  detail: string | null;
  lastInviteLabel: string;
  activatedLabel: string;
  action: RosterRowAction | null;
  lockedUntilLabel: string | null;
  inFlight: boolean;
};

const VISIBLE_STEP = 50;

const STATUS_CHIP: Record<AccountStatus, string> = {
  not_invited: "border-slate-200 bg-slate-50 text-slate-600",
  send_failed: "border-amber-200 bg-amber-50 text-amber-800",
  invited_pending: "border-blue-200 bg-blue-50 text-blue-700",
  active: "border-green-200 bg-green-50 text-green-700",
  blocked: "border-red-200 bg-red-50 text-red-700"
};

const STATUS_FILTERS: Array<{ value: "all" | AccountStatus; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "not_invited", label: "Chưa mời" },
  { value: "send_failed", label: "Thư lỗi" },
  { value: "invited_pending", label: "Đã gửi thư, chưa vào" },
  { value: "active", label: "Đã vào" },
  { value: "blocked", label: "Không mời được" }
];

const ROLE_FILTERS: Array<{ value: "all" | InvitableRole; label: string }> = [
  { value: "all", label: "Tất cả vai trò" },
  { value: "mentor", label: "Mentor" },
  { value: "mentee", label: "Mentee" }
];

const ACTION_LABELS: Record<RosterRowAction, string> = {
  invite: "Mời",
  resend: "Gửi lại",
  reset: "Gửi link đặt lại mật khẩu"
};

function confirmTextFor(row: RosterViewRow): string | null {
  const who = row.email ? `${row.fullName} (${row.email})` : row.fullName;
  if (row.action === "resend") {
    return `Gửi lại thư mời cho ${who}? Đường dẫn trong thư trước sẽ không dùng được nữa.`;
  }
  if (row.action === "reset") {
    return `Gửi đường dẫn đặt lại mật khẩu cho ${who}? Mật khẩu hiện tại vẫn dùng được cho tới khi họ đặt mật khẩu mới.`;
  }
  return null;
}

function RowAction({ row, seasonId }: { row: RosterViewRow; seasonId: string }) {
  const router = useRouter();
  const [state, formAction] = useFormState<ParticipantInviteState, FormData>(
    inviteParticipantAction,
    initialParticipantInviteState
  );

  // Làm mới theo mốc máy chủ trả về, không theo nội dung lời báo: hai lần gửi
  // thành công liên tiếp cho ra cùng một câu.
  const lastAt = useRef(0);
  useEffect(() => {
    if (state.at && state.at !== lastAt.current) {
      lastAt.current = state.at;
      router.refresh();
    }
  }, [router, state.at]);

  if (row.inFlight) return <span className="text-xs text-slate-500">Đang gửi ở lượt khác…</span>;
  if (!row.action) return <span className="text-xs text-slate-400">—</span>;

  const confirmText = confirmTextFor(row);

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction}>
        <input type="hidden" name="person_id" value={row.personId} />
        <input type="hidden" name="season_id" value={seasonId} />
        <input type="hidden" name="mode" value={row.action === "reset" ? "reset" : "invite"} />
        <SubmitButton
          variant={row.action === "invite" ? "primary" : "outline"}
          pendingText="Đang gửi…"
          disabled={Boolean(row.lockedUntilLabel)}
          className="h-9 px-3 text-xs"
          onClick={(event) => {
            if (confirmText && !window.confirm(confirmText)) event.preventDefault();
          }}
        >
          {ACTION_LABELS[row.action]}
        </SubmitButton>
      </form>
      {row.lockedUntilLabel ? (
        <span className="text-xs text-slate-500">Gửi lại được sau {row.lockedUntilLabel}</span>
      ) : null}
      {state.message ? (
        <p role="status" className={`text-xs ${state.ok ? "text-green-700" : "text-red-700"}`}>
          {state.ok ? "✓" : "✗"} {state.message}
        </p>
      ) : null}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        active ? "border-vam-green bg-vam-green text-white" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

export function RosterClient({ rows, seasonId }: { rows: RosterViewRow[]; seasonId: string }) {
  const [role, setRole] = useState<"all" | InvitableRole>("all");
  const [status, setStatus] = useState<"all" | AccountStatus>("all");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(VISIBLE_STEP);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { all: rows.length, mentor: 0, mentee: 0 };
    rows.forEach((row) => row.roles.forEach((value) => (counts[value] += 1)));
    return counts;
  }, [rows]);

  const byRole = useMemo(
    () => (role === "all" ? rows : rows.filter((row) => row.roles.includes(role))),
    [rows, role]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: byRole.length };
    byRole.forEach((row) => (counts[row.status] = (counts[row.status] ?? 0) + 1));
    return counts;
  }, [byRole]);

  const filtered = useMemo(
    () =>
      byRole.filter(
        (row) =>
          (status === "all" || row.status === status) &&
          matchesMentorQuery({ fullName: row.fullName, email: row.email, mentorCode: null }, query)
      ),
    [byRole, status, query]
  );
  const shown = filtered.slice(0, visible);

  const resetVisible = () => setVisible(VISIBLE_STEP);

  return (
    <section className="space-y-4" aria-label="Danh sách tài khoản">
      <div className="flex flex-wrap gap-2">
        {ROLE_FILTERS.map((option) => (
          <Pill
            key={option.value}
            active={role === option.value}
            onClick={() => {
              setRole(option.value);
              resetVisible();
            }}
          >
            {option.label} ({roleCounts[option.value] ?? 0})
          </Pill>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((option) => (
          <Pill
            key={option.value}
            active={status === option.value}
            onClick={() => {
              setStatus(option.value);
              resetVisible();
            }}
          >
            {option.label} ({statusCounts[option.value] ?? 0})
          </Pill>
        ))}
      </div>

      <input
        type="search"
        aria-label="Tìm theo tên hoặc email"
        placeholder="Tìm theo tên hoặc email (gõ không dấu cũng được)"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          resetVisible();
        }}
        className="w-full max-w-md rounded-md border border-vam-line px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
      />

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-vam-line bg-white px-4 py-8 text-center text-sm text-slate-500">
          {rows.length === 0 ? "Mùa này chưa có mentor hay mentee chính thức nào." : "Không có ai khớp bộ lọc."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-vam-line">
          <table className="min-w-full divide-y divide-vam-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Họ tên</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Vai trò</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Thư gần nhất</th>
                <th className="px-4 py-3">Đăng nhập lần đầu</th>
                <th className="px-4 py-3">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line bg-white">
              {shown.map((row) => (
                <tr key={row.personId} data-person-id={row.personId} className="align-top">
                  <td className="px-4 py-3 font-medium text-vam-ink">{row.fullName}</td>
                  <td className="px-4 py-3 text-slate-600">{row.email ?? <span className="text-slate-400">Chưa có</span>}</td>
                  <td className="px-4 py-3 text-slate-600">{row.roleLabel}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_CHIP[row.status]}`}>
                      {row.statusLabel}
                    </span>
                    {row.detail ? <p className="mt-1 text-xs text-slate-500">{row.detail}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{row.lastInviteLabel}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{row.activatedLabel}</td>
                  <td className="px-4 py-3">
                    <RowAction row={row} seasonId={seasonId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-slate-500">
            <span>
              Hiển thị {shown.length}/{filtered.length}
              {filtered.length > shown.length ? " — gõ thêm để thu hẹp" : ""}
            </span>
            {filtered.length > shown.length ? (
              <button
                type="button"
                onClick={() => setVisible((count) => count + VISIBLE_STEP)}
                className="rounded-md border border-vam-line px-3 py-1 font-medium text-vam-green hover:bg-vam-mint"
              >
                Xem thêm {Math.min(VISIBLE_STEP, filtered.length - shown.length)}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
