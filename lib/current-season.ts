import "server-only";

import { cache } from "react";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { resolveCurrentSeason } from "@/lib/portfolio-core";

/**
 * lib/current-season.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The season a programme is running.
 *
 * Until now the whole application shared one hardcoded answer —
 * `CURRENT_OPERATING_SEASON_CODE` in lib/season-config.ts, pinned to UEHM-S11
 * and read in about thirty places. That worked while there was one programme.
 * Five schools moving at their own pace need one answer each, and it needs to
 * be something an organiser can change without a deploy.
 *
 * So the answer now lives in `programs.current_season_id`. One column, one
 * season per programme by construction rather than by a rule somebody has to
 * remember.
 *
 * THE FALLBACK IS DELIBERATE. A programme with nothing set falls back to the
 * highest season code — the same rule `resolveCurrentSeason` already applies on
 * the portfolio screen. It means the picker works on day one, before anybody
 * has been through the new admin screen, rather than showing five programmes
 * with no season at all.
 *
 * This module does NOT replace SEASON_CONFIG. The thirty staff call sites still
 * read the global constant; migrating those is its own piece of work with its
 * own risk, and mixing it into the login change would make both harder to
 * verify.
 */

const SAFE_ERROR = "Không đọc được mùa hiện tại của chương trình.";

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[current-season]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type CurrentSeason = {
  id: string;
  code: string;
  name: string;
  /** True when a person chose this season, false when it was inferred. */
  explicit: boolean;
};

export type ProgramWithSeason = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  currentSeason: CurrentSeason | null;
};

export type MutationResult = { ok: boolean; message: string };

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * The season a programme is running, by programme code.
 *
 * Cached per request because a participant's landing page asks for it more than
 * once — in the header strip and again in the body.
 */
export const getCurrentSeasonForProgram = cache(
  async (programCode: string): Promise<CurrentSeason | null> => {
    const code = String(programCode ?? "").trim();
    if (!code) return null;

    const client = getSupabaseServiceRoleClient();
    if (!client) return null;

    const { data, error } = await client
      .from("programs")
      .select("id,code,current_season_id")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      log("read program", error);
      return null;
    }

    const program = data as { id: string; current_season_id: string | null } | null;
    if (!program) return null;

    return resolveSeasonForProgram(client, program.id, program.current_season_id);
  }
);

async function resolveSeasonForProgram(
  client: ServiceClient,
  programId: string,
  currentSeasonId: string | null
): Promise<CurrentSeason | null> {
  if (currentSeasonId) {
    const { data, error } = await client
      .from("seasons")
      .select("id,code,name")
      .eq("id", currentSeasonId)
      .maybeSingle();

    if (error) log("read chosen season (falling back)", error);

    const season = data as { id: string; code: string; name: string } | null;
    if (season) return { ...season, explicit: true };
  }

  // Nothing chosen, or the chosen season has since been removed: infer from the
  // season codes, exactly as the portfolio screen already does.
  const { data, error } = await client
    .from("seasons")
    .select("id,code,name,program_id")
    .eq("program_id", programId);

  if (error) {
    log("read seasons for fallback", error);
    return null;
  }

  const seasons = (data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    program_id: string;
  }>;
  if (!seasons.length) return null;

  const inferred = resolveCurrentSeason(
    seasons.map((row) => ({ id: row.id, code: row.code, name: row.name, programId: row.program_id }))
  );
  if (!inferred) return null;

  return { id: inferred.id, code: inferred.code, name: inferred.name, explicit: false };
}

/** Every programme with the season it is running — the admin screen's table. */
export async function listProgramsWithSeasons(): Promise<ProgramWithSeason[]> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const { data, error } = await client
    .from("programs")
    .select("id,code,name,is_active,current_season_id")
    .order("name", { ascending: true });

  if (error) {
    log("list programs", error);
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    code: string;
    name: string;
    is_active: boolean | null;
    current_season_id: string | null;
  }>;

  const result: ProgramWithSeason[] = [];
  for (const row of rows) {
    result.push({
      id: row.id,
      code: row.code,
      name: row.name,
      isActive: row.is_active !== false,
      currentSeason: await resolveSeasonForProgram(client, row.id, row.current_season_id)
    });
  }

  return result;
}

/** The seasons belonging to one programme, for the dropdown on the admin screen. */
export async function listSeasonsForProgram(
  programId: string
): Promise<Array<{ id: string; code: string; name: string }>> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const { data, error } = await client
    .from("seasons")
    .select("id,code,name")
    .eq("program_id", programId)
    .order("code", { ascending: false });

  if (error) {
    log("list seasons", error);
    return [];
  }

  return (data ?? []) as Array<{ id: string; code: string; name: string }>;
}

// ── Setting ──────────────────────────────────────────────────────────────────

/**
 * Point a programme at the season it is running.
 *
 * Refuses a season belonging to a different programme. Getting that wrong would
 * put UEH mentors into BK's season without anything visibly breaking, which is
 * the kind of error that is only found much later.
 */
export async function setCurrentSeason(input: {
  programId?: unknown;
  seasonId?: unknown;
}): Promise<MutationResult> {
  const programId = String(input.programId ?? "").trim();
  const seasonId = String(input.seasonId ?? "").trim();

  if (!programId) return { ok: false, message: "Chưa chọn chương trình." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (admin.role !== "super_admin") {
    return { ok: false, message: "Chỉ super admin mới đặt được mùa hiện tại." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // Clearing it is allowed: the programme falls back to the inferred season.
  if (!seasonId) {
    const { error } = await client
      .from("programs")
      .update({ current_season_id: null })
      .eq("id", programId);

    if (error) {
      log("clear current season", error);
      return { ok: false, message: SAFE_ERROR };
    }
    return { ok: true, message: "Đã bỏ chọn mùa hiện tại. Hệ thống sẽ tự lấy mùa mới nhất." };
  }

  const { data: seasonRow, error: seasonErr } = await client
    .from("seasons")
    .select("id,code,name,program_id")
    .eq("id", seasonId)
    .maybeSingle();

  if (seasonErr) {
    log("read season", seasonErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const season = seasonRow as { code: string; name: string; program_id: string | null } | null;
  if (!season) return { ok: false, message: "Không tìm thấy mùa này." };

  if (season.program_id !== programId) {
    return {
      ok: false,
      message: "Mùa này thuộc chương trình khác. Chọn một mùa của đúng chương trình."
    };
  }

  const { error } = await client
    .from("programs")
    .update({ current_season_id: seasonId })
    .eq("id", programId);

  if (error) {
    log("set current season", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: `Đã đặt mùa hiện tại là ${season.name || season.code}.` };
}
