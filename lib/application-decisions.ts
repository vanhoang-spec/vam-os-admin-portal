import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

// All writes use service-role to bypass RLS.

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

function serviceClient() {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error("[application-decisions] service-role client unavailable");
    return null;
  }
  return client;
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[application-decisions]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type RecordDecisionInput = {
  applicationId: string;
  decidedByAdminUserId: string;
  decidedByName: string | null;
  previousStatus: string | null;
  newStatus: string;
  decisionNote: string | null;
};

export type DecisionResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

/**
 * Atomically (best-effort):
 *   1. Updates applications.status to newStatus.
 *   2. Inserts an audit row into application_decisions.
 *
 * If the status update fails, returns an error — nothing is written.
 * If the audit insert fails, logs the error but still returns ok=true
 * because the status change already committed and is the primary effect.
 */
export async function recordApplicationDecision(
  input: RecordDecisionInput
): Promise<DecisionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // 1. Update application status
  const { error: statusErr } = await client
    .from("applications")
    .update({ status: input.newStatus })
    .eq("id", input.applicationId);

  if (statusErr) {
    log("update application status failed", statusErr);
    return { ok: false, message: `${SAFE_ERROR} (${statusErr.message})` };
  }

  // 2. Insert audit row (non-fatal — status change has already committed)
  const { data, error: auditErr } = await client
    .from("application_decisions")
    .insert({
      application_id: input.applicationId,
      decided_by: input.decidedByAdminUserId,
      decided_by_name: input.decidedByName,
      decision: input.newStatus,
      previous_status: input.previousStatus,
      new_status: input.newStatus,
      decision_note: input.decisionNote
    })
    .select("id")
    .maybeSingle();

  if (auditErr) {
    log("insert application_decisions failed (non-fatal, status already updated)", auditErr);
  }

  return { ok: true, id: data?.id ?? input.applicationId };
}
