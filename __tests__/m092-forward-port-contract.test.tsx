/** @vitest-environment jsdom */
/**
 * M092 forward-port contract on the current baseline.
 *
 * The ported suites cover authorization, count/dedup validation and row
 * mapping. This file covers what the forward-port itself has to guarantee on
 * THIS baseline:
 *
 *   * the action forwards only application IDs — no client-supplied role,
 *     status, identity or season can reach the trusted RPC;
 *   * every reason_code the DEPLOYED Staging RPC can emit has a Vietnamese
 *     operator message, so no machine token reaches the UI;
 *   * renewal and returning-Mentor rows keep their distinct outcomes;
 *   * the mutating submit is locked against double submission;
 *   * retry re-selects only unresolved rows and cannot duplicate work;
 *   * the entry point is gated by the same authority as the action, and stays
 *     a separate surface from the post-interview bulk decision screen.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

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
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { bulkOfficialApprovalAction } from "@/app/actions/bulk-official-approval";
import { bulkOfficialApproveApplications } from "@/lib/bulk-official-approval";
import { BulkApprovalForm } from "@/app/applications/bulk-approval/bulk-approval-form";
import { initialBulkApprovalActionState, type BulkApprovalRowResult } from "@/lib/bulk-official-approval-types";

const APP_A = "00000000-0000-4000-8000-00000000000a";
const APP_B = "00000000-0000-4000-8000-00000000000b";

/**
 * Every reason_code the Staging deployment of
 * vam092_bulk_official_approve_applications can emit, read out of the
 * deployed function body during the 03 Sep read-only preflight. If the RPC
 * ever gains a code with no Vietnamese message, the operator would see a bare
 * machine token — this list is what makes that a test failure.
 */
const DEPLOYED_RPC_REASON_CODES = [
  "approved",
  "already_approved",
  "ambiguous_identity",
  "ambiguous_profile",
  "application_not_found",
  "blank_email",
  "blank_full_name",
  "internal_error",
  "linked_person_not_found",
  "person_link_identity_conflict",
  "renewal_requires_individual_path",
  "returning_mentor_renewal_path_required",
  "scope_denied",
  "unsupported_role"
] as const;

/** Reason codes the shared lifecycle gate passes through unchanged. */
const ELIGIBILITY_GATE_REASON_CODES = [
  "stage_requirement_missing",
  "profile_review_minimum_not_met",
  "interview_review_minimum_not_met",
  "application_role_mismatch",
  "additional_review_not_submitted",
  "invalid_transition",
  "terminal_status",
  "unsupported_decision"
] as const;

function rpcClient(rows: unknown[]) {
  return { rpc: vi.fn().mockResolvedValue({ data: rows, error: null }) };
}

function rpcRow(overrides: Record<string, unknown> = {}) {
  return {
    application_id: APP_A,
    target_role: "mentor",
    outcome: "approved",
    reason_code: "approved",
    person_id: null,
    person_created: null,
    profile_id: null,
    profile_created: null,
    ...overrides
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockUseFormStatus.mockReturnValue({ pending: false });
});
afterEach(cleanup);

describe("M092 — the client cannot forge anything but the selection", () => {
  it("forwards only application IDs, dropping every other submitted field", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin" });
    const client = rpcClient([rpcRow()]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const fd = new FormData();
    fd.append("application_id", APP_A);
    // A hostile or stale client trying to dictate the outcome:
    fd.set("role_applied", "mentor");
    fd.set("target_role", "mentee");
    fd.set("person_id", "attacker-person");
    fd.set("profile_id", "attacker-profile");
    fd.set("season_id", "attacker-season");
    fd.set("status", "interview_passed");
    fd.set("outcome", "approved");
    fd.set("eligible", "true");
    fd.set("actorAdminUserId", "someone-else");

    const result = await bulkOfficialApprovalAction({ ok: false, message: null }, fd);
    expect(result.ok).toBe(true);

    const args = client.rpc.mock.calls[0];
    expect(args[0]).toBe("vam092_bulk_official_approve_applications");
    // Exactly two parameters reach the database: the ID list and the actor
    // resolved from the server session — never anything the form posted.
    expect(Object.keys(args[1]).sort()).toEqual(["p_actor", "p_application_ids"]);
    expect(args[1].p_application_ids).toEqual([APP_A]);
    expect(args[1].p_actor).toBe("admin-1");
    expect(JSON.stringify(args[1])).not.toContain("attacker");
    expect(JSON.stringify(args[1])).not.toContain("someone-else");
  });

  it("takes the actor from the session, not from the submission", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "core-9", role: "core_team" });
    const client = rpcClient([rpcRow()]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const fd = new FormData();
    fd.append("application_id", APP_A);
    fd.set("actor", "admin-1");
    await bulkOfficialApprovalAction({ ok: false, message: null }, fd);
    expect(client.rpc.mock.calls[0][1].p_actor).toBe("core-9");
  });
});

