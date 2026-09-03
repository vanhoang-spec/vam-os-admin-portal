/**
 * Direct production tests for lib/bulk-official-approval.ts.
 *
 * All Supabase I/O is mocked at the RPC boundary — this module deliberately
 * does no per-row business logic itself (that all lives in the trusted DB
 * RPC, see m092-bulk-official-approval-migration.test.ts for its static
 * proof), so these tests cover the module's own actual responsibilities:
 * request-shape validation (count/dedup) before ever calling the RPC,
 * mapping the RPC's row contract onto the row-result type the UI consumes,
 * reason_code → Vietnamese message mapping, and aggregate counts.
 *
 * Classification: DIRECT PRODUCTION TESTS (call actual production export).
 */
import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { bulkOfficialApproveApplications } from "@/lib/bulk-official-approval";
import { MAX_BULK_APPROVAL_IDS } from "@/lib/bulk-official-approval-types";

const APP_1 = "00000000-0000-4000-8000-000000000001";
const APP_2 = "00000000-0000-4000-8000-000000000002";
const PERSON_1 = "00000000-0000-4000-8000-000000000011";
const PROFILE_1 = "00000000-0000-4000-8000-000000000021";

function rpcClient(rows: unknown[], error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data: error ? null : rows, error });
  return { rpc };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Request-shape validation (before any RPC call) ────────────────────────

describe("bulkOfficialApproveApplications — request-shape validation", () => {
  it("empty selection → ok:false, service client never even requested", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(rpcClient([]));
    const result = await bulkOfficialApproveApplications({ applicationIds: [], actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    expect(getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });

  it(`exactly ${MAX_BULK_APPROVAL_IDS} unique IDs → allowed, RPC called with all ${MAX_BULK_APPROVAL_IDS}`, async () => {
    const ids = Array.from({ length: MAX_BULK_APPROVAL_IDS }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const client = rpcClient(ids.map((id) => ({
      application_id: id, target_role: "mentor", outcome: "approved", reason_code: "approved",
      person_id: PERSON_1, person_created: false, profile_id: PROFILE_1, profile_created: false
    })));
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const result = await bulkOfficialApproveApplications({ applicationIds: ids, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "vam092_bulk_official_approve_applications",
      expect.objectContaining({ p_application_ids: ids, p_actor: "admin-1" })
    );
  });

  it(`${MAX_BULK_APPROVAL_IDS + 1} unique IDs → rejected before the RPC is called`, async () => {
    const ids = Array.from({ length: MAX_BULK_APPROVAL_IDS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const client = rpcClient([]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const result = await bulkOfficialApproveApplications({ applicationIds: ids, actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("duplicate IDs are deduplicated before counting against the limit", async () => {
    const client = rpcClient([
      { application_id: APP_1, target_role: "mentor", outcome: "approved", reason_code: "approved", person_id: PERSON_1, person_created: true, profile_id: PROFILE_1, profile_created: true }
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const result = await bulkOfficialApproveApplications({
      applicationIds: [APP_1, APP_1, APP_1],
      actorAdminUserId: "admin-1"
    });
    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      "vam092_bulk_official_approve_applications",
      expect.objectContaining({ p_application_ids: [APP_1] })
    );
  });

  it("service-role client unavailable → ok:false", async () => {
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(null);
    const result = await bulkOfficialApproveApplications({ applicationIds: [APP_1], actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
  });
});

// ── RPC error handling ─────────────────────────────────────────────────────

describe("bulkOfficialApproveApplications — RPC error handling", () => {
  it("RPC error → ok:false with a safe message, no raw DB text leaked", async () => {
    const client = rpcClient([], { code: "P0001", message: "INTERNAL_SENSITIVE: something exploded" });
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const result = await bulkOfficialApproveApplications({ applicationIds: [APP_1], actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("INTERNAL_SENSITIVE");
      expect(result.message).toBeTruthy();
    }
  });
});

// ── Row mapping and aggregate counts ───────────────────────────────────────

describe("bulkOfficialApproveApplications — row mapping and aggregates", () => {
  it("maps every outcome category and computes correct aggregate counts for a mixed batch", async () => {
    const client = rpcClient([
      { application_id: APP_1, target_role: "mentor", outcome: "approved", reason_code: "approved", person_id: PERSON_1, person_created: true, profile_id: PROFILE_1, profile_created: true },
      { application_id: APP_2, target_role: "mentee", outcome: "skipped", reason_code: "already_approved", person_id: PERSON_1, person_created: false, profile_id: null, profile_created: false },
      { application_id: "app-3", target_role: "mentor", outcome: "manual_required", reason_code: "blank_email", person_id: null, person_created: null, profile_id: null, profile_created: null },
      { application_id: "app-4", target_role: "mentee", outcome: "failed", reason_code: "internal_error", person_id: null, person_created: null, profile_id: null, profile_created: null }
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);

    const result = await bulkOfficialApproveApplications({
      applicationIds: [APP_1, APP_2, "app-3", "app-4"],
      actorAdminUserId: "admin-1"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approved).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.manualRequired).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.rows).toHaveLength(4);

    const approvedRow = result.rows.find((r) => r.applicationId === APP_1);
    expect(approvedRow).toMatchObject({
      outcome: "approved",
      targetRole: "mentor",
      personId: PERSON_1,
      personCreated: true,
      profileId: PROFILE_1,
      profileCreated: true
    });
    expect(approvedRow?.reasonMessage).toBeTruthy();

    const manualRow = result.rows.find((r) => r.applicationId === "app-3");
    expect(manualRow?.outcome).toBe("manual_required");
    expect(manualRow?.reasonMessage.toLowerCase()).toMatch(/thủ công|email/);

    const failedRow = result.rows.find((r) => r.applicationId === "app-4");
    expect(failedRow?.outcome).toBe("failed");
    expect(failedRow?.personId).toBeNull();
  });

  it("falls back to a generic message for an unmapped reason_code, and never returns an empty message", async () => {
    const client = rpcClient([
      { application_id: APP_1, target_role: "mentor", outcome: "failed", reason_code: "some_future_reason_code", person_id: null, person_created: null, profile_id: null, profile_created: null }
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    const result = await bulkOfficialApproveApplications({ applicationIds: [APP_1], actorAdminUserId: "admin-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].reasonMessage).toBeTruthy();
  });

  it("M092.1: maps the profile-concurrency ambiguous_profile reason_code to an operator-facing manual_required message", () => {
    const client = rpcClient([
      { application_id: APP_1, target_role: "mentor", outcome: "manual_required", reason_code: "ambiguous_profile", person_id: PERSON_1, person_created: false, profile_id: null, profile_created: null }
    ]);
    (getSupabaseServiceRoleClient as Mock).mockReturnValue(client);
    return bulkOfficialApproveApplications({ applicationIds: [APP_1], actorAdminUserId: "admin-1" }).then((result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows[0].outcome).toBe("manual_required");
      expect(result.rows[0].reasonMessage).not.toBe("");
      expect(result.rows[0].reasonMessage.toLowerCase()).toMatch(/thủ công|profile/);
    });
  });
});
