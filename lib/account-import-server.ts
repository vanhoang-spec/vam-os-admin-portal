import "server-only";

import { createHash } from "crypto";
import { createManagedAdminUser, requireSuperAdmin } from "@/lib/admin-users";
import { isParticipantImportRole, isStaffImportRole, scopeRoleForStaffRole } from "@/lib/account-roles";
import {
  parseAccountImportCsv,
  type AccountImportParseResult,
  type AccountImportReference,
  type AccountImportRow
} from "@/lib/account-import";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

export type AccountImportOutcomeStatus = "created" | "updated" | "skipped" | "failed";
export type AccountImportOutcome = { rowNumber: number; status: AccountImportOutcomeStatus; reason: string };

function clientOrThrow() {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("Thiếu cấu hình server để xử lý import an toàn.");
  return client;
}

export async function loadAccountImportReference(): Promise<AccountImportReference> {
  const actor = await requireSuperAdmin();
  if (!actor) throw new Error("Không có quyền quản lý import tài khoản.");
  const client = clientOrThrow();
  const [programs, seasons, batches] = await Promise.all([
    client.from("programs").select("id,code").eq("is_active", true),
    client.from("seasons").select("id,code,program_id"),
    client.from("intake_batches").select("id,code,season_id")
  ]);
  const firstError = programs.error ?? seasons.error ?? batches.error;
  if (firstError) throw new Error("Không thể tải danh mục program/season/intake batch.");
  return {
    programs: (programs.data ?? []).map((row: any) => ({ id: String(row.id), code: String(row.code) })),
    seasons: (seasons.data ?? []).map((row: any) => ({ id: String(row.id), code: String(row.code), programId: String(row.program_id) })),
    intakeBatches: (batches.data ?? []).map((row: any) => ({ id: String(row.id), code: String(row.code), seasonId: String(row.season_id) }))
  };
}

export async function previewAccountImport(csv: string): Promise<AccountImportParseResult> {
  return parseAccountImportCsv(csv, await loadAccountImportReference());
}

async function persistOutcome(client: any, batchId: string, outcome: AccountImportOutcome) {
  const { error } = await client.from("account_import_outcomes").insert({
    batch_id: batchId,
    row_number: outcome.rowNumber,
    outcome_status: outcome.status,
    reason_code: outcome.reason.slice(0, 240)
  });
  if (error) throw new Error("Không thể ghi kết quả import đã được làm sạch.");
}

async function upsertParticipantMembership(client: any, actorId: string, row: AccountImportRow): Promise<AccountImportOutcome> {
  if (!row.programId || !row.seasonId || !isParticipantImportRole(row.role)) {
    return { rowNumber: row.rowNumber, status: "failed", reason: "participant_scope_invalid" };
  }
  const { data: existingPerson, error: lookupError } = await client
    .from("people").select("id,full_name").eq("email_primary", row.email).maybeSingle();
  if (lookupError) return { rowNumber: row.rowNumber, status: "failed", reason: "person_lookup_failed" };
  let personId = existingPerson?.id as string | undefined;
  let createdPerson = false;
  if (!personId) {
    const { data, error } = await client.from("people").insert({ email_primary: row.email, full_name: row.displayName }).select("id").maybeSingle();
    if (error || !data?.id) return { rowNumber: row.rowNumber, status: "failed", reason: "person_create_failed" };
    personId = String(data.id);
    createdPerson = true;
  }
  const { data: existingMembership, error: membershipLookupError } = await client
    .from("person_season_memberships")
    .select("id,status,intake_batch_id")
    .eq("person_id", personId)
    .eq("season_id", row.seasonId)
    .eq("role", row.role)
    .maybeSingle();
  if (membershipLookupError) return { rowNumber: row.rowNumber, status: "failed", reason: "membership_lookup_failed" };
  if (existingMembership?.id && existingMembership.status === "invited" && (existingMembership.intake_batch_id ?? null) === row.intakeBatchId) {
    return { rowNumber: row.rowNumber, status: "skipped", reason: "membership_already_current" };
  }
  const payload = {
    person_id: personId,
    program_id: row.programId,
    season_id: row.seasonId,
    intake_batch_id: row.intakeBatchId,
    role: row.role,
    status: "invited",
    source: "manual",
    created_by: actorId
  };
  const result = existingMembership?.id
    ? await client.from("person_season_memberships").update(payload).eq("id", existingMembership.id).select("id").maybeSingle()
    : await client.from("person_season_memberships").insert(payload).select("id").maybeSingle();
  if (result.error || !result.data?.id) return { rowNumber: row.rowNumber, status: "failed", reason: "membership_write_failed" };
  const { error: logError } = await client.from("person_season_membership_log").insert({
    membership_id: result.data.id,
    person_id: personId,
    program_id: row.programId,
    season_id: row.seasonId,
    role: row.role,
    old_status: existingMembership?.status ?? null,
    new_status: "invited",
    transition_type: existingMembership ? "status_change" : "created",
    reason: "account_csv_import",
    changed_by: actorId
  });
  if (logError) return { rowNumber: row.rowNumber, status: "failed", reason: "membership_audit_failed" };
  const { error: auditError } = await client.from("admin_audit_log").insert({
    actor_admin_user_id: actorId,
    action_type: existingMembership ? "import_update_membership" : "import_create_membership",
    before_data: null,
    after_data: { role: row.role, program_id: row.programId, season_id: row.seasonId, participant_auth_created: false }
  });
  if (auditError) return { rowNumber: row.rowNumber, status: "failed", reason: "admin_audit_failed" };
  return { rowNumber: row.rowNumber, status: existingMembership || !createdPerson ? "updated" : "created", reason: existingMembership ? "membership_updated" : "membership_created_no_auth" };
}