describe("M092 — no machine reason_code can reach the operator", () => {
  it.each([...DEPLOYED_RPC_REASON_CODES, ...ELIGIBILITY_GATE_REASON_CODES])(
    "maps reason_code %s to a Vietnamese operator message",
    async (code) => {
      (getSupabaseServiceRoleClient as Mock).mockReturnValue(
        rpcClient([rpcRow({ reason_code: code, outcome: "skipped" })])
      );
      const result = await bulkOfficialApproveApplications({
        applicationIds: [APP_A],
        actorAdminUserId: "admin-1"
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const message = result.rows[0].reasonMessage;
      expect(message.length).toBeGreaterThan(10);
      // Never the bare machine token, and never an untranslated identifier.
      expect(message).not.toBe(code);
      expect(message).not.toMatch(/^[a-z_]+$/);
      expect(message).toMatch(/[àáảãạăâđêôơưèéẹếệìíịòóọồốộùúụýỳđ]/i);
    }
  );

  it("falls back to a safe message for an unknown future reason_code", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      rpcClient([rpcRow({ reason_code: "some_future_code_v9", outcome: "failed" })])
    );
    const result = await bulkOfficialApproveApplications({
      applicationIds: [APP_A],
      actorAdminUserId: "admin-1"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.rows[0].reasonMessage).not.toContain("some_future_code_v9");
    expect(result.rows[0].reasonMessage).toMatch(/liên hệ admin/i);
  });
});

describe("M092 — renewal and returning-Mentor outcomes stay distinct", () => {
  it("keeps a renewal application out of ordinary approval and says why", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      rpcClient([rpcRow({ outcome: "skipped", reason_code: "renewal_requires_individual_path" })])
    );
    const result = await bulkOfficialApproveApplications({
      applicationIds: [APP_A],
      actorAdminUserId: "admin-1"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.rows[0].outcome).toBe("skipped");
    expect(result.approved).toBe(0);
    expect(result.rows[0].reasonMessage).toMatch(/gia hạn/i);
    expect(result.rows[0].personCreated).toBeNull();
    expect(result.rows[0].profileCreated).toBeNull();
  });

  it("reports a returning-Mentor collision as manual_required, never as an approval", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      rpcClient([
        rpcRow({ outcome: "manual_required", reason_code: "returning_mentor_renewal_path_required" })
      ])
    );
    const result = await bulkOfficialApproveApplications({
      applicationIds: [APP_A],
      actorAdminUserId: "admin-1"
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.rows[0].outcome).toBe("manual_required");
    expect(result.approved).toBe(0);
    expect(result.manualRequired).toBe(1);
    expect(result.rows[0].reasonMessage).toMatch(/mentor profile|gia hạn/i);
    expect(result.rows[0].reasonMessage).toMatch(/thủ công/i);
  });

  it("counts a mixed batch correctly and leaves valid rows approved", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(
      rpcClient([
        rpcRow({ application_id: APP_A, outcome: "approved", reason_code: "approved" }),
        rpcRow({ application_id: APP_B, outcome: "manual_required", reason_code: "ambiguous_identity" })
      ])
    );
    const result = await bulkOfficialApproveApplications({
      applicationIds: [APP_A, APP_B],
      actorAdminUserId: "admin-1"
    });
    if (!result.ok) throw new Error("expected ok");
    expect([result.approved, result.skipped, result.manualRequired, result.failed]).toEqual([1, 0, 1, 0]);
  });
});

