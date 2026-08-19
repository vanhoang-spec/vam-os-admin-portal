import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sortProgramChoices, type ProgramChoice } from "@/lib/participant-auth-core";

/**
 * lib/participant-programs.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Which programmes a person may enter, and the season each one is running.
 *
 * This is the list behind the picker. It answers a programme-level question —
 * "may this person enter UEH Mentoring at all" — and deliberately not a
 * season-level one. Season comes from the programme, so a school moving into
 * its next season does not mean rewriting a row per participant.
 *
 * Only super admins change the list. Adding somebody to a programme decides
 * what they can see, so every change is written to an append-only log.
 */

const SAFE_ERROR = "Không đọc được danh sách chương trình. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[participant-programs]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * The programmes one person may enter, each with the season it is running.
 *
 * Inactive memberships and inactive programmes are filtered out here rather
 * than in the page, so no caller can forget.
 */
export async function getProgramsForPerson(personId: string): Promise<ProgramChoice[]> {
  if (!isValidUuid(personId)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    log("service-role client unavailable", new Error("missing SUPABASE_SERVICE_ROLE_KEY"));
    return [];
  }

  const { data: membershipRows, error } = await client
    .from("person_program_memberships")
    .select("program_id,role")
    .eq("person_id", personId)
    .eq("status", "active");

  if (error) {
    log("read memberships", error);
    return [];
  }

  const memberships = (membershipRows ?? []) as Array<{ program_id: string; role: string }>;
  if (!memberships.length) return [];

  const programIds = Array.from(new Set(memberships.map((row) => row.program_id)));
  const programs = await loadPrograms(client, programIds);

  const choices: ProgramChoice[] = [];
  for (const membership of memberships) {
    const program = programs.get(membership.program_id);
    // An archived programme should stop appearing on the picker even for
    // somebody who was in it.
    if (!program || !program.isActive) continue;
    choices.push({ ...program.choice, role: membership.role });
  }

  return sortProgramChoices(choices);
}

type LoadedProgram = { isActive: boolean; choice: ProgramChoice };

async function loadPrograms(
  client: ServiceClient,
  programIds: string[]
): Promise<Map<string, LoadedProgram>> {
  const byId = new Map<string, LoadedProgram>();
  if (!programIds.length) return byId;

  const { data, error } = await client
    .from("programs")
    .select("id,code,name,is_active,current_season_id")
    .in("id", programIds);

  if (error) {
    log("read programs", error);
    return byId;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    is_active: boolean | null;
    current_season_id: string | null;
  }>;

  const seasonIds = rows
    .map((row) => row.current_season_id)
    .filter((id): id is string => Boolean(id));
  const seasons = await loadSeasons(client, seasonIds);

  for (const row of rows) {
    const season = row.current_season_id ? seasons.get(row.current_season_id) : undefined;
    byId.set(row.id, {
      isActive: row.is_active !== false,
      choice: {
        programId: row.id,
        programCode: row.code,
        programName: row.name,
        currentSeasonCode: season?.code ?? null,
        currentSeasonName: season?.name ?? null
      }
    });
  }

  return byId;
}

async function loadSeasons(client: ServiceClient, seasonIds: string[]) {
  const bySeason = new Map<string, { code: string; name: string }>();
  if (!seasonIds.length) return bySeason;

  const { data, error } = await client
    .from("seasons")
    .select("id,code,name")
    .in("id", Array.from(new Set(seasonIds)));

  if (error) {
    log("read seasons (non-fatal)", error);
    return bySeason;
  }

  for (const row of (data ?? []) as Array<{ id: string; code: string; name: string }>) {
    bySeason.set(row.id, { code: row.code, name: row.name });
  }
  return bySeason;
}

// ── Managing, for a super admin ──────────────────────────────────────────────

async function requireSuperAdmin() {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false as const, message: "Bạn chưa đăng nhập." };
  if (admin.role !== "super_admin") {
    return { ok: false as const, message: "Chỉ super admin mới thay đổi được tư cách thành viên." };
  }
  return { ok: true as const, adminId: admin.id };
}

