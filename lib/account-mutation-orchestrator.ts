export type StaffMutationResult = { ok: boolean; status: "created" | "updated" | "failed"; reason: string; reconciliationRequired?: boolean };
export type AuthCreationResult = { id: string | null; ownership: "created" | "ambiguous" };

export async function executeStaffMutation(input: {
  findAuth: () => Promise<{ id: string } | null>;
  inviteAuth: () => Promise<AuthCreationResult>;
  commitDatabase: (authUserId: string) => Promise<void>;
  compensateAuth: (authUserId: string) => Promise<void>;
  recordCompensation: (authUserIdHash: string) => Promise<void>;
  recordReconciliation: (authUserIdHash: string) => Promise<void>;
  hashIdentifier: (value: string) => string;
}): Promise<StaffMutationResult> {
  const existing = await input.findAuth();
  const invited = existing ? null : await input.inviteAuth();
  if (!existing && (!invited?.id || invited.ownership === "ambiguous")) {
    try { await input.recordReconciliation(input.hashIdentifier(invited?.id ?? "ambiguous_auth_identity")); }
    catch { return { ok: false, status: "failed", reason: "critical_reconciliation_recording_failed", reconciliationRequired: true }; }
    return { ok: false, status: "failed", reason: "ambiguous_auth_ownership_recorded", reconciliationRequired: true };
  }
  const auth = existing ?? { id: invited!.id! };
  try {
    await input.commitDatabase(auth.id);
    return { ok: true, status: existing ? "updated" : "created", reason: existing ? "staff_account_updated" : "staff_account_invited" };
  } catch {
    if (existing) return { ok: false, status: "failed", reason: "database_transaction_failed_no_new_auth" };
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
