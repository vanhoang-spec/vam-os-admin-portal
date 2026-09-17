"use client";
import React, { useState, useEffect } from "react";
import { useFormState } from "react-dom";
import {
  addMembershipRoleAction,
  transitionMembershipAction,
} from "@/app/actions/membership-lifecycle";
import {
  isMembershipRole,
  isParticipationRole,
  MEMBERSHIP_ACTION_LABELS,
  MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLE_LABELS,
  membershipChangeDeniedMessage,
  membershipOperationNeedsReason,
  otherMembershipActions,
  PARTICIPATION_MOVE_LABELS,
  participationView,
  type MembershipLifecycleOperation,
  type ParticipationMove,
  initialMembershipLifecycleState,
} from "@/lib/membership-lifecycle";
import { canChangeSeasonMembership } from "@/lib/permissions";
import { SubmitButton } from "@/components/submit-button";
import {
  resolveContinuationLineage,
  isEligibleSourceMembership,
  isSuppressedForRole,
} from "@/lib/season-lineage";

type Membership = {
  id: string;
  role: string;
  status: string;
  intakeBatchCode: string | null;
  programLabel: string;
  seasonLabel: string;
  authorizationScopeLevel?: string | null;
  programCode?: string | null;
  seasonCode?: string | null;
  programId?: string;
  seasonId?: string;
};
type Option = {
  id: string;
  label: string;
  code?: string;
  programId?: string;
  isActive?: boolean | null;
};

function Feedback({
  state,
}: {
  state: typeof initialMembershipLifecycleState;
}) {
  return state.message ? (
    <p
      role="status"
      className={state.ok ? "text-sm text-green-700" : "text-sm text-red-700"}
    >
      {state.message}
    </p>
  ) : null;
}

function roleLabelOf(role: string) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return isMembershipRole(normalized) ? MEMBERSHIP_ROLE_LABELS[normalized] : role;
}

/**
 * Câu hỏi lại trước khi đổi tham dự nói luôn hệ quả: danh sách Mentor/Mentee của
 * mùa, thư gửi theo mùa và lời mời tạo tài khoản đều chỉ đọc membership đang
 * active. Một câu "Xác nhận?" trần không cho người bấm biết mình vừa đưa ai ra
 * khỏi những thứ đó.
 */
function participationConfirmMessage(move: ParticipationMove, membership: Membership) {
  const who = `${roleLabelOf(membership.role)} · ${membership.seasonLabel}`;
  if (move === "opt_out") {
    return `Chuyển ${who} sang "Không tham dự"? Người này sẽ ra khỏi danh sách ${roleLabelOf(membership.role)} của mùa, không nằm trong thư gửi hàng loạt theo mùa và không được mời tạo tài khoản. Chuyển lại được bất cứ lúc nào.`;
  }
  return `Chuyển ${who} sang "Tham dự"? Người này sẽ vào lại danh sách ${roleLabelOf(membership.role)} chính thức của mùa.`;
}