/**
 * Add somebody to a programme, or turn their membership on and off.
 *
 * One row per person per programme per role, so re-adding somebody who was
 * removed reactivates the row they already had rather than creating a second —
 * which keeps the log a single readable history instead of a set of fragments.
 */
export async function setProgramMembership(input: {
  personId?: unknown;
  programId?: unknown;
  role?: unknown;
  status?: unknown;
  reason?: unknown;
}): Promise<MutationResult> {
  const personId = String(input.personId ?? "").trim();
  const programId = String(input.programId ?? "").trim();
  const role = String(input.role ?? "").trim();
  const status = String(input.status ?? "active").trim();

  if (!isValidUuid(personId)) return { ok: false, message: "Chưa chọn người." };
  if (!isValidUuid(programId)) return { ok: false, message: "Chưa chọn chương trình." };
  if (!["mentor", "mentee"].includes(role)) return { ok: false, message: "Vai trò không hợp lệ." };
  if (!["active", "inactive"].includes(status)) {
    return { ok: false, message: "Trạng thái không hợp lệ." };
  }

  const guard = await requireSuperAdmin();
  if (!guard.ok) return { ok: false, message: guard.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: existingRow, error: readErr } = await client
    .from("person_program_memberships")
    .select("id,status")
    .eq("person_id", personId)
    .eq("program_id", programId)
    .eq("role", role)
    .maybeSingle();

  if (readErr) {
    log("read membership", readErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const existing = existingRow as { id: string; status: string } | null;
  const reason = String(input.reason ?? "").trim().slice(0, 300) || null;

  if (existing) {
    if (existing.status === status) {
      return { ok: true, message: "Không có gì thay đổi." };
    }

    const { error: updateErr } = await client
      .from("person_program_memberships")
      .update({ status })
      .eq("id", existing.id);

    if (updateErr) {
      log("update membership", updateErr);
      return { ok: false, message: SAFE_ERROR };
    }

    await writeLog(client, {
      membershipId: existing.id,
      personId,
      programId,
      role,
      oldStatus: existing.status,
      newStatus: status,
      transitionType: status === "active" ? "activated" : "deactivated",
      reason,
      changedBy: guard.adminId
    });

    return {
      ok: true,
      message: status === "active" ? "Đã mở lại chương trình cho người này." : "Đã tắt chương trình cho người này."
    };
  }

  const { data: created, error: insertErr } = await client
    .from("person_program_memberships")
    .insert({
      person_id: personId,
      program_id: programId,
      role,
      status,
      source: "manual",
      notes: reason,
      created_by: guard.adminId
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    log("insert membership", insertErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    membershipId: (created as { id?: string } | null)?.id ?? null,
    personId,
    programId,
    role,
    oldStatus: null,
    newStatus: status,
    transitionType: "created",
    reason,
    changedBy: guard.adminId
  });

  return { ok: true, message: "Đã thêm người này vào chương trình." };
}

/**
 * Record the change.
 *
 * Non-fatal on failure: the membership itself is already written, and losing
 * the audit line is worse handled by refusing the whole operation than by
 * logging loudly and moving on.
 */
async function writeLog(
  client: ServiceClient,
  entry: {
    membershipId: string | null;
    personId: string;
    programId: string;
    role: string;
    oldStatus: string | null;
    newStatus: string;
    transitionType: string;
    reason: string | null;
    changedBy: string | null;
  }
) {
  const { error } = await client.from("person_program_membership_log").insert({
    membership_id: entry.membershipId,
    person_id: entry.personId,
    program_id: entry.programId,
    role: entry.role,
    old_status: entry.oldStatus,
    new_status: entry.newStatus,
    transition_type: entry.transitionType,
    reason: entry.reason,
    changed_by: entry.changedBy
  });

  if (error) log("write membership log (non-fatal)", error);
}
