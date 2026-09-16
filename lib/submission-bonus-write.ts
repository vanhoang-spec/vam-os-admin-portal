import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { isApplicantRole, readApplicationFormControls, S12_BINDING } from "@/lib/application-form-controls";
import { writeAdminAudit } from "@/lib/events";
import { canManageSubmissionBonus } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { readApplicationBonusRules, rulesForTarget, type BonusRuleRecord } from "@/lib/submission-bonus";
import { BONUS_RULES_MAX, describeBonusWindow, parseBonusRuleInput } from "@/lib/submission-bonus-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/submission-bonus-write.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Ai được đặt mốc điểm cộng theo ngày nộp, và đường ghi của việc đó.
 *
 * Chỉ có thêm và xoá, không có sửa: sửa một mốc là xoá rồi thêm. Mỗi lệnh ghi chạm
 * đúng một dòng, nên không có bản cũ nào bị đè bởi một màn hình đã mở từ trước.
 */

type Result = { ok: boolean; message: string };

const DENIED = "Bạn không có quyền đặt điểm cộng cho form của mùa này.";
const GENERIC = "Không lưu được mốc điểm cộng. Thử lại.";
const ROLE_LABEL = { mentor: "mentor", mentee: "mentee" } as const;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[submission-bonus-write]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

/**
 * Hai điều kiện, cả hai phải qua: vai trò được đặt điểm cộng (super_admin, admin,
 * core_team, support_team — `canManageSubmissionBonus`), và quyền vận hành đúng
 * mùa của đợt tuyển.
 *
 * Fail-closed: bảng phạm vi đọc hỏng trông y như một người không được cấp gì, nên
 * `scopeError` là từ chối, không phải đánh giá tiếp trên một phạm vi rỗng.
 */
export async function canManageBonusForSeason(seasonId: string): Promise<boolean> {
  try {
    const ctx = await getAdminScopeContext();
    if (ctx.scopeError) return false;
    const admin = ctx.adminUser ?? (await getCurrentAdminUser());
    if (!admin?.id || admin.status !== "active" || !canManageSubmissionBonus(admin.role)) return false;
    return await canOperateSeason(ctx, seasonId);
  } catch (error) {
    log("canManageBonusForSeason", error);
    return false;
  }
}

/**
 * Đợt tuyển mà form đang nhận đơn. Lấy qua đúng bản ghi điều khiển form công khai
 * dùng, không tự tra lại theo mã: mốc điểm cộng phải gắn vào chính form người ta
 * đang nộp, không phải một đợt tuyển trùng tên.
 */
async function currentApplicationForm(): Promise<{ ok: true; seasonId: string; intakeBatchId: string } | { ok: false }> {
  const lookup = await readApplicationFormControls();
  if (!lookup.ok) {
    log("form controls unreadable", lookup.reason);
    return { ok: false };
  }
  return { ok: true, seasonId: lookup.controls.mentee.seasonId, intakeBatchId: lookup.controls.mentee.intakeBatchId };
}

function auditRules(rules: readonly BonusRuleRecord[]) {
  return rules.map((rule) => ({
    id: rule.id,
    label: rule.label,
    starts_on: rule.startsOn,
    ends_on: rule.endsOn,
    points: rule.points
  }));
}

type Prepared =
  | { ok: false; message: string }
  | {
      ok: true;
      adminId: string;
      role: "mentor" | "mentee";
      intakeBatchId: string;
      client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;
      rules: BonusRuleRecord[];
    };

/** Kiểm quyền trước, đọc mốc hiện có sau. Chưa qua bước nào thì chưa có lệnh ghi nào. */
async function prepare(roleInput: unknown): Promise<Prepared> {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!isApplicantRole(roleInput)) return { ok: false, message: "Form không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: GENERIC };

  const form = await currentApplicationForm();
  if (!form.ok) return { ok: false, message: "Chưa đọc được form đăng ký của mùa này." };

  if (!(await canManageBonusForSeason(form.seasonId))) return { ok: false, message: DENIED };

  const lookup = await readApplicationBonusRules([form.intakeBatchId], client);
  const rules = rulesForTarget(lookup, form.intakeBatchId, roleInput);
  if (!rules) {
    return {
      ok: false,
      message: "Chưa đọc được bảng điểm cộng. Migration submission_bonus_rules có thể chưa được chạy."
    };
  }

  return { ok: true, adminId: admin.id, role: roleInput, intakeBatchId: form.intakeBatchId, client, rules };
}

