/**
 * @vitest-environment jsdom
 *
 * `screening_passed` is retired as a FORWARD decision.
 *
 * It remains a legal application status, remains in history, remains in the
 * export filter and remains labelled in the audit trail. What it may no longer
 * be is the target of a NEW decision — through any surface, including the
 * generic /applications/bulk-decision route, which stayed reachable by URL after
 * its button was removed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/application-decisions", () => ({
  applyApplicationDecisions: vi.fn(),
  recordApplicationDecision: vi.fn(),
  getApplicationDecisionEligibility: vi.fn()
}));

const mockUseFormState = vi.fn();
const mockUseFormStatus = vi.fn();
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (...args: unknown[]) => mockUseFormState(...args),
    useFormStatus: () => mockUseFormStatus()
  };
});

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { applyApplicationDecisions, recordApplicationDecision } from "@/lib/application-decisions";
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { updateApplicationDecisionAction } from "@/app/actions/application-decisions";
import { bulkInviteInterviewAction } from "@/app/actions/bulk-invite-interview";
import { BulkDecisionForm } from "@/app/applications/bulk-decision/bulk-decision-form";
import {
  ALLOWED_DECISION_STATUSES,
  RETIRED_FORWARD_DECISION_STATUSES
} from "@/lib/decision-action-types";
import { classifyOutcome, deriveDecisions } from "@/lib/recruitment-export";
import { applicationStatusLabel } from "@/lib/ui-labels";

const APP = "cccccccc-0000-4000-8000-00000000000c";
const CORE_TEAM = { id: "40000000-0000-4000-8000-0000000000c1", role: "core_team", full_name: "Ops" };

const CARRIAGE_RETURN = String.fromCharCode(13);
const read = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").split(CARRIAGE_RETURN).join("");

function bulkForm(status: string) {
  const data = new FormData();
  data.append("application_id", APP);
  data.set(`expected_status_${APP}`, "screening_completed");
  data.set("new_status", status);
  return data;
}

function individualForm(status: string) {
  const data = new FormData();
  data.set("application_id", APP);
  data.set("new_status", status);
  data.set("previous_status", "screening_completed");
  return data;
}

beforeEach(() => {
  mockUseFormState.mockReturnValue([{ ok: false, message: null }, vi.fn()]);
  mockUseFormStatus.mockReturnValue({ pending: false });
  vi.mocked(getCurrentAdminUser).mockResolvedValue(CORE_TEAM as never);
  vi.mocked(applyApplicationDecisions).mockResolvedValue({
    ok: true,
    id: APP,
    applied: 1,
    failed: 0,
    message: "Đã cập nhật 1 đơn."
  });
  vi.mocked(recordApplicationDecision).mockResolvedValue({
    ok: true,
    id: APP,
    applied: 1,
    failed: 0
  });
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// A — the route renders no screening_passed action
// ---------------------------------------------------------------------------

describe("A. /applications/bulk-decision offers no screening_passed action", () => {
  it("does not render it as a selectable option", () => {
    render(<BulkDecisionForm rows={[{ id: APP, fullName: "A", role: "mentor", status: "screening_completed" }]} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).not.toContain("screening_passed");
    expect(select.textContent).not.toContain("Qua vòng hồ sơ");
  });

  it("points the screening use case at the dedicated bulk invite route", () => {
    render(<BulkDecisionForm rows={[]} />);
    expect(
      screen.getByText("Mời phỏng vấn hàng loạt").getAttribute("href")
    ).toBe("/applications/bulk-invite-interview");
  });

  it("leaves no forward 'Qua vòng hồ sơ' control anywhere in the mutation UI", () => {
    const surfaces = [
      "app/applications/bulk-decision/bulk-decision-form.tsx",
      "app/applications/_components/bulk-screening-controls.tsx",
      "app/applications/[id]/decision-form.tsx",
      "app/applications/[id]/screening-decision-panel.tsx",
      "app/applications/bulk-invite-interview/bulk-invite-form.tsx"
    ];
    for (const path of surfaces) {
      const source = read(path);
      // A comment may explain the removal; a control may not exist.
      expect(source).not.toContain('<option value="screening_passed">');
      expect(source).not.toContain('value="screening_passed"');
    }
  });
});

// ---------------------------------------------------------------------------
// B — crafted requests fail closed at the mutation boundary
// ---------------------------------------------------------------------------

describe("B. a crafted request to screening_passed is refused server-side", () => {
  it("is refused by the generic BULK decision action", async () => {
    const result = await bulkApplicationDecisionAction({ ok: false, message: null }, bulkForm("screening_passed"));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ngừng sử dụng");
    expect(applyApplicationDecisions).not.toHaveBeenCalled();
  });

  it("is refused by the generic INDIVIDUAL decision action", async () => {
    const result = await updateApplicationDecisionAction(
      { ok: false, message: null },
      individualForm("screening_passed")
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ngừng sử dụng");
    expect(recordApplicationDecision).not.toHaveBeenCalled();
  });

  it("is refused before authorization is even the question — no write is attempted", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ ...CORE_TEAM, role: "super_admin" } as never);
    const result = await bulkApplicationDecisionAction({ ok: false, message: null }, bulkForm("screening_passed"));
    expect(result.ok).toBe(false);
    expect(applyApplicationDecisions).not.toHaveBeenCalled();
  });

  it("declares the retirement once, and enforces it at both boundaries", () => {
    expect(Array.from(RETIRED_FORWARD_DECISION_STATUSES)).toEqual(["screening_passed"]);
    for (const path of [
      "app/actions/bulk-application-decisions.ts",
      "app/actions/application-decisions.ts"
    ]) {
      expect(read(path)).toContain("RETIRED_FORWARD_DECISION_STATUSES.has(newStatus)");
    }
  });
});

// ---------------------------------------------------------------------------
// C — the remaining bulk decisions still work
// ---------------------------------------------------------------------------

describe("C. the route's other decisions are preserved", () => {
  const preserved = [
    "invited_to_interview",
    "interview_scheduled",
    "interview_passed",
    "waitlisted",
    "rejected_or_not_fit",
    "needs_more_review"
  ];

  it.each(preserved)("still applies %s", async (status) => {
    const result = await bulkApplicationDecisionAction({ ok: false, message: null }, bulkForm(status));
    expect(result.ok).toBe(true);
    expect(vi.mocked(applyApplicationDecisions).mock.calls[0][0].newStatus).toBe(status);
  });

  it("still renders every preserved option", () => {
    render(<BulkDecisionForm rows={[]} />);
    const values = Array.from((screen.getByRole("combobox") as HTMLSelectElement).options)
      .map((o) => o.value)
      .filter(Boolean);
    expect(values).toEqual(preserved);
  });

  it("still refuses withdrawn through the bulk surface, as before", async () => {
    const result = await bulkApplicationDecisionAction({ ok: false, message: null }, bulkForm("withdrawn"));
    expect(result.ok).toBe(false);
    expect(applyApplicationDecisions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// D — the dedicated bulk invite route is unaffected
// ---------------------------------------------------------------------------

describe("D. the direct bulk invite route still works", () => {
  it("applies invited_to_interview through its own action", async () => {
    vi.mocked(applyApplicationDecisions).mockResolvedValue({
      ok: true,
      id: APP,
      applied: 1,
      failed: 0,
      message: "Đã cập nhật 1 đơn.",
      rows: [{ applicationId: APP, applied: true, reason: "applied", message: "Đã mời phỏng vấn." }]
    });
    const data = new FormData();
    data.append("application_id", APP);
    data.set(`expected_status_${APP}`, "screening_completed");
    data.set(`applicant_name_${APP}`, "Ứng viên A");

    const result = await bulkInviteInterviewAction(
      { ok: false, message: "", appliedCount: 0, blockedCount: 0, rows: [] },
      data
    );
    expect(result.ok).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(vi.mocked(applyApplicationDecisions).mock.calls[0][0].newStatus).toBe("invited_to_interview");
  });

  it("cannot be turned into a screening_passed surface — the status is a constant", () => {
    const action = read("app/actions/bulk-invite-interview.ts");
    expect(action).toContain("newStatus: BULK_INVITE_TARGET_STATUS");
    expect(action).not.toContain('formData.get("new_status")');
  });
});

// ---------------------------------------------------------------------------
// E — history stays readable
// ---------------------------------------------------------------------------

describe("E. historical screening_passed remains readable and exportable", () => {
  it("keeps its status label for the audit trail", () => {
    expect(applicationStatusLabel("screening_passed")).toBe("Qua vòng hồ sơ");
  });

  it("keeps it in the export filter options", () => {
    expect(read("app/applications/exports/export-panels.tsx")).toContain('value="screening_passed"');
  });

  it("keeps it as a legal status the lifecycle still recognises", () => {
    // Removing it here would strand every application that already holds it.
    expect(ALLOWED_DECISION_STATUSES).toContain("screening_passed");
  });

  it("still derives a two-step history as screening passed", () => {
    const derived = deriveDecisions([
      { new_status: "screening_passed", previous_status: "screening_completed", created_at: "2026-08-20T00:00:00Z" }
    ]);
    expect(derived.screening?.status).toBe("screening_passed");
    expect(classifyOutcome(derived.screening)).toBe("passed");
  });

  it("does not touch old records — the guard governs new decisions only", () => {
    const types = read("lib/decision-action-types.ts");
    expect(types).toContain("This set governs");
    expect(types).toContain("what a NEW decision may target");
    // No migration, no backfill, no update of existing rows.
    for (const path of [
      "app/actions/bulk-application-decisions.ts",
      "app/actions/application-decisions.ts"
    ]) {
      expect(read(path)).not.toContain("update(");
    }
  });
});