export async function confirmAccountImport(csv: string): Promise<{ ok: boolean; batchId?: string; outcomes: AccountImportOutcome[]; message: string }> {
  const actor = await requireSuperAdmin();
  if (!actor?.id) return { ok: false, outcomes: [], message: "Không có quyền xác nhận import." };
  const reference = await loadAccountImportReference();
  const parsed = parseAccountImportCsv(csv, reference);
  if (!parsed.ok) return { ok: false, outcomes: parsed.rows.map((row) => ({ rowNumber: row.rowNumber, status: "failed", reason: row.reasons.join("; ") })), message: "Dữ liệu đã thay đổi hoặc không còn hợp lệ; chưa có mutation." };
  const client = clientOrThrow();
  const fingerprint = createHash("sha256").update(csv, "utf8").digest("hex");
  const { data: batch, error: batchError } = await client.from("account_import_batches").insert({
    actor_admin_user_id: actor.id,
    source_sha256: fingerprint,
    row_count: parsed.rows.length,
    status: "processing"
  }).select("id").maybeSingle();
  if (batchError || !batch?.id) return { ok: false, outcomes: [], message: "Kho lưu metadata import chưa sẵn sàng; không có lời mời hay dữ liệu nào được tạo." };
  const outcomes: AccountImportOutcome[] = [];
  for (const row of parsed.rows) {
    let outcome: AccountImportOutcome;
    try {
      if (isParticipantImportRole(row.role)) outcome = await upsertParticipantMembership(client, actor.id, row);
      else if (isStaffImportRole(row.role)) {
        const result = await createManagedAdminUser({
          email: row.email,
          fullName: row.displayName,
          role: row.role,
          status: "invited",
          programId: row.programId,
          seasonId: row.seasonId,
          scopeRole: scopeRoleForStaffRole(row.role),
          scopeStatus: "inactive"
        });
        outcome = { rowNumber: row.rowNumber, status: result.ok ? (result.message.includes("gửi lời mời") ? "created" : "updated") : "failed", reason: result.ok ? "staff_account_invited_or_updated" : "staff_account_failed" };
      } else outcome = { rowNumber: row.rowNumber, status: "failed", reason: "unsupported_role_after_revalidation" };
      await persistOutcome(client, batch.id, outcome);
    } catch {
      outcome = { rowNumber: row.rowNumber, status: "failed", reason: "unexpected_row_failure" };
      try { await persistOutcome(client, batch.id, outcome); } catch { /* batch finalization reports failure */ }
    }
    outcomes.push(outcome);
  }
  const failed = outcomes.filter((row) => row.status === "failed").length;
  await client.from("account_import_batches").update({ status: failed ? "completed_with_errors" : "completed", completed_at: new Date().toISOString() }).eq("id", batch.id);
  return { ok: failed === 0, batchId: batch.id, outcomes, message: failed ? `Hoàn tất với ${failed} dòng lỗi.` : "Import hoàn tất." };
}
