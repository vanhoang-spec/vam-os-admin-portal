import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "./supabase-server";
import { getScopedIntakeBatchIds } from "./data";
import { ScopeFilter } from "./program-scope";
import { Application, ApplicationDecision, ApplicationReview, JsonRecord, Match, MenteeProfile, MentorProfile, Person, Season } from "./types";
import { serviceRoleRequiredError } from "./data";

export type ApplicationDetailContext = {
  application: Application | null;
  person: Person | null;
  season: Season | null;
  menteeProfile: MenteeProfile | null;
  mentorProfile: MentorProfile | null;
  relatedMatch: Match | null;
  relatedMentor: Person | null;
  answers: JsonRecord[];
  reviews: ApplicationReview[];
  decisions: ApplicationDecision[];
  error: string | null;
};

/**
 * R2B: Authorization-by-association proof.
 * An application is authorized if its (season_id, intake_batch_id) falls within the user's scope.
 * We enforce this natively via row predicates, eliminating the need to pre-fetch 
 * the entire season of applications as a gate array.
 */
export async function getApplicationDetailContext(id: string, scope?: ScopeFilter): Promise<ApplicationDetailContext> {
  const result: ApplicationDetailContext = {
    application: null,
    person: null,
    season: null,
    menteeProfile: null,
    mentorProfile: null,
    relatedMatch: null,
    relatedMentor: null,
    answers: [],
    reviews: [],
    decisions: [],
    error: null
  };

  const serviceRole = getSupabaseServiceRoleClient();
  if (!serviceRole) {
    result.error = "Service role client required";
    return result;
  }
  
  const client = (await getSupabaseServerClient()) || serviceRole;

  // 1. Fetch authorized application and batch scope
  const { batchIds, error: batchScopeError } = await getScopedIntakeBatchIds(scope);
  if (batchScopeError) {
    result.error = batchScopeError;
    return result;
  }

  let appQuery = serviceRole.from("applications").select("*").eq("id", id);
  
  if (scope) {
    const allowedKeys = new Set<string>();
    if (scope.allowedSeasonIds?.length) scope.allowedSeasonIds.forEach((sid) => allowedKeys.add(sid));
    if (batchIds?.length) batchIds.forEach((bid) => allowedKeys.add(bid));
    
    if (allowedKeys.size === 0) {
      return result; // Not authorized
    }
    
    // We emulate the batch_season_id OR logic at the row level
    const scopeFilters: string[] = [];
    if (scope.allowedSeasonIds?.length) scopeFilters.push(`season_id.in.(${scope.allowedSeasonIds.join(",")})`);
    if (batchIds?.length) scopeFilters.push(`intake_batch_id.in.(${batchIds.join(",")})`);
    appQuery = appQuery.or(scopeFilters.join(","));
  }

  const { data: appData, error: appError } = await appQuery.maybeSingle();
  
  if (appError) {
    result.error = appError.message;
    return result;
  }
  if (!appData) {
    return result; // Not found or not authorized
  }

  result.application = appData as Application;
  const personId = result.application.person_id;
  const seasonId = result.application.season_id;

  // 2. Wave 2: targeted reads for person, season, profiles, match, answers, reviews, decisions
  const wave2: Promise<any>[] = [
    personId ? serviceRole.from("people").select("*").eq("id", personId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    seasonId ? client.from("seasons").select("*").eq("id", seasonId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    personId ? client.from("mentee_profiles").select("*").eq("person_id", personId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    personId ? client.from("mentor_profiles").select("*").eq("person_id", personId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    personId ? client.from("matches").select("*").eq("mentee_person_id", personId) : Promise.resolve({ data: [], error: null }),
    serviceRole.from("application_answers").select("*").eq("application_id", id),
    serviceRole.from("application_reviews").select("*").eq("application_id", id).order("created_at", { ascending: false }),
    serviceRole.from("application_decisions").select("*").eq("application_id", id).order("created_at", { ascending: false })
  ];

  const [
    personRes, seasonRes, menteeRes, mentorRes, matchRes,
    answersRes, reviewsRes, decisionsRes
  ] = await Promise.all(wave2);

  if (personRes.error) result.error = personRes.error.message;
  if (seasonRes.error) result.error = seasonRes.error.message;
  if (menteeRes.error) result.error = menteeRes.error.message;
  if (mentorRes.error) result.error = mentorRes.error.message;
  if (matchRes.error) result.error = matchRes.error.message;
  if (answersRes.error) result.error = answersRes.error.message;
  if (reviewsRes.error) result.error = reviewsRes.error.message;
  if (decisionsRes.error) result.error = decisionsRes.error.message;

  result.person = personRes.data as Person | null;
  result.season = seasonRes.data as Season | null;
  result.menteeProfile = menteeRes.data as MenteeProfile | null;
  result.mentorProfile = mentorRes.data as MentorProfile | null;
  
  const matches = (matchRes.data as Match[] | null) || [];
  
  // Sort matches by rank (active -> completed -> dropped -> other)
  function matchRank(m: Match) {
    const s = String(m.status ?? "").trim().toLowerCase();
    if (s === "active") return 0;
    if (s === "completed") return 1;
    if (s === "dropped") return 3;
    return 2;
  }
  
  if (matches.length > 0) {
    matches.sort((a, b) => matchRank(a) - matchRank(b));
    result.relatedMatch = matches[0];
  }

  result.answers = (answersRes.data as JsonRecord[] | null) || [];
  result.reviews = (reviewsRes.data as ApplicationReview[] | null) || [];
  result.decisions = (decisionsRes.data as ApplicationDecision[] | null) || [];

  // Wave 3: If there's a related match, fetch the mentor person
  if (result.relatedMatch?.mentor_person_id) {
    const { data: relatedMentorData } = await serviceRole.from("people").select("*").eq("id", result.relatedMatch.mentor_person_id).maybeSingle();
    result.relatedMentor = relatedMentorData as Person | null;
  }

  return result;
}
