import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { getCurrentSeasonForProgram, type CurrentSeason } from "@/lib/current-season";
import { getDossierLinksForMentor } from "@/lib/mentee-dossier";
import { getDocumentLinks } from "@/lib/program-documents";

/**
 * lib/participant-home.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What one person sees inside one programme.
 *
 * This phase builds no new participant features. It gathers what the
 * application already produces for mentors and mentees — the season
 * confirmation, the mentee dossier, the code of conduct and the tips — and puts
 * it behind a login instead of behind four separate links in four separate
 * emails. The links themselves are the same ones the emails carry.
 *
 * EVERY READ IS SCOPED TO THIS PERSON. Nothing here takes an id from the URL and
 * looks it up; the person comes from the session, the programme is checked
 * against their own membership, and the season comes from the programme. A
 * participant cannot widen what they see by editing an address bar.
 *
 * "NOT IN THIS SEASON" IS A STATE, NOT AN EMPTY PAGE. Somebody who was a mentor
 * last season and has not been added to the current one gets told exactly that,
 * with their previous seasons still reachable.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[participant-home]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type PastSeason = {
  seasonId: string;
  seasonCode: string;
  seasonName: string;
  role: string;
};

export type ParticipantHomeView = {
  /** Null when the programme code is not one this person belongs to. */
  program: { id: string; code: string; name: string } | null;
  role: "mentor" | "mentee" | null;
  currentSeason: CurrentSeason | null;
  /** True when this person is actually in the current season. */
  inCurrentSeason: boolean;
  /** Mentor only — their capacity line, when they have confirmed. */
  confirmation: {
    status: string | null;
    maxMentees: number | null;
    url: string | null;
  } | null;
  /** Mentor only — one expiring link per matched mentee. */
  dossierLinks: Array<{ url: string; applicationId: string }>;
  /** The pair they are in this season, seen from their own side. */
  partnerNames: string[];
  documents: { codeOfConduct: string | null; tips: string | null };
  pastSeasons: PastSeason[];
};

function emptyView(): ParticipantHomeView {
  return {
    program: null,
    role: null,
    currentSeason: null,
    inCurrentSeason: false,
    confirmation: null,
    dossierLinks: [],
    partnerNames: [],
    documents: { codeOfConduct: null, tips: null },
    pastSeasons: []
  };
}

/**
 * Assemble one participant's view of one programme.
 *
 * Returns an empty view — not an error — when the programme is not theirs. The
 * page turns that into "not found", which tells somebody probing the address bar
 * nothing about whether the programme exists.
 */
