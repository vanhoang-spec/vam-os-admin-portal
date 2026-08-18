import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageMatches } from "@/lib/permissions";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { createManualMatch } from "@/lib/matches";
import { approveApplication } from "@/lib/application-approvals";
import { resolveMentorCap } from "@/lib/mentor-confirmations-core";
import {
  assignPairs,
  buildAnonymousPool,
  buildMatchPrompt,
  chunk,
  DEFAULT_MENTEE_BATCH_SIZE,
  DEFAULT_SHORTLIST_SIZE,
  evaluateAiMatchingGate,
  MAX_ROUNDS,
  parseMatchResponse,
  PROMPT_VERSION,
  shortlistMentors,
  shouldContinue,
  summarizeRun,
  SYSTEM_PROMPT,
  validateAssignment,
  type AnonymousMentee,
  type AnonymousMentor,
  type AssignedPair,
  type AiMatchingEnv,
  type MenteeSource,
  type MentorSource,
  type ParsedPair
} from "@/lib/ai-matching-core";

/**
 * lib/ai-matching.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Assisted matching: ask a provider to score the pairings that are left, store
 * the result as a PROPOSAL, and let an organiser approve them one at a time.
 *
 * Nothing here creates a match. Approval goes through `createManualMatch`,
 * which re-checks the mentor's confirmed capacity, the mentee's single active
 * match and the season scope — so the worst a bad proposal can do is waste an
 * organiser's click.
 *
 * What leaves the building is decided in lib/ai-matching-core.ts: codes and
 * allow-listed, redacted attributes. This module never passes a name, an
 * address or a raw application row to the provider.
 */

const SAFE_ERROR = "Không thể chạy đề xuất ghép cặp. Vui lòng thử lại hoặc liên hệ admin.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mentees waiting for a mentor, same definition as /matches/unmatched. */
const WAITING_STATUSES = ["interview_completed", "approved_as_mentee"];

/** One run stays inside a request timeout; a bigger pool is split across runs. */
export const MAX_MENTEES_PER_RUN = 40;
const PROVIDER_TIMEOUT_MS = 45_000;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[ai-matching]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

async function requireMatchOperator(seasonId: string) {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false as const, message: "Bạn chưa đăng nhập." };
  if (!canManageMatches(admin.role)) {
    return { ok: false as const, message: "Bạn không có quyền ghép cặp." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, seasonId))) {
    return { ok: false as const, message: "Bạn không có quyền vận hành mùa này." };
  }
  return { ok: true as const, admin, adminId: admin.id };
}

// ── Loading the pool ─────────────────────────────────────────────────────────

type Pool = {
  mentees: MenteeSource[];
  mentors: MentorSource[];
  totalWaiting: number;
};

