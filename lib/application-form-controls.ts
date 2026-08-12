import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";

/**
 * M069 — Season 12 Application Intake Control.
 *
 * The authoritative open/close state for the public /apply/* forms lives in
 * `public.application_form_controls`, NOT in an environment variable. This
 * module is the only place that reads or writes it.
 *
 * Everything here fails CLOSED. A missing row, an unreadable table, a broken
 * program/season/intake binding and a malformed state all resolve to
 * "closed" — never to "open".
 */

export type ApplicantRole = "mentor" | "mentee";

/**
 * Three states, reconstructed from the gate that already existed
 * (enable-flag + token + tokenless opt-in) rather than replaced by a
 * weaker two-state model:
 *
 *   closed : nobody can load or submit the form.
 *   pilot  : reachable only with the correct `?token=`. The page AND the
 *            submission Server Action enforce the identical contract.
 *   open   : fully public. No token is required anywhere.
 */
export type ApplicationFormState = "closed" | "pilot" | "open";

export const APPLICANT_ROLES: readonly ApplicantRole[] = ["mentor", "mentee"] as const;
export const APPLICATION_FORM_STATES: readonly ApplicationFormState[] = [
  "closed",
  "pilot",
  "open"
] as const;

export function isApplicantRole(value: unknown): value is ApplicantRole {
  return value === "mentor" || value === "mentee";
}

export function isApplicationFormState(value: unknown): value is ApplicationFormState {
  return value === "closed" || value === "pilot" || value === "open";
}

/** The fixed Season 12 binding. New applications may bind to nothing else. */
export const S12_BINDING = {
  programCode: "UEHM",
  seasonCode: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
  intakeBatchCode: SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE
} as const;

export type ApplicationFormControl = {
  role: ApplicantRole;
  state: ApplicationFormState;
  programCode: string;
  seasonCode: string;
  intakeBatchCode: string;
  seasonId: string;
  intakeBatchId: string;
  updatedAt: string | null;
  updatedByName: string | null;
  updatedByEmail: string | null;
};

export type ControlLookup =
  | { ok: true; controls: Record<ApplicantRole, ApplicationFormControl> }
  | { ok: false; reason: string };

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[application-form-controls]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function text(value: unknown): string | null {
  const out = String(value ?? "").trim();
  return out || null;
}

/**
 * Read both control rows for the fixed Season 12 intake.
 *
 * The program/season/intake relationship is re-verified here from the catalog
 * on every read. A control row whose stored binding disagrees with the
 * catalog, or that points at any season other than the configured application
 * season, is rejected outright — this is what stops a Season 11 form from
 * being opened by a mis-seeded or tampered row.
 */
export async function readApplicationFormControls(): Promise<ControlLookup> {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    log("service-role client unavailable", { binding: S12_BINDING.intakeBatchCode });
    return { ok: false, reason: "control_client_unavailable" };
  }

  const { data: season, error: seasonError } = await client
    .from("seasons")
    .select("id,code,program_id,programs(id,code)")
    .eq("code", S12_BINDING.seasonCode)
    .maybeSingle();

  if (seasonError) {
    log("season lookup failed", seasonError);
    return { ok: false, reason: "control_season_unreadable" };
  }
  if (!season?.id) return { ok: false, reason: "control_season_missing" };

  const program = (Array.isArray(season.programs) ? season.programs[0] : season.programs) as
    | { id?: string; code?: string }
    | null
    | undefined;
  if (text(program?.code) !== S12_BINDING.programCode) {
    log("season/program binding mismatch", {
      expected: S12_BINDING.programCode,
      found: text(program?.code)
    });
    return { ok: false, reason: "control_program_binding_invalid" };
  }

  const { data: batch, error: batchError } = await client
    .from("intake_batches")
    .select("id,code,season_id")
    .eq("code", S12_BINDING.intakeBatchCode)
    .eq("season_id", season.id)
    .maybeSingle();

  if (batchError) {
    log("intake_batch lookup failed", batchError);
    return { ok: false, reason: "control_batch_unreadable" };
  }
  if (!batch?.id) return { ok: false, reason: "control_batch_missing" };

  const { data: rows, error: rowsError } = await client
    .from("application_form_controls")
    .select(
      "applicant_role,state,program_id,season_id,intake_batch_id,updated_at,admin_users(full_name,email)"
    )
    .eq("intake_batch_id", batch.id);

  if (rowsError) {
    log("control rows unreadable", rowsError);
    return { ok: false, reason: "control_rows_unreadable" };
  }

  const controls = {} as Record<ApplicantRole, ApplicationFormControl>;

  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const role = row.applicant_role;
    if (!isApplicantRole(role)) continue;

    // Fail closed on a malformed state rather than trusting the string.
    const state = isApplicationFormState(row.state) ? row.state : "closed";
    if (!isApplicationFormState(row.state)) {
      log("malformed control state coerced to closed", { role, raw: row.state });
    }

    // Re-verify the stored binding against the catalog we just resolved.
    if (text(row.season_id) !== season.id || text(row.intake_batch_id) !== batch.id) {
      log("control row binding mismatch — ignoring row", { role });
      continue;
    }

    const updatedBy = (Array.isArray(row.admin_users) ? row.admin_users[0] : row.admin_users) as
      | { full_name?: string | null; email?: string | null }
      | null
      | undefined;

    controls[role] = {
      role,
      state,
      programCode: S12_BINDING.programCode,
      seasonCode: S12_BINDING.seasonCode,
      intakeBatchCode: S12_BINDING.intakeBatchCode,
      seasonId: String(season.id),
      intakeBatchId: String(batch.id),
      updatedAt: text(row.updated_at),
      updatedByName: text(updatedBy?.full_name),
      updatedByEmail: text(updatedBy?.email)
    };
  }

  // A missing control row is not "open by default" — it is a broken install.
  if (!controls.mentor || !controls.mentee) {
    log("control rows incomplete", {
      mentor: Boolean(controls.mentor),
      mentee: Boolean(controls.mentee)
    });
    return { ok: false, reason: "control_rows_missing" };
  }

  return { ok: true, controls };
}

/**
 * Resolve the state for one role. Any failure resolves to "closed".
 * This is the single source the gate consults.
 */
export async function readApplicationFormState(
  role: ApplicantRole
): Promise<{ state: ApplicationFormState; reason: string | null }> {
  const lookup = await readApplicationFormControls();
  if (!lookup.ok) return { state: "closed", reason: lookup.reason };
  return { state: lookup.controls[role].state, reason: null };
}
