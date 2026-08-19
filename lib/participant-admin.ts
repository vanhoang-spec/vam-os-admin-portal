import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { listProgramsWithSeasons, listSeasonsForProgram, type ProgramWithSeason } from "@/lib/current-season";

/**
 * lib/participant-admin.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What a super admin sees when deciding who may enter which programme.
 *
 * SEARCH, NOT A LIST. There are over eleven hundred people. A page that renders
 * all of them is slow, unreadable, and — because every row carries an email
 * address — a larger disclosure than the task needs. Nothing is shown until
 * somebody types who they are looking for.
 */

const SAFE_ERROR = "Không đọc được dữ liệu. Vui lòng thử lại.";

/** Enough to find somebody, few enough that nobody browses the database. */
const MAX_SEARCH_RESULTS = 25;
const MIN_QUERY_LENGTH = 2;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[participant-admin]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type ParticipantRow = {
  personId: string;
  fullName: string | null;
  email: string | null;
  /** Both null when this person has no login yet. */
  accountId: string | null;
  accountStatus: "active" | "disabled" | null;
  memberships: Array<{
    programId: string;
    programCode: string;
    programName: string;
    role: string;
    status: string;
  }>;
};

export type ParticipantAdminView = {
  ok: boolean;
  error: string | null;
  programs: ProgramWithSeason[];
  seasonsByProgram: Record<string, Array<{ id: string; code: string; name: string }>>;
  query: string;
  results: ParticipantRow[];
  searched: boolean;
};

function emptyView(overrides: Partial<ParticipantAdminView> = {}): ParticipantAdminView {
  return {
    ok: true,
    error: null,
    programs: [],
    seasonsByProgram: {},
    query: "",
    results: [],
    searched: false,
    ...overrides
  };
}

export async function getParticipantAdminView(input: {
  query?: string | null;
}): Promise<ParticipantAdminView> {
  const admin = await getCurrentAdminUser();
  if (admin?.role !== "super_admin") {
    return emptyView({ ok: false, error: "Chỉ super admin mới mở được màn hình này." });
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return emptyView({ ok: false, error: SAFE_ERROR });

  const programs = await listProgramsWithSeasons();

  const seasonsByProgram: Record<string, Array<{ id: string; code: string; name: string }>> = {};
  for (const program of programs) {
    seasonsByProgram[program.id] = await listSeasonsForProgram(program.id);
  }

  const query = String(input.query ?? "").trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return emptyView({ programs, seasonsByProgram, query });
  }

  const results = await searchPeople(client, query, programs);
  return emptyView({ programs, seasonsByProgram, query, results, searched: true });
}

async function searchPeople(
  client: ServiceClient,
  query: string,
  programs: ProgramWithSeason[]
): Promise<ParticipantRow[]> {
  // Escape the characters PostgREST's pattern syntax would otherwise read as
  // wildcards or as a list separator.
  const safe = query.replace(/[%_,()]/g, " ").trim();
  if (!safe) return [];

  const { data, error } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .or(`full_name.ilike.%${safe}%,email_primary.ilike.%${safe}%`)
    .order("full_name", { ascending: true })
    .limit(MAX_SEARCH_RESULTS);

  if (error) {
    log("search people", error);
    return [];
  }

  const people = (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email_primary: string | null;
  }>;
  if (!people.length) return [];

  const personIds = people.map((row) => row.id);
  const [accounts, memberships] = await Promise.all([
    readAccounts(client, personIds),
    readMemberships(client, personIds)
  ]);

  const programById = new Map(programs.map((program) => [program.id, program]));

  return people.map((person) => ({
    personId: person.id,
    fullName: person.full_name,
    email: person.email_primary,
    accountId: accounts.get(person.id)?.id ?? null,
    accountStatus: accounts.get(person.id)?.status ?? null,
    memberships: (memberships.get(person.id) ?? [])
      .map((row) => {
        const program = programById.get(row.program_id);
        return program
          ? {
              programId: program.id,
              programCode: program.code,
              programName: program.name,
              role: row.role,
              status: row.status
            }
          : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  }));
}

async function readAccounts(client: ServiceClient, personIds: string[]) {
  const byPerson = new Map<string, { id: string; status: "active" | "disabled" }>();

  const { data, error } = await client
    .from("participant_accounts")
    .select("id,person_id,status")
    .in("person_id", personIds);

  if (error) {
    log("read accounts (non-fatal)", error);
    return byPerson;
  }

  for (const row of (data ?? []) as Array<{ id: string; person_id: string; status: string }>) {
    byPerson.set(row.person_id, {
      id: row.id,
      status: row.status === "active" ? "active" : "disabled"
    });
  }
  return byPerson;
}

async function readMemberships(client: ServiceClient, personIds: string[]) {
  const byPerson = new Map<string, Array<{ program_id: string; role: string; status: string }>>();

  const { data, error } = await client
    .from("person_program_memberships")
    .select("person_id,program_id,role,status")
    .in("person_id", personIds);

  if (error) {
    log("read memberships (non-fatal)", error);
    return byPerson;
  }

  for (const row of (data ?? []) as Array<{
    person_id: string;
    program_id: string;
    role: string;
    status: string;
  }>) {
    const list = byPerson.get(row.person_id) ?? [];
    list.push({ program_id: row.program_id, role: row.role, status: row.status });
    byPerson.set(row.person_id, list);
  }

  return byPerson;
}
