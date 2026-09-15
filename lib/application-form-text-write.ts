import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { S12_BINDING } from "@/lib/application-form-controls";
import { planFormTextSave } from "@/lib/application-form-text-core";
import { overrideBodies, readApplicationFormTextOverrides } from "@/lib/application-form-texts";
import { writeAdminAudit } from "@/lib/events";
import { canEditApplicationFormTexts } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/application-form-text-write.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ai được sửa chữ trên form nộp đơn, và đường ghi của việc đó.
 */

const DENIED = "Bạn không có quyền sửa chữ trên form đăng ký của mùa này.";
const GENERIC = "Không lưu được chữ trên form. Thử lại.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[application-form-text-write]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

/**
 * Hai điều kiện, cả hai phải qua: vai trò được sửa chữ trên form (super_admin, admin,
 * core_team — `canEditApplicationFormTexts`), và quyền vận hành đúng mùa của đợt tuyển.
 *
 * Fail-closed: bảng phạm vi đọc hỏng trông y như một người không được cấp gì, nên
 * `scopeError` là từ chối, không phải đánh giá tiếp trên một phạm vi rỗng.
 */
export async function canEditFormTextsForSeason(seasonId: string): Promise<boolean> {
  try {
    const ctx = await getAdminScopeContext();
    if (ctx.scopeError) return false;
    const admin = ctx.adminUser ?? (await getCurrentAdminUser());
    if (!admin?.id || admin.status !== "active" || !canEditApplicationFormTexts(admin.role)) return false;
    return await canOperateSeason(ctx, seasonId);
  } catch (error) {
    log("canEditFormTextsForSeason", error);
    return false;
  }
}

/**
 * Lưu các khối chữ của một nhóm.
 *
 * Kiểm quyền trước, kiểm nội dung sau. Chữ nào trùng mặc định thì xoá dòng đã sửa —
 * xem `planFormTextSave`.
 */
export async function saveApplicationFormTexts(input: {
  submitted: Record<string, unknown>;
  expected: Record<string, unknown>;
}): Promise<{ ok: boolean; message: string; changed: number }> {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập.", changed: 0 };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: GENERIC, changed: 0 };

  const lookup = await readApplicationFormTextOverrides(client);
  if (!lookup.ok) {
    return {
      ok: false,
      message: "Chưa đọc được bảng chữ của form. Migration application_form_texts có thể chưa được chạy.",
      changed: 0
    };
  }

  if (!(await canEditFormTextsForSeason(lookup.seasonId))) {
    return { ok: false, message: DENIED, changed: 0 };
  }

  const plan = planFormTextSave({
    submitted: input.submitted,
    expected: input.expected,
    overrides: overrideBodies(lookup.overrides)
  });
  if (!plan.ok) return { ok: false, message: plan.message, changed: 0 };

  const changedKeys = Object.keys(plan.after);
  if (changedKeys.length === 0) {
    return { ok: true, message: "Không có khối chữ nào thay đổi.", changed: 0 };
  }

  const now = new Date().toISOString();

  if (plan.upserts.length > 0) {
    const { error } = await client.from("application_form_texts").upsert(
      plan.upserts.map((entry) => ({
        intake_batch_id: lookup.intakeBatchId,
        text_key: entry.key,
        body: entry.body,
        updated_at: now,
        updated_by: admin.id
      })),
      { onConflict: "intake_batch_id,text_key" }
    );
    if (error) {
      log("upsert", error);
      return { ok: false, message: GENERIC, changed: 0 };
    }
  }

  let deleteFailed = false;
  if (plan.deletes.length > 0) {
    const { error } = await client
      .from("application_form_texts")
      .delete()
      .eq("intake_batch_id", lookup.intakeBatchId)
      .in("text_key", plan.deletes);
    if (error) {
      log("delete", error);
      deleteFailed = true;
    }
  }

  // Nhật ký chỉ ghi những gì thật sự đã vào database.
  const written = deleteFailed ? plan.upserts.map((entry) => entry.key) : changedKeys;
  if (written.length > 0) {
    const pick = (source: Record<string, string | undefined>) =>
      Object.fromEntries(written.map((key) => [key, source[key] ?? null]));
    await writeAdminAudit(client, {
      actionType: "update_application_form_text",
      beforeData: { intake_batch_code: S12_BINDING.intakeBatchCode, texts: pick(plan.before) },
      afterData: { intake_batch_code: S12_BINDING.intakeBatchCode, texts: pick(plan.after) }
    });
  }

  if (deleteFailed) {
    return {
      ok: false,
      message: "Đã lưu phần chữ vừa sửa, nhưng chưa trả được một số khối về chữ mặc định. Bấm lưu lại một lần nữa.",
      changed: written.length
    };
  }

  return {
    ok: true,
    message: `Đã lưu ${changedKeys.length} khối chữ. Form công khai hiện chữ mới ngay.`,
    changed: changedKeys.length
  };
}
