import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { sendParticipantInvite } from "@/lib/email";
import { isValidEmail, normalizeEmail } from "@/lib/identity";

/**
 * lib/participant-invites.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Giving a mentor or a mentee the account that has been waiting for them.
 *
 * Roughly 450 mentors and 656 mentees need one, and the provider allows 300
 * letters a day, so this runs in batches and is expected to take several days.
 * That is the reason for `MAX_PER_BATCH` and for the summary this returns:
 * somebody has to be able to pick up where they left off tomorrow.
 *
 * THE LINK COMES FROM SUPABASE, THE LETTER FROM US. `generateLink` produces the
 * invitation without sending it, and the app's own provider carries it — the
 * same split lib/enable-reviewer.ts already uses, because Supabase's built-in
 * mail is rate-limited far below what a season needs.
 *
 * NOBODY IS INVITED TWICE. A person who already has an account is skipped and
 * counted, not re-sent. A thousand people receiving a second "set your password"
 * letter is the kind of mistake that generates a thousand replies.
 */

const SAFE_ERROR = "Không gửi được thư mời. Vui lòng thử lại hoặc liên hệ admin.";

/** One batch. Below the provider's daily ceiling, so one run cannot exhaust it. */
export const MAX_INVITES_PER_BATCH = 100;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[participant-invites]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type InviteSummary = {
  ok: boolean;
  message: string;
  invited: number;
  alreadyHadAccount: number;
  noEmail: number;
  failed: number;
};

function emptySummary(ok: boolean, message: string): InviteSummary {
  return { ok, message, invited: 0, alreadyHadAccount: 0, noEmail: 0, failed: 0 };
}

/**
 * Invite a batch of people.
 *
 * Every outcome is counted rather than thrown, because a batch of a hundred
 * will always contain somebody with no address on file, and stopping the run for
 * them would mean the other ninety-nine never hear from us.
 */