function renderForm(state = initialBulkApprovalActionState, action = vi.fn()) {
  mockUseFormState.mockReturnValue([state, action]);
  const rows = [
    { id: APP_A, fullName: "UAT A", email: "a@ops-validation.vam.test", role: "mentor" as const, status: "interview_passed", isRenewal: false },
    { id: APP_B, fullName: "UAT B", email: "b@ops-validation.vam.test", role: "mentee" as const, status: "interview_passed", isRenewal: false }
  ];
  return { action, ...render(<BulkApprovalForm rows={rows} />) };
}

describe("M092 — the mutating submit is guarded", () => {
  it("locks out a second submit of the same batch", () => {
    const { container } = renderForm();
    const form = container.querySelector("form")!;
    const first = fireEvent.submit(form);
    const second = fireEvent.submit(form);
    // fireEvent returns false when preventDefault() was called.
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("re-selects only unresolved rows for retry, never the approved ones", () => {
    const rows: BulkApprovalRowResult[] = [
      { applicationId: APP_A, targetRole: "mentor", outcome: "approved", reasonCode: "approved", reasonMessage: "Đã duyệt thành công.", personId: "p", personCreated: true, profileId: "pr", profileCreated: true },
      { applicationId: APP_B, targetRole: "mentee", outcome: "manual_required", reasonCode: "ambiguous_identity", reasonMessage: "Có nhiều hồ sơ người trùng email — cần xử lý thủ công.", personId: null, personCreated: null, profileId: null, profileCreated: null }
    ];
    renderForm({ ok: true, message: "Đã duyệt 1/2 đơn.", rows });

    fireEvent.click(screen.getByRole("button", { name: /Chọn lại các dòng/i }));

    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const byValue = new Map(boxes.map((b) => [b.value, b]));
    // The already-approved row must not be re-submitted; only the unresolved one.
    expect(byValue.get(APP_A)!.checked).toBe(false);
    expect(byValue.get(APP_B)!.checked).toBe(true);
  });

  it("shows the per-row outcome and reason, not the raw reason code", () => {
    renderForm({
      ok: true,
      message: "Đã duyệt 0/1 đơn.",
      rows: [
        { applicationId: APP_B, targetRole: "mentor", outcome: "manual_required", reasonCode: "returning_mentor_renewal_path_required", reasonMessage: "Người này đã có mentor profile hoặc đang trong luồng gia hạn Season 12 — cần xử lý thủ công qua quy trình gia hạn, không duyệt như đơn mới.", personId: null, personCreated: null, profileId: null, profileCreated: null }
      ]
    });
    expect(screen.getByText("Cần xử lý thủ công")).toBeTruthy();
    expect(screen.getByText(/cần xử lý thủ công qua quy trình gia hạn/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("returning_mentor_renewal_path_required");
  });
});

describe("M092 — entry point respects the current information architecture", () => {
  const APPLICATIONS_PAGE = readFileSync("app/applications/page.tsx", "utf8");
  const BULK_PAGE = readFileSync("app/applications/bulk-approval/page.tsx", "utf8");

  it("gates the new entry point on the same authority as the action", () => {
    expect(APPLICATIONS_PAGE).toContain('href="/applications/bulk-approval"');
    expect(APPLICATIONS_PAGE).toContain("canDecide(adminUser.role)");
  });

  it("keeps official approval free of any cross-link to the bulk-decision screen", () => {
    // The historical M092 page linked to /applications/bulk-decision. That
    // link is still not ported: the two surfaces are reached independently
    // from /applications, so this page cannot become a back door into a
    // different bulk mutation.
    const executable = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(executable(BULK_PAGE)).not.toContain('href="/applications/bulk-decision"');
    expect(APPLICATIONS_PAGE).toContain('href="/applications/exports"');
  });

  it("stays a separate entry point from the post-interview decision screen", () => {
    // Both are canDecide-gated and both live in the applications action row,
    // so each must keep its own href and its own unambiguous Vietnamese label.
    expect(APPLICATIONS_PAGE).toContain("Duyệt chính thức hàng loạt");
    expect(APPLICATIONS_PAGE).toContain("Quyết định sau phỏng vấn");
    expect(APPLICATIONS_PAGE).toContain('href="/applications/bulk-approval"');
    expect(APPLICATIONS_PAGE).toContain('href="/applications/bulk-decision"');
  });

  it("keeps the Slice 2C export entry point and its guard untouched", () => {
    expect(APPLICATIONS_PAGE).toContain("canAssignReview(adminUser.role) && exportSeasonId");
  });
});