function TransitionForm({
  personId,
  membership,
  operation,
  isLocked,
  onLock,
  onUnlock,
  label: labelOverride,
  confirmMessage,
  primary = false,
}: {
  personId: string;
  membership: Membership;
  operation: MembershipLifecycleOperation;
  isLocked: boolean;
  onLock: () => void;
  onUnlock: () => void;
  label?: string;
  confirmMessage?: string;
  primary?: boolean;
}) {
  const [state, action] = useFormState(
    transitionMembershipAction,
    initialMembershipLifecycleState,
  );
  const required = membershipOperationNeedsReason(operation);
  const label = labelOverride ?? MEMBERSHIP_ACTION_LABELS[operation];

  useEffect(() => {
    if (state !== initialMembershipLifecycleState) {
      onUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (isLocked) {
      event.preventDefault();
      return;
    }
    if (
      !window.confirm(
        confirmMessage ?? `Xác nhận ${label.toLowerCase()} cho membership này?`,
      )
    ) {
      event.preventDefault();
      return;
    }
    onLock();
  };

  return (
    <form
      action={action}
      className="grid gap-2 rounded-md border border-vam-line bg-white p-3"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="person_id" value={personId} />
      <input type="hidden" name="membership_id" value={membership.id} />
      <input type="hidden" name="expected_status" value={membership.status} />
      <input type="hidden" name="operation" value={operation} />
      <label className="text-xs text-slate-600">
        Lý do {required ? "(bắt buộc)" : "(không bắt buộc)"}
        <input
          name="reason"
          required={required}
          maxLength={500}
          className="mt-1 w-full rounded-md border border-vam-line px-3 py-2 text-sm"
        />
      </label>
      <SubmitButton
        variant={primary ? "primary" : "outline"}
        className={
          primary
            ? "justify-self-start px-3 py-2 text-sm font-medium"
            : "justify-self-start border-vam-line px-3 py-2 text-sm font-medium text-vam-green"
        }
        disabled={isLocked}
        pendingText={`Đang ${label.toLowerCase()}...`}
      >
        {label}
      </SubmitButton>
      <Feedback state={state} />
    </form>
  );
}

export function MembershipLifecycleControls({
  personId,
  memberships,
  programs,
  seasons,
  enabled,
  canOperateUehmS12,
  adminRole,
}: {
  personId: string;
  memberships: Membership[];
  programs: Option[];
  seasons: Option[];
  enabled: boolean;
  canOperateUehmS12?: boolean;
  /**
   * Vai trò của người đang xem. Bắt buộc, không có mặc định: thiếu nó thì không
   * vai trò nào đổi được, thay vì mọi nút hiện ra rồi server từ chối.
   */
  adminRole: string | null;
}) {
  const [addState, addAction] = useFormState(
    addMembershipRoleAction,
    initialMembershipLifecycleState,
  );
  const [pendingMembershipId, setPendingMembershipId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setPendingMembershipId(null);
  }, [addState]);

  const handleAddSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    // Only block if we already submitted THIS form type.
    const buttonName =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") ||
      "add_new";
    if (pendingMembershipId === buttonName) {
      event.preventDefault();
      return;
    }
    if (
      !window.confirm(
        buttonName === "continue_s12"
          ? "Xác nhận tiếp tục sang Mùa 12?"
          : "Xác nhận thêm vai trò active cho person này?",
      )
    ) {
      event.preventDefault();
      return;
    }
    setPendingMembershipId(buttonName);
  };

  if (!enabled)
    return (
      <p className="text-sm text-slate-600">
        Cần quyền operations hoặc full_access trong season để quản lý lifecycle.
      </p>
    );

  const lineage = resolveContinuationLineage(programs, seasons);

  const missingS12Roles: {
    role: string;
    programId: string;
    seasonId: string;
    programLabel: string;
    seasonLabel: string;
  }[] = [];

  const normalize = (val: string) =>
    String(val ?? "")
      .trim()
      .toLowerCase();

  // Chỉ những vai trò người xem được đổi. Support Team không thấy Mentor trong ô
  // chọn; không còn vai trò nào thì không dựng form thêm vai trò.
  const addableRoles = MEMBERSHIP_ROLES.filter((value) =>
    canChangeSeasonMembership(adminRole, value),
  );

  const finalBranch = lineage.ok && canOperateUehmS12;

  if (finalBranch) {
    const uehmProgram = programs.find((p) => p.id === lineage.targetProgramId)!;
    const s12Season = seasons.find((s) => s.id === lineage.targetSeasonId)!;

    const s11Memberships = memberships.filter((m) =>
      isEligibleSourceMembership(m, lineage.sourceSeasonId)
    );

    for (const s11 of s11Memberships) {
      const normalizedRole = normalize(s11.role);
      const isSuppressed = isSuppressedForRole(memberships, lineage.targetSeasonId, normalizedRole);

      if (!isSuppressed && canChangeSeasonMembership(adminRole, normalizedRole)) {
        if (!missingS12Roles.some((m) => m.role === normalizedRole)) {
          missingS12Roles.push({
            role: normalizedRole,
            programId: lineage.targetProgramId,
            seasonId: lineage.targetSeasonId,
            programLabel: uehmProgram.label,
            seasonLabel: s12Season.label,
          });
        }
      }
    }
  }

  return (
    <div className="grid gap-4">
      {memberships.map((membership) => {
        const canChange = canChangeSeasonMembership(adminRole, membership.role);
        const participation = isParticipationRole(membership.role)
          ? participationView(membership.status)
          : null;
        const actions = otherMembershipActions(membership.role, membership.status);
        const isLocked = pendingMembershipId === membership.id;
        const lockProps = {
          personId,
          membership,
          isLocked,
          onLock: () => setPendingMembershipId(membership.id),
          onUnlock: () =>
            setPendingMembershipId((prev) =>
              prev === membership.id ? null : prev,
            ),
        };

        return (
          <section
            key={membership.id}
            data-vam-membership-id={membership.id}
            data-vam-intake-batch={membership.intakeBatchCode ?? undefined}
            data-vam-program-scope={
              membership.authorizationScopeLevel ?? undefined
            }
            data-vam-program-code={membership.programCode ?? undefined}
            data-vam-season-code={membership.seasonCode ?? undefined}
            className="rounded-md border border-vam-line bg-slate-50 p-3"
          >
            <div className="mb-3 text-sm">
              <strong>
                {membership.programLabel} / {membership.seasonLabel}
              </strong>
              <span className="ml-2">
                {roleLabelOf(membership.role)} ·{" "}
                {participation ? participation.label : membership.status}
              </span>
            </div>
            {!canChange ? (
              <p className="text-sm text-slate-600">
                {membershipChangeDeniedMessage(membership.role)}
              </p>
            ) : (
              <div className="grid gap-3">
                {participation?.moves.length ? (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {participation.moves.map((move) => (
                      <TransitionForm
                        key={move}
                        {...lockProps}
                        operation={move}
                        label={PARTICIPATION_MOVE_LABELS[move]}
                        confirmMessage={participationConfirmMessage(move, membership)}
                        primary
                      />
                    ))}
                  </div>
                ) : null}
                {actions.length ? (
                  <div className="grid gap-2">
                    {participation ? (
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Thao tác khác
                      </p>
                    ) : null}
                    <div className="grid gap-2 lg:grid-cols-2">
                      {actions.map((operation) => (
                        <TransitionForm
                          key={operation}
                          {...lockProps}
                          operation={operation}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {!actions.length && !participation?.moves.length ? (
                  <p className="text-sm text-slate-600">
                    Không có thao tác lifecycle hợp lệ từ trạng thái này.
                  </p>
                ) : null}
              </div>
            )}
          </section>
        );
      })}

      {missingS12Roles.map((missing) => (
        <section
          key={`missing-s12-${missing.role}`}
          className="rounded-md border border-vam-line bg-slate-50 p-3"
        >
          <div className="mb-3 text-sm">
            <strong>
              {missing.programLabel} / {missing.seasonLabel}
            </strong>
            <span className="ml-2">
              {missing.role} · Chưa chuyển sang Mùa 12
            </span>
          </div>
          <form
            action={addAction}
            className="grid gap-2 lg:grid-cols-2"
            onSubmit={handleAddSubmit}
          >
            <input type="hidden" name="person_id" value={personId} />
            <input type="hidden" name="program_id" value={missing.programId} />
            <input type="hidden" name="season_id" value={missing.seasonId} />
            <input type="hidden" name="role" value={missing.role} />
            <input
              type="hidden"
              name="reason"
              value="Tiếp tục tham gia Mùa 12"
            />
            <SubmitButton
              name="continue_s12"
              disabled={pendingMembershipId === "continue_s12"}
              pendingText="Đang xử lý..."
              className="justify-self-start bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
            >
              Tiếp tục sang Mùa 12
            </SubmitButton>
            {pendingMembershipId === "continue_s12" && (
              <Feedback state={addState} />
            )}
          </form>
        </section>
      ))}

      {addableRoles.length ? (
        <form
          action={addAction}
          className="grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3"
          onSubmit={handleAddSubmit}
        >
          <h3 className="font-medium">Thêm vai trò membership</h3>
          <input type="hidden" name="person_id" value={personId} />
          {/*
            Every select opens on an empty placeholder rather than on its first
            option. A browser select with no defaultValue silently pre-selects
            option 0, so this form previously arrived pre-filled with whichever
            program and season happened to sort first, and with Mentor — which is
            wrong for an approved mentee. The operator had to notice and change a
            value that already looked chosen. `required` plus an empty value means
            an unchosen field cannot be submitted at all, and the server action's
            uuid/role validation rejects it as a second line of defence.
          */}
          <label className="text-sm">
            Program
            <select
              name="program_id"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2"
            >
              <option value="" disabled>
                — Chọn program —
              </option>
              {programs.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Season
            <select
              name="season_id"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2"
            >
              <option value="" disabled>
                — Chọn season —
              </option>
              {seasons.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Vai trò
            <select
              name="role"
              required
              defaultValue=""
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2"
            >
              <option value="" disabled>
                — Chọn vai trò —
              </option>
              {addableRoles.map((value) => (
                <option key={value} value={value}>
                  {MEMBERSHIP_ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Lý do (không bắt buộc)
            <input
              name="reason"
              maxLength={500}
              className="mt-1 w-full rounded-md border border-vam-line px-3 py-2"
            />
          </label>
          <SubmitButton
            name="add_new"
            disabled={pendingMembershipId === "add_new"}
            pendingText="Đang thêm vai trò..."
            className="justify-self-start bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Thêm vai trò active
          </SubmitButton>
          {pendingMembershipId === "add_new" && <Feedback state={addState} />}
        </form>
      ) : null}
    </div>
  );
}