export async function getParticipantHome(input: {
  personId: string;
  programCode: string;
}): Promise<ParticipantHomeView> {
  if (!isValidUuid(input.personId)) return emptyView();

  const client = getSupabaseServiceRoleClient();
  if (!client) return emptyView();

  const program = await readProgram(client, input.programCode);
  if (!program) return emptyView();

  // The membership check is the authorisation. Everything below assumes it.
  const membership = await readMembership(client, input.personId, program.id);
  if (!membership) return emptyView();

  const role = membership.role === "mentor" || membership.role === "mentee" ? membership.role : null;
  const currentSeason = await getCurrentSeasonForProgram(program.code);

  const view: ParticipantHomeView = {
    ...emptyView(),
    program,
    role,
    currentSeason
  };

  const [pastSeasons] = await Promise.all([readSeasonHistory(client, input.personId, program.id)]);
  view.pastSeasons = pastSeasons.filter((season) => season.seasonId !== currentSeason?.id);

  if (!currentSeason) return view;

  const pair = await readPairInSeason(client, input.personId, currentSeason.id);
  view.inCurrentSeason =
    pair !== null || pastSeasons.some((season) => season.seasonId === currentSeason.id);
  view.partnerNames = pair?.partnerNames ?? [];

  if (role) {
    const links = await getDocumentLinks({ seasonId: currentSeason.id, audience: role });
    view.documents = { codeOfConduct: links.codeOfConduct, tips: links.tips };
  }

  if (role === "mentor") {
    view.confirmation = await readConfirmation(client, input.personId, currentSeason.id);
    view.dossierLinks = await getDossierLinksForMentor({
      seasonId: currentSeason.id,
      mentorPersonId: input.personId
    });
  }

  return view;
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function readProgram(client: ServiceClient, programCode: string) {
  const code = String(programCode ?? "").trim();
  if (!code) return null;

  const { data, error } = await client
    .from("programs")
    .select("id,code,name,is_active")
    .eq("code", code)
    .maybeSingle();

  if (error) {
    log("read program", error);
    return null;
  }

  const row = data as { id: string; code: string; name: string; is_active: boolean | null } | null;
  if (!row || row.is_active === false) return null;
  return { id: row.id, code: row.code, name: row.name };
}

async function readMembership(client: ServiceClient, personId: string, programId: string) {
  const { data, error } = await client
    .from("person_program_memberships")
    .select("role")
    .eq("person_id", personId)
    .eq("program_id", programId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    log("read membership", error);
    return null;
  }
  return data as { role: string } | null;
}

/**
 * The pair this person is in this season, named from their own side.
 *
 * A mentor sees their mentees, a mentee sees their mentor — never the whole
 * table, and never a pair they are not in.
 */
async function readPairInSeason(client: ServiceClient, personId: string, seasonId: string) {
  const { data, error } = await client
    .from("matches")
    .select("id,mentor_person_id,mentee_person_id")
    .eq("season_id", seasonId)
    .eq("status", "active")
    .or(`mentor_person_id.eq.${personId},mentee_person_id.eq.${personId}`);

  if (error) {
    log("read pair", error);
    return null;
  }

  const rows = (data ?? []) as Array<{
    mentor_person_id: string | null;
    mentee_person_id: string | null;
  }>;
  if (!rows.length) return null;

  const partnerIds = Array.from(
    new Set(
      rows
        .map((row) => (row.mentor_person_id === personId ? row.mentee_person_id : row.mentor_person_id))
        .filter((id): id is string => Boolean(id))
    )
  );

  return { partnerNames: await readNames(client, partnerIds) };
}

async function readNames(client: ServiceClient, personIds: string[]): Promise<string[]> {
  if (!personIds.length) return [];

  const { data, error } = await client.from("people").select("id,full_name").in("id", personIds);
  if (error) {
    log("read names (non-fatal)", error);
    return [];
  }

  return ((data ?? []) as Array<{ full_name: string | null }>)
    .map((row) => row.full_name)
    .filter((name): name is string => Boolean(name));
}

async function readConfirmation(client: ServiceClient, personId: string, seasonId: string) {
  const { data, error } = await client
    .from("mentor_season_confirmations")
    .select("status,max_mentees,token,token_expires_at")
    .eq("person_id", personId)
    .eq("season_id", seasonId)
    .maybeSingle();

  if (error) {
    log("read confirmation (non-fatal)", error);
    return null;
  }

  const row = data as {
    status: string | null;
    max_mentees: number | null;
    token: string | null;
    token_expires_at: string | null;
  } | null;
  if (!row) return null;

  // An expired token is not offered as a link — following it would only produce
  // a refusal page, which is a worse answer than not offering it.
  const expired = row.token_expires_at ? new Date(row.token_expires_at).getTime() < Date.now() : false;

  return {
    status: row.status,
    maxMentees: row.max_mentees,
    url: row.token && !expired ? `/confirm/${row.token}` : null
  };
}

/**
 * Seasons of this programme this person has taken part in.
 *
 * Read from `matches` rather than from `person_season_memberships`: that table
 * is empty on production, so matches are the only reliable record of who was
 * actually in which season.
 */
async function readSeasonHistory(
  client: ServiceClient,
  personId: string,
  programId: string
): Promise<PastSeason[]> {
  const { data: seasonRows, error: seasonErr } = await client
    .from("seasons")
    .select("id,code,name")
    .eq("program_id", programId);

  if (seasonErr) {
    log("read seasons", seasonErr);
    return [];
  }

  const seasons = (seasonRows ?? []) as Array<{ id: string; code: string; name: string }>;
  if (!seasons.length) return [];

  const { data: matchRows, error: matchErr } = await client
    .from("matches")
    .select("season_id,mentor_person_id,mentee_person_id")
    .in("season_id", seasons.map((row) => row.id))
    .or(`mentor_person_id.eq.${personId},mentee_person_id.eq.${personId}`);

  if (matchErr) {
    log("read season history", matchErr);
    return [];
  }

  const bySeason = new Map<string, string>();
  for (const row of (matchRows ?? []) as Array<{
    season_id: string | null;
    mentor_person_id: string | null;
  }>) {
    if (!row.season_id) continue;
    bySeason.set(row.season_id, row.mentor_person_id === personId ? "mentor" : "mentee");
  }

  return seasons
    .filter((season) => bySeason.has(season.id))
    .map((season) => ({
      seasonId: season.id,
      seasonCode: season.code,
      seasonName: season.name,
      role: bySeason.get(season.id) ?? ""
    }))
    .sort((a, b) => b.seasonCode.localeCompare(a.seasonCode));
}
