import "server-only";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import {
  canOperateSeason,
  canReadAnyScope,
  getAdminScopeContext,
  getScopeFilter,
  getScopeLevelForSeason,
  type AdminScopeContext,
  type ScopeFilter,
  type ScopeLevel
} from "@/lib/program-scope";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import type { JsonRecord } from "@/lib/types";

const VI_ERROR = "Khong the tai du lieu lifecycle/CRM. Vui long kiem tra schema va quyen doc bang.";

export type PersonSeasonMembership = JsonRecord & {
  id: string;
  person_id: string;
  program_id: string;
  season_id: string;
  intake_batch_id: string | null;
  intake_batch_code: string | null;
  role: string;
  status: string;
  source: string;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmNote = JsonRecord & {
  id: string;
  person_id: string;
  match_id: string | null;
  program_id: string | null;
  season_id: string | null;
  note_type: string;
  visibility: CrmNoteVisibility;
  channel: string | null;
  sentiment: string | null;
  priority: string;
  content: string;
  next_action_text: string | null;
  next_action_due_date: string | null;
  owner_admin_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmNoteVisibility = "private" | "ops_only" | "team" | "system";

export type CrmNoteActionState = {
  ok: boolean;
  message: string | null;
};

const NOTE_TYPES = new Set([
  "contact_outbound",
  "contact_inbound",
  "re_engagement",
  "feedback_from_mentor",
  "feedback_from_mentee",
  "feedback_about_mentor",
  "feedback_about_mentee",
  "program_feedback",
  "pause_intent",
  "withdrawal_intent",
  "return_intent",
  "application_intent",
  "observation",
  "escalation",
  "resolution",
  "handover"
]);

const OPS_ONLY_NOTE_TYPES = new Set([
  "re_engagement",
  "feedback_from_mentor",
  "feedback_from_mentee",
  "feedback_about_mentor",
  "feedback_about_mentee",
  "pause_intent",
  "withdrawal_intent",
  "return_intent",
  "observation",
  "escalation",
  "resolution"
]);

const VISIBILITIES = new Set(["private", "ops_only", "team"]);
const CHANNELS = new Set(["", "zalo", "phone", "email", "in_person", "video_call", "form", "event", "other"]);
const SENTIMENTS = new Set(["", "positive", "neutral", "concern", "critical"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const SCOPE_RANK: Record<ScopeLevel, number> = {
  read: 1,
  review: 2,
  operations: 3,
  full_access: 4
};

function client() {
  return getSupabaseServiceRoleClient();
}

function errorMessage(scope: string, error: unknown) {
  const err = error as { message?: string };
  return `${VI_ERROR} (${scope}: ${err?.message ?? String(error)})`;
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function isUuidLike(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

function hasScope(scope?: ScopeFilter) {
  return !scope || Boolean(scope.allowedProgramIds?.length || scope.allowedSeasonIds?.length);
}

function canSeeOpsOnly(level: ScopeLevel | null, ctx: AdminScopeContext) {
  return ctx.isSuperAdmin || Boolean(level && SCOPE_RANK[level] >= SCOPE_RANK.operations);
}

function canCreateStandardNote(level: ScopeLevel | null, ctx: AdminScopeContext) {
  return ctx.isSuperAdmin || Boolean(level && SCOPE_RANK[level] >= SCOPE_RANK.review);
}

function canCreateOpsNote(level: ScopeLevel | null, ctx: AdminScopeContext) {
  return ctx.isSuperAdmin || Boolean(level && SCOPE_RANK[level] >= SCOPE_RANK.operations);
}

async function getProgramIdForSeason(seasonId: string | null) {
  if (!seasonId) return null;
  const supabase = client();
  if (!supabase) return null;
  const { data } = await supabase.from("seasons").select("program_id").eq("id", seasonId).maybeSingle();
  return (data?.program_id as string | null) ?? null;
}

async function getProgramCode(programId: string | null) {
  if (!programId) return null;
  const supabase = client();
  if (!supabase) return null;
  const { data } = await supabase.from("programs").select("code").eq("id", programId).maybeSingle();
  return (data?.code as string | null) ?? null;
}

async function getBestScopeLevel(ctx: AdminScopeContext, programId: string | null, seasonId: string | null) {
  if (ctx.isSuperAdmin) return "full_access" as ScopeLevel;
  if (seasonId) return getScopeLevelForSeason(ctx, seasonId);
  if (programId) {
    const programCode = await getProgramCode(programId);
    const direct = ctx.programScopes
      .filter((scope) => (scope.programId === programId || scope.programId === programCode) && !scope.seasonId)
      .map((scope) => scope.scopeLevel)
      .sort((a, b) => SCOPE_RANK[b] - SCOPE_RANK[a])[0];
    return direct ?? null;
  }
  return null;
}

function noteVisibleToAdmin(note: CrmNote, admin: CurrentAdminUser | null, level: ScopeLevel | null, ctx: AdminScopeContext) {
  if (ctx.isSuperAdmin) return true;
  if (note.visibility === "private") {
    return Boolean(admin?.id && note.created_by === admin.id && level && SCOPE_RANK[level] >= SCOPE_RANK.review);
  }
  if (note.visibility === "ops_only") return canSeeOpsOnly(level, ctx);
  if (note.visibility === "team" || note.visibility === "system") return Boolean(level);
  return false;
}

export async function getPersonSeasonMemberships(personId: string, scope?: ScopeFilter) {
  if (!hasScope(scope)) return { data: [] as PersonSeasonMembership[], error: null };
  const supabase = client();
  if (!supabase) return { data: [] as PersonSeasonMembership[], error: "Thieu Supabase service role client." };

  let query = supabase
    .from("person_season_memberships")
    .select("*")
    .eq("person_id", personId)
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (scope?.allowedSeasonIds) {
    if (!scope.allowedSeasonIds.length) return { data: [], error: null };
    query = query.in("season_id", scope.allowedSeasonIds);
  } else if (scope?.allowedProgramIds?.length) {
    query = query.in("program_id", scope.allowedProgramIds);
  }

  const { data, error } = await query;
  if (error) return { data: [] as PersonSeasonMembership[], error: errorMessage("person_season_memberships", error) };

  const rows = (data ?? []) as PersonSeasonMembership[];
  const batchIds = Array.from(new Set(rows.map((row) => clean(row.intake_batch_id)).filter((id): id is string => Boolean(id))));
  const codeByBatchId = new Map<string, string>();

  if (batchIds.length) {
    const { data: batches, error: batchError } = await supabase.from("intake_batches").select("id,code").in("id", batchIds);
    if (batchError) return { data: [] as PersonSeasonMembership[], error: errorMessage("intake_batches", batchError) };
    for (const batch of (batches ?? []) as Array<{ id?: unknown; code?: unknown }>) {
      const id = clean(batch.id);
      const code = clean(batch.code);
      if (id && code) codeByBatchId.set(id, code);
    }
  }

  return {
    data: rows.map((row) => ({
      ...row,
      intake_batch_code: row.intake_batch_id ? codeByBatchId.get(row.intake_batch_id) ?? null : null
    })),
    error: null
  };
}

export async function getCrmNotesByPerson(personId: string, ctx: AdminScopeContext, scope?: ScopeFilter) {
  if (!hasScope(scope) || !canReadAnyScope(ctx)) return { data: [] as CrmNote[], error: null };
  const supabase = client();
  if (!supabase) return { data: [] as CrmNote[], error: "Thieu Supabase service role client." };

  let query = supabase
    .from("crm_notes")
    .select("*")
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!ctx.isSuperAdmin && scope?.allowedSeasonIds?.length) {
    query = query.or(`season_id.in.(${scope.allowedSeasonIds.join(",")}),season_id.is.null`);
  } else if (!ctx.isSuperAdmin && scope?.allowedProgramIds?.length) {
    query = query.or(`program_id.in.(${scope.allowedProgramIds.join(",")}),program_id.is.null`);
  }

  const { data, error } = await query;
  if (error) return { data: [] as CrmNote[], error: errorMessage("crm_notes", error) };

  const admin = ctx.adminUser ?? (await getCurrentAdminUser());
  const rows = (data ?? []) as CrmNote[];
  const withVisibility = await Promise.all(
    rows.map(async (note) => {
      const programId = note.program_id ?? (await getProgramIdForSeason(note.season_id));
      const level = await getBestScopeLevel(ctx, programId, note.season_id);
      return noteVisibleToAdmin(note, admin, level, ctx) ? note : null;
    })
  );

  return { data: withVisibility.filter((note): note is CrmNote => Boolean(note)), error: null };
}

export async function createCrmNoteAction(_previous: CrmNoteActionState, formData: FormData): Promise<CrmNoteActionState> {
  "use server";

  const supabase = client();
  if (!supabase) return { ok: false, message: "Thieu Supabase service role client." };

  const ctx = await getAdminScopeContext();
  const admin = ctx.adminUser ?? (await getCurrentAdminUser());
  if (!admin?.id || !canReadAnyScope(ctx)) {
    return { ok: false, message: "Ban khong co quyen tao ghi chu CRM." };
  }

  const personId = clean(formData.get("person_id"));
  const programIdInput = clean(formData.get("program_id"));
  const seasonId = clean(formData.get("season_id"));
  const matchId = clean(formData.get("match_id"));
  const noteType = clean(formData.get("note_type")) ?? "";
  const visibility = (clean(formData.get("visibility")) ?? "ops_only") as CrmNoteVisibility;
  const channel = clean(formData.get("channel"));
  const sentiment = clean(formData.get("sentiment"));
  const priority = clean(formData.get("priority")) ?? "normal";
  const content = clean(formData.get("content"));
  const nextActionText = clean(formData.get("next_action_text"));
  const nextActionDueDate = clean(formData.get("next_action_due_date"));
  const ownerAdminUserId = clean(formData.get("owner_admin_user_id"));

  if (!personId || !isUuidLike(personId)) return { ok: false, message: "Thieu person_id hop le." };
  if (!NOTE_TYPES.has(noteType)) return { ok: false, message: "Loai ghi chu CRM khong hop le." };
  if (!VISIBILITIES.has(visibility)) return { ok: false, message: "Muc hien thi ghi chu khong hop le." };
  if (!CHANNELS.has(channel ?? "")) return { ok: false, message: "Kenh lien he khong hop le." };
  if (!SENTIMENTS.has(sentiment ?? "")) return { ok: false, message: "Sentiment khong hop le." };
  if (!PRIORITIES.has(priority)) return { ok: false, message: "Priority khong hop le." };
  if (!content) return { ok: false, message: "Vui long nhap noi dung ghi chu." };

  const programId = seasonId ? await getProgramIdForSeason(seasonId) : programIdInput;
  const level = await getBestScopeLevel(ctx, programId, seasonId);
  if (!ctx.isSuperAdmin && !programId && !seasonId) {
    return { ok: false, message: "Ghi chu cua admin theo chuong trinh can gan program hoac season." };
  }
  if (seasonId && !(await canOperateSeason(ctx, seasonId)) && !ctx.isSuperAdmin) {
    return { ok: false, message: "Ban khong co quyen operations trong mua nay." };
  }
  if (!seasonId && !canCreateStandardNote(level, ctx)) {
    return { ok: false, message: "Ban khong co quyen tao ghi chu CRM trong pham vi nay." };
  }
  if ((visibility === "ops_only" || OPS_ONLY_NOTE_TYPES.has(noteType)) && !canCreateOpsNote(level, ctx)) {
    return { ok: false, message: "Ghi chu nhay cam can quyen operations tro len." };
  }

  const scope = await getScopeFilter(ctx);
  if (scope?.allowedProgramIds?.length && programId && !scope.allowedProgramIds.includes(programId)) {
    return { ok: false, message: "Program cua ghi chu nam ngoai pham vi duoc cap." };
  }
  if (scope?.allowedSeasonIds?.length && seasonId && !scope.allowedSeasonIds.includes(seasonId)) {
    return { ok: false, message: "Season cua ghi chu nam ngoai pham vi duoc cap." };
  }

  const { error } = await supabase.from("crm_notes").insert({
    person_id: personId,
    match_id: matchId,
    program_id: programId,
    season_id: seasonId,
    note_type: noteType,
    visibility,
    channel,
    sentiment,
    priority,
    content,
    next_action_text: nextActionText,
    next_action_due_date: nextActionDueDate,
    owner_admin_user_id: ownerAdminUserId,
    created_by: admin.id
  });

  if (error) return { ok: false, message: errorMessage("crm_notes insert", error) };

  revalidatePath(`/people/${personId}`, "page");
  return { ok: true, message: "Da tao ghi chu CRM." };
}

export async function createCrmNoteFormAction(formData: FormData) {
  "use server";

  await createCrmNoteAction({ ok: false, message: null }, formData);
}
