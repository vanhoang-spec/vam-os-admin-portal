import "server-only";

import { createHash } from "crypto";
import { requireSuperAdmin } from "@/lib/admin-users";
import { isParticipantImportRole, isStaffImportRole, scopeRoleForStaffRole } from "@/lib/account-roles";
import { executeStaffMutation } from "@/lib/account-mutation-orchestrator";
import { consumeAccountPreview, createAccountPreview } from "@/lib/account-preview-store";
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

export async function previewAccountImport(csv: string): Promise<AccountImportParseResult & { preview?: { id: string; integrity: string; expiresAt: number } }> {
  const actor = await requireSuperAdmin();
  if (!actor?.id) throw new Error("Không có quyền xem trước import.");
  const parsed = parseAccountImportCsv(csv, await loadAccountImportReference());
  return parsed.ok ? { ...parsed, preview: createAccountPreview(actor.id, csv) } : parsed;
}

async function upsertParticipantMembership(client: any, actorId: string, batchId: string, row: AccountImportRow): Promise<AccountImportOutcome> {
  if (!row.programId || !row.seasonId || !isParticipantImportRole(row.role)) {
    return { rowNumber: row.rowNumber, status: "failed", reason: "participant_scope_invalid" };
  }
  const { data, error } = await client.rpc("vam062_import_participant_membership_atomic", {
    p_actor_admin_user_id: actorId, p_batch_id: batchId, p_row_number: row.rowNumber,
    p_email: row.email, p_display_name: row.displayName, p_role: row.role,
    p_program_id: row.programId, p_season_id: row.seasonId, p_intake_batch_id: row.intakeBatchId
  });
  if (error || !data) return { rowNumber: row.rowNumber, status: "failed", reason: "participant_transaction_failed" };
  const result = Array.isArray(data) ? data[0] : data;
  return { rowNumber: row.rowNumber, status: result.outcome_status, reason: result.reason_code };
}

async function findAuthUser(client: any, email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("AUTH_LOOKUP_FAILED");
    const found = data?.users?.find((user: any) => String(user.email ?? "").trim().toLowerCase() === email);
    if (found?.id) return { id: String(found.id) };
    if (!data?.users?.length || data.users.length < 1000) break;
  }
  return null;
}

export async function confirmAccountImport(previewId: string, integrity: string): Promise<{ ok: boolean; batchId?: string; outcomes: AccountImportOutcome[]; message: string }> {
  const actor = await requireSuperAdmin();
  if (!actor?.id) return { ok: false, outcomes: [], message: "Không có quyền xác nhận import." };
  const consumed = consumeAccountPreview(actor.id, previewId, integrity);
  if (!consumed.ok) return { ok: false, outcomes: [], message: "Bản xem trước đã hết hạn, bị thay đổi hoặc đã được sử dụng." };
  const csv = consumed.csv;
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
      if (isParticipantImportRole(row.role)) outcome = await upsertParticipantMembership(client, actor.id, String(batch.id), row);
      else if (isStaffImportRole(row.role)) {
        const staffRole = row.role;
        const result = await executeStaffMutation({
          findAuth: () => findAuthUser(client, row.email),
          inviteAuth: async () => { const invited = await client.auth.admin.inviteUserByEmail(row.email); if (invited.error || !invited.data?.user?.id) throw new Error("AUTH_INVITE_FAILED"); return { id: String(invited.data.user.id) }; },
          commitDatabase: async (authUserId) => { const rpc = await client.rpc("vam062_upsert_staff_account_atomic", { p_actor_admin_user_id: actor.id, p_batch_id: batch.id, p_row_number: row.rowNumber, p_auth_user_id: authUserId, p_email: row.email, p_display_name: row.displayName, p_role: staffRole, p_program_id: row.programId, p_season_id: row.seasonId, p_scope_role: scopeRoleForStaffRole(staffRole) }); if (rpc.error) throw new Error("DB_TRANSACTION_FAILED"); },
          compensateAuth: async (authUserId) => { const deleted = await client.auth.admin.deleteUser(authUserId); if (deleted.error) throw new Error("AUTH_COMPENSATION_FAILED"); },
          recordReconciliation: async (authUserIdHash) => { const rpc = await client.rpc("vam062_record_reconciliation", { p_actor_admin_user_id: actor.id, p_batch_id: batch.id, p_row_number: row.rowNumber, p_auth_user_id_hash: authUserIdHash }); if (rpc.error) throw new Error("RECONCILIATION_RECORD_FAILED"); },
          hashIdentifier: (value) => createHash("sha256").update(value, "utf8").digest("hex")
        });
        outcome = { rowNumber: row.rowNumber, status: result.status, reason: result.reason };
      } else outcome = { rowNumber: row.rowNumber, status: "failed", reason: "unsupported_role_after_revalidation" };
    } catch {
      outcome = { rowNumber: row.rowNumber, status: "failed", reason: "unexpected_row_failure" };
    }
    outcomes.push(outcome);
  }
  const failed = outcomes.filter((row) => row.status === "failed").length;
  await client.from("account_import_batches").update({ status: failed ? "completed_with_errors" : "completed", completed_at: new Date().toISOString() }).eq("id", batch.id);
  return { ok: failed === 0, batchId: batch.id, outcomes, message: failed ? `Hoàn tất với ${failed} dòng lỗi.` : "Import hoàn tất." };
}
