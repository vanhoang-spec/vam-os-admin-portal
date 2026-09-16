import "server-only";

import {
  bonusRuleFromRow,
  bonusTargetKey,
  resolveSubmissionBonus,
  sortBonusRules,
  type SubmissionBonus,
  type SubmissionBonusRule
} from "@/lib/submission-bonus-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/submission-bonus.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc mốc điểm cộng theo ngày nộp, và gắn điểm cộng vào đơn để hiển thị.
 *
 * Đọc hỏng thì trả `ok: false`, và mọi đơn nhận `{ kind: "unknown" }` — KHÔNG
 * phải "không được cộng". Màn hình xếp điểm mà lặng lẽ bỏ điểm cộng khi bảng chưa
 * đọc được thì trông y như đúng, và đó là lúc người ta ra quyết định.
 */

type Client = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

export type BonusRuleRecord = SubmissionBonusRule & {
  intakeBatchId: string;
  role: string;
  createdAt: string | null;
  createdByName: string | null;
};

export type BonusRulesLookup =
  | { ok: true; byTarget: Map<string, BonusRuleRecord[]> }
  | { ok: false };

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[submission-bonus]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

/** Mốc của các form nộp đơn thuộc những đợt tuyển này. */
export async function readApplicationBonusRules(
  intakeBatchIds: ReadonlyArray<string | null | undefined>,
  client: Client | null = getSupabaseServiceRoleClient()
): Promise<BonusRulesLookup> {
  const ids = Array.from(new Set(intakeBatchIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return { ok: true, byTarget: new Map() };
  if (!client) return { ok: false };

  try {
    const { data, error } = await client
      .from("submission_bonus_rules")
      .select("id, intake_batch_id, role_applied, label, starts_on, ends_on, points, created_at, admin_users(full_name)")
      .eq("form_kind", "application")
      .in("intake_batch_id", ids);
    if (error) {
      log("read", error);
      return { ok: false };
    }

    const byTarget = new Map<string, BonusRuleRecord[]>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const rule = bonusRuleFromRow(row);
      if (!rule) {
        log("malformed rule ignored", { id: row.id });
        continue;
      }
      const by = (Array.isArray(row.admin_users) ? row.admin_users[0] : row.admin_users) as
        | { full_name?: string | null }
        | null
        | undefined;
      const record: BonusRuleRecord = {
        ...rule,
        intakeBatchId: String(row.intake_batch_id ?? ""),
        role: String(row.role_applied ?? ""),
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
        createdByName: by?.full_name ?? null
      };
      const key = bonusTargetKey(record.intakeBatchId, record.role);
      byTarget.set(key, [...(byTarget.get(key) ?? []), record]);
    }
    for (const [key, rules] of Array.from(byTarget.entries())) {
      byTarget.set(key, sortBonusRules(rules) as BonusRuleRecord[]);
    }
    return { ok: true, byTarget };
  } catch (error) {
    log("read:crash", error);
    return { ok: false };
  }
}

/** Mốc của đúng một form. Null khi không đọc được. */
export function rulesForTarget(
  lookup: BonusRulesLookup,
  intakeBatchId: unknown,
  role: unknown
): BonusRuleRecord[] | null {
  if (!lookup.ok) return null;
  return lookup.byTarget.get(bonusTargetKey(intakeBatchId, role)) ?? [];
}

/** Điểm cộng của một đơn nộp đơn. */
export function bonusForApplication(
  lookup: BonusRulesLookup,
  application: { intake_batch_id?: unknown; role_applied?: unknown; created_at?: unknown }
): SubmissionBonus {
  return resolveSubmissionBonus(
    rulesForTarget(lookup, application.intake_batch_id, application.role_applied),
    application.created_at
  );
}
