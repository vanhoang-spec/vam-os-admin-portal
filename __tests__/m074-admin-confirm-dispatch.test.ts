/**
 * S12 UAT incident — Admin Confirm produced app/error.tsx and committed nothing.
 *
 * Live Staging evidence proved CONFIRM_FAILED_NO_MUTATION: no confirm_renewal
 * audit, profile unchanged, no S12 membership, application still `submitted`.
 *
 * The failure was in Next's Server Action DISPATCH, not in our action body:
 * `confirmRenewalAction` catches every throw and returns a graceful state, so
 * it is structurally incapable of reaching an error boundary; and because
 * nothing mutated, the post-`revalidatePath` re-render saw byte-identical data
 * to the render that had just succeeded. The confirm control was the only
 * action on the page dispatched as an INLINE Server Action closing over an
 * encrypted bound argument; its three siblings are module-level actions taking
 * only FormData, and all three worked.
 *
 * These tests pin the shape that removes that difference, and the server-side
 * re-binding that makes carrying the intent in the form safe.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "fs";

vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(),
  canOperateSeason: vi.fn()
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/renewal-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/renewal-runtime")>();
  return { ...actual, confirmRenewalAndApprove: vi.fn(async () => ({ ok: true, outcome: "renewal_complete", message: "ok" })) };
});

import { confirmRenewalAction } from "@/app/actions/renewals";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { confirmRenewalAndApprove } from "@/lib/renewal-runtime";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const IDS = {
  application: "2d613e55-f49c-4113-827e-b181c25aa24e",
  season: "7fca95f5-2205-4060-8a9a-7d604e4268f7",
  admin: "00000000-0000-4000-8000-0000000000aa"
};

const DIFF = [
  { field: "capacity_target", before: 3, after: 1 },
  { field: "title_current", before: "Mentor", after: "Mentor UAT S12" }
];

function reviewedJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    applicationId: IDS.application,
    expectedProfile: { capacity_target: 3, title_current: "Mentor" },
    profileUpdate: { capacity_target: 1, title_current: "Mentor UAT S12" },
    diff: DIFF,
    ...overrides
  });
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function confirmForm(overrides: Record<string, unknown> = {}) {
  return form({ application_id: IDS.application, reviewed: reviewedJson(overrides) });
}

function chain(data: unknown) {
  const c: Record<string, any> = {};
  for (const m of ["select", "eq", "order", "limit"]) c[m] = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => ({ data, error: null }));
  return c;
}

const previous = { ok: false, message: "" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  (getSupabaseServiceRoleClient as any).mockReturnValue({ from: () => chain({ season_id: IDS.season }) });
  (getAdminScopeContext as any).mockResolvedValue({
    adminUser: { id: IDS.admin, role: "super_admin", status: "active", full_name: "Ops", email: "ops@example.com" }
  });
  (getCurrentAdminUser as any).mockResolvedValue({ id: IDS.admin, role: "super_admin", status: "active" });
  (canOperateSeason as any).mockResolvedValue(true);
  (confirmRenewalAndApprove as any).mockResolvedValue({ ok: true, outcome: "renewal_complete", message: "ok" });
});

// ---------------------------------------------------------------------------
// The defect itself: dispatch shape
// ---------------------------------------------------------------------------

describe("M074 confirm is dispatched as a plain FormData Server Action", () => {
  it("the admin page defines no inline Server Action and binds no closure", () => {
    const page = fs.readFileSync("app/admin/renewals/page.tsx", "utf8");
    expect(page).not.toContain('"use server"');
    expect(page).not.toContain("confirmReviewed");
    expect(page).not.toContain("confirmRenewalAction");
    expect(page).not.toContain("RenewalRowActions");
  });

  it("the confirm control uses the module-level action, like its three working siblings", () => {
    const controls = fs.readFileSync("app/admin/renewals/renewal-controls.tsx", "utf8");
    expect(controls).toContain("confirmRenewalAction");
    expect(controls).toContain("useFormState(confirmRenewalAction");
    // No action is threaded through props any more.
    expect(controls).not.toContain("confirmAction");
  });

  it("the reviewed snapshot travels in the form, alongside the application id", () => {
    const controls = fs.readFileSync("app/admin/renewals/renewal-controls.tsx", "utf8");
    expect(controls).toContain('name="reviewed"');
    expect(controls).toContain('name="application_id"');
  });

  it("accepts a well-formed confirmation and reaches the trusted runtime exactly once", async () => {
    const result = await confirmRenewalAction(previous, confirmForm());
    expect(result.ok).toBe(true);
    expect(confirmRenewalAndApprove).toHaveBeenCalledOnce();
    const [input] = (confirmRenewalAndApprove as any).mock.calls[0];
    expect(input.applicationId).toBe(IDS.application);
    expect(input.reviewed.diff).toEqual(DIFF);
    expect(input.reviewed.profileUpdate).toEqual({ capacity_target: 1, title_current: "Mentor UAT S12" });
  });
});

// ---------------------------------------------------------------------------
// The action must never throw — that is what produced app/error.tsx
// ---------------------------------------------------------------------------

describe("M074 confirm never escalates to an error boundary", () => {
  it("returns a graceful state when the scope layer throws", async () => {
    (getAdminScopeContext as any).mockRejectedValue(new Error("scope exploded"));
    (getCurrentAdminUser as any).mockRejectedValue(new Error("auth exploded"));
    const result = await confirmRenewalAction(previous, confirmForm());
    expect(result.ok).toBe(false);
    expect(confirmRenewalAndApprove).not.toHaveBeenCalled();
  });

  it("returns a graceful state when the operator lacks S12 operations scope", async () => {
    (canOperateSeason as any).mockResolvedValue(false);
    const result = await confirmRenewalAction(previous, confirmForm());
    expect(result.ok).toBe(false);
    expect(confirmRenewalAndApprove).not.toHaveBeenCalled();
  });

  it("returns a graceful state when no invite is bound to the application", async () => {
    (getSupabaseServiceRoleClient as any).mockReturnValue({ from: () => chain(null) });
    const result = await confirmRenewalAction(previous, confirmForm());
    expect(result.ok).toBe(false);
    expect(confirmRenewalAndApprove).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", ""],
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["a diff that is not an array", JSON.stringify({ applicationId: IDS.application, expectedProfile: {}, profileUpdate: {}, diff: "x" })],
    ["a diff entry without a field name", JSON.stringify({ applicationId: IDS.application, expectedProfile: {}, profileUpdate: {}, diff: [{ before: 1, after: 2 }] })],
    ["a nested object in expectedProfile", JSON.stringify({ applicationId: IDS.application, expectedProfile: { a: { b: 1 } }, profileUpdate: {}, diff: [] })]
  ])("refuses %s without throwing and without reaching the runtime", async (_label, raw) => {
    const result = await confirmRenewalAction(previous, form({ application_id: IDS.application, reviewed: raw }));
    expect(result.ok).toBe(false);
    expect(confirmRenewalAndApprove).not.toHaveBeenCalled();
  });

  it("refuses when the id in the form disagrees with the id inside the snapshot", async () => {
    const fd = form({
      application_id: "11111111-1111-4111-8111-111111111111",
      reviewed: reviewedJson()
    });
    const result = await confirmRenewalAction(previous, fd);
    expect(result.ok).toBe(false);
    expect(confirmRenewalAndApprove).not.toHaveBeenCalled();
  });

  it("refuses a non-uuid application id", async () => {
    const result = await confirmRenewalAction(previous, form({
      application_id: "not-a-uuid",
      reviewed: reviewedJson({ applicationId: "not-a-uuid" })
    }));
    expect(result.ok).toBe(false);
    expect(confirmRenewalAndApprove).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotence and the downstream contract the console renders
// ---------------------------------------------------------------------------

describe("M074 repeated confirm produces no duplicate effect", () => {
  it("a second confirm on an already-approved application is a no-op outcome", async () => {
    (confirmRenewalAndApprove as any).mockResolvedValue({
      ok: true,
      outcome: "renewal_already_complete",
      message: "Gia hạn đã hoàn tất trước đó; không tạo thêm mutation hoặc log trùng."
    });
    const first = await confirmRenewalAction(previous, confirmForm());
    const second = await confirmRenewalAction(previous, confirmForm());
    expect(first.outcome).toBe("renewal_already_complete");
    expect(second.outcome).toBe("renewal_already_complete");
    expect(second.message).toMatch(/không tạo thêm mutation/);
  });

  it("the runtime short-circuits an approved application before the confirm RPC", () => {
    const runtime = fs.readFileSync("lib/renewal-runtime.ts", "utf8");
    const guard = runtime.indexOf('snapshot.application.status === "approved_as_mentor"');
    const rpc = runtime.indexOf('client.rpc("vam071_confirm_renewal_profile"');
    expect(guard).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(rpc);
  });
});

// ---------------------------------------------------------------------------
// Post-confirm render: the finalized state must not crash the console
// ---------------------------------------------------------------------------

describe("M074 finalized renewal renders", () => {
  it("the pending filter and confirm affordance both close on approved_as_mentor", () => {
    const page = fs.readFileSync("app/admin/renewals/page.tsx", "utf8");
    const controls = fs.readFileSync("app/admin/renewals/renewal-controls.tsx", "utf8");
    expect(page).toContain('startsWith("approved_as_")');
    expect(controls).toContain('startsWith("approved_as_")');
  });

  it("an accepted row with an empty diff and a present membership still renders its fields", async () => {
    const { buildRenewalProfileDiff, buildRenewalProfileRefresh } = await import("@/lib/renewal-profile-safety");
    // After a successful confirm the profile equals the proposal, so the diff
    // collapses to empty. That must be a legal render state, not a crash.
    const refresh = buildRenewalProfileRefresh({ mentoring_capacity_total: 1, title_current: "Mentor UAT S12" });
    const diff = buildRenewalProfileDiff({ capacity_target: 1, title_current: "Mentor UAT S12" }, refresh);
    expect(diff).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lineage and the approved UI policy correction
// ---------------------------------------------------------------------------

describe("M074 lineage and copy policy", () => {
  it("renewal never proposes a lineage field, so S11 history cannot be rewritten", async () => {
    const { buildRenewalProfileRefresh, RENEWAL_STRIPPED_PROFILE_FIELDS } = await import("@/lib/renewal-profile-safety");
    const refresh = buildRenewalProfileRefresh({
      first_vam_season: "UEHM-S12",
      prior_vam_involvement: "rewritten",
      title_current: "Mentor UAT S12"
    }) as Record<string, unknown>;
    for (const field of RENEWAL_STRIPPED_PROFILE_FIELDS) {
      expect(`${field}:${field in refresh}`).toBe(`${field}:false`);
    }
    expect(refresh.title_current).toBe("Mentor UAT S12");
  });

  it("the Core Team note has no placeholder implying continuity with last season's mentee", () => {
    const form = fs.readFileSync("app/renew/[token]/renewal-form.tsx", "utf8");
    const line = form.split(/\r?\n/).find((l) => l.includes('name="core_team_note"')) ?? "";
    expect(line).not.toContain("placeholder");
    expect(form).not.toMatch(/mentor cũ năm ngoái|ưu tiên match bạn đó/);
  });
});
