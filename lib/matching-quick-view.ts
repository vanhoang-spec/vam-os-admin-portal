import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageMatches } from "@/lib/permissions";
import {
  canAccessSeason,
  canOperateAnyScope,
  getAdminScopeContext,
  getAllowedSeasonIds
} from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { effectiveMentorCapacity } from "@/lib/matches";
import {
  buildQuickView,
  pickQuickViewApplication,
  type QuickViewPayload,
  type QuickViewRole
} from "@/lib/matching-quick-view-core";
import type { Application, JsonRecord, MenteeProfile, MentorProfile, Person } from "@/lib/types";

/**
 * lib/matching-quick-view.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * WHO may open a matching drawer, and what is loaded when they do.
 *
 * ---------------------------------------------------------------------------
 * NOTHING FROM THE BROWSER IS TRUSTED
 * ---------------------------------------------------------------------------
 * The client sends a person id, a role and the selected batch. All three are
 * hints. Every one of them is re-derived or re-checked here before a single
 * application answer is read:
 *
 *   1. the caller may manage matches at all, and holds an operations scope;
 *   2. the batch resolves to a season the caller may act in;
 *   3. that person holds an APPROVED application in THAT season;
 *   4. the approval matches the requested role — approved_as_mentor for a
 *      mentor drawer, approved_as_mentee for a mentee drawer;
 *   5. the corresponding profile row exists.
 *
 * A crafted request naming another season, an unapproved person, the wrong
 * role, or an arbitrary application id reaches none of the reads. There is no
 * application-id parameter at all: the application is FOUND from the verified
 * (person, season, role) triple rather than accepted, which removes the whole
 * class of "read any application by id" request.
 *
 * Recruitment helpers hold role `reviewer`, which `canManageMatches` excludes.
 * This adds no permission and widens none.
 *
 * ---------------------------------------------------------------------------
 * ON DEMAND, NEVER PRELOADED
 * ---------------------------------------------------------------------------
 * UEHM-S12 already has ~150 approved mentors and will grow. Nothing in this
 * module runs while /matches renders its candidate lists — it runs once, for
 * one person, when an operator opens that person's drawer.
 *
 * ---------------------------------------------------------------------------
 * SEASON APPROVAL, NOT BATCH MEMBERSHIP
 * ---------------------------------------------------------------------------
 * The same principle the matching pool now uses. A renewal mentor's application
 * carries no `intake_batch_id` and their reused profile still points at an older
 * batch, so neither may be required to equal the selected batch. The batch is
 * the operator's context and supplies the season; approval in that season is the
 * authority.
 */

const SAFE_ERROR = "Không thể tải hồ sơ. Vui lòng thử lại hoặc liên hệ admin.";
const NOT_ELIGIBLE = "Người này chưa được duyệt chính thức trong mùa của batch đã chọn.";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[matching-quick-view]", scope, {
    code: err?.code,
    message: err?.message ?? String(error)
  });
}

const APPROVED_STATUS: Record<QuickViewRole, string> = {
  mentor: "approved_as_mentor",
  mentee: "approved_as_mentee"
};

export type QuickViewResult =
  | { ok: true; data: QuickViewPayload }
  | { ok: false; message: string };