export async function addApplicationBonusRule(input: {
  role: unknown;
  label: unknown;
  startsOn: unknown;
  endsOn: unknown;
  points: unknown;
}): Promise<Result> {
  const ready = await prepare(input.role);
  if (!ready.ok) return ready;

  const parsed = parseBonusRuleInput(input);
  if (!parsed.ok) return parsed;

  if (ready.rules.length >= BONUS_RULES_MAX) {
    return { ok: false, message: `Form này đã có ${BONUS_RULES_MAX} mốc. Xoá bớt mốc cũ trước khi thêm.` };
  }

  const { data, error } = await ready.client
    .from("submission_bonus_rules")
    .insert({
      form_kind: "application",
      intake_batch_id: ready.intakeBatchId,
      role_applied: ready.role,
      label: parsed.value.label,
      starts_on: parsed.value.startsOn,
      ends_on: parsed.value.endsOn,
      points: parsed.value.points,
      created_by: ready.adminId
    })
    .select("id")
    .maybeSingle();
  if (error) {
    log("insert", error);
    return { ok: false, message: GENERIC };
  }

  const added = {
    id: String((data as { id?: string } | null)?.id ?? ""),
    label: parsed.value.label,
    starts_on: parsed.value.startsOn,
    ends_on: parsed.value.endsOn,
    points: parsed.value.points
  };
  await writeAdminAudit(ready.client, {
    actionType: "update_submission_bonus_rules",
    beforeData: { intake_batch_code: S12_BINDING.intakeBatchCode, role: ready.role, rules: auditRules(ready.rules) },
    afterData: {
      intake_batch_code: S12_BINDING.intakeBatchCode,
      role: ready.role,
      added,
      rules: [...auditRules(ready.rules), added]
    }
  });

  return {
    ok: true,
    message: `Đã thêm mốc cho form ${ROLE_LABEL[ready.role]}: ${describeBonusWindow(parsed.value)} → +${parsed.value.points} điểm. Điểm cộng hiện ngay trên các màn hình chấm.`
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deleteApplicationBonusRule(input: { role: unknown; ruleId: unknown }): Promise<Result> {
  const ready = await prepare(input.role);
  if (!ready.ok) return ready;

  const ruleId = String(input.ruleId ?? "").trim();
  const target = UUID.test(ruleId) ? ready.rules.find((rule) => rule.id === ruleId) : undefined;
  // Id đến từ form là thứ người gửi tự đặt được. Chỉ xoá mốc ĐANG thuộc đúng form
  // này — một id của form khác, hay của một mốc vừa bị người khác xoá, không đi tiếp.
  if (!target) return { ok: false, message: "Mốc này không còn nữa. Tải lại trang để xem danh sách mới." };

  const { error } = await ready.client
    .from("submission_bonus_rules")
    .delete()
    .eq("id", target.id)
    .eq("form_kind", "application")
    .eq("intake_batch_id", ready.intakeBatchId)
    .eq("role_applied", ready.role);
  if (error) {
    log("delete", error);
    return { ok: false, message: "Không xoá được mốc điểm cộng. Thử lại." };
  }

  const remaining = ready.rules.filter((rule) => rule.id !== target.id);
  await writeAdminAudit(ready.client, {
    actionType: "update_submission_bonus_rules",
    beforeData: { intake_batch_code: S12_BINDING.intakeBatchCode, role: ready.role, rules: auditRules(ready.rules) },
    afterData: {
      intake_batch_code: S12_BINDING.intakeBatchCode,
      role: ready.role,
      removed: auditRules([target])[0],
      rules: auditRules(remaining)
    }
  });

  return {
    ok: true,
    message: `Đã xoá mốc ${describeBonusWindow(target)} (+${target.points}). Các đơn trong mốc này không còn được cộng.`
  };
}
