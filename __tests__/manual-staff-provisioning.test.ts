import { describe, expect, it, vi } from "vitest";
import { executeManualStaffProvisioning, type ManualStaffProvisioningDeps } from "@/lib/manual-staff-provisioning";

const OPERATION = "11111111-1111-4111-8111-111111111111";
function deps(overrides: Partial<ManualStaffProvisioningDeps> = {}) {
  const base: ManualStaffProvisioningDeps = {
    beginJournal: vi.fn(async () => true), recordStage: vi.fn(async () => undefined),
    preLookup: vi.fn(async () => ({ ok: true, ids: [] })), invite: vi.fn(async () => ({ id: "new-auth", error: false })),
    postLookup: vi.fn(async () => ({ ok: true, ids: ["new-auth"] })), commitApplication: vi.fn(async () => undefined),
    compensate: vi.fn(async () => undefined), recordReconciliation: vi.fn(async () => undefined)
  };
  return { ...base, ...overrides };
}

describe("manual staff provisioning journal", () => {
  it("begins the durable journal before lookup or provider activity", async () => {
    const order: string[] = [], d = deps({ beginJournal: vi.fn(async () => { order.push("journal"); return true; }), preLookup: vi.fn(async () => { order.push("lookup"); return { ok: true, ids: [] }; }), invite: vi.fn(async () => { order.push("invite"); return { id: "new-auth", error: false }; }) });
    await executeManualStaffProvisioning(OPERATION, d);
    expect(order).toEqual(["journal", "lookup", "invite"]);
  });
  it("journal failure prevents every provider and application action", async () => {
    const d = deps({ beginJournal: vi.fn(async () => false) });
    const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(result).toMatchObject({ failureClass: "journal_creation_failed", operationId: OPERATION });
    expect(d.preLookup).not.toHaveBeenCalled(); expect(d.invite).not.toHaveBeenCalled(); expect(d.commitApplication).not.toHaveBeenCalled();
  });
  it("rejects a pre-existing identity without invite, mutation, deletion, or reconciliation", async () => {
    const d = deps({ preLookup: vi.fn(async () => ({ ok: true, ids: ["existing-auth"] })) });
    const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(result).toMatchObject({ status: "rejected", ownerAction: "review_existing_identity", operationId: OPERATION });
    expect(d.invite).not.toHaveBeenCalled(); expect(d.commitApplication).not.toHaveBeenCalled(); expect(d.compensate).not.toHaveBeenCalled(); expect(d.recordReconciliation).not.toHaveBeenCalled();
  });
  it("ambiguous ownership is durably reconciled and never reaches application mutation", async () => {
    const d = deps({ preLookup: vi.fn(async () => ({ ok: true, ids: ["one", "two"] })) });
    const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(result.reconciliationRequired).toBe(true); expect(result.operationId).toBe(OPERATION);
    expect(d.commitApplication).not.toHaveBeenCalled(); expect(d.compensate).not.toHaveBeenCalled(); expect(d.recordReconciliation).toHaveBeenCalledWith("ambiguous_auth_ownership", false);
  });
  it("invites only after confirmed absence and commits only after post-invite ownership proof", async () => {
    const d = deps(); const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(result).toMatchObject({ ok: true, status: "created", operationId: OPERATION, reconciliationRequired: false });
    expect(d.commitApplication).toHaveBeenCalledWith("new-auth"); expect(d.compensate).not.toHaveBeenCalled();
    expect(vi.mocked(d.recordStage).mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(["incomplete", "prelookup_zero", "provider_pending", "provider_explicit_id", "application_pending", "application_completed"]));
  });
  it("unproven post-provider identity requires reconciliation and cannot mutate", async () => {
    const d = deps({ postLookup: vi.fn(async () => ({ ok: true, ids: ["different-auth"] })) });
    const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(result.reconciliationRequired).toBe(true); expect(d.commitApplication).not.toHaveBeenCalled(); expect(d.compensate).not.toHaveBeenCalled();
  });
  it("database failure compensates only a proven-created identity and journals resolution", async () => {
    const d = deps({ commitApplication: vi.fn(async () => { throw new Error("db"); }) });
    const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(d.compensate).toHaveBeenCalledWith("new-auth"); expect(d.recordReconciliation).toHaveBeenCalledWith("database_failed_auth_compensated", true);
    expect(result).toMatchObject({ operationId: OPERATION, reconciliationRequired: false });
  });
  it("failed compensation records reconciliation-required and preserves correlation", async () => {
    const d = deps({ commitApplication: vi.fn(async () => { throw new Error("db"); }), compensate: vi.fn(async () => { throw new Error("provider"); }) });
    const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(result).toMatchObject({ operationId: OPERATION, reconciliationRequired: true, ownerAction: "manual_reconciliation" });
    expect(d.recordReconciliation).toHaveBeenCalledWith("auth_compensation_failed", false);
  });
  it("reconciliation RPC failure still returns the durable operation ID", async () => {
    const d = deps({ preLookup: vi.fn(async () => ({ ok: true, ids: ["one", "two"] })), recordReconciliation: vi.fn(async () => { throw new Error("reconcile"); }) });
    const result = await executeManualStaffProvisioning(OPERATION, d);
    expect(result).toMatchObject({ operationId: OPERATION, failureClass: "reconciliation_recording_failed", reconciliationRequired: true });
  });
  it("uses one stable operation ID and returns no identity or credential fields", async () => {
    const result = await executeManualStaffProvisioning(OPERATION, deps());
    expect(result.operationId).toBe(OPERATION);
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(["email", "authUserId", "password", "token", "requestBody"]));
    expect(JSON.stringify(result)).not.toContain("new-auth");
  });
});
