import type { AuthOwnershipState } from "@/lib/account-auth-ownership";

export type ProvisioningStage = "journal" | "pre_lookup" | "provider" | "application" | "compensation" | "reconciliation" | "complete";
export type ProvisioningResult = {
  ok: boolean;
  status: "created" | "rejected" | "failed";
  failureClass?: string;
  failureStage?: ProvisioningStage;
  operationId: string;
  reconciliationRequired: boolean;
  ownerAction: "none" | "review_existing_identity" | "manual_reconciliation" | "do_not_retry";
};

type JournalOwnershipState = AuthOwnershipState | "incomplete";
export type ManualStaffProvisioningDeps = {
  beginJournal: () => Promise<boolean>;
  recordStage: (stage: string, ownership: JournalOwnershipState, authId: string | null, deleteAllowed: boolean, failureClass?: string) => Promise<void>;
  preLookup: () => Promise<{ ok: boolean; ids: string[] }>;
  invite: () => Promise<{ id: string | null; error: boolean }>;
  postLookup: () => Promise<{ ok: boolean; ids: string[] }>;
  commitApplication: (authId: string) => Promise<void>;
  compensate: (authId: string) => Promise<void>;
  recordReconciliation: (failureClass: string, resolved: boolean) => Promise<void>;
};

function result(operationId: string, input: Omit<ProvisioningResult, "operationId">): ProvisioningResult { return { operationId, ...input }; }
async function reconcile(deps: ManualStaffProvisioningDeps, operationId: string, failureClass: string, authId: string | null, resolved = false) {
  try {
    await deps.recordStage(resolved ? "reconciliation_resolved" : "reconciliation_required", resolved ? "proven_created" : "ambiguous", authId, false, failureClass);
    await deps.recordReconciliation(failureClass, resolved);
    return result(operationId, { ok: false, status: "failed", failureClass, failureStage: "reconciliation", reconciliationRequired: !resolved, ownerAction: resolved ? "none" : "manual_reconciliation" });
  } catch {
    return result(operationId, { ok: false, status: "failed", failureClass: "reconciliation_recording_failed", failureStage: "reconciliation", reconciliationRequired: true, ownerAction: "manual_reconciliation" });
  }
}

export async function executeManualStaffProvisioning(operationId: string, deps: ManualStaffProvisioningDeps): Promise<ProvisioningResult> {
  try { if (!(await deps.beginJournal())) throw new Error("journal_rejected"); }
  catch { return result(operationId, { ok: false, status: "failed", failureClass: "journal_creation_failed", failureStage: "journal", reconciliationRequired: false, ownerAction: "do_not_retry" }); }

  try { await deps.recordStage("incomplete", "incomplete", null, false); }
  catch { return result(operationId, { ok: false, status: "failed", failureClass: "prelookup_stage_recording_failed", failureStage: "pre_lookup", reconciliationRequired: false, ownerAction: "do_not_retry" }); }

  let before: { ok: boolean; ids: string[] };
  try { before = await deps.preLookup(); }
  catch { before = { ok: false, ids: [] }; }
  if (!before.ok) return reconcile(deps, operationId, "prelookup_failed", null);
  if (before.ids.length > 1) return reconcile(deps, operationId, "ambiguous_auth_ownership", null);
  if (before.ids.length === 1) {
    try { await deps.recordStage("preexisting", "preexisting", before.ids[0], false, "existing_identity_rejected"); }
    catch { return result(operationId, { ok: false, status: "failed", failureClass: "existing_identity_stage_failed", failureStage: "pre_lookup", reconciliationRequired: false, ownerAction: "do_not_retry" }); }
    return result(operationId, { ok: false, status: "rejected", failureClass: "existing_identity_rejected", failureStage: "pre_lookup", reconciliationRequired: false, ownerAction: "review_existing_identity" });
  }

  try { await deps.recordStage("prelookup_zero", "not_found", null, false); await deps.recordStage("provider_pending", "not_found", null, false); }
  catch { return result(operationId, { ok: false, status: "failed", failureClass: "provider_stage_recording_failed", failureStage: "provider", reconciliationRequired: false, ownerAction: "do_not_retry" }); }

  let invitation: { id: string | null; error: boolean };
  try { invitation = await deps.invite(); } catch { invitation = { id: null, error: true }; }
  let after: { ok: boolean; ids: string[] };
  try { after = await deps.postLookup(); } catch { after = { ok: false, ids: [] }; }
  const providerId = invitation.id;
  const proven = !invitation.error && Boolean(providerId) && after.ok && after.ids.length <= 1 && (after.ids.length === 0 || after.ids[0] === providerId);
  if (!proven || !providerId) {
    try { await deps.recordStage(invitation.error ? "failed" : "ambiguous", "ambiguous", providerId, false, "provider_ownership_unproven"); } catch { /* durable journal already exists */ }
    return reconcile(deps, operationId, "provider_ownership_unproven", providerId);
  }
  try { await deps.recordStage("provider_explicit_id", "proven_created", providerId, true); await deps.recordStage("application_pending", "proven_created", providerId, true); }
  catch { return reconcile(deps, operationId, "application_stage_recording_failed", providerId); }

  try {
    await deps.commitApplication(providerId);
    await deps.recordStage("application_completed", "proven_created", providerId, true);
    return result(operationId, { ok: true, status: "created", failureStage: "complete", reconciliationRequired: false, ownerAction: "none" });
  } catch {
    try { await deps.recordStage("application_failed", "proven_created", providerId, true, "application_mutation_failed"); await deps.recordStage("compensation_pending", "proven_created", providerId, true, "application_mutation_failed"); }
    catch { return reconcile(deps, operationId, "compensation_stage_recording_failed", providerId); }
    try {
      await deps.compensate(providerId);
      await deps.recordStage("compensation_completed", "proven_created", providerId, true, "application_mutation_failed");
      return reconcile(deps, operationId, "database_failed_auth_compensated", providerId, true);
    } catch {
      try { await deps.recordStage("compensation_failed", "proven_created", providerId, false, "auth_compensation_failed"); } catch { /* preserve initial journal */ }
      return reconcile(deps, operationId, "auth_compensation_failed", providerId);
    }
  }
}
