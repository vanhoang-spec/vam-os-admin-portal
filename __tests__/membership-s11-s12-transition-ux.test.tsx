/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

vi.mock("server-only", () => ({}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false }),
  };
});
vi.mock("@/app/actions/membership-lifecycle", () => ({
  initialMembershipLifecycleState: { ok: false, message: "" },
  transitionMembershipAction: vi.fn(),
  addMembershipRoleAction: vi.fn(),
}));

import { MembershipLifecycleControls } from "@/app/people/[id]/membership-lifecycle-controls";

const PERSON = "11111111-1111-4111-8111-111111111111";

// ── Catalog constants ────────────────────────────────────────────────
// UEHM program has its own UUID. Legacy VAM is a different program UUID.
const UEHM_PROGRAM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEGACY_VAM_PROGRAM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UEHM_S11_SEASON_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UEHM_S12_SEASON_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UNRELATED_SEASON_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const PROGRAMS = [
  { id: UEHM_PROGRAM_ID, label: "UEHM", code: "UEHM" },
];
const SEASONS = [
  { id: UEHM_S11_SEASON_ID, label: "Mùa 11", code: "UEHM-S11", programId: UEHM_PROGRAM_ID },
  { id: UEHM_S12_SEASON_ID, label: "Mùa 12", code: "UEHM-S12", programId: UEHM_PROGRAM_ID },
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
      {
        id: "M1",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    // Should render the missing S12 section
    expect(screen.getByText("UEHM / Mùa 12")).not.toBeNull();
    expect(screen.getByText("mentor · Chưa chuyển sang Mùa 12")).not.toBeNull();
    // Should render the button explicitly
    const continueBtn = screen.getByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtn).not.toBeNull();
  });

  it("displays 'Tiếp tục sang Mùa 12' when S11 status is completed", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "completed",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    const continueBtn = screen.getByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtn).not.toBeNull();
  });

  it("hides 'Tiếp tục sang Mùa 12' when S11 status is withdrawn", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "withdrawn",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("hides 'Tiếp tục sang Mùa 12' when S11 status is opted_out", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "opted_out",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("hides 'Tiếp tục sang Mùa 12' when S11 status is cancelled", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "cancelled",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("hides 'Tiếp tục sang Mùa 12' when S11 status is paused", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "paused",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("hides 'Tiếp tục sang Mùa 12' when S11 status is unknown", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "unknown_status_123",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("does not display 'Tiếp tục sang Mùa 12' when person already has S12 role", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      {
        id: "M2",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    // Mùa 12 already exists in the memberships list
    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("hides controls for unauthorized users", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={false}
        canOperateUehmS12={false}
      />,
    );

    expect(screen.getByText(/Cần quyền operations/)).not.toBeNull();
    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("does not display 'Tiếp tục sang Mùa 12' if user cannot operate UEHM-S12 specifically", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={false}
      />,
    );

    // Cannot operate UEHM-S12, so the transition action does not show up
    const continueBtns = screen.queryAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(0);
  });

  it("shows existing active S12 actions if S12 membership exists", () => {
    const memberships = [
      {
        id: "M2",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    // Active membership supports pause/withdraw/opt_out
    expect(screen.getByRole("button", { name: "Tạm nghỉ" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Không tiếp tục" }),
    ).not.toBeNull();
  });

  it("shows existing paused S12 actions if S12 membership is paused", () => {
    const memberships = [
      {
        id: "M2",
        role: "mentor",
        status: "paused",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    // Paused membership supports reactivate
    expect(
      screen.getByRole("button", { name: "Kích hoạt lại" }),
    ).not.toBeNull();
  });

  it("applies the same UX to Mentee roles", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentee",
        status: "completed",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];

    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    expect(screen.getByText("mentee · Chưa chuyển sang Mùa 12")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" }),
    ).not.toBeNull();
  });

  it("hides 'Tiếp tục sang Mùa 12' for S11 active supporter", () => {
    const memberships = [
      {
        id: "M1",
        role: "supporter",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];
    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );
    expect(
      screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length,
    ).toBe(0);
  });

  it("hides 'Tiếp tục sang Mùa 12' for S11 completed coreteam", () => {
    const memberships = [
      {
        id: "M1",
        role: "coreteam",
        status: "completed",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];
    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );
    expect(
      screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length,
    ).toBe(0);
  });

  it("hides 'Tiếp tục sang Mùa 12' for other canonical non-participant roles", () => {
    for (const role of [
      "reviewer",
      "interviewer",
      "advisor",
      "alumni_mentee",
      "guest",
    ]) {
      const memberships = [
        {
          id: "M1",
          role,
          status: "active",
          intakeBatchCode: null,
          programLabel: "UEHM",
          seasonLabel: "Mùa 11",
          programCode: "UEHM",
          seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      ];
      const { unmount } = render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={PROGRAMS}
          seasons={SEASONS}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(
        screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" })
          .length,
      ).toBe(0);
      unmount();
    }
  });

  it("mixed person: S11 mentor=active, S11 mentee=withdrawn -> Mentor visible, Mentee hidden", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      {
        id: "M2",
        role: "mentee",
        status: "withdrawn",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];
    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    expect(screen.getByText("mentor · Chưa chuyển sang Mùa 12")).not.toBeNull();
    expect(screen.queryByText("mentee · Chưa chuyển sang Mùa 12")).toBeNull();
    const continueBtns = screen.getAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(1);
  });

  it("reverse mixed case: S11 mentor=cancelled, S11 mentee=completed -> Mentor hidden, Mentee visible", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "cancelled",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      {
        id: "M2",
        role: "mentee",
        status: "completed",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
    ];
    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    expect(screen.queryByText("mentor · Chưa chuyển sang Mùa 12")).toBeNull();
    expect(screen.getByText("mentee · Chưa chuyển sang Mùa 12")).not.toBeNull();
    const continueBtns = screen.getAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(1);
  });

  it("Existing S12 Mentor + eligible S11 Mentor and Mentee -> Mentor suppressed, Mentee eligible", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      {
        id: "M2",
        role: "mentee",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      {
        id: "M3",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID, },
    ];
    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    expect(screen.queryByText("mentor · Chưa chuyển sang Mùa 12")).toBeNull();
    expect(screen.getByText("mentee · Chưa chuyển sang Mùa 12")).not.toBeNull();
    const continueBtns = screen.getAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(1);
  });

  it("Existing S12 Mentee -> suppress only Mentee", () => {
    const memberships = [
      {
        id: "M1",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      {
        id: "M2",
        role: "mentee",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
      {
        id: "M3",
        role: "mentee",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID, },
    ];
    render(
      <MembershipLifecycleControls
        personId={PERSON}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled={true}
        canOperateUehmS12={true}
      />,
    );

    expect(screen.getByText("mentor · Chưa chuyển sang Mùa 12")).not.toBeNull();
    expect(screen.queryByText("mentee · Chưa chuyển sang Mùa 12")).toBeNull();
    const continueBtns = screen.getAllByRole("button", {
      name: "Tiếp tục sang Mùa 12",
    });
    expect(continueBtns.length).toBe(1);
  });

  it("Existing non-active S12 membership (paused / withdrawn / opted_out / cancelled) -> suppress same-role duplicate transition", () => {
    for (const status of ["paused", "withdrawn", "opted_out", "cancelled"]) {
      const memberships = [
        {
          id: "M1",
          role: "mentor",
          status: "active",
          intakeBatchCode: null,
          programLabel: "UEHM",
          seasonLabel: "Mùa 11",
          programCode: "UEHM",
          seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID, },
        {
          id: "M2",
          role: "mentor",
          status,
          intakeBatchCode: null,
          programLabel: "UEHM",
          seasonLabel: "Mùa 12",
          programCode: "UEHM",
          seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID, },
      ];
      const { unmount } = render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={PROGRAMS}
          seasons={SEASONS}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(
        screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" })
          .length,
      ).toBe(0);
      unmount();
    }
  });

  it("normalizes role casing and whitespace for continuation eligibility", () => {
    for (const role of ["mentor", "Mentor", " MENTOR ", "mentee", "Mentee"]) {
      const memberships = [
        { id: "M1", role, status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID }
      ];
      const { unmount } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
      unmount();
    }
  });

  it("normalizes status casing and whitespace for continuation eligibility", () => {
    for (const status of ["active", "Active", " completed "]) {
      const memberships = [
        { id: "M1", role: "mentor", status, intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID }
      ];
      const { unmount } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
      unmount();
    }
  });

  it("suppresses CTA when same-role S12 membership exists despite role casing differences", () => {
    const memberships = [
      { id: "M1", role: "Mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      { id: "M2", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
  });

  it("suppresses CTA when same-role Mentor membership exists with normalization on BOTH records", () => {
    const memberships = [
      { id: "M1", role: " mentor ", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      { id: "M2", role: "MENTOR", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
  });

  it("suppresses CTA when same-role Mentee membership exists with cross-case suppression", () => {
    const memberships = [
      { id: "M1", role: "Mentee", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      { id: "M2", role: "mentee", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
  });

  it("renders CTA for opposite-role even with normalization", () => {
    const memberships = [
      { id: "M1", role: " MENTOR ", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      { id: "M2", role: "mEnTeE", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
  });

  it("submits normalized lowercase role and exact targets in continuation form (Mentor)", () => {
    const memberships = [
      { id: "M1", role: "Mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID }
    ];
    const { container } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    // Find the hidden inputs for the transition form
    const roleInput = container.querySelector('input[name="role"]');
    const programIdInput = container.querySelector('input[name="program_id"]');
    const seasonIdInput = container.querySelector('input[name="season_id"]');

    expect(roleInput).not.toBeNull();
    expect(roleInput?.getAttribute("value")).toBe("mentor");

    expect(programIdInput).not.toBeNull();
    expect(programIdInput?.getAttribute("value")).toBe(UEHM_PROGRAM_ID);

    expect(seasonIdInput).not.toBeNull();
    expect(seasonIdInput?.getAttribute("value")).toBe(UEHM_S12_SEASON_ID);
  });

  it("submits normalized lowercase role and exact targets in continuation form (Mentee)", () => {
    const memberships = [
      { id: "M1", role: " mEntEe ", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID }
    ];
    const { container } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    const roleInput = container.querySelector('input[name="role"]');
    const programIdInput = container.querySelector('input[name="program_id"]');
    const seasonIdInput = container.querySelector('input[name="season_id"]');

    expect(roleInput).not.toBeNull();
    expect(roleInput?.getAttribute("value")).toBe("mentee");

    expect(programIdInput).not.toBeNull();
    expect(programIdInput?.getAttribute("value")).toBe(UEHM_PROGRAM_ID);

    expect(seasonIdInput).not.toBeNull();
    expect(seasonIdInput?.getAttribute("value")).toBe(UEHM_S12_SEASON_ID);
  });

  // ── S12 Continuation Season Identity Remediation ───────────────────
  // These tests reproduce the real Hạ production shape: membership has
  // legacy VAM program_id while season_id correctly points to UEHM-S11.
  describe("S12 Continuation Season Identity Remediation", () => {
    // 1. Hạ real-shape: legacy VAM program_id + UEHM-S11 season_id => CTA
    it("Lê Thị Thu Hạ-shaped fixture: legacy VAM programCode + UEHM-S11 seasonId => renders CTA", () => {
      const memberships = [
        {
          id: "M1",
          role: "Mentor",
          status: "active",
          intakeBatchCode: null,
          programLabel: "UEHM",
          seasonLabel: "Mùa 11",
          programCode: "VAM",          // ← legacy VAM program code
          seasonCode: "UEHM-S11",
          seasonId: UEHM_S11_SEASON_ID, // ← correct UEHM-S11 season
        },
      ];
      render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={PROGRAMS}
          seasons={SEASONS}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
    });

    // 2. Unrelated VAM membership with another season => no CTA
    it("does not render CTA for unrelated VAM membership with non-UEHM season", () => {
      const memberships = [
        {
          id: "M1",
          role: "mentor",
          status: "active",
          intakeBatchCode: null,
          programLabel: "VAM",
          seasonLabel: "Mùa 10",
          programCode: "VAM",
          seasonCode: "VAM-S10",
          seasonId: UNRELATED_SEASON_ID, // ← not UEHM-S11
        },
      ];
      render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={PROGRAMS}
          seasons={SEASONS}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(screen.queryByRole("button", { name: "Tiếp tục sang Mùa 12" })).toBeNull();
    });

    // 3. Season with matching code but wrong program linkage => fail closed
    it("fails closed when season catalog has wrong program linkage", () => {
      const BAD_LINK_SEASONS = [
        { id: UEHM_S11_SEASON_ID, label: "Mùa 11", code: "UEHM-S11", programId: "WRONG_PROGRAM_ID" },
        { id: UEHM_S12_SEASON_ID, label: "Mùa 12", code: "UEHM-S12", programId: UEHM_PROGRAM_ID },
      ];
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={PROGRAMS}
          seasons={BAD_LINK_SEASONS}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(screen.queryByRole("button", { name: "Tiếp tục sang Mùa 12" })).toBeNull();
    });

    // 4. Missing UEHM program => no CTA
    it("does not render CTA when UEHM program is missing from catalog", () => {
      const NO_UEHM_PROGRAMS = [{ id: LEGACY_VAM_PROGRAM_ID, label: "VAM", code: "VAM" }];
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={NO_UEHM_PROGRAMS}
          seasons={SEASONS}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(screen.queryByRole("button", { name: "Tiếp tục sang Mùa 12" })).toBeNull();
    });

    // 5. Missing S11 season => no CTA
    it("does not render CTA when UEHM-S11 season is missing from catalog", () => {
      const NO_S11 = [
        { id: UEHM_S12_SEASON_ID, label: "Mùa 12", code: "UEHM-S12", programId: UEHM_PROGRAM_ID },
      ];
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={PROGRAMS}
          seasons={NO_S11}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(screen.queryByRole("button", { name: "Tiếp tục sang Mùa 12" })).toBeNull();
    });

    // 6. Missing S12 season => no CTA
    it("does not render CTA when UEHM-S12 season is missing from catalog", () => {
      const NO_S12 = [
        { id: UEHM_S11_SEASON_ID, label: "Mùa 11", code: "UEHM-S11", programId: UEHM_PROGRAM_ID },
      ];
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      render(
        <MembershipLifecycleControls
          personId={PERSON}
          memberships={memberships}
          programs={PROGRAMS}
          seasons={NO_S12}
          enabled={true}
          canOperateUehmS12={true}
        />,
      );
      expect(screen.queryByRole("button", { name: "Tiếp tục sang Mùa 12" })).toBeNull();
    });

    // 7. Mentor active => CTA
    it("renders CTA for active S11 mentor", () => {
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
    });

    // 8. Mentee completed => CTA
    it("renders CTA for completed S11 mentee", () => {
      const memberships = [
        { id: "M1", role: "mentee", status: "completed", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
    });

    // 9. Invalid source statuses excluded
    it("excludes invalid source statuses from continuation", () => {
      for (const status of ["withdrawn", "opted_out", "cancelled", "paused", "pending"]) {
        const memberships = [
          { id: "M1", role: "mentor", status, intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
        ];
        const { unmount } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
        expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
        unmount();
      }
    });

    // 10. Same-role S12 suppresses regardless of status/casing
    it("suppresses CTA when same-role S12 membership exists regardless of status or casing", () => {
      for (const s12Status of ["active", "paused", "withdrawn", "opted_out", "cancelled"]) {
        const memberships = [
          { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "VAM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
          { id: "M2", role: " MENTOR ", status: s12Status, intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID },
        ];
        const { unmount } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
        expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
        unmount();
      }
    });

    // 11. Opposite-role S12 does not suppress
    it("does not suppress CTA when opposite-role S12 membership exists", () => {
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "VAM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
        { id: "M2", role: "mentee", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12", seasonId: UEHM_S12_SEASON_ID },
      ];
      render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
    });

    // 12. Unauthorized operator => no CTA
    it("does not render CTA for unauthorized operator", () => {
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "VAM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={false} />);
      expect(screen.queryByRole("button", { name: "Tiếp tục sang Mùa 12" })).toBeNull();
    });

    // 13. Hidden program target exact UEHM program ID
    it("hidden program_id targets exact UEHM program ID in continuation form", () => {
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "VAM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      const { container } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      const programIdInput = container.querySelector('input[name="program_id"]');
      expect(programIdInput).not.toBeNull();
      expect(programIdInput?.getAttribute("value")).toBe(UEHM_PROGRAM_ID);
    });

    // 14. Hidden season target exact UEHM-S12 season ID
    it("hidden season_id targets exact UEHM-S12 season ID in continuation form", () => {
      const memberships = [
        { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "VAM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      const { container } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      const seasonIdInput = container.querySelector('input[name="season_id"]');
      expect(seasonIdInput).not.toBeNull();
      expect(seasonIdInput?.getAttribute("value")).toBe(UEHM_S12_SEASON_ID);
    });

    // 15. Hidden role canonical lowercase
    it("hidden role is canonical lowercase in continuation form", () => {
      const memberships = [
        { id: "M1", role: " MENTOR ", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "VAM", seasonCode: "UEHM-S11", seasonId: UEHM_S11_SEASON_ID },
      ];
      const { container } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      const roleInput = container.querySelector('input[name="role"]');
      expect(roleInput).not.toBeNull();
      expect(roleInput?.getAttribute("value")).toBe("mentor");
    });
  });
});
