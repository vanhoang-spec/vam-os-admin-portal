"use client";
import React, { useState, useEffect } from "react";
import { useFormState } from "react-dom";
import {
  addMembershipRoleAction,
  transitionMembershipAction,
} from "@/app/actions/membership-lifecycle";
import {
  availableMembershipActions,
  MEMBERSHIP_ACTION_LABELS,
  membershipOperationNeedsReason,
  type MembershipLifecycleOperation,
  initialMembershipLifecycleState,
} from "@/lib/membership-lifecycle";
import { SubmitButton } from "@/components/submit-button";
import {
  LEGACY_PREDECESSOR_SEASON_ID,
  CONTINUATION_TARGET_SEASON_ID,
  CONTINUATION_TARGET_PROGRAM_ID,
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
type Option = { id: string; label: string; code?: string; programId?: string };

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

function TransitionForm({
  personId,
  membership,
  operation,
  isLocked,
  onLock,
  onUnlock,
}: {
  personId: string;
  membership: Membership;
  operation: MembershipLifecycleOperation;
  isLocked: boolean;
  onLock: () => void;
  onUnlock: () => void;
}) {
  const [state, action] = useFormState(
    transitionMembershipAction,
    initialMembershipLifecycleState,
  );
  const required = membershipOperationNeedsReason(operation);
  const label = MEMBERSHIP_ACTION_LABELS[operation];

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
      !window.confirm(`Xác nhận ${label.toLowerCase()} cho membership này?`)
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
        variant="outline"
        className="justify-self-start border-vam-line px-3 py-2 text-sm font-medium text-vam-green"
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
}: {
  personId: string;
  memberships: Membership[];
  programs: Option[];
  seasons: Option[];
  enabled: boolean;
  canOperateUehmS12?: boolean;
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

  const uehmProgram = programs.find(
    (p) => p.id === CONTINUATION_TARGET_PROGRAM_ID && p.code === "UEHM",
  );
  const s11Season = seasons.find(
    (s) => s.id === LEGACY_PREDECESSOR_SEASON_ID && s.code === "UEHM-S11",
  );
  const s12Season = seasons.find(
    (s) =>
      s.id === CONTINUATION_TARGET_SEASON_ID &&
      s.code === "UEHM-S12" &&
      s.programId === CONTINUATION_TARGET_PROGRAM_ID,
  );

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
  const isContinuationEligible = (status: string) => {
    const s = normalize(status);
    return s === "active" || s === "completed";
  };
  const isParticipantRole = (role: string) => {
    const r = normalize(role);
    return r === "mentor" || r === "mentee";
  };

  // Final fail-closed catalog contract
  const catalogValid = !!(uehmProgram && s11Season && s12Season);

  // Source eligibility: match by season identity only. Do NOT require
  // membership.programId === uehmProgram.id because historical rows (e.g. Hạ)
  // may legitimately carry a legacy VAM program_id while their season_id
  // correctly points to UEHM-S11.
  const s11Memberships = memberships.filter(
    (m) =>
      m.seasonId === LEGACY_PREDECESSOR_SEASON_ID &&
      isContinuationEligible(m.status) &&
      isParticipantRole(m.role),
  );

  // S12 suppression:
  // Suppress continuation for role R iff an existing membership has:
  // membership.seasonId === CONTINUATION_TARGET_SEASON_ID
  // AND normalized membership.role === normalized R
  const s12Memberships = memberships.filter(
    (m) => m.seasonId === CONTINUATION_TARGET_SEASON_ID,
  );

  const finalBranch = !!(catalogValid && canOperateUehmS12);

  if (finalBranch) {
    for (const s11 of s11Memberships) {
      const normalizedRole = normalize(s11.role);
      const isSuppressed = s12Memberships.some(
        (s12) => normalize(s12.role) === normalizedRole,
      );
      if (!isSuppressed) {
        if (!missingS12Roles.some((m) => m.role === normalizedRole)) {
          missingS12Roles.push({
            role: normalizedRole,
            programId: CONTINUATION_TARGET_PROGRAM_ID,
            seasonId: CONTINUATION_TARGET_SEASON_ID,
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
        const actions = availableMembershipActions(membership.status);
        const isLocked = pendingMembershipId === membership.id;

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
                {membership.role} · {membership.status}
              </span>
            </div>
            {actions.length ? (
              <div className="grid gap-2 lg:grid-cols-2">
                {actions.map((operation) => (
                  <TransitionForm
                    key={operation}
                    personId={personId}
                    membership={membership}
                    operation={operation}
                    isLocked={isLocked}
                    onLock={() => setPendingMembershipId(membership.id)}
                    onUnlock={() =>
                      setPendingMembershipId((prev) =>
                        prev === membership.id ? null : prev,
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                Không có thao tác lifecycle hợp lệ từ trạng thái này.
              </p>
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
            <option value="mentor">Mentor</option>
            <option value="mentee">Mentee</option>
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
    </div>
  );
}