async function loadPool(
  client: ServiceClient,
  input: { seasonId: string; intakeBatchId?: string | null; maxMentees: number }
): Promise<Pool | null> {
  const { data: matchRows, error: matchErr } = await client
    .from("matches")
    .select("id,mentor_person_id,mentee_person_id")
    .eq("season_id", input.seasonId)
    .eq("status", "active");

  if (matchErr) {
    log("load active matches", matchErr);
    return null;
  }

  const matches = (matchRows ?? []) as Array<{
    mentor_person_id: string | null;
    mentee_person_id: string | null;
  }>;
  const matchedMentees = new Set(
    matches.map((row) => row.mentee_person_id).filter((id): id is string => Boolean(id))
  );
  const activeByMentor = new Map<string, number>();
  for (const row of matches) {
    if (!row.mentor_person_id) continue;
    activeByMentor.set(row.mentor_person_id, (activeByMentor.get(row.mentor_person_id) ?? 0) + 1);
  }

  // --- Mentees still waiting
  let menteeQuery = client
    .from("applications")
    .select("id,person_id,full_name,raw_payload,submitted_at")
    .eq("season_id", input.seasonId)
    .eq("role_applied", "mentee")
    .in("status", WAITING_STATUSES)
    .order("submitted_at", { ascending: true });

  if (input.intakeBatchId && isValidUuid(input.intakeBatchId)) {
    menteeQuery = menteeQuery.eq("intake_batch_id", input.intakeBatchId);
  }

  const { data: menteeRows, error: menteeErr } = await menteeQuery;
  if (menteeErr) {
    log("load waiting mentees", menteeErr);
    return null;
  }

  const waiting = ((menteeRows ?? []) as Array<{
    id: string;
    person_id: string | null;
    full_name: string | null;
    raw_payload: Record<string, unknown> | null;
  }>).filter((row) => !row.person_id || !matchedMentees.has(row.person_id));

  const mentees: MenteeSource[] = waiting
    .slice(0, Math.max(1, input.maxMentees))
    .map((row) => ({
      applicationId: row.id,
      fullName: row.full_name,
      rawPayload: row.raw_payload
    }));

  // --- Mentors with a confirmed place and room left
  const { data: confirmationRows, error: confirmationErr } = await client
    .from("mentor_season_confirmations")
    .select("person_id,status,max_mentees,extra_slots")
    .eq("season_id", input.seasonId)
    .eq("status", "confirmed");

  if (confirmationErr) {
    log("load confirmations", confirmationErr);
    return null;
  }

  const confirmations = (confirmationRows ?? []) as Array<{
    person_id: string;
    status: string;
    max_mentees: number | null;
    extra_slots: number | null;
  }>;

  const withRoom = confirmations
    .map((row) => ({
      personId: row.person_id,
      freeSlots: resolveMentorCap(row) - (activeByMentor.get(row.person_id) ?? 0)
    }))
    .filter((row) => row.freeSlots > 0);

  const profileByPerson = new Map<
    string,
    { industry: string | null; function_area: string | null; years_experience_min: number | null }
  >();

  if (withRoom.length) {
    const { data: profileRows } = await client
      .from("mentor_profiles")
      .select("person_id,industry,function_area,years_experience_min")
      .in(
        "person_id",
        withRoom.map((row) => row.personId)
      );
    for (const row of (profileRows ?? []) as Array<{
      person_id: string | null;
      industry: string | null;
      function_area: string | null;
      years_experience_min: number | null;
    }>) {
      if (row.person_id && !profileByPerson.has(row.person_id)) {
        profileByPerson.set(row.person_id, {
          industry: row.industry,
          function_area: row.function_area,
          years_experience_min: row.years_experience_min
        });
      }
    }
  }

  const mentors: MentorSource[] = withRoom.map((row) => {
    const profile = profileByPerson.get(row.personId);
    return {
      personId: row.personId,
      industry: profile?.industry ?? null,
      functionArea: profile?.function_area ?? null,
      yearsExperienceMin: profile?.years_experience_min ?? null,
      freeSlots: row.freeSlots
    };
  });

  return { mentees, mentors, totalWaiting: waiting.length };
}

// ── Talking to the provider ──────────────────────────────────────────────────

type ProviderReply = {
  content: string;
  promptTokens: number;
  completionTokens: number;
};

