/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFormState: (action: unknown, initial: unknown) => [initial, action], useFormStatus: () => ({ pending: false }) };
});
vi.mock("@/app/actions/membership-lifecycle", () => ({
  initialMembershipLifecycleState: { ok: false, message: "" },
  transitionMembershipAction: vi.fn(),
  addMembershipRoleAction: vi.fn()
}));

import { MembershipLifecycleControls } from "@/app/people/[id]/membership-lifecycle-controls";

const PERSON = "11111111-1111-4111-8111-111111111111";

const PROGRAMS = [{ id: "P1", label: "UEHM", code: "UEHM" }];
const SEASONS = [
  { id: "S11", label: "Mùa 11", code: "UEHM-S11" },
  { id: "S12", label: "Mùa 12", code: "UEHM-S12" }
];

describe("Season 11 -> Season 12 Transition UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("displays 'Tiếp tục sang Mùa 12' when person has S11 role but no S12 role", () => {
    const memberships = [
      { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];

    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    // Should render the missing S12 section
    expect(screen.getByText("UEHM / Mùa 12")).not.toBeNull();
    expect(screen.getByText("mentor · Chưa chuyển sang Mùa 12")).not.toBeNull();
    // Should render the button explicitly
    const continueBtn = screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" });
    expect(continueBtn).not.toBeNull();
  });

  it("does not display 'Tiếp tục sang Mùa 12' when person already has S12 role", () => {
    const memberships = [
      { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" },
      { id: "M2", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12" }
    ];

    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    // Mùa 12 already exists in the memberships list
    const continueBtns = screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" });
    expect(continueBtns.length).toBe(0);
  });

  it("hides controls for unauthorized users", () => {
    const memberships = [
      { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];

    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={false} canOperateUehmS12={false} />);

    expect(screen.getByText(/Cần quyền operations/)).not.toBeNull();
    const continueBtns = screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" });
    expect(continueBtns.length).toBe(0);
  });

  it("does not display 'Tiếp tục sang Mùa 12' if user cannot operate UEHM-S12 specifically", () => {
    const memberships = [
      { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];

    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={false} />);

    // Cannot operate UEHM-S12, so the transition action does not show up
    const continueBtns = screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" });
    expect(continueBtns.length).toBe(0);
  });

  it("shows existing active S12 actions if S12 membership exists", () => {
    const memberships = [
      { id: "M2", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12" }
    ];

    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    // Active membership supports pause/withdraw/opt_out
    expect(screen.getByRole("button", { name: "Tạm nghỉ" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Không tiếp tục" })).not.toBeNull();
  });

  it("shows existing paused S12 actions if S12 membership is paused", () => {
    const memberships = [
      { id: "M2", role: "mentor", status: "paused", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12" }
    ];

    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    // Paused membership supports reactivate
    expect(screen.getByRole("button", { name: "Kích hoạt lại" })).not.toBeNull();
  });

  it("applies the same UX to Mentee roles", () => {
    const memberships = [
      { id: "M1", role: "mentee", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];

    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    expect(screen.getByText("mentee · Chưa chuyển sang Mùa 12")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
  });
});
