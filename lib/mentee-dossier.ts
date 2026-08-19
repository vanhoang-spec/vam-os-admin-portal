import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageMatches } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { resolveEmailBaseUrl } from "@/lib/email";

/**
 * lib/mentee-dossier.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A mentor's access to the application of the mentee they were given.
 *
 * The mentor needs to read it — that is the point of being matched — but a
 * student's answers, phone number and student id do not belong in an email
 * body: a mailbox keeps them forever, forwards them in one click, and cannot be
 * corrected. So the email carries a link instead, and the link:
 *
 *   * belongs to one mentor and one application, and to nothing else;
 *   * stops working on a date the organisers choose;
 *   * can be revoked the moment a pair changes;
 *   * counts every time it is opened, so "who has seen this" has an answer.
 *
 * The page it leads to needs no login, because most mentors do not have one.
 */

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How long a mentor can reach the dossier before the link has to be reissued. */
export const DEFAULT_DOSSIER_TTL_DAYS = 120;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[mentee-dossier]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

export type DossierLinkRow = {
  id: string;
  token: string;
  season_id: string;
  match_id: string | null;
  mentor_person_id: string;
  mentee_application_id: string;
  expires_at: string;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
};

export function buildDossierUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/mentee-dossier/${token}`;
}

// ── Creating the links ───────────────────────────────────────────────────────

export type EnsureDossierResult = {
  ok: boolean;
  message: string;
  created: number;
  existing: number;
  /** Matches whose mentee has no application row to show. */
  skipped: number;
};

/**
 * Make sure every active pair in the season has a link.
 *
 * Idempotent by construction: the table holds one row per (mentor, application)
 * pair, so running this again after a few more matches only adds the new ones.
 */
export async function ensureDossierLinks(input: {
  seasonId: string;
  ttlDays?: number;
}): Promise<EnsureDossierResult> {
  const seasonId = String(input.seasonId ?? "").trim();
  if (!isValidUuid(seasonId)) {
    return { ok: false, message: "Mùa không hợp lệ.", created: 0, existing: 0, skipped: 0 };
  }

  const admin = await getCurrentAdminUser();
  if (!admin?.id) {
    return { ok: false, message: "Bạn chưa đăng nhập.", created: 0, existing: 0, skipped: 0 };
  }
  if (!canManageMatches(admin.role)) {
    return {
      ok: false,
      message: "Bạn không có quyền tạo đường dẫn hồ sơ.",
      created: 0,
      existing: 0,
      skipped: 0
    };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, seasonId))) {
    return {
      ok: false,
      message: "Bạn không có quyền vận hành mùa này.",
      created: 0,
      existing: 0,
      skipped: 0
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR, created: 0, existing: 0, skipped: 0 };

  const { data: matchRows, error: matchErr } = await client
    .from("matches")
    .select("id,mentor_person_id,mentee_person_id,mentee_profile_id")
    .eq("season_id", seasonId)
    .eq("status", "active");

  if (matchErr) {
    log("load matches", matchErr);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: 0, skipped: 0 };
  }

  const matches = ((matchRows ?? []) as Array<{
    id: string;
    mentor_person_id: string | null;
    mentee_person_id: string | null;
    mentee_profile_id: string | null;
  }>).filter((row) => row.mentor_person_id && row.mentee_person_id);

  if (!matches.length) {
    return {
      ok: true,
      message: "Mùa này chưa có cặp ghép nào đang hoạt động.",
      created: 0,
      existing: 0,
      skipped: 0
    };
  }

  const applicationByPerson = await resolveMenteeApplications(client, {
    seasonId,
    personIds: matches.map((row) => row.mentee_person_id as string)
  });

  const { data: existingRows } = await client
    .from("mentee_dossier_links")
    .select("mentor_person_id,mentee_application_id")
    .eq("season_id", seasonId);

  const have = new Set(
    ((existingRows ?? []) as Array<{ mentor_person_id: string; mentee_application_id: string }>).map(
      (row) => `${row.mentor_person_id}:${row.mentee_application_id}`
    )
  );

  const ttlDays = Math.min(365, Math.max(1, Math.floor(Number(input.ttlDays) || DEFAULT_DOSSIER_TTL_DAYS)));
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const rows: Array<Record<string, unknown>> = [];
  let skipped = 0;

  for (const match of matches) {
    const applicationId = applicationByPerson.get(match.mentee_person_id as string);
    if (!applicationId) {
      // A mentee imported from a previous season has no application to show.
      skipped++;
      continue;
    }
    const key = `${match.mentor_person_id}:${applicationId}`;
    if (have.has(key)) continue;
    have.add(key);
    rows.push({
      season_id: seasonId,
      match_id: match.id,
      mentor_person_id: match.mentor_person_id,
      mentee_application_id: applicationId,
      expires_at: expiresAt,
      created_by: admin.id
    });
  }

  if (!rows.length) {
    return {
      ok: true,
      message: `Tất cả cặp ghép đã có đường dẫn.${skipped ? ` ${skipped} cặp chưa có hồ sơ để xem.` : ""}`,
      created: 0,
      existing: have.size,
      skipped
    };
  }

  const { error: insertErr } = await client.from("mentee_dossier_links").insert(rows);
  if (insertErr) {
    log("create dossier links", insertErr);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: have.size, skipped };
  }

  return {
    ok: true,
    message: `Đã tạo ${rows.length} đường dẫn hồ sơ, hiệu lực ${ttlDays} ngày.`,
    created: rows.length,
    existing: have.size - rows.length,
    skipped
  };
}

/** Which application does each matched mentee come from? */
async function resolveMenteeApplications(
  client: ServiceClient,
  input: { seasonId: string; personIds: string[] }
): Promise<Map<string, string>> {
  const byPerson = new Map<string, string>();
  const personIds = Array.from(new Set(input.personIds.filter(Boolean)));
  if (!personIds.length) return byPerson;

  const { data, error } = await client
    .from("applications")
    .select("id,person_id,submitted_at")
    .eq("season_id", input.seasonId)
    .eq("role_applied", "mentee")
    .in("person_id", personIds)
    .order("submitted_at", { ascending: false });

  if (error) {
    log("resolve mentee applications", error);
    return byPerson;
  }

  for (const row of (data ?? []) as Array<{ id: string; person_id: string | null }>) {
    if (!row.person_id || byPerson.has(row.person_id)) continue;
    byPerson.set(row.person_id, row.id);
  }
  return byPerson;
}

/** Links a mentor should receive, with the URL to put in their email. */
export async function getDossierLinksForMentor(input: {
  seasonId: string;
  mentorPersonId: string;
  requestOrigin?: string | null;
}): Promise<Array<{ url: string; applicationId: string }>> {
  if (!isValidUuid(input.seasonId) || !isValidUuid(input.mentorPersonId)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const base = resolveEmailBaseUrl(input.requestOrigin ?? null);
  if (!base) return [];

  const { data, error } = await client
    .from("mentee_dossier_links")
    .select("token,mentee_application_id,expires_at,revoked_at")
    .eq("season_id", input.seasonId)
    .eq("mentor_person_id", input.mentorPersonId)
    .is("revoked_at", null);

  if (error) {
    log("links for mentor", error);
    return [];
  }

  const now = Date.now();
  return ((data ?? []) as Array<{
    token: string;
    mentee_application_id: string;
    expires_at: string;
  }>)
    .filter((row) => new Date(row.expires_at).getTime() > now)
    .map((row) => ({
      url: buildDossierUrl(base, row.token),
      applicationId: row.mentee_application_id
    }));
}

export async function revokeDossierLink(input: { linkId?: unknown }): Promise<MutationResult> {
  const linkId = String(input.linkId ?? "").trim();
  if (!isValidUuid(linkId)) return { ok: false, message: "Đường dẫn không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: linkRow, error: loadErr } = await client
    .from("mentee_dossier_links")
    .select("id,season_id,revoked_at")
    .eq("id", linkId)
    .maybeSingle();

  if (loadErr) {
    log("load link for revoke", loadErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const link = linkRow as { season_id: string; revoked_at: string | null } | null;
  if (!link) return { ok: false, message: "Không tìm thấy đường dẫn." };

  const admin = await getCurrentAdminUser();
  if (!canManageMatches(admin?.role)) {
    return { ok: false, message: "Bạn không có quyền thu hồi đường dẫn." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, link.season_id))) {
    return { ok: false, message: "Bạn không có quyền vận hành mùa này." };
  }

  if (link.revoked_at) return { ok: true, message: "Đường dẫn đã được thu hồi trước đó." };

  const { error } = await client
    .from("mentee_dossier_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("revoked_at", null);

  if (error) {
    log("revoke link", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: "Đã thu hồi đường dẫn. Mentor sẽ không mở được nữa." };
}

// ── The public read ──────────────────────────────────────────────────────────

export type DossierApplicationView = {
  id: string;
  full_name: string | null;
  email_primary: string | null;
  phone_primary: string | null;
  gender: string | null;
  status: string | null;
  submitted_at: string | null;
  answers: Array<[string, string]>;
};

export type DossierView =
  | {
      state: "ready";
      mentorName: string | null;
      seasonLabel: string | null;
      expiresAt: string;
      application: DossierApplicationView;
    }
  | { state: "not_found" }
  | { state: "expired"; expiresAt: string }
  | { state: "revoked" };

/**
 * Resolve a link and return the dossier.
 *
 * Opening the page bumps the counter — the only write on this path, and the
 * reason "who opened this, and when" can be answered later.
 */
export async function getDossierByToken(token: string): Promise<DossierView> {
  if (!isValidUuid(token)) return { state: "not_found" };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { state: "not_found" };

  const { data: linkRow, error: linkErr } = await client
    .from("mentee_dossier_links")
    .select("id,season_id,mentor_person_id,mentee_application_id,expires_at,revoked_at,view_count")
    .eq("token", token.trim())
    .maybeSingle();

  if (linkErr) {
    log("resolve token", linkErr);
    return { state: "not_found" };
  }

  const link = linkRow as {
    id: string;
    season_id: string;
    mentor_person_id: string;
    mentee_application_id: string;
    expires_at: string;
    revoked_at: string | null;
    view_count: number;
  } | null;

  if (!link) return { state: "not_found" };
  if (link.revoked_at) return { state: "revoked" };
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return { state: "expired", expiresAt: link.expires_at };
  }

  const [applicationRes, mentorRes, seasonRes] = await Promise.all([
    client
      .from("applications")
      .select("id,full_name,email_primary,phone_primary,gender,status,submitted_at,raw_payload")
      .eq("id", link.mentee_application_id)
      .maybeSingle(),
    client.from("people").select("full_name").eq("id", link.mentor_person_id).maybeSingle(),
    client.from("seasons").select("code,name").eq("id", link.season_id).maybeSingle()
  ]);

  const application = applicationRes.data as
    | {
        id: string;
        full_name: string | null;
        email_primary: string | null;
        phone_primary: string | null;
        gender: string | null;
        status: string | null;
        submitted_at: string | null;
        raw_payload: Record<string, unknown> | null;
      }
    | null;

  if (!application) return { state: "not_found" };

  const answers: Array<[string, string]> = Object.entries(application.raw_payload ?? {})
    .filter(([key, value]) => {
      if (value === null || value === undefined || value === "") return false;
      // The honeypot and the submission plumbing are not part of the dossier.
      return !["website", "apply_token", "consent_data_storage"].includes(key);
    })
    .map(([key, value]): [string, string] => [
      key,
      Array.isArray(value) ? value.map((item) => String(item)).join(", ") : String(value)
    ]);

  // Non-fatal: the dossier is worth showing even if the counter fails.
  const { error: touchErr } = await client
    .from("mentee_dossier_links")
    .update({ view_count: (link.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq("id", link.id);
  if (touchErr) log("record view (non-fatal)", touchErr);

  const season = seasonRes.data as { code: string | null; name: string | null } | null;

  return {
    state: "ready",
    mentorName: (mentorRes.data as { full_name: string | null } | null)?.full_name ?? null,
    seasonLabel: season?.code ?? season?.name ?? null,
    expiresAt: link.expires_at,
    application: {
      id: application.id,
      full_name: application.full_name,
      email_primary: application.email_primary,
      phone_primary: application.phone_primary,
      gender: application.gender,
      status: application.status,
      submitted_at: application.submitted_at,
      answers
    }
  };
}
