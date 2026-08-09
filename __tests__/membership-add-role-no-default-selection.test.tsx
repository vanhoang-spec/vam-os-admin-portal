/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/membership-lifecycle", () => ({
  initialMembershipLifecycleState: { ok: false, message: "" },
  transitionMembershipAction: vi.fn(),
  addMembershipRoleAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { MembershipLifecycleControls } from "@/app/people/[id]/membership-lifecycle-controls";

const PERSON = "11111111-1111-4111-8111-111111111111";
const PROGRAM_FIRST = "44444444-4444-4444-8444-4444444444aa";
const PROGRAM_SECOND = "44444444-4444-4444-8444-4444444444bb";
const SEASON_S11 = "55555555-5555-4555-8555-5555555555aa";
const SEASON_S12 = "55555555-5555-4555-8555-5555555555bb";

function renderControls() {
  return render(
    <MembershipLifecycleControls
      personId={PERSON}
      memberships={[]}
      // Deliberately ordered so that the first option is the WRONG answer for
      // an approved Season 12 candidate: HAM before UEHM, S11 before S12.
      programs={[
        { id: PROGRAM_FIRST, label: "HAM" },
        { id: PROGRAM_SECOND, label: "UEHM" }
      ]}
      seasons={[
        { id: SEASON_S11, label: "UEHM-S11" },
        { id: SEASON_S12, label: "UEHM-S12" }
      ]}
      enabled
    />
  );
}

function select(container: HTMLElement, name: string) {
  const node = container.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
  if (!node) throw new Error(`select[name="${name}"] not found`);
  return node;
}

afterEach(() => cleanup());

describe("Add membership role — no silent default selection", () => {
  // The defect: a <select> with no defaultValue pre-selects option 0. The form
  // therefore arrived already showing a program, a season and "Mentor" that
  // nobody chose, and submitting without touching them wrote a membership for
  // the wrong program/season/role for an approved candidate.
  it("opens with program, season and role all unselected", () => {
    const { container } = renderControls();
    expect(select(container, "program_id").value).toBe("");
    expect(select(container, "season_id").value).toBe("");
    expect(select(container, "role").value).toBe("");
  });

  it("never pre-selects the first program or the first season", () => {
    const { container } = renderControls();
    expect(select(container, "program_id").value).not.toBe(PROGRAM_FIRST);
    expect(select(container, "season_id").value).not.toBe(SEASON_S11);
  });

  it('never pre-selects "mentor", which is wrong for an approved mentee', () => {
    const { container } = renderControls();
    expect(select(container, "role").value).not.toBe("mentor");
  });

  it("marks all three as required so an unchosen field cannot be submitted", () => {
    const { container } = renderControls();
    for (const name of ["program_id", "season_id", "role"]) {
      expect(select(container, name).required).toBe(true);
    }
  });

  it("offers a disabled placeholder first, then the real options", () => {
    const { container } = renderControls();
    for (const name of ["program_id", "season_id", "role"]) {
      const options = Array.from(select(container, name).options);
      expect(options[0].value).toBe("");
      expect(options[0].disabled).toBe(true);
      expect(options.length).toBeGreaterThan(1);
      // No real option may carry an empty value, or the placeholder stops
      // being distinguishable from a genuine choice.
      expect(options.slice(1).every((option) => option.value !== "")).toBe(true);
    }
  });

  it("still offers every program and season passed in", () => {
    const { container } = renderControls();
    const programValues = Array.from(select(container, "program_id").options).map((o) => o.value);
    const seasonValues = Array.from(select(container, "season_id").options).map((o) => o.value);
    expect(programValues).toEqual(["", PROGRAM_FIRST, PROGRAM_SECOND]);
    expect(seasonValues).toEqual(["", SEASON_S11, SEASON_S12]);
    expect(Array.from(select(container, "role").options).map((o) => o.value)).toEqual(["", "mentor", "mentee"]);
  });
});