export async function getMatchingQuickView(input: {
  personId?: unknown;
  role?: unknown;
  intakeBatchId?: unknown;
}): Promise<QuickViewResult> {
  // ── 1. May this caller manage matching at all? ───────────────────────────
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMatches(actor.role)) {
    return { ok: false, message: "Bạn không có quyền xem hồ sơ ghép cặp." };
  }
  const scopeContext = await getAdminScopeContext();
  if (!canOperateAnyScope(scopeContext)) {
    return { ok: false, message: "Bạn không có quyền vận hành trong phạm vi chương trình." };
  }

  const roleRaw = String(input.role ?? "").trim();
  if (roleRaw !== "mentor" && roleRaw !== "mentee") {
    return { ok: false, message: "Vai trò không hợp lệ." };
  }
  const role: QuickViewRole = roleRaw;

  const personId = String(input.personId ?? "").trim();
  const intakeBatchId = String(input.intakeBatchId ?? "").trim();
  if (!isValidUuid(personId) || !isValidUuid(intakeBatchId)) {
    return { ok: false, message: "Yêu cầu không hợp lệ." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // ── 2. Batch → season, and may the caller act in that season? ────────────
  const { data: batch, error: batchError } = await client
    .from("intake_batches")
    .select("id,season_id")
    .eq("id", intakeBatchId)
    .maybeSingle();
  if (batchError) {
    log("load batch", batchError);
    return { ok: false, message: SAFE_ERROR };
  }
  const seasonId = (batch as JsonRecord | null)?.season_id as string | null;
  if (!seasonId) return { ok: false, message: "Batch chưa gắn mùa." };

  const allowedSeasonIds = await getAllowedSeasonIds(scopeContext);
  if (!canAccessSeason(scopeContext, seasonId, allowedSeasonIds)) {
    return { ok: false, message: "Bạn không có quyền xem hồ sơ trong mùa này." };
  }

  // ── 3 & 4. Approved in THIS season, for THIS role ────────────────────────
  //
  // Bounded by contract: one person, one season, one status. The M083 identity
  // arbiters make more than one row an anomaly, which
  // `pickQuickViewApplication` resolves deterministically rather than by taking
  // whatever PostgREST returned first.
  const { data: appRows, error: appError } = await client
    .from("applications")
    .select("id,person_id,season_id,status,role_applied,full_name,source,raw_payload,submitted_at")
    .eq("person_id", personId)
    .eq("season_id", seasonId)
    .eq("status", APPROVED_STATUS[role])
    .limit(50);
  if (appError) {
    log("load approved application", appError);
    return { ok: false, message: SAFE_ERROR };
  }

  const application = pickQuickViewApplication((appRows ?? []) as unknown as Application[]);
  if (!application) return { ok: false, message: NOT_ELIGIBLE };

  // ── 5. The matching profile must exist ───────────────────────────────────
  const profileTable = role === "mentor" ? "mentor_profiles" : "mentee_profiles";
  const profileColumns =
    role === "mentor"
      ? "id,person_id,company_current,title_current,industry,function_area,years_experience_text,years_experience_min,first_vam_season,capacity_target"
      : "id,person_id,school_code,school_raw,major,class_cohort";
  const { data: profileRows, error: profileError } = await client
    .from(profileTable)
    .select(profileColumns)
    .eq("person_id", personId)
    .limit(50);
  if (profileError) {
    log(`load ${profileTable}`, profileError);
    return { ok: false, message: SAFE_ERROR };
  }
  // Lowest id per person, the same deterministic rule the candidate list uses,
  // so the drawer describes the row the operator is about to match.
  const profile = [...((profileRows ?? []) as JsonRecord[])]
    .filter((row) => Boolean(row.id))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
  if (!profile) return { ok: false, message: NOT_ELIGIBLE };

  // ── Context loads, only now that eligibility is settled ──────────────────
  const [{ data: personRows }, { data: legacyRows }] = await Promise.all([
    client.from("people").select("id,full_name").eq("id", personId).limit(1),
    client
      .from("application_answers")
      .select("application_id,question_key,question_label,value_text")
      .eq("application_id", application.id)
      .limit(200)
  ]);

  let activeMatchCount: number | undefined;
  if (role === "mentor") {
    const { count, error: countError } = await client
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("mentor_person_id", personId)
      .eq("season_id", seasonId)
      .eq("status", "active");
    if (countError) log("count active matches", countError);
    else activeMatchCount = count ?? 0;
  }

  const payload = buildQuickView({
    role,
    person: ((personRows ?? [])[0] ?? null) as Person | null,
    application,
    mentorProfile: role === "mentor" ? (profile as unknown as MentorProfile) : null,
    menteeProfile: role === "mentee" ? (profile as unknown as MenteeProfile) : null,
    legacyAnswers: (legacyRows ?? []) as JsonRecord[],
    activeMatchCount,
    effectiveCapacity:
      role === "mentor" ? effectiveMentorCapacity(profile.capacity_target) : undefined
  });

  return { ok: true, data: payload };
}
