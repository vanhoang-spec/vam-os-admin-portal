import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { getCurrentSupabaseAuthUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { matchPersonByEmail } from "@/lib/participant-auth-core";

/**
 * lib/participant-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Turning a Supabase login into a person in the programme's records.
 *
 * Two paths lead here. An organiser invites somebody, and the link between the
 * login and the person is written when the invitation is created. Or somebody
 * signs up on their own with the address the programme already holds for them,
 * and the link is written on first sight — but only when that address matches
 * exactly one person.
 *
 * THE READ IS SERVICE-ROLE, and it has to be. `participant_accounts` has RLS on
 * with no policies at all, so an anon-bearer read returns nothing rather than
 * failing loudly — the same trap that once silently demoted real admins to
 * viewers (see the note in lib/admin-auth.ts).
 *
 * NOTHING IS GUESSED. An address matching two people is refused, not resolved
 * to the first row. The whole point of an identity layer is that being wrong
 * about it means showing one person another person's records.
 */

const SAFE_ERROR = "Không thể xác định tài khoản. Vui lòng thử lại hoặc liên hệ ban tổ chức.";

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[participant-auth]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type ParticipantAccount = {
  id: string;
  authUserId: string;
  personId: string;
  status: "active" | "disabled";
  linkSource: string;
  fullName: string | null;
  email: string | null;
};

export type ParticipantResolution =
  | { state: "participant"; account: ParticipantAccount }
  | { state: "none" }
  | { state: "disabled" }
  | { state: "unmatched"; message: string }
  | { state: "ambiguous"; message: string }
  | { state: "error"; message: string };

// ── Resolving the current visitor ────────────────────────────────────────────

/**
 * The participant behind the current session, if there is one.
 *
 * Cached per request: the layout, the middleware-adjacent page guards and the
 * page body all ask the same question, and asking the database three times for
 * one answer is waste, not safety.
 */
export const getCurrentParticipant = cache(async (): Promise<ParticipantResolution> => {
  const user = await getCurrentSupabaseAuthUser();
  if (!user?.id) return { state: "none" };
  return resolveParticipantForAuthUser(user);
});

/**
 * The same resolution, for a user we already hold.
 *
 * The login action needs this BEFORE it sets any cookie — at that moment there
 * is a signed-in Supabase user but no session for `getCurrentParticipant` to
 * read. Splitting it here keeps one implementation rather than two that drift.
 */
export async function resolveParticipantForAuthUser(user: User): Promise<ParticipantResolution> {
  if (!user?.id) return { state: "none" };

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    log("service-role client unavailable", new Error("missing SUPABASE_SERVICE_ROLE_KEY"));
    return { state: "error", message: SAFE_ERROR };
  }

  const linked = await readAccountByAuthUser(client, user.id);
  if (linked.state !== "none") return linked;

  // No link yet: this is either a first sign-in after an invitation, or somebody
  // registering themselves. Both resolve the same way — by address.
  return linkByEmail(client, user);
}

async function readAccountByAuthUser(
  client: ServiceClient,
  authUserId: string
): Promise<ParticipantResolution> {
  const { data, error } = await client
    .from("participant_accounts")
    .select("id,auth_user_id,person_id,status,link_source")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    log("read account", error);
    return { state: "error", message: SAFE_ERROR };
  }
  if (!data) return { state: "none" };

  const row = data as {
    id: string;
    auth_user_id: string;
    person_id: string;
    status: string;
    link_source: string;
  };

  // Disabled is a decision somebody made; it is not the same as not existing,
  // and the message the visitor sees should differ accordingly.
  if (row.status !== "active") return { state: "disabled" };

  const person = await readPerson(client, row.person_id);

  return {
    state: "participant",
    account: {
      id: row.id,
      authUserId: row.auth_user_id,
      personId: row.person_id,
      status: "active",
      linkSource: row.link_source,
      fullName: person?.full_name ?? null,
      email: person?.email_primary ?? null
    }
  };
}

async function readPerson(client: ServiceClient, personId: string) {
  const { data, error } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .eq("id", personId)
    .maybeSingle();

  if (error) {
    log("read person (non-fatal)", error);
    return null;
  }
  return data as { full_name: string | null; email_primary: string | null } | null;
}

/**
 * Link a login to a person by address, on first sign-in.
 *
 * `people.email_primary` is `citext` and globally unique in the schema, so a
 * second match means the data is wrong rather than the visitor being wrong.
 * That is worth stopping for.
 */
async function linkByEmail(client: ServiceClient, user: User): Promise<ParticipantResolution> {
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) return { state: "none" };

  const { data, error } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .ilike("email_primary", email)
    .limit(5);

  if (error) {
    log("lookup person by email", error);
    return { state: "error", message: SAFE_ERROR };
  }

  const candidates = (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email_primary: string | null;
  }>;

  // `ilike` treats `_` as a wildcard, so re-check exactly — the same correction
  // lib/mentor-selection.ts makes for the same reason.
  const match = matchPersonByEmail(email, candidates);

  if (!match.ok) {
    if (match.reason === "ambiguous") return { state: "ambiguous", message: match.message };
    return { state: "unmatched", message: match.message };
  }

  const person = candidates.find((row) => row.id === match.personId) ?? null;

  const { data: inserted, error: insertErr } = await client
    .from("participant_accounts")
    .insert({
      auth_user_id: user.id,
      person_id: match.personId,
      status: "active",
      link_source: "self_register",
      activated_at: new Date().toISOString()
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    // A person already linked to a different login, or two tabs racing. Either
    // way the safe answer is to refuse rather than to overwrite an identity.
    log("link account", insertErr);
    return {
      state: "unmatched",
      message:
        "Không liên kết được tài khoản với hồ sơ của bạn. Vui lòng liên hệ ban tổ chức."
    };
  }

  return {
    state: "participant",
    account: {
      id: (inserted as { id: string } | null)?.id ?? "",
      authUserId: user.id,
      personId: match.personId,
      status: "active",
      linkSource: "self_register",
      fullName: person?.full_name ?? null,
      email: person?.email_primary ?? email
    }
  };
}

// ── Inviting ─────────────────────────────────────────────────────────────────

export type MutationResult = { ok: boolean; message: string };

/**
 * Pre-link a person so their first sign-in lands on the right records.
 *
 * Written when an organiser invites somebody. The auth user may not exist yet,
 * which is why `auth_user_id` is filled in later by the sign-in path above
 * rather than being required here — the row is created only once the invitation
 * has produced an account.
 */
export async function linkParticipantAccount(input: {
  authUserId: string;
  personId: string;
  createdBy?: string | null;
  linkSource?: "invite" | "admin";
}): Promise<MutationResult> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client.from("participant_accounts").insert({
    auth_user_id: input.authUserId,
    person_id: input.personId,
    status: "active",
    link_source: input.linkSource ?? "invite",
    invited_at: new Date().toISOString(),
    created_by: input.createdBy ?? null
  });

  if (error) {
    log("insert invited account", error);
    return {
      ok: false,
      message: "Không tạo được liên kết tài khoản. Có thể người này đã có tài khoản rồi."
    };
  }

  return { ok: true, message: "Đã liên kết tài khoản với hồ sơ." };
}

/** Turn a participant's access on or off without breaking the link to their records. */
export async function setParticipantAccountStatus(input: {
  accountId: string;
  status: "active" | "disabled";
}): Promise<MutationResult> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client
    .from("participant_accounts")
    .update({ status: input.status })
    .eq("id", input.accountId);

  if (error) {
    log("set account status", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    message: input.status === "active" ? "Đã mở lại tài khoản." : "Đã khoá tài khoản."
  };
}
