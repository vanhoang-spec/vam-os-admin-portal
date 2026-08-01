export type StaffMutationResult = { ok: boolean; status: "created" | "updated" | "failed"; reason: string; reconciliationRequired?: boolean };
import type { AuthOwnershipResult } from "@/lib/account-auth-ownership";

export async function executeStaffMutation(input: {
  resolveAuth: () => Promise<AuthOwnershipResult>;
  commitDatabase: (authUserId: string) => Promise<void>;
  compensateAuth: (authUserId: string) => Promise<void>;
  recordCompensation: (authUserIdHash: string) => Promise<void>;
  recordReconciliation: (authUserIdHash: string) => Promise<void>;
  hashIdentifier: (value: string) => string;
}): Promise<StaffMutationResult> {
  const auth = await input.resolveAuth();
  if (!auth.id || auth.state === "ambiguous" || auth.state === "not_found" || auth.state === "failed") {
    try { await input.recordReconciliation(input.hashIdentifier(auth.id ?? `auth_${auth.state}`)); }
    catch { return { ok: false, status: "failed", reason: "critical_reconciliation_recording_failed", reconciliationRequired: true }; }
    return { ok: false, status: "failed", reason: "ambiguous_auth_ownership_recorded", reconciliationRequired: true };
  }
  try {
    await input.commitDatabase(auth.id);
    return { ok: true, status: auth.state === "preexisting" ? "updated" : "created", reason: auth.state === "preexisting" ? "staff_account_updated" : "staff_account_invited" };
  } catch {
    if (!auth.deleteAllowed || auth.state !== "proven_created") return { ok: false, status: "failed", reason: "database_transaction_failed_no_deletion_authority" };
    try {
      await input.compensateAuth(auth.id);
      try { await input.recordCompensation(input.hashIdentifier(auth.id)); }
      catch { return { ok: false, status: "failed", reason: "critical_compensation_recording_failed", reconciliationRequired: true }; }
      return { ok: false, status: "failed", reason: "database_transaction_failed_auth_compensated" };
    } catch {
      try { await input.recordReconciliation(input.hashIdentifier(auth.id)); }
      catch { return { ok: false, status: "failed", reason: "critical_reconciliation_recording_failed", reconciliationRequired: true }; }
      return { ok: false, status: "failed", reason: "reconciliation_required_recorded", reconciliationRequired: true };
    }
  }
}
