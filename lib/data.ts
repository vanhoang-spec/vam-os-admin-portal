import { supabase } from "@/lib/supabase";
import type { Application, JsonRecord, Match, MenteeProfile, MentorProfile, Person, Season } from "@/lib/types";

export type QueryResult<T> = { data: T; error: string | null };

const VI_ERROR = "Không thể tải dữ liệu. Vui lòng kiểm tra cấu hình Supabase và quyền đọc bảng.";

export function envError<T>(fallback: T): QueryResult<T> {
  return {
    data: fallback,
    error: "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local."
  };
}

async function selectTable<T>(table: string, columns = "*", fallback: T[] = []): Promise<QueryResult<T[]>> {
  if (!supabase) return envError(fallback);
  const { data, error } = await supabase.from(table).select(columns);
  if (error) return { data: fallback, error: `${VI_ERROR} (${table}: ${error.message})` };
  return { data: (data ?? []) as T[], error: null };
}

async function selectAllTable<T>(table: string, columns = "*", fallback: T[] = [], pageSize = 1000): Promise<QueryResult<T[]>> {
  if (!supabase) return envError(fallback);
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase.from(table).select(columns).range(from, to);
    if (error) return { data: rows.length ? rows : fallback, error: `${VI_ERROR} (${table}: ${error.message})` };
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows, error: null };
}

export async function selectAllRows<T>(table: string, columns = "*", fallback: T[] = []) {
  return selectAllTable<T>(table, columns, fallback);
}

async function countTable(table: string, filter?: (query: any) => any): Promise<QueryResult<number>> {
  if (!supabase) return envError(0);
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) return { data: 0, error: `${VI_ERROR} (${table}: ${error.message})` };
  return { data: count ?? 0, error: null };
}

export async function getPeople() {
  return selectAllTable<Person>("people");
}

export async function getMentorProfiles() {
  return selectTable<MentorProfile>("mentor_profiles");
}

export async function getMenteeProfiles() {
  return selectTable<MenteeProfile>("mentee_profiles");
}

export async function getApplications() {
  return selectAllTable<Application>("applications");
}

export async function getMatches() {
  return selectTable<Match>("matches");
}

export async function getSeasons() {
  return selectTable<Season>("seasons");
}

export async function getRolesForPerson(personId: string) {
  return selectTable<JsonRecord>("person_roles", "*").then((res) => ({
    ...res,
    data: res.data.filter((role) => role.person_id === personId)
  }));
}

export async function getAnswersForApplications(applicationIds: string[]) {
  const empty: JsonRecord[] = [];
  if (!applicationIds.length) return { data: empty, error: null };
  if (!supabase) return envError(empty);
  const { data, error } = await supabase.from("application_answers").select("*").in("application_id", applicationIds);
  if (error) return { data: empty, error: `${VI_ERROR} (application_answers: ${error.message})` };
  return { data: data ?? empty, error: null };
}

export async function getDataIssues() {
  return selectTable<JsonRecord>("data_issues");
}

export async function getPerson(id: string) {
  if (!supabase) return envError<Person | null>(null);
  const { data, error } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (people: ${error.message})` };
  return { data: data as Person | null, error: null };
}

export async function getApplication(id: string) {
  if (!supabase) return envError<Application | null>(null);
  const { data, error } = await supabase.from("applications").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (applications: ${error.message})` };
  return { data: data as Application | null, error: null };
}

export async function getAnswersForApplication(applicationId: string) {
  return getAnswersForApplications([applicationId]);
}

export async function getMatch(id: string) {
  if (!supabase) return envError<Match | null>(null);
  const { data, error } = await supabase.from("matches").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: `${VI_ERROR} (matches: ${error.message})` };
  return { data: data as Match | null, error: null };
}

export async function getDashboardData() {
  // Use exact count queries for KPI cards to avoid Supabase default 1000-row limit.
  const [
    totalPeople,
    totalMentors,
    totalMentees,
    totalApplications,
    totalMatches,
    totalActiveMatches,
    people,
    mentors,
    mentees,
    applications,
    matches,
    seasons
  ] = await Promise.all([
    countTable("people"),
    countTable("mentor_profiles"),
    countTable("mentee_profiles"),
    countTable("applications"),
    countTable("matches"),
    countTable("matches", (q) => q.eq("status", "active")),
    selectAllTable<Person>("people", "id,full_name,email_primary,phone_primary"),
    selectTable<MentorProfile>("mentor_profiles", "id,person_id,mentor_code,bio_url,company_current,title_current"),
    selectTable<MenteeProfile>("mentee_profiles", "id,person_id,mentee_code,school_code"),
    selectTable<Application>("applications", "id,final_status"),
    selectTable<Match>("matches", "id,status,mentor_person_id,mentee_person_id"),
    getSeasons()
  ]);
  const duplicateEmails = { data: getDuplicateEmailCountFromRows(people.data), error: people.error };
  const activeMissing = await countTable("matches", (q) => q.eq("status", "active").or("mentor_person_id.is.null,mentee_person_id.is.null"));

  return {
    people,
    mentors,
    mentees,
    applications,
    matches,
    seasons,
    counts: {
      people: totalPeople,
      mentors: totalMentors,
      mentees: totalMentees,
      applications: totalApplications,
      matches: totalMatches,
      activeMatches: totalActiveMatches
    },
    duplicateEmails,
    activeMissing
  };
}

async function getDuplicateEmailCount() {
  const people = await getPeople();
  if (people.error) return { data: 0, error: people.error };
  return { data: getDuplicateEmailCountFromRows(people.data), error: null };
}

function getDuplicateEmailCountFromRows(people: Person[]) {
  const counts = new Map<string, number>();
  for (const person of people) {
    const email = String(person.email_primary ?? "").trim().toLowerCase();
    if (email) counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  return Array.from(counts.values()).filter((count) => count > 1).length;
}

export function keyById<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

export function groupCount(rows: JsonRecord[], key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = String(row[key] ?? "Chưa có dữ liệu");
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}
