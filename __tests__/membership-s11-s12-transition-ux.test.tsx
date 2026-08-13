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

const PROGRAMS = [{ id: "P1", label: "UEHM", code: "UEHM" }];
const SEASONS = [
  { id: "S11", label: "Mùa 11", code: "UEHM-S11" },
  { id: "S12", label: "Mùa 12", code: "UEHM-S12" },
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
      },
      {
        id: "M2",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12",
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
        seasonCode: "UEHM-S11",
      },
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
        seasonCode: "UEHM-S11",
      },
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
        seasonCode: "UEHM-S12",
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
        seasonCode: "UEHM-S12",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
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
          seasonCode: "UEHM-S11",
        },
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
        seasonCode: "UEHM-S11",
      },
      {
        id: "M2",
        role: "mentee",
        status: "withdrawn",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
      },
      {
        id: "M2",
        role: "mentee",
        status: "completed",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11",
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
        seasonCode: "UEHM-S11",
      },
      {
        id: "M2",
        role: "mentee",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11",
      },
      {
        id: "M3",
        role: "mentor",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12",
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
        seasonCode: "UEHM-S11",
      },
      {
        id: "M2",
        role: "mentee",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 11",
        programCode: "UEHM",
        seasonCode: "UEHM-S11",
      },
      {
        id: "M3",
        role: "mentee",
        status: "active",
        intakeBatchCode: null,
        programLabel: "UEHM",
        seasonLabel: "Mùa 12",
        programCode: "UEHM",
        seasonCode: "UEHM-S12",
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
          seasonCode: "UEHM-S11",
        },
        {
          id: "M2",
          role: "mentor",
          status,
          intakeBatchCode: null,
          programLabel: "UEHM",
          seasonLabel: "Mùa 12",
          programCode: "UEHM",
          seasonCode: "UEHM-S12",
        },
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
        { id: "M1", role, status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
      ];
      const { unmount } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
      unmount();
    }
  });

  it("normalizes status casing and whitespace for continuation eligibility", () => {
    for (const status of ["active", "Active", " completed "]) {
      const memberships = [
        { id: "M1", role: "mentor", status, intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
      ];
      const { unmount } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
      unmount();
    }
  });

  it("suppresses CTA when same-role S12 membership exists despite role casing differences", () => {
    const memberships = [
      { id: "M1", role: "Mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" },
      { id: "M2", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12" }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
  });

  it("Lê Thị Thu Hạ-shaped fixture: renders CTA successfully", () => {
    const memberships = [
      { id: "M1", role: "Mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
  });

  it("suppresses CTA when same-role Mentor membership exists with normalization on BOTH records", () => {
    const memberships = [
      { id: "M1", role: " mentor ", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" },
      { id: "M2", role: "MENTOR", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12" }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
  });

  it("suppresses CTA when same-role Mentee membership exists with cross-case suppression", () => {
    const memberships = [
      { id: "M1", role: "Mentee", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" },
      { id: "M2", role: "mentee", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12" }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.queryAllByRole("button", { name: "Tiếp tục sang Mùa 12" }).length).toBe(0);
  });

  it("renders CTA for opposite-role even with normalization", () => {
    const memberships = [
      { id: "M1", role: " MENTOR ", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" },
      { id: "M2", role: "mEnTeE", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 12", programCode: "UEHM", seasonCode: "UEHM-S12" }
    ];
    render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
    expect(screen.getByRole("button", { name: "Tiếp tục sang Mùa 12" })).not.toBeNull();
  });

  it("submits normalized lowercase role and exact targets in continuation form (Mentor)", () => {
    const memberships = [
      { id: "M1", role: "Mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];
    const { container } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    // Find the hidden inputs for the transition form
    const roleInput = container.querySelector('input[name="role"]');
    const programIdInput = container.querySelector('input[name="program_id"]');
    const seasonIdInput = container.querySelector('input[name="season_id"]');

    expect(roleInput).not.toBeNull();
    expect(roleInput?.getAttribute("value")).toBe("mentor");

    expect(programIdInput).not.toBeNull();
    expect(programIdInput?.getAttribute("value")).toBe("P1");

    expect(seasonIdInput).not.toBeNull();
    expect(seasonIdInput?.getAttribute("value")).toBe("S12");
  });

  it("submits normalized lowercase role and exact targets in continuation form (Mentee)", () => {
    const memberships = [
      { id: "M1", role: " mEntEe ", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];
    const { container } = render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);

    const roleInput = container.querySelector('input[name="role"]');
    const programIdInput = container.querySelector('input[name="program_id"]');
    const seasonIdInput = container.querySelector('input[name="season_id"]');

    expect(roleInput).not.toBeNull();
    expect(roleInput?.getAttribute("value")).toBe("mentee");

    expect(programIdInput).not.toBeNull();
    expect(programIdInput?.getAttribute("value")).toBe("P1");

    expect(seasonIdInput).not.toBeNull();
    expect(seasonIdInput?.getAttribute("value")).toBe("S12");
  });

  describe("S12 continuation diagnostic", () => {
    const TARGET_PERSON = "74f882de-338d-47da-a759-98bd32659b59";
    const memberships = [
      { id: "M1", role: "mentor", status: "active", intakeBatchCode: null, programLabel: "UEHM", seasonLabel: "Mùa 11", programCode: "UEHM", seasonCode: "UEHM-S11" }
    ];

    it("renders only for Hạ on Preview/Staging with authorized operator", () => {
      process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
      render(<MembershipLifecycleControls personId={TARGET_PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.queryByTestId("s12-diagnostic")).not.toBeNull();
      delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    });

    it("does not render in Production", () => {
      process.env.NEXT_PUBLIC_VERCEL_ENV = "production";
      render(<MembershipLifecycleControls personId={TARGET_PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.queryByTestId("s12-diagnostic")).toBeNull();
      delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    });

    it("does not render for another person", () => {
      process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
      render(<MembershipLifecycleControls personId={PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={true} />);
      expect(screen.queryByTestId("s12-diagnostic")).toBeNull();
      delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    });

    it("does not render for unauthorized operator", () => {
      process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
      render(<MembershipLifecycleControls personId={TARGET_PERSON} memberships={memberships} programs={PROGRAMS} seasons={SEASONS} enabled={true} canOperateUehmS12={false} />);
      expect(screen.queryByTestId("s12-diagnostic")).toBeNull();
      delete process.env.NEXT_PUBLIC_VERCEL_ENV;
    });
  });
});