async function callProvider(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  attempt?: number;
}): Promise<ProviderReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input.prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 2000
      }),
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      // A 5xx is worth one retry; a 4xx is a configuration problem and is not.
      if (response.status >= 500 && (input.attempt ?? 0) < 1) {
        return callProvider({ ...input, attempt: (input.attempt ?? 0) + 1 });
      }
      throw new Error(`Provider trả về HTTP ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      content: String(payload?.choices?.[0]?.message?.content ?? ""),
      promptTokens: Number(payload?.usage?.prompt_tokens ?? 0) || 0,
      completionTokens: Number(payload?.usage?.completion_tokens ?? 0) || 0
    };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    if (!aborted && (input.attempt ?? 0) < 1) {
      return callProvider({ ...input, attempt: (input.attempt ?? 0) + 1 });
    }
    throw new Error(aborted ? "Provider không phản hồi kịp thời." : String((err as Error)?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

// ── Running ──────────────────────────────────────────────────────────────────

export type RunRecommendationsInput = {
  seasonId?: unknown;
  intakeBatchId?: unknown;
  rounds?: unknown;
  shortlistSize?: unknown;
  batchSize?: unknown;
};

export type RunRecommendationsResult = {
  ok: boolean;
  message: string;
  runId?: string | null;
  pairCount?: number;
  menteeCount?: number;
};

function positiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

export async function runMatchRecommendations(
  input: RunRecommendationsInput
): Promise<RunRecommendationsResult> {
  const seasonId = String(input.seasonId ?? "").trim();
  if (!isValidUuid(seasonId)) return { ok: false, message: "Mùa không hợp lệ." };

  const access = await requireMatchOperator(seasonId);
  if (!access.ok) return { ok: false, message: access.message };

  // ProcessEnv shares no declared key with AiMatchingEnv, hence the cast.
  const gate = evaluateAiMatchingGate(process.env as unknown as AiMatchingEnv);
  if (!gate.canRun) {
    return { ok: false, message: `Chưa bật ghép cặp bằng AI: ${gate.reason}.` };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const intakeBatchId = String(input.intakeBatchId ?? "").trim() || null;
  const rounds = positiveInt(input.rounds, MAX_ROUNDS, MAX_ROUNDS);
  const shortlistSize = positiveInt(input.shortlistSize, DEFAULT_SHORTLIST_SIZE, 20);
  const batchSize = positiveInt(input.batchSize, DEFAULT_MENTEE_BATCH_SIZE, 10);

  const pool = await loadPool(client, {
    seasonId,
    intakeBatchId,
    maxMentees: MAX_MENTEES_PER_RUN
  });
  if (!pool) return { ok: false, message: SAFE_ERROR };

  if (!pool.mentees.length) {
    return { ok: false, message: "Không còn mentee nào chờ ghép trong mùa này." };
  }
  if (!pool.mentors.length) {
    return {
      ok: false,
      message: "Không còn mentor nào trống suất. Cấp thêm suất hoặc mời thêm mentor trước khi chạy."
    };
  }

  const anonymous = buildAnonymousPool(pool.mentees, pool.mentors);

  // --- Open the run. The partial unique index refuses a second running row.
  const { data: runRow, error: runErr } = await client
    .from("match_recommendation_runs")
    .insert({
      season_id: seasonId,
      intake_batch_id: intakeBatchId,
      provider: "deepseek",
      model: gate.model,
      prompt_version: PROMPT_VERSION,
      status: "running",
      mentee_count: anonymous.mentees.length,
      mentor_count: anonymous.mentors.length,
      params: { rounds, shortlist_size: shortlistSize, batch_size: batchSize }
    })
    .select("id")
    .maybeSingle();

  if (runErr || !runRow) {
    if ((runErr as { code?: string } | null)?.code === "23505") {
      return {
        ok: false,
        message: "Đang có một lần chạy khác cho mùa này. Đợi lần chạy đó kết thúc rồi thử lại."
      };
    }
    log("open run", runErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const runId = (runRow as { id: string }).id;
  await writeLog(client, { runId, action: "run_created", actorId: access.adminId });

  try {
    const outcome = await proposePairs({
      gate,
      anonymous,
      rounds,
      shortlistSize,
      batchSize
    });

    const rows = outcome.assigned.map((pair) => {
      const mentee = anonymous.menteeByCode.get(pair.menteeCode);
      const mentor = anonymous.mentorByCode.get(pair.mentorCode);
      return {
        run_id: runId,
        round: pair.round,
        mentor_person_id: mentor?.personId ?? null,
        mentee_application_id: mentee?.applicationId ?? null,
        score: pair.score,
        rationale: pair.rationale || null,
        status: "pending"
      };
    }).filter((row) => row.mentor_person_id && row.mentee_application_id);

    if (rows.length) {
      const { error: insertErr } = await client.from("match_recommendations").insert(rows);
      if (insertErr) {
        log("insert recommendations", insertErr);
        throw new Error("Không lưu được danh sách đề xuất.");
      }
    }

    await supersedeOlderPending(client, { seasonId, currentRunId: runId, actorId: access.adminId });

    const { error: completeErr } = await client
      .from("match_recommendation_runs")
      .update({
        status: "completed",
        pair_count: rows.length,
        round_count: outcome.rounds,
        prompt_tokens: outcome.promptTokens,
        completion_tokens: outcome.completionTokens,
        completed_at: new Date().toISOString()
      })
      .eq("id", runId);
    if (completeErr) log("complete run (non-fatal)", completeErr);

    await writeLog(client, {
      runId,
      action: "run_completed",
      actorId: access.adminId,
      detail: { pair_count: rows.length, warnings: outcome.warnings.slice(0, 20) }
    });

    return {
      ok: true,
      runId,
      pairCount: rows.length,
      menteeCount: anonymous.mentees.length,
      message: summarizeRun({
        menteeCount: anonymous.mentees.length,
        pairCount: rows.length,
        rounds: outcome.rounds,
        warnings: outcome.warnings
      })
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log("run failed", err);

    await client
      .from("match_recommendation_runs")
      .update({
        status: "failed",
        error: detail.slice(0, 500),
        completed_at: new Date().toISOString()
      })
      .eq("id", runId);
    await writeLog(client, { runId, action: "run_failed", actorId: access.adminId, reason: detail });

    return { ok: false, runId, message: `Lần chạy thất bại: ${detail}` };
  }
}

type ProposeOutcome = {
  assigned: AssignedPair[];
  warnings: string[];
  rounds: number;
  promptTokens: number;
  completionTokens: number;
};

/**
 * The rounds. Each one asks about the mentees still without a mentor, using the
 * capacity that is still free, so a mentor filled in round 1 is simply not
 * offered again in round 2.
 */
async function proposePairs(input: {
  gate: { apiKey: string; model: string; baseUrl: string };
  anonymous: {
    mentees: AnonymousMentee[];
    mentors: AnonymousMentor[];
    menteeByCode: Map<string, AnonymousMentee>;
    mentorByCode: Map<string, AnonymousMentor>;
  };
  rounds: number;
  shortlistSize: number;
  batchSize: number;
}): Promise<ProposeOutcome> {
  const capacity = new Map(input.anonymous.mentors.map((mentor) => [mentor.code, mentor.capacity]));
  const menteeCodes = new Set(input.anonymous.mentees.map((mentee) => mentee.code));
  const mentorCodes = new Set(input.anonymous.mentors.map((mentor) => mentor.code));

  const assigned: AssignedPair[] = [];
  const warnings: string[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let remaining = [...input.anonymous.mentees];
  let round = 0;

  while (round < input.rounds && remaining.length > 0) {
    round += 1;

    const available = input.anonymous.mentors.filter((mentor) => (capacity.get(mentor.code) ?? 0) > 0);
    if (!available.length) break;

    const scored: ParsedPair[] = [];

    for (const batch of chunk(remaining, input.batchSize)) {
      const prompt = buildMatchPrompt({
        round,
        batch: batch.map((mentee) => ({
          mentee,
          mentors: shortlistMentors(mentee, available, input.shortlistSize)
        }))
      });

      const reply = await callProvider({
        baseUrl: input.gate.baseUrl,
        apiKey: input.gate.apiKey,
        model: input.gate.model,
        prompt
      });
      promptTokens += reply.promptTokens;
      completionTokens += reply.completionTokens;

      const parsed = parseMatchResponse(reply.content, { menteeCodes, mentorCodes });
      scored.push(...parsed.pairs);
      warnings.push(...parsed.warnings);
    }

    const result = assignPairs({
      pairs: scored,
      capacity,
      menteeCodes: remaining.map((mentee) => mentee.code),
      round
    });

    assigned.push(...result.assigned);
    for (const [code, left] of Array.from(result.remainingCapacity.entries())) {
      capacity.set(code, left);
    }
    const stillWaiting = new Set(result.unassignedMentees);
    remaining = remaining.filter((mentee) => stillWaiting.has(mentee.code));

    if (!shouldContinue({
      round,
      unassignedCount: remaining.length,
      remainingCapacity: capacity,
      maxRounds: input.rounds
    })) {
      break;
    }
  }

  // Last check before anything is written: the pairing must obey the rules even
  // if every earlier step misbehaved.
  const check = validateAssignment({
    assigned,
    capacity: new Map(input.anonymous.mentors.map((mentor) => [mentor.code, mentor.capacity])),
    menteeCodes
  });
  if (!check.ok) {
    throw new Error(`Kết quả ghép không hợp lệ: ${check.problems.slice(0, 3).join("; ")}`);
  }

  return { assigned, warnings, rounds: round, promptTokens, completionTokens };
}

async function writeLog(
  client: ServiceClient,
  row: {
    runId: string;
    action: string;
    actorId?: string | null;
    recommendationId?: string | null;
    detail?: Record<string, unknown> | null;
    reason?: string | null;
  }
) {
  const { error } = await client.from("match_recommendation_log").insert({
    run_id: row.runId,
    recommendation_id: row.recommendationId ?? null,
    action: row.action,
    detail: row.detail ?? null,
    reason: row.reason ? row.reason.slice(0, 500) : null,
    actor_admin_user_id: row.actorId ?? null
  });
  if (error) log("write log (non-fatal)", error);
}

/**
 * A new proposal replaces the previous one: leaving two sets of pending pairs
 * for the same free slots would let an organiser approve both.
 */
async function supersedeOlderPending(
  client: ServiceClient,
  input: { seasonId: string; currentRunId: string; actorId?: string | null }
) {
  const { data: olderRuns } = await client
    .from("match_recommendation_runs")
    .select("id")
    .eq("season_id", input.seasonId)
    .neq("id", input.currentRunId);

  const ids = ((olderRuns ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (!ids.length) return;

  const { error } = await client
    .from("match_recommendations")
    .update({ status: "superseded", decided_at: new Date().toISOString() })
    .in("run_id", ids)
    .eq("status", "pending");
  if (error) log("supersede older pending (non-fatal)", error);
}

// ── Reading a run ────────────────────────────────────────────────────────────

export type RecommendationRunRow = {
  id: string;
  season_id: string;
  intake_batch_id: string | null;
  provider: string;
  model: string;
  prompt_version: string;
  status: string;
  mentee_count: number;
  mentor_count: number;
  pair_count: number;
  round_count: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export type RecommendationView = {
  id: string;
  round: number;
  score: number | null;
  rationale: string | null;
  status: string;
  match_id: string | null;
  decided_at: string | null;
  mentor_person_id: string;
  mentor_name: string | null;
  mentor_email: string | null;
  mentor_free_slots: number | null;
  mentee_application_id: string;
  mentee_name: string | null;
  mentee_email: string | null;
};

export type RecommendationRunView = {
  ok: boolean;
  error: string | null;
  run: RecommendationRunRow | null;
  rows: RecommendationView[];
};

export async function getLatestRecommendationRun(input: {
  seasonId: string;
  runId?: string | null;
}): Promise<RecommendationRunView> {
  const empty: RecommendationRunView = { ok: true, error: null, run: null, rows: [] };
  if (!isValidUuid(input.seasonId)) return { ...empty, ok: false, error: "Mùa không hợp lệ." };

  const admin = await getCurrentAdminUser();
  if (!canManageMatches(admin?.role)) {
    return { ...empty, ok: false, error: "Bạn không có quyền xem đề xuất ghép cặp." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, input.seasonId))) {
    return { ...empty, ok: false, error: "Bạn không có quyền xem dữ liệu của mùa này." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ...empty, ok: false, error: SAFE_ERROR };

  let runQuery = client
    .from("match_recommendation_runs")
    .select("*")
    .eq("season_id", input.seasonId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (input.runId && isValidUuid(input.runId)) {
    runQuery = client.from("match_recommendation_runs").select("*").eq("id", input.runId).limit(1);
  }

  const { data: runRows, error: runErr } = await runQuery;
  if (runErr) {
    log("load run", runErr);
    return { ...empty, ok: false, error: SAFE_ERROR };
  }

  const run = ((runRows ?? []) as RecommendationRunRow[])[0] ?? null;
  if (!run) return empty;

  const { data: recRows, error: recErr } = await client
    .from("match_recommendations")
    .select(
      "id,round,score,rationale,status,match_id,decided_at,mentor_person_id,mentee_application_id"
    )
    .eq("run_id", run.id)
    .order("score", { ascending: false });

  if (recErr) {
    log("load recommendations", recErr);
    return { ok: false, error: SAFE_ERROR, run, rows: [] };
  }

  const recommendations = (recRows ?? []) as Array<{
    id: string;
    round: number;
    score: number | null;
    rationale: string | null;
    status: string;
    match_id: string | null;
    decided_at: string | null;
    mentor_person_id: string;
    mentee_application_id: string;
  }>;

  if (!recommendations.length) return { ok: true, error: null, run, rows: [] };

  const mentorIds = Array.from(new Set(recommendations.map((row) => row.mentor_person_id)));
  const applicationIds = Array.from(new Set(recommendations.map((row) => row.mentee_application_id)));

  const [peopleRes, appRes, confirmationRes, matchRes] = await Promise.all([
    client.from("people").select("id,full_name,email_primary").in("id", mentorIds),
    client.from("applications").select("id,full_name,email_primary").in("id", applicationIds),
    client
      .from("mentor_season_confirmations")
      .select("person_id,status,max_mentees,extra_slots")
      .eq("season_id", input.seasonId)
      .in("person_id", mentorIds),
    client
      .from("matches")
      .select("mentor_person_id")
      .eq("season_id", input.seasonId)
      .eq("status", "active")
  ]);

  const peopleById = new Map(
    ((peopleRes.data ?? []) as Array<{ id: string; full_name: string | null; email_primary: string | null }>).map(
      (row) => [row.id, row]
    )
  );
  const appById = new Map(
    ((appRes.data ?? []) as Array<{ id: string; full_name: string | null; email_primary: string | null }>).map(
      (row) => [row.id, row]
    )
  );
  const activeByMentor = new Map<string, number>();
  for (const row of (matchRes.data ?? []) as Array<{ mentor_person_id: string | null }>) {
    if (!row.mentor_person_id) continue;
    activeByMentor.set(row.mentor_person_id, (activeByMentor.get(row.mentor_person_id) ?? 0) + 1);
  }
  const freeByMentor = new Map<string, number>();
  for (const row of (confirmationRes.data ?? []) as Array<{
    person_id: string;
    status: string;
    max_mentees: number | null;
    extra_slots: number | null;
  }>) {
    freeByMentor.set(row.person_id, resolveMentorCap(row) - (activeByMentor.get(row.person_id) ?? 0));
  }

  const rows: RecommendationView[] = recommendations.map((row) => {
    const mentor = peopleById.get(row.mentor_person_id);
    const application = appById.get(row.mentee_application_id);
    return {
      id: row.id,
      round: row.round,
      score: row.score,
      rationale: row.rationale,
      status: row.status,
      match_id: row.match_id,
      decided_at: row.decided_at,
      mentor_person_id: row.mentor_person_id,
      mentor_name: mentor?.full_name ?? null,
      mentor_email: mentor?.email_primary ?? null,
      mentor_free_slots: freeByMentor.get(row.mentor_person_id) ?? null,
      mentee_application_id: row.mentee_application_id,
      mentee_name: application?.full_name ?? null,
      mentee_email: application?.email_primary ?? null
    };
  });

  return { ok: true, error: null, run, rows };
}

// ── Deciding ─────────────────────────────────────────────────────────────────

type LoadedRecommendation = {
  id: string;
  run_id: string;
  status: string;
  mentor_person_id: string;
  mentee_application_id: string;
  season_id: string;
};

async function loadPendingRecommendation(
  client: ServiceClient,
  recommendationId: string
): Promise<LoadedRecommendation | null> {
  const { data, error } = await client
    .from("match_recommendations")
    .select("id,run_id,status,mentor_person_id,mentee_application_id")
    .eq("id", recommendationId)
    .maybeSingle();

  if (error) {
    log("load recommendation", error);
    return null;
  }
  const row = data as Omit<LoadedRecommendation, "season_id"> | null;
  if (!row) return null;

  const { data: runRow } = await client
    .from("match_recommendation_runs")
    .select("season_id")
    .eq("id", row.run_id)
    .maybeSingle();

  const seasonId = (runRow as { season_id?: string } | null)?.season_id;
  if (!seasonId) return null;

  return { ...row, season_id: seasonId };
}

/**
 * Approve one proposed pair.
 *
 * The match is created by the ordinary manual path, which checks the mentor's
 * capacity again — a proposal computed an hour ago cannot push a mentor past
 * the limit they confirmed.
 */
export async function approveRecommendation(input: {
  recommendationId?: unknown;
}): Promise<MutationResult> {
  const recommendationId = String(input.recommendationId ?? "").trim();
  if (!isValidUuid(recommendationId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const recommendation = await loadPendingRecommendation(client, recommendationId);
  if (!recommendation) return { ok: false, message: "Không tìm thấy đề xuất này." };

  const access = await requireMatchOperator(recommendation.season_id);
  if (!access.ok) return { ok: false, message: access.message };

  if (recommendation.status !== "pending") {
    return { ok: false, message: "Đề xuất này đã được xử lý trước đó." };
  }

  const { data: appRow, error: appErr } = await client
    .from("applications")
    .select("id,status,intake_batch_id,full_name,email_primary,phone_primary,gender,role_applied")
    .eq("id", recommendation.mentee_application_id)
    .maybeSingle();

  if (appErr) {
    log("load application for approval", appErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const application = appRow as {
    id: string;
    status: string | null;
    intake_batch_id: string | null;
    full_name: string | null;
    email_primary: string | null;
    phone_primary: string | null;
    gender: string | null;
    role_applied: string | null;
  } | null;

  if (!application) return { ok: false, message: "Không tìm thấy hồ sơ mentee." };
  if (!application.intake_batch_id) {
    return { ok: false, message: "Hồ sơ mentee chưa thuộc đợt tuyển nào nên chưa ghép được." };
  }
  if (!application.full_name?.trim()) {
    return { ok: false, message: "Hồ sơ mentee thiếu họ tên nên chưa tạo được hồ sơ." };
  }

  // The mentee must exist as a person and a profile before a match can point at
  // them. Identity comes from the application row.
  const approval = await approveApplication({
    applicationId: application.id,
    targetRole: "mentee",
    seasonCode: null,
    fullName: application.full_name,
    emailPrimary: application.email_primary,
    phonePrimary: application.phone_primary,
    gender: application.gender,
    intakeBatchId: application.intake_batch_id,
    previousStatus: application.status,
    approvedByAdminUserId: access.adminId,
    approvedByName: access.admin.full_name ?? access.admin.email ?? null
  });
  if (!approval.ok) return { ok: false, message: approval.message };

  const { data: mentorProfile } = await client
    .from("mentor_profiles")
    .select("id")
    .eq("person_id", recommendation.mentor_person_id)
    .limit(1)
    .maybeSingle();

  const mentorProfileId = (mentorProfile as { id?: string } | null)?.id;
  if (!mentorProfileId) {
    return { ok: false, message: "Mentor này chưa có hồ sơ mentor nên chưa ghép được." };
  }

  const created = await createManualMatch({
    mentorProfileId,
    menteeProfileId: approval.profileId,
    intakeBatchId: application.intake_batch_id,
    adminNotes: "Duyệt từ đề xuất ghép cặp"
  });

  if (!created.ok) {
    // Most often: the mentor filled up between the proposal and the approval.
    return { ok: false, message: created.message };
  }

  const { error: updateErr } = await client
    .from("match_recommendations")
    .update({
      status: "approved",
      decided_by: access.adminId,
      decided_at: new Date().toISOString(),
      match_id: created.matchId ?? null,
      mentee_person_id: approval.personId
    })
    .eq("id", recommendationId)
    .eq("status", "pending");

  if (updateErr) {
    log("mark recommendation approved (non-fatal)", updateErr);
  }

  await writeLog(client, {
    runId: recommendation.run_id,
    recommendationId,
    action: "approved",
    actorId: access.adminId,
    detail: { match_id: created.matchId ?? null }
  });

  return { ok: true, message: "Đã duyệt và tạo cặp ghép." };
}

export async function rejectRecommendation(input: {
  recommendationId?: unknown;
  reason?: unknown;
}): Promise<MutationResult> {
  const recommendationId = String(input.recommendationId ?? "").trim();
  if (!isValidUuid(recommendationId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const recommendation = await loadPendingRecommendation(client, recommendationId);
  if (!recommendation) return { ok: false, message: "Không tìm thấy đề xuất này." };

  const access = await requireMatchOperator(recommendation.season_id);
  if (!access.ok) return { ok: false, message: access.message };

  if (recommendation.status !== "pending") {
    return { ok: false, message: "Đề xuất này đã được xử lý trước đó." };
  }

  const reason = String(input.reason ?? "").trim().slice(0, 500) || null;

  const { error } = await client
    .from("match_recommendations")
    .update({
      status: "rejected",
      decided_by: access.adminId,
      decided_at: new Date().toISOString()
    })
    .eq("id", recommendationId)
    .eq("status", "pending");

  if (error) {
    log("reject recommendation", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    runId: recommendation.run_id,
    recommendationId,
    action: "rejected",
    actorId: access.adminId,
    reason
  });

  return { ok: true, message: "Đã bỏ qua đề xuất này." };
}

/** Throw a whole proposal away, e.g. after the pool changed. */
export async function discardRecommendationRun(input: {
  runId?: unknown;
}): Promise<MutationResult> {
  const runId = String(input.runId ?? "").trim();
  if (!isValidUuid(runId)) return { ok: false, message: "Lần chạy không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: runRow, error: runErr } = await client
    .from("match_recommendation_runs")
    .select("id,season_id,status")
    .eq("id", runId)
    .maybeSingle();

  if (runErr) {
    log("load run for discard", runErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const run = runRow as { id: string; season_id: string; status: string } | null;
  if (!run) return { ok: false, message: "Không tìm thấy lần chạy này." };

  const access = await requireMatchOperator(run.season_id);
  if (!access.ok) return { ok: false, message: access.message };

  const now = new Date().toISOString();

  const { error: recErr } = await client
    .from("match_recommendations")
    .update({ status: "superseded", decided_at: now })
    .eq("run_id", runId)
    .eq("status", "pending");
  if (recErr) log("discard pending recommendations (non-fatal)", recErr);

  const { error: updateErr } = await client
    .from("match_recommendation_runs")
    .update({ status: "discarded", completed_at: now })
    .eq("id", runId);

  if (updateErr) {
    log("discard run", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, { runId, action: "discarded", actorId: access.adminId });

  return { ok: true, message: "Đã huỷ danh sách đề xuất." };
}
