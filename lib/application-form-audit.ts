import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * M069 audit history for the application form controls.
 *
 * Reads the rows the toggle RPC wrote into `admin_audit_log`. This is the
 * existing audit table, not a parallel audit system — the RPC writes there in
 * the same transaction as the state change.
 */

export const FORM_CONTROL_ACTION_TYPE = "set_application_form_state";

export type FormControlAuditRow = {
  id: string;
  createdAt: string | null;
  actorEmail: string | null;
  applicantRole: string | null;
  previousState: string | null;
  newState: string | null;
  intakeBatchCode: string | null;
};

function text(value: unknown): string | null {
  const out = String(value ?? "").trim();
  return out || null;
}

export async function readApplicationFormAudit(
  limit = 50
): Promise<{ rows: FormControlAuditRow[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { rows: [], error: "Không đọc được lịch sử kiểm toán." };

  // Bounded by construction: `limit` is a hard cap and the ordering is total
  // (created_at desc, id desc), so this read has no unbounded-row exposure.
  const { data, error } = await client
    .from("admin_audit_log")
    .select("id,created_at,actor_email,details")
    .eq("action_type", FORM_CONTROL_ACTION_TYPE)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[application-form-audit] read failed", {
      code: error.code,
      message: error.message
    });
    return { rows: [], error: "Không đọc được lịch sử kiểm toán." };
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const details = (row.details ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      createdAt: text(row.created_at),
      actorEmail: text(row.actor_email),
      applicantRole: text(details.applicant_role),
      previousState: text(details.previous_state),
      newState: text(details.new_state),
      intakeBatchCode: text(details.intake_batch_code)
    };
  });

  return { rows, error: null };
}