export async function inviteParticipants(input: {
  personIds?: unknown;
}): Promise<InviteSummary> {
  const personIds = toIdList(input.personIds);
  if (!personIds.length) return emptySummary(false, "Chưa chọn người nào để mời.");
  if (personIds.length > MAX_INVITES_PER_BATCH) {
    return emptySummary(
      false,
      `Mỗi lượt mời tối đa ${MAX_INVITES_PER_BATCH} người. Vui lòng chọn ít hơn.`
    );
  }

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return emptySummary(false, "Bạn chưa đăng nhập.");
  if (admin.role !== "super_admin") {
    return emptySummary(false, "Chỉ super admin mới gửi được thư mời tài khoản.");
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return emptySummary(false, SAFE_ERROR);

  const people = await readPeople(client, personIds);
  const alreadyLinked = await readLinkedPersonIds(client, personIds);
  const programsByPerson = await readProgramNames(client, personIds);

  const summary: InviteSummary = {
    ok: true,
    message: "",
    invited: 0,
    alreadyHadAccount: 0,
    noEmail: 0,
    failed: 0
  };

  for (const person of people) {
    if (alreadyLinked.has(person.id)) {
      summary.alreadyHadAccount++;
      continue;
    }

    const email = normalizeEmail(person.email_primary);
    if (!isValidEmail(email)) {
      summary.noEmail++;
      continue;
    }

    const invite = await createInvite(client, email);
    if (!invite.ok) {
      summary.failed++;
      continue;
    }

    // Record the link first. If the letter fails to send, the person still has
    // an account waiting and a re-send costs nothing; the reverse — a letter
    // pointing at an account nothing knows about — is unrecoverable.
    const { error: linkErr } = await client.from("participant_accounts").insert({
      auth_user_id: invite.authUserId,
      person_id: person.id,
      status: "active",
      link_source: "invite",
      invited_at: new Date().toISOString(),
      created_by: admin.id
    });

    if (linkErr) {
      log("link invited account", linkErr);
      summary.failed++;
      continue;
    }

    if (!invite.inviteUrl) {
      // The account exists but Supabase returned no link — a re-send from this
      // screen will produce one.
      summary.failed++;
      continue;
    }

    try {
      const sent = await sendParticipantInvite({
        toEmail: email,
        recipientName: person.full_name ?? "",
        inviteUrl: invite.inviteUrl,
        programNames: programsByPerson.get(person.id) ?? [],
        personId: person.id
      });
      if (sent.ok) summary.invited++;
      else if (sent.skipped) summary.invited++;
      else summary.failed++;
    } catch (err) {
      log("send invite (non-fatal)", err);
      summary.failed++;
    }
  }

  const parts = [`Đã mời ${summary.invited} người`];
  if (summary.alreadyHadAccount) parts.push(`${summary.alreadyHadAccount} người đã có tài khoản`);
  if (summary.noEmail) parts.push(`${summary.noEmail} người chưa có email trong hồ sơ`);
  if (summary.failed) parts.push(`${summary.failed} người chưa gửi được`);

  summary.message = `${parts.join(", ")}.`;
  summary.ok = summary.invited > 0;
  return summary;
}

// ── Supabase Auth ────────────────────────────────────────────────────────────

async function createInvite(
  client: ServiceClient,
  email: string
): Promise<{ ok: boolean; authUserId: string; inviteUrl: string | null }> {
  try {
    const existing = await findAuthUserByEmail(client, email);
    if (existing?.id) {
      // The auth user already exists — a staff account, or an earlier partial
      // run. Generate a fresh link for it rather than creating a second user.
      const { data, error } = await (client as any).auth.admin.generateLink({
        type: "recovery",
        email
      });
      if (error) {
        log("generate recovery link", error);
        return { ok: false, authUserId: "", inviteUrl: null };
      }
      return {
        ok: true,
        authUserId: existing.id,
        inviteUrl: String(data?.properties?.action_link ?? "") || null
      };
    }

    const { data, error } = await (client as any).auth.admin.generateLink({
      type: "invite",
      email
    });

    if (error || !data?.user?.id) {
      log("generate invite link", error);
      return { ok: false, authUserId: "", inviteUrl: null };
    }

    return {
      ok: true,
      authUserId: String(data.user.id),
      inviteUrl: String(data?.properties?.action_link ?? "") || null
    };
  } catch (err) {
    log("auth invite", err);
    return { ok: false, authUserId: "", inviteUrl: null };
  }
}

async function findAuthUserByEmail(client: ServiceClient, email: string) {
  try {
    const { data, error } = await (client as any).auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return null;
    const users = (data?.users ?? []) as Array<{ id: string; email?: string | null }>;
    return users.find((user) => normalizeEmail(user.email) === email) ?? null;
  } catch {
    return null;
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

async function readPeople(client: ServiceClient, personIds: string[]) {
  const { data, error } = await client
    .from("people")
    .select("id,full_name,email_primary")
    .in("id", personIds);

  if (error) {
    log("read people", error);
    return [];
  }

  return (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email_primary: string | null;
  }>;
}

async function readLinkedPersonIds(client: ServiceClient, personIds: string[]) {
  const linked = new Set<string>();

  const { data, error } = await client
    .from("participant_accounts")
    .select("person_id")
    .in("person_id", personIds);

  if (error) {
    // Fail closed: without this list we cannot tell who already has an account,
    // and inviting somebody twice is worse than inviting nobody this run.
    log("read linked accounts", error);
    for (const id of personIds) linked.add(id);
    return linked;
  }

  for (const row of (data ?? []) as Array<{ person_id: string }>) linked.add(row.person_id);
  return linked;
}

async function readProgramNames(client: ServiceClient, personIds: string[]) {
  const byPerson = new Map<string, string[]>();

  const { data, error } = await client
    .from("person_program_memberships")
    .select("person_id,program_id")
    .in("person_id", personIds)
    .eq("status", "active");

  if (error) {
    log("read memberships for invite (non-fatal)", error);
    return byPerson;
  }

  const rows = (data ?? []) as Array<{ person_id: string; program_id: string }>;
  if (!rows.length) return byPerson;

  const { data: programRows } = await client
    .from("programs")
    .select("id,name")
    .in("id", Array.from(new Set(rows.map((row) => row.program_id))));

  const nameById = new Map<string, string>();
  for (const row of (programRows ?? []) as Array<{ id: string; name: string }>) {
    nameById.set(row.id, row.name);
  }

  for (const row of rows) {
    const name = nameById.get(row.program_id);
    if (!name) continue;
    const list = byPerson.get(row.person_id) ?? [];
    list.push(name);
    byPerson.set(row.person_id, list);
  }

  return byPerson;
}

function toIdList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  return Array.from(
    new Set(raw.map((item) => String(item ?? "").trim()).filter((item) => isValidUuid(item)))
  );
}
