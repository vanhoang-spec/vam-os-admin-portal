/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";

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
  transitionMembershipAction: vi.fn(),
  addMembershipRoleAction: vi.fn(),
}));

import { MembershipLifecycleControls } from "@/app/people/[id]/membership-lifecycle-controls";

afterEach(cleanup);

it("forwards an inactive DB program through the page mapping and suppresses continuation", () => {
  const pageSource = readFileSync("app/people/[id]/page.tsx", "utf8");
  expect(pageSource).toMatch(
    /programs=\{programs\.data\.map\(\(row\) => \(\{[^}]*isActive:\s*row\.is_active[^}]*\}\)\)\}/,
  );

  const dbProgram = {
    id: "uehm-program",
    name: "UEHM",
    code: "UEHM",
    is_active: false,
  };
  const mappedProgram = {
    id: dbProgram.id,
    label: String(dbProgram.name ?? dbProgram.code ?? dbProgram.id),
    code: dbProgram.code ?? undefined,
    isActive: dbProgram.is_active,
  };

  render(
    <MembershipLifecycleControls
      personId="person"
      adminRole="super_admin"
      enabled={true}
      canOperateUehmS12={true}
      programs={[mappedProgram]}
      seasons={[
        { id: "season-11", label: "Mùa 11", code: "UEHM-S11" },
        {
          id: "season-12",
          label: "Mùa 12",
          code: "UEHM-S12",
          programId: dbProgram.id,
        },
      ]}
      memberships={[
        {
          id: "membership-11",
          role: "mentor",
          status: "active",
          intakeBatchCode: null,
          programLabel: "UEHM",
          seasonLabel: "Mùa 11",
          seasonId: "season-11",
        },
      ]}
    />,
  );

  expect(
    screen.queryByRole("button", { name: "Tiếp tục sang Mùa 12" }),
  ).toBeNull();
});
