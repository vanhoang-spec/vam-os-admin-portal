import type { AdminRole } from "@/lib/auth-constants";

export const PROGRAM_ADMIN_ACCOUNT_MANAGEMENT_ENABLED = false;

export type AccountActor = { role: AdminRole; status: string; scopes: Array<{ programId: string; seasonId: string | null; level: string; status: string }> };
export type AccountTarget = { role: string; programId: string; seasonId: string };

export function authorizeAccountTarget(actor: AccountActor, target: AccountTarget, featureEnabled = PROGRAM_ADMIN_ACCOUNT_MANAGEMENT_ENABLED) {
  if (actor.status !== "active") return { allowed: false, reason: "actor_inactive" } as const;
  if (actor.role === "super_admin") return { allowed: true, reason: "super_admin" } as const;
  if (!featureEnabled) return { allowed: false, reason: "program_admin_feature_disabled" } as const;
  if (actor.role !== "admin") return { allowed: false, reason: "role_cannot_manage_accounts" } as const;
  if (target.role === "admin" || target.role === "super_admin") return { allowed: false, reason: "cannot_assign_admin_role" } as const;
  const scope = actor.scopes.find((item) => item.status === "active" && item.level === "full_access" && item.programId === target.programId && (!item.seasonId || item.seasonId === target.seasonId));
  return scope ? { allowed: true, reason: "program_scope_match" } as const : { allowed: false, reason: "target_outside_scope" } as const;
}

export function canTransitionAccountStatus(current: string, next: string) {
  const allowed: Record<string, string[]> = {
    invited: ["active", "suspended", "inactive"], active: ["suspended", "inactive"], suspended: ["active", "inactive"], inactive: ["invited", "active"]
  };
  return Boolean(allowed[current]?.includes(next));
}
