import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageWorkflow } from "@/lib/auth-constants";
import { canOperateAnyScope, canOperateSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";
import type { JsonRecord, MentoringRecap, Person, Season } from "@/lib/types";

export type AdminWorkflowStatus = "open" | "in_progress" | "resolved" | "dropped" | "no_response";
export type AdminWorkflowType =
  | "followup_no_recap"
  | "data_issue"
  | "unmatched_recap"
  | "missing_mentee"
  | "missing_mentor"
  | "invalid_date"
  | "duplicate_recap";

export type AdminActionItem = JsonRecord & {
  id: string;
  type: AdminWorkflowType;
  target_person_id: string | null;
  season_code: string | null;
  status: AdminWorkflowStatus;
  owner_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminDataIssue = {
  key: string;
  type: AdminWorkflowType;
  label: string;
  severity: "high" | "medium" | "low";
  recap_id: string;
  target_person_id: string | null;
  season_code: string;
  meeting_date: string | null;
  mentee_name: string | null;
  mentor_name: string | null;
  recap_url: string | null;
  details: string;
  actionItem?: AdminActionItem | null;
};

export type AdminCorrectionData = {
  ok: boolean;
  error: string | null;
  issues: AdminDataIssue[];
  followups: AdminActionItem[];
  actionItems: AdminActionItem[];
  recaps: MentoringRecap[];
  people: Person[];
  seasons: Season[];
};

export type MutationResult = {
  ok: boolean;
  message: string;
};

const DEFAULT_SEASON_CODE = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE;
const SAFE_ERROR = "Không thể thực hiện tác vụ. Vui lòng kiểm tra migration Phase 2D và server logs.";
const RECAP_STATUSES = new Set(["submitted", "needs_review", "invalid", "duplicate", "deleted"]);
const ACTION_STATUSES = new Set(["open", "in_progress", "resolved", "dropped", "no_response"]);
const ACTION_TYPES = new Set([
  "followup_no_recap",
  "data_issue",
  "unmatched_recap",
  "missing_mentee",
  "missing_mentor",
  "invalid_date",
  "duplicate_recap"
]);

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[admin-corrections]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

function clientResult() {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { client: null, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY trên server." };
  return { client, error: null };
}

async function requireWorkflowAdmin(): Promise<{ ok: true; admin: Awaited<ReturnType<typeof getCurrentAdminUser>> } | { ok: false; message: string }> {
  const admin = await getCurrentAdminUser();
  if (!canManageWorkflow(admin)) return { ok: false, message: "Bạn không có quyền quản lý correction workflow." };
  const ctx = await getAdminScopeContext();
  if (!canOperateAnyScope(ctx)) return { ok: false, message: "Ban khong co quyen operations trong pham vi chuong trinh." };
  return { ok: true, admin };
}

async function requireOperationsForSeason(seasonId: string | null | undefined) {
  const ctx = await getAdminScopeContext();
  if (await canOperateSeason(ctx, seasonId)) return { ok: true as const };
  return { ok: false as const, message: "Ban khong co quyen operations trong mua nay." };
}

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function validStatus(value: unknown): AdminWorkflowStatus {
  const status = String(value ?? "open").trim();
  return ACTION_STATUSES.has(status) ? (status as AdminWorkflowStatus) : "open";
}

function validType(value: unknown): AdminWorkflowType {
  const type = String(value ?? "data_issue").trim();
  return ACTION_TYPES.has(type) ? (type as AdminWorkflowType) : "data_issue";
}

function validRecapStatus(value: unknown) {
  const status = String(value ?? "submitted").trim();
  return RECAP_STATUSES.has(status) ? status : "submitted";
}

function validateDate(value: string | null) {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function seasonCodeFor(seasonsById: Map<string, Season>, seasonId: string | null | undefined) {
  return (seasonId ? seasonsById.get(seasonId)?.code : null) ?? DEFAULT_SEASON_CODE;
}

function issueKey(type: AdminWorkflowType, recapId: string, extra = "") {
  return `${type}:${recapId}${extra ? `:${extra}` : ""}`;
}

async function writeAdminAudit(client: any, input: {
  actionType: string;
  beforeData?: unknown;
  afterData?: unknown;
  details?: unknown;
}) {
  try {
    const admin = await getCurrentAdminUser();
    const { error } = await client.from("admin_audit_log").insert({
      actor_admin_user_id: admin?.id ?? null,
      action_type: input.actionType,
      target_admin_user_id: null,
      before_data: input.beforeData ?? null,
      after_data: input.afterData ?? null,
      details: input.details ?? null
    });
    if (error) log("admin_audit_log insert failed", error);
  } catch (error) {
    log("admin audit crashed", error);
  }
}

async function writeActivityAudit(client: any, input: {
  targetId: string;
  correctionType: string;
  fieldName?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}) {
  const admin = await getCurrentAdminUser();
  const correctedBy = admin?.full_name ? `${admin.full_name} <${admin.email}>` : admin?.email ?? "admin";
  const { error } = await client.from("activity_correction_log").insert({
    target_table: "mentoring_recaps",
    target_id: input.targetId,
    correction_type: input.correctionType,
    field_name: input.fieldName ?? null,
    old_value: input.oldValue === undefined || input.oldValue === null ? null : String(input.oldValue),
    new_value: input.newValue === undefined || input.newValue === null ? null : String(input.newValue),
    reason: input.reason ?? null,
    corrected_by: correctedBy
  });
  if (error) log("activity_correction_log insert failed", error);
}

async function selectAll<T>(client: any, table: string, columns = "*") {
  let allData: T[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await client.from(table).select(columns).range(from, from + step - 1);
    if (error) {
      log(`${table} select failed`, error);
      return { data: allData, error: error.message as string };
    }
    if (!data || data.length === 0) break;
    allData = allData.concat(data as T[]);
    if (data.length < step) break;
    from += step;
  }
  return { data: allData, error: null };
}

function buildIssues(input: {
  recaps: MentoringRecap[];
  people: Person[];
  seasons: Season[];
  actionItems: AdminActionItem[];
}) {
  const peopleById = new Map(input.people.map((person) => [person.id, person]));
  const seasonsById = new Map(input.seasons.map((season) => [season.id, season]));
  const activeItemsByKey = new Map<string, AdminActionItem>();
  for (const item of input.actionItems) {
    const key = String(item.metadata?.issue_key ?? "");
    if (key && item.status !== "resolved" && item.status !== "dropped") activeItemsByKey.set(key, item);
  }

  const issues: AdminDataIssue[] = [];
  const duplicateBuckets = new Map<string, MentoringRecap[]>();
  for (const recap of input.recaps.filter((row) => row.status !== "deleted")) {
    const seasonCode = seasonCodeFor(seasonsById, recap.season_id);
    const mentee = recap.mentee_person_id ? peopleById.get(recap.mentee_person_id) : undefined;
    const mentor = recap.mentor_person_id ? peopleById.get(recap.mentor_person_id) : undefined;
    const base = {
      recap_id: recap.id,
      target_person_id: recap.mentee_person_id ?? recap.mentor_person_id ?? null,
      season_code: seasonCode,
      meeting_date: recap.meeting_date,
      mentee_name: mentee?.full_name ?? mentee?.email_primary ?? null,
      mentor_name: mentor?.full_name ?? mentor?.email_primary ?? null,
      recap_url: recap.recap_url
    };

    const push = (type: AdminWorkflowType, label: string, severity: AdminDataIssue["severity"], details: string, extra = "") => {
      const key = issueKey(type, recap.id, extra);
      issues.push({
        ...base,
        key,
        type,
        label,
        severity,
        details,
        actionItem: activeItemsByKey.get(key) ?? null
      });
    };

    if (!recap.match_id) push("unmatched_recap", "Unmatched recap", "medium", "Recap chưa liên kết match_id.");
    if (!recap.mentee_person_id || !mentee) push("missing_mentee", "Missing mentee", "high", "Recap thiếu mentee hoặc mentee_person_id không tồn tại.");
    if (!recap.mentor_person_id || !mentor) push("missing_mentor", "Missing mentor", "high", "Recap thiếu mentor hoặc mentor_person_id không tồn tại.");
    if (!validateDate(String(recap.meeting_date ?? "").slice(0, 10))) {
      push("invalid_date", "Invalid date", "high", "meeting_date không hợp lệ.");
    } else if (recap.meeting_month && String(recap.meeting_date).slice(0, 7) !== recap.meeting_month) {
      push("invalid_date", "Invalid date", "medium", "meeting_month không khớp meeting_date.", "month_mismatch");
    }

    const duplicateKey = [
      recap.season_id ?? seasonCode,
      recap.match_id ?? "",
      recap.mentor_person_id ?? "",
      recap.mentee_person_id ?? "",
      recap.meeting_date ?? "",
      recap.recap_url ?? ""
    ].join("|");
    duplicateBuckets.set(duplicateKey, [...(duplicateBuckets.get(duplicateKey) ?? []), recap]);
  }

  for (const rows of Array.from(duplicateBuckets.values())) {
    if (rows.length < 2) continue;
    for (const recap of rows) {
      const key = issueKey("duplicate_recap", recap.id);
      if (issues.some((issue) => issue.key === key)) continue;
      const seasonCode = seasonCodeFor(seasonsById, recap.season_id);
      const mentee = recap.mentee_person_id ? peopleById.get(recap.mentee_person_id) : undefined;
      const mentor = recap.mentor_person_id ? peopleById.get(recap.mentor_person_id) : undefined;
      issues.push({
        key,
        type: "duplicate_recap",
        label: "Duplicate recap",
        severity: "medium",
        recap_id: recap.id,
        target_person_id: recap.mentee_person_id ?? recap.mentor_person_id ?? null,
        season_code: seasonCode,
        meeting_date: recap.meeting_date,
        mentee_name: mentee?.full_name ?? mentee?.email_primary ?? null,
        mentor_name: mentor?.full_name ?? mentor?.email_primary ?? null,
        recap_url: recap.recap_url,
        details: "Có nhiều recap trùng season/match/người/ngày/link.",
        actionItem: activeItemsByKey.get(key) ?? null
      });
    }
  }

  return issues.sort((a, b) => a.severity.localeCompare(b.severity) || a.type.localeCompare(b.type));
}

export async function getAdminCorrectionData(): Promise<AdminCorrectionData> {
  const { client, error } = clientResult();
  if (!client) return { ok: false, error, issues: [], followups: [], actionItems: [], recaps: [], people: [], seasons: [] };
  const scope = await getScopeFilter(await getAdminScopeContext());

  const [recaps, people, seasons, actionItems] = await Promise.all([
    selectAll<MentoringRecap>(client, "mentoring_recaps", "id,season_id,match_id,mentor_person_id,mentee_person_id,meeting_date,meeting_month,recap_url,recap_source,recap_note,meeting_type,captured_by,issue_flag,status,admin_notes"),
    selectAll<Person>(client, "people", "id,full_name,email_primary,phone_primary"),
    selectAll<Season>(client, "seasons", "id,code,name"),
    selectAll<AdminActionItem>(client, "action_items", "id,type,target_person_id,season_code,status,owner_email,created_at,updated_at,notes,metadata")
  ]);
  const allowedSeasonIds = scope?.allowedSeasonIds;
  const scopedSeasons = allowedSeasonIds ? seasons.data.filter((season) => allowedSeasonIds.includes(season.id)) : seasons.data;
  const scopedSeasonCodes = new Set(scopedSeasons.map((season) => season.code).filter(Boolean));
  const scopedRecaps = allowedSeasonIds ? recaps.data.filter((recap) => recap.season_id && allowedSeasonIds.includes(recap.season_id)) : recaps.data;
  const scopedPersonIds = new Set(scopedRecaps.flatMap((recap) => [recap.mentor_person_id, recap.mentee_person_id]).filter(Boolean) as string[]);
  const scopedPeople = allowedSeasonIds ? people.data.filter((person) => scopedPersonIds.has(person.id)) : people.data;
  const scopedActionItems = allowedSeasonIds
    ? actionItems.data.filter((item) => item.season_code && scopedSeasonCodes.has(item.season_code))
    : actionItems.data;

  const errors = [recaps.error, people.error, seasons.error, actionItems.error].filter(Boolean);
  const issues = buildIssues({
    recaps: scopedRecaps,
    people: scopedPeople,
    seasons: scopedSeasons,
    actionItems: scopedActionItems
  });

  return {
    ok: !errors.length,
    error: errors.join(" | ") || null,
    issues,
    followups: scopedActionItems.filter((item) => item.type === "followup_no_recap"),
    actionItems: scopedActionItems,
    recaps: scopedRecaps,
    people: scopedPeople,
    seasons: scopedSeasons
  };
}

export async function createActionItem(input: {
  type: unknown;
  targetPersonId?: unknown;
  seasonCode?: unknown;
  ownerEmail?: unknown;
  notes?: unknown;
  issueKey?: unknown;
}): Promise<MutationResult> {
  const access = await requireWorkflowAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error };

  const type = validType(input.type);
  const notes = clean(input.notes);
  const seasonCode = clean(input.seasonCode) ?? DEFAULT_SEASON_CODE;
  const { data: seasonForScope, error: seasonScopeError } = await client
    .from("seasons")
    .select("id,code")
    .eq("code", seasonCode)
    .maybeSingle();
  if (seasonScopeError) {
    log("load season for action item scope failed", seasonScopeError);
    return { ok: false, message: SAFE_ERROR };
  }
  const seasonAccess = await requireOperationsForSeason((seasonForScope as JsonRecord | null)?.id as string | null);
  if (!seasonAccess.ok) return { ok: false, message: seasonAccess.message };
  const payload = {
    type,
    action_type: type,
    title: type.replaceAll("_", " "),
    target_person_id: clean(input.targetPersonId),
    season_code: seasonCode,
    status: "open",
    owner_email: clean(input.ownerEmail),
    notes,
    entity_type: "person",
    entity_id: clean(input.targetPersonId),
    source: "admin_phase2d",
    metadata: {
      issue_key: clean(input.issueKey),
      created_by: access.admin?.email ?? null
    }
  };

  const { data, error: insertError } = await client.from("action_items").insert(payload).select("id").maybeSingle();
  if (insertError) {
    log("create action item failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (${insertError.message})` };
  }
  await writeAdminAudit(client, { actionType: "create_action_item", afterData: { id: data?.id, ...payload } });
  return { ok: true, message: "Đã tạo action item." };
}

export async function updateActionItem(input: {
  id: unknown;
  status?: unknown;
  ownerEmail?: unknown;
  noteToAppend?: unknown;
}): Promise<MutationResult> {
  const access = await requireWorkflowAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error };
  const id = clean(input.id);
  if (!id) return { ok: false, message: "Thiếu action item id." };

  const { data: before, error: beforeError } = await client.from("action_items").select("*").eq("id", id).maybeSingle();
  if (beforeError) {
    log("load action item failed", beforeError);
    return { ok: false, message: `${SAFE_ERROR} (${beforeError.message})` };
  }
  if (!before) return { ok: false, message: "Không tìm thấy action item." };

  const { data: seasonForScope, error: seasonScopeError } = await client
    .from("seasons")
    .select("id,code")
    .eq("code", clean(before.season_code) ?? DEFAULT_SEASON_CODE)
    .maybeSingle();
  if (seasonScopeError) {
    log("load season for action item update scope failed", seasonScopeError);
    return { ok: false, message: SAFE_ERROR };
  }
  const seasonAccess = await requireOperationsForSeason((seasonForScope as JsonRecord | null)?.id as string | null);
  if (!seasonAccess.ok) return { ok: false, message: seasonAccess.message };

  const appendedNote = clean(input.noteToAppend);
  const existingNotes = clean(before.notes);
  const updates: JsonRecord = {};
  if (Object.prototype.hasOwnProperty.call(input, "status")) updates.status = validStatus(input.status);
  if (Object.prototype.hasOwnProperty.call(input, "ownerEmail")) updates.owner_email = clean(input.ownerEmail);
  if (appendedNote) {
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const author = access.admin?.email ?? "admin";
    updates.notes = [existingNotes, `[${stamp}] ${author}: ${appendedNote}`].filter(Boolean).join("\n");
  }
  if (!Object.keys(updates).length) return { ok: true, message: "Không có thay đổi mới." };

  const { data: after, error: updateError } = await client.from("action_items").update(updates).eq("id", id).select("*").maybeSingle();
  if (updateError) {
    log("update action item failed", updateError);
    return { ok: false, message: `${SAFE_ERROR} (${updateError.message})` };
  }
  await writeAdminAudit(client, { actionType: "update_action_item", beforeData: before, afterData: after });
  return { ok: true, message: "Đã cập nhật action item." };
}

export async function addManualRecap(input: JsonRecord): Promise<MutationResult> {
  const access = await requireWorkflowAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error };

  const meetingDate = clean(input.meeting_date);
  if (!validateDate(meetingDate)) return { ok: false, message: "meeting_date phải đúng định dạng YYYY-MM-DD." };
  const seasonCode = clean(input.season_code) ?? DEFAULT_SEASON_CODE;
  const { data: season } = await client.from("seasons").select("id,code").eq("code", seasonCode).maybeSingle();
  const seasonAccess = await requireOperationsForSeason((season as JsonRecord | null)?.id as string | null);
  if (!seasonAccess.ok) return { ok: false, message: seasonAccess.message };
  const matchId = clean(input.match_id);
  const mentorId = clean(input.mentor_person_id);
  const menteeId = clean(input.mentee_person_id);

  if (!matchId && !mentorId && !menteeId) {
    return { ok: false, message: "Phải chọn ít nhất Mentor, Mentee hoặc Match." };
  }

  if (matchId && meetingDate) {
    const { data: existing } = await client.from("mentoring_recaps")
      .select("id")
      .eq("match_id", matchId)
      .eq("meeting_date", meetingDate)
      .limit(1)
      .maybeSingle();
    
    if (existing) {
      return { ok: false, message: `Hệ thống đã có recap cho match này vào ngày ${meetingDate}.` };
    }
  }

  const payload = {
    season_id: season?.id ?? null,
    match_id: matchId,
    mentor_person_id: mentorId,
    mentee_person_id: menteeId,
    meeting_date: meetingDate,
    meeting_month: meetingDate!.slice(0, 7),
    recap_url: clean(input.recap_url) ?? "manual://missing-recap-url",
    recap_source: "admin_input",
    recap_note: clean(input.recap_note),
    meeting_type: clean(input.meeting_type) ?? "1on1_primary",
    captured_by: access.admin?.email ?? "admin",
    issue_flag: String(input.issue_flag ?? "false") === "true",
    status: validRecapStatus(input.status),
    admin_notes: clean(input.admin_notes)
  };

  const { data, error: insertError } = await client.from("mentoring_recaps").insert(payload).select("*").maybeSingle();
  if (insertError) {
    log("add manual recap failed", insertError);
    return { ok: false, message: `${SAFE_ERROR} (${insertError.message})` };
  }
  await writeActivityAudit(client, {
    targetId: data.id,
    correctionType: "manual_review",
    fieldName: "insert",
    newValue: JSON.stringify(payload),
    reason: "Manual recap added from Admin Correction Workflow"
  });
  await writeAdminAudit(client, { actionType: "add_manual_recap", afterData: data });
  return { ok: true, message: "Đã thêm recap manual." };
}

export async function editRecap(input: JsonRecord): Promise<MutationResult> {
  const access = await requireWorkflowAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error };
  const id = clean(input.id);
  if (!id) return { ok: false, message: "Thiếu recap id." };

  const { data: before, error: beforeError } = await client.from("mentoring_recaps").select("*").eq("id", id).maybeSingle();
  if (beforeError) {
    log("load recap failed", beforeError);
    return { ok: false, message: `${SAFE_ERROR} (${beforeError.message})` };
  }
  if (!before) return { ok: false, message: "Không tìm thấy recap." };

  const meetingDate = clean(input.meeting_date);
  if (meetingDate && !validateDate(meetingDate)) return { ok: false, message: "meeting_date phải đúng định dạng YYYY-MM-DD." };

  const seasonAccess = await requireOperationsForSeason(clean(before.season_id));
  if (!seasonAccess.ok) return { ok: false, message: seasonAccess.message };

  const updates: JsonRecord = {
    match_id: clean(input.match_id),
    mentor_person_id: clean(input.mentor_person_id),
    mentee_person_id: clean(input.mentee_person_id),
    recap_url: clean(input.recap_url) ?? "manual://missing-recap-url",
    recap_note: clean(input.recap_note),
    meeting_type: clean(input.meeting_type),
    status: validRecapStatus(input.status),
    issue_flag: String(input.issue_flag ?? "false") === "true",
    admin_notes: clean(input.admin_notes)
  };
  if (meetingDate) {
    updates.meeting_date = meetingDate;
    updates.meeting_month = meetingDate.slice(0, 7);
  }

  const { data: after, error: updateError } = await client.from("mentoring_recaps").update(updates).eq("id", id).select("*").maybeSingle();
  if (updateError) {
    log("edit recap failed", updateError);
    return { ok: false, message: `${SAFE_ERROR} (${updateError.message})` };
  }

  await writeActivityAudit(client, {
    targetId: id,
    correctionType: "update_field",
    fieldName: "recap_record",
    oldValue: JSON.stringify(before),
    newValue: JSON.stringify(after),
    reason: clean(input.reason) ?? "Manual recap edit from Admin Correction Workflow"
  });
  await writeAdminAudit(client, { actionType: "edit_recap", beforeData: before, afterData: after });
  return { ok: true, message: "Đã cập nhật recap." };
}

export async function softDeleteRecap(input: { id: unknown; reason?: unknown }): Promise<MutationResult> {
  const access = await requireWorkflowAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, error } = clientResult();
  if (!client) return { ok: false, message: error };
  const id = clean(input.id);
  if (!id) return { ok: false, message: "Thiếu recap id." };

  const { data: before, error: beforeError } = await client.from("mentoring_recaps").select("*").eq("id", id).maybeSingle();
  if (beforeError || !before) {
    if (beforeError) log("load recap for delete failed", beforeError);
    return { ok: false, message: beforeError ? `${SAFE_ERROR} (${beforeError.message})` : "Không tìm thấy recap." };
  }

  const seasonAccess = await requireOperationsForSeason(clean(before.season_id));
  if (!seasonAccess.ok) return { ok: false, message: seasonAccess.message };

  const nextNotes = [clean(before.admin_notes), `Soft deleted by ${access.admin?.email ?? "admin"}: ${clean(input.reason) ?? "No reason provided"}`].filter(Boolean).join("\n");
  const { data: after, error: updateError } = await client
    .from("mentoring_recaps")
    .update({ status: "deleted", issue_flag: true, admin_notes: nextNotes })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (updateError) {
    log("soft delete recap failed", updateError);
    return { ok: false, message: `${SAFE_ERROR} (${updateError.message})` };
  }

  await writeActivityAudit(client, {
    targetId: id,
    correctionType: "status_change",
    fieldName: "status",
    oldValue: before.status,
    newValue: "deleted",
    reason: clean(input.reason) ?? "Soft delete recap"
  });
  await writeAdminAudit(client, { actionType: "soft_delete_recap", beforeData: before, afterData: after });
  return { ok: true, message: "Đã soft delete recap." };
}
