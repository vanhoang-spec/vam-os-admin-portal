export type StaffMutationResult = { ok: boolean; status: "created" | "updated" | "failed"; reason: string; reconciliationRequired?: boolean };

export async function executeStaffMutation(input: {
  findAuth: () => Promise<{ id: string } | null>;
  inviteAuth: () => Promise<{ id: string }>;
  commitDatabase: (authUserId: string) => Promise<void>;
  compensateAuth: (authUserId: string) => Promise<void>;
  recordReconciliation: (authUserIdHash: string) => Promise<void>;
  hashIdentifier: (value: string) => string;
}): Promise<StaffMutationResult> {
  const existing = await input.findAuth();
  const auth = existing ?? await input.inviteAuth();
  try {
    await input.commitDatabase(auth.id);
    return { ok: true, status: existing ? "updated" : "created", reason: existing ? "staff_account_updated" : "staff_account_invited" };
  } catch {
    if (existing) return { ok: false, status: "failed", reason: "database_transaction_failed_no_new_auth" };
    try {
      await input.compensateAuth(auth.id);
      return { ok: false, status: "failed", reason: "database_transaction_failed_auth_compensated" };
    } catch {
      try { await input.recordReconciliation(input.hashIdentifier(auth.id)); } catch { /* fail closed; manual reconciliation remains required */ }
      return { ok: false, status: "failed", reason: "reconciliation_required", reconciliationRequired: true };
    }
  }
}
