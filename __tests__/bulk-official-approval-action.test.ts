/**
 * Authorization-boundary tests for the bulkOfficialApprovalAction server
 * action (M092). bulkOfficialApproveApplications() (the library function)
 * has no internal auth check — authorization is the server action's
 * responsibility, and the DB RPC re-checks season scope per row as a second,
 * independent boundary (see m092-bulk-official-approval-migration.test.ts).
 * These tests verify the server-action boundary only.
 *
 * Classification: DIRECT SERVER ACTION TESTS (call actual server action export).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/bulk-official-approval", () => ({ bulkOfficialApproveApplications: vi.fn() }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { bulkOfficialApproveApplications } from "@/lib/bulk-official-approval";
import { bulkOfficialApprovalAction } from "@/app/actions/bulk-official-approval";
import { MAX_BULK_APPROVAL_IDS } from "@/lib/bulk-official-approval-types";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeFormData(ids: string[], extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  ids.forEach((id) => fd.append("application_id", id));
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

const ID_1 = "00000000-0000-4000-8000-000000000001";
const ID_2 = "00000000-0000-4000-8000-000000000002";
const prev = { ok: false as const, message: null };

const mixedResult = {
  ok: true as const,
  rows: [
    { applicationId: ID_1, targetRole: "mentor" as const, outcome: "approved" as const, reasonCode: "approved", reasonMessage: "Đã duyệt thành công.", personId: "p1", personCreated: true, profileId: "pr1", profileCreated: true }
  ],
  approved: 1,
  skipped: 0,
  manualRequired: 0,
  failed: 0
};

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Authorization boundary ───────────────────────────────────────────────

describe("bulkOfficialApprovalAction — authorization boundary", () => {
  it("unauthenticated → rejected before bulkOfficialApproveApplications is called", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue(null);
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/đăng nhập/i);
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it("viewer role → rejected", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "viewer-1", role: "viewer" });
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(false);
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it("reviewer role → rejected", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "reviewer-1", role: "reviewer" });
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(false);
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it("support_team role → rejected", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "support-1", role: "support_team" });
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(false);
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it("core_team role → passes auth and calls bulkOfficialApproveApplications", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "core-1", role: "core_team" });
    (bulkOfficialApproveApplications as Mock).mockResolvedValue(mixedResult);
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(true);
    expect(bulkOfficialApproveApplications).toHaveBeenCalledOnce();
  });

  it("admin role → passes auth and calls bulkOfficialApproveApplications", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin" });
    (bulkOfficialApproveApplications as Mock).mockResolvedValue(mixedResult);
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(true);
    expect(bulkOfficialApproveApplications).toHaveBeenCalledWith(
      expect.objectContaining({ applicationIds: [ID_1], actorAdminUserId: "admin-1" })
    );
  });

  it("super_admin role → passes auth and calls bulkOfficialApproveApplications", async () => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "super-1", role: "super_admin" });
    (bulkOfficialApproveApplications as Mock).mockResolvedValue(mixedResult);
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(true);
    expect(bulkOfficialApproveApplications).toHaveBeenCalledOnce();
  });
});

// ── Input validation (server action layer) ─────────────────────────────────

describe("bulkOfficialApprovalAction — server-action input validation", () => {
  beforeEach(() => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin" });
  });

  it("no applications selected → rejected without calling the library", async () => {
    const result = await bulkOfficialApprovalAction(prev, makeFormData([]));
    expect(result.ok).toBe(false);
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it(`exactly ${MAX_BULK_APPROVAL_IDS} unique IDs → allowed`, async () => {
    const ids = Array.from({ length: MAX_BULK_APPROVAL_IDS }, (_, i) => `id-${i}`);
    (bulkOfficialApproveApplications as Mock).mockResolvedValue({ ...mixedResult, rows: [] });
    const result = await bulkOfficialApprovalAction(prev, makeFormData(ids));
    expect(result.ok).toBe(true);
    expect(bulkOfficialApproveApplications).toHaveBeenCalledWith(
      expect.objectContaining({ applicationIds: expect.arrayContaining(ids) })
    );
  });

  it(`${MAX_BULK_APPROVAL_IDS + 1} unique IDs → rejected at the server-action boundary, before the library is called`, async () => {
    const ids = Array.from({ length: MAX_BULK_APPROVAL_IDS + 1 }, (_, i) => `id-${i}`);
    const result = await bulkOfficialApprovalAction(prev, makeFormData(ids));
    expect(result.ok).toBe(false);
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it("duplicate application IDs in the submission are deduplicated before the count check", async () => {
    (bulkOfficialApproveApplications as Mock).mockResolvedValue(mixedResult);
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1, ID_1, ID_2, ID_2]));
    expect(result.ok).toBe(true);
    expect(bulkOfficialApproveApplications).toHaveBeenCalledWith(
      expect.objectContaining({ applicationIds: expect.arrayContaining([ID_1, ID_2]) })
    );
    const call = (bulkOfficialApproveApplications as Mock).mock.calls[0][0];
    expect(call.applicationIds).toHaveLength(2);
  });
});

// ── Row-level result passthrough and messaging ─────────────────────────────

describe("bulkOfficialApprovalAction — row-level result passthrough", () => {
  beforeEach(() => {
    (getCurrentAdminUser as Mock).mockResolvedValue({ id: "admin-1", role: "admin" });
  });

  it("summarizes a mixed batch (approved/skipped/manual/failed) in the returned message and preserves per-row rows", async () => {
    (bulkOfficialApproveApplications as Mock).mockResolvedValue({
      ok: true,
      rows: [
        { applicationId: "a1", targetRole: "mentor", outcome: "approved", reasonCode: "approved", reasonMessage: "ok", personId: "p1", personCreated: true, profileId: "pr1", profileCreated: true },
        { applicationId: "a2", targetRole: "mentee", outcome: "skipped", reasonCode: "already_approved", reasonMessage: "skip", personId: null, personCreated: null, profileId: null, profileCreated: null },
        { applicationId: "a3", targetRole: "mentor", outcome: "manual_required", reasonCode: "blank_email", reasonMessage: "manual", personId: null, personCreated: null, profileId: null, profileCreated: null },
        { applicationId: "a4", targetRole: "mentee", outcome: "failed", reasonCode: "internal_error", reasonMessage: "fail", personId: null, personCreated: null, profileId: null, profileCreated: null }
      ],
      approved: 1,
      skipped: 1,
      manualRequired: 1,
      failed: 1
    });
    const result = await bulkOfficialApprovalAction(prev, makeFormData(["a1", "a2", "a3", "a4"]));
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(4);
    expect(result.message).toMatch(/1\/4/);
  });

  it("library-level failure (e.g. RPC error) is echoed without exposing raw internals", async () => {
    (bulkOfficialApproveApplications as Mock).mockResolvedValue({
      ok: false,
      message: "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin."
    });
    const result = await bulkOfficialApprovalAction(prev, makeFormData([ID_1]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("INTERNAL");
      expect(result.message).not.toContain("row-level-security");
    }
  });
});
