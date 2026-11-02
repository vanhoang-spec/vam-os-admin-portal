import "server-only";

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { memberCodeErrorMessage, type MemberCodeGroup } from "@/lib/member-code-core";

type Result = { ok: true; code: string } | { ok: false; message: string };

function toResult({ data, error }: { data: unknown; error: { message?: string } | null }): Result {
  if (error || typeof data !== "string") return { ok: false, message: memberCodeErrorMessage(error?.message) };
  return { ok: true, code: data };
}

export async function assignMemberCode(personId: string, group: MemberCodeGroup, actorAdminUserId: string): Promise<Result> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: memberCodeErrorMessage(null) };
  return toResult(await client.rpc("vam124_assign_member_code", { p_person_id: personId, p_group: group, p_source: "admin_assign", p_actor_admin_user_id: actorAdminUserId }));
}

export async function setMemberCode(personId: string, code: string, actorAdminUserId: string): Promise<Result> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: memberCodeErrorMessage(null) };
  return toResult(await client.rpc("vam124_set_member_code", { p_person_id: personId, p_code: code, p_actor_admin_user_id: actorAdminUserId }));
}
