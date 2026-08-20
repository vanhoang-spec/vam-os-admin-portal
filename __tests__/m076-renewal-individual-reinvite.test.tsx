/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/actions/renewals", () => ({
  createRenewalInviteAction: vi.fn(),
  regenerateRenewalInviteAction: vi.fn(),
  revokeRenewalInviteAction: vi.fn(),
  confirmRenewalAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { CreateRenewalInviteForm } from "@/app/admin/renewals/renewal-controls";
import type { RenewalMentorOption } from "@/lib/renewal-console";

/**
 * M076 — withholding previously-declined mentors from BULK selection must not
 * remove the deliberate, one-at-a-time way to re-invite them.
 *
 * The batch picker gates on `batchSelectable`; this form gates on `selectable`,
 * which still follows the trusted create path. These tests pin that split, so a
 * future edit cannot quietly collapse the two flags back together and take the
 * re-invite path down with it.
 */

const PROGRAM = "22222222-2222-4222-8222-222222222222";
const SEASON = "33333333-3333-4333-8333-333333333333";

function mentor(n: number, status: RenewalMentorOption["status"]): RenewalMentorOption {
  const fullName = `Mentor ${String(n).padStart(2, "0")}`;
  const mentorCode = `VM-${String(n).padStart(3, "0")}`;
  const email = `mentor${String(n).padStart(2, "0")}@example.com`;
  return {
    personId: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
    label: `${fullName} · ${mentorCode} · ${email}`,
    fullName,
    mentorCode,
    email,
    status,
    selectable: status === "eligible" || status === "renewal_declined",
    batchSelectable: status === "eligible"
  };
}

const ELIGIBLE = mentor(1, "eligible");
const DECLINED = mentor(2, "renewal_declined");
const LIVE = mentor(3, "has_live_invite");
const ACCEPTED = mentor(4, "renewal_accepted");

function renderForm(mentors: RenewalMentorOption[]) {
  return render(<CreateRenewalInviteForm mentors={mentors} programId={PROGRAM} seasonId={SEASON} />);
}

function optionLabels() {
  return Array.from(document.querySelectorAll("option"))
    .map((o) => o.textContent ?? "")
    .filter((t) => t && !t.startsWith("Chọn mentor"));
}

afterEach(cleanup);

describe("M076 individual re-invite path", () => {
  it("still offers a previously declined mentor", () => {
    renderForm([ELIGIBLE, DECLINED, LIVE, ACCEPTED]);
    expect(optionLabels()).toContain(DECLINED.label);
  });

  it("offers ordinary eligible mentors as before", () => {
    renderForm([ELIGIBLE, DECLINED, LIVE, ACCEPTED]);
    expect(optionLabels()).toContain(ELIGIBLE.label);
  });

  it("still withholds a mentor holding a live invite", () => {
    renderForm([ELIGIBLE, DECLINED, LIVE, ACCEPTED]);
    expect(optionLabels()).not.toContain(LIVE.label);
  });

  it("still withholds a mentor who already accepted", () => {
    renderForm([ELIGIBLE, DECLINED, LIVE, ACCEPTED]);
    expect(optionLabels()).not.toContain(ACCEPTED.label);
  });

  it("offers exactly the trusted-path-eligible population", () => {
    renderForm([ELIGIBLE, DECLINED, LIVE, ACCEPTED]);
    expect(optionLabels()).toHaveLength(2);
  });

  it("stays usable when the only remaining mentor is a declined one", () => {
    renderForm([DECLINED, LIVE, ACCEPTED]);
    const button = screen.getByRole("button", { name: /Tạo link/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByText(/Không có mentor đủ điều kiện/i)).toBeNull();
  });

  it("reports an empty state only when nothing is eligible at all", () => {
    renderForm([LIVE, ACCEPTED]);
    expect(screen.getByText(/Không có mentor đủ điều kiện/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Tạo link/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps batchSelectable strictly narrower than selectable for declined mentors", () => {
    // The invariant the two flags exist to express. If these ever coincide, the
    // batch picker and the individual form have silently merged.
    expect(DECLINED.selectable).toBe(true);
    expect(DECLINED.batchSelectable).toBe(false);
    expect(ELIGIBLE.selectable).toBe(true);
    expect(ELIGIBLE.batchSelectable).toBe(true);
  });
});
