import "server-only";

import { readAllPages } from "@/lib/paged-read";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh, type RenewalProfileDiffEntry } from "@/lib/renewal-profile-safety";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;

/**
 * Why a mentor can or cannot be given a renewal link right now.
 *
 * `has_live_invite` and `renewal_accepted` were previously expressed by simply
 * OMITTING the mentor from the picker. They are surfaced instead so the batch
 * UI can show "Đã có link" rather than leaving an operator to wonder why a
 * mentor they expect is missing — while remaining unselectable, so the
 * eligibility RULE is unchanged.
 */
export type RenewalMentorStatus =
  | "eligible"
  | "has_live_invite"
  | "renewal_accepted"
  | "renewal_declined";

export type RenewalMentorOption = {
  personId: string;
  /** Pre-composed "Name · CODE · email", kept for the single-invite <select>. */
  label: string;
  fullName: string;
  mentorCode: string | null;
  email: string | null;
  status: RenewalMentorStatus;
  /**
   * What the TRUSTED CREATE PATH would accept: no accepted renewal and no live
   * invite for this person, season and role. This is the eligibility rule, and
   * it is deliberately unchanged by the declined handling below — a mentor who
   * declined is still a legitimate target for a deliberate re-invitation, and
   * vam071_create_renewal_invite would still mint them a link.
   *
   * The single-invite form gates on THIS, so the individual re-invite path
   * behaves exactly as it always has. The server re-derives it independently;
   * the client is never trusted to decide who may receive a link.
   */
  selectable: boolean;
  /**
   * Additionally safe to sweep into a BULK selection.
   *
   * A mentor who already said no is excluded here — not because the system
   * forbids re-inviting them, but because re-approaching someone who declined
   * is a judgement call a human should make one at a time, and "select all
   * filtered" must never make it silently on their behalf. It is a UI safety
   * default layered ON TOP of eligibility, never a replacement for it.
   */
  batchSelectable: boolean;
};

export type RenewalConsoleRow = {
  id: string;
  personId: string;
  personName: string;
  personEmail: string | null;
  seasonCode: string;
  inviteState: "live" | "expired" | "revoked" | "accepted" | "declined";
  expiresAt: string;
  createdAt: string;
  applicationId: string | null;
  applicationStatus: string | null;
  renewalOutcome: string | null;
  membershipStatus: string | null;
  needsAttention: boolean;
  attentionReason: string | null;
  diff: RenewalProfileDiffEntry[];
  coreTeamNote: string | null;
  declineFeedback: string | null;
  commitmentsCompleted: boolean | null;
};

export type RenewalConsoleData = {
  season: { id: string; programId: string; code: string } | null;
  mentors: RenewalMentorOption[];
  invites: RenewalConsoleRow[];
  error: string | null;
};

export type RenewalSeasonContext = { id: string; programId: string; code: string };

export function renewalInviteState(invite: Row, now = Date.now()): RenewalConsoleRow["inviteState"] {
  if (invite.revoked_at) return "revoked";
  if (invite.outcome === "accepted") return "accepted";
  if (invite.outcome === "declined") return "declined";
  if (!Number.isFinite(Date.parse(String(invite.expires_at))) || Date.parse(String(invite.expires_at)) <= now) {
    return "expired";
  }
  return "live";
}

export function renewalDeclineAttention(
  state: RenewalConsoleRow["inviteState"],
  membershipStatus: string | null
): { needsAttention: boolean; reason: string | null } {
  const normalized = String(membershipStatus ?? "").toLowerCase();
  const deferredStatus = ["active", "paused", "invited"].includes(normalized);
  const terminalStatus = ["withdrawn", "cancelled", "completed", "graduated"].includes(normalized);
  const needsAttention = state === "declined" && (deferredStatus || terminalStatus);
  const reason = !needsAttention
    ? null
    : deferredStatus
      ? "Membership chưa được opt-out; có thể là deferred_actor_unauthorized. Cần operator xử lý."
      : `Membership ${membershipStatus} không đủ điều kiện tự động; cần operator rà soát.`;
  return { needsAttention, reason };
}

export async function loadRenewalSeasonContext(): Promise<RenewalSeasonContext | null> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data: seasonData, error: seasonError } = await client
    .from("seasons")
    .select("id,program_id,code")
    .eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE)
    .maybeSingle();
  if (seasonError || !seasonData) return null;
  return { id: String(seasonData.id), programId: String(seasonData.program_id), code: String(seasonData.code) };
}

export async function loadRenewalConsoleData(seasonContext?: RenewalSeasonContext): Promise<RenewalConsoleData> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { season: null, mentors: [], invites: [], error: "Dịch vụ gia hạn chưa sẵn sàng." };
  const season = seasonContext ?? (await loadRenewalSeasonContext());
  if (!season) return { season: null, mentors: [], invites: [], error: "Không tìm thấy Season 12 canonical." };

  const [people, profiles, invites, applications, memberships] = await Promise.all([
    readAllPages<Row>("people", "id,full_name,email_primary", (columns) => client.from("people").select(columns)),
    readAllPages<Row>("mentor_profiles", "id,person_id,mentor_code,company_current,title_current,years_experience_min,years_experience_text,capacity_target,industry,function_area,first_vam_season", (columns) => client.from("mentor_profiles").select(columns)),
    readAllPages<Row>("person_season_invites", "id,person_id,program_id,season_id,role,created_at,expires_at,revoked_at,submitted_at,outcome,application_id,decline_feedback", (columns) => client.from("person_season_invites").select(columns).eq("season_id", season.id).eq("role", "mentor")),
    readAllPages<Row>("applications", "id,person_id,season_id,status,source,raw_payload", (columns) => client.from("applications").select(columns).eq("season_id", season.id).eq("source", "s12_mentor_renewal")),
    readAllPages<Row>("person_season_memberships", "id,person_id,season_id,role,status", (columns) => client.from("person_season_memberships").select(columns).eq("season_id", season.id).eq("role", "mentor"))
  ]);
  const error = people.error ?? profiles.error ?? invites.error ?? applications.error ?? memberships.error;
  if (error) {
    console.error("[renewal-console] inventory read failed", { code: (error as { code?: string })?.code ?? "UNKNOWN" });
    return { season, mentors: [], invites: [], error: "Không thể tải đầy đủ dữ liệu gia hạn; không hiển thị kết quả một phần." };
  }

  const peopleById = new Map(people.data.map((row) => [String(row.id), row]));
  const profilesByPerson = new Map<string, Row[]>();
  for (const profile of profiles.data) {
    const key = String(profile.person_id ?? "");
    profilesByPerson.set(key, [...(profilesByPerson.get(key) ?? []), profile]);
  }
  const applicationsById = new Map(applications.data.map((row) => [String(row.id), row]));
  const membershipByPerson = new Map(memberships.data.map((row) => [String(row.person_id), row]));
  const acceptedPeople = new Set(invites.data.filter((row) => row.outcome === "accepted").map((row) => String(row.person_id)));
  const livePeople = new Set(invites.data.filter((row) => renewalInviteState(row) === "live").map((row) => String(row.person_id)));
  // A mentor who answered "no". Derived from the invite's own recorded outcome,
  // so this reads the decline lifecycle rather than changing it. Precedence
  // below puts it BELOW live, so a mentor who declined and was later re-invited
  // shows their current live link instead of a stale refusal.
  const declinedPeople = new Set(invites.data.filter((row) => row.outcome === "declined").map((row) => String(row.person_id)));

  // The eligibility RULE is unchanged: a mentor may receive a link only when
  // they have exactly one canonical profile, a known person row, no accepted
  // renewal and no live invite. What changed is that the two "already handled"
  // cases are now RETURNED with a status instead of being dropped, so the batch
  // picker can render them as "Đã có link" and refuse to select them. Mentors
  // with zero or duplicate profiles stay omitted exactly as before — they are a
  // data-integrity problem, not an operator choice.
  const mentors: RenewalMentorOption[] = Array.from(profilesByPerson.entries())
    .filter(([personId, rows]) => rows.length === 1 && peopleById.has(personId))
    .map(([personId, rows]) => {
      const person = peopleById.get(personId)!;
      const mentorCode = rows[0].mentor_code ? String(rows[0].mentor_code) : null;
      const email = person.email_primary ? String(person.email_primary) : null;
      const fullName = String(person.full_name || "Không tên");
      // Precedence: accepted > live > declined > eligible. Live above declined
      // matters — a mentor who declined and was deliberately re-invited holds a
      // current link, and showing them as "Đã từ chối" would hide it.
      const status: RenewalMentorStatus = acceptedPeople.has(personId)
        ? "renewal_accepted"
        : livePeople.has(personId)
          ? "has_live_invite"
          : declinedPeople.has(personId)
            ? "renewal_declined"
            : "eligible";
      return {
        personId,
        label: `${fullName}${mentorCode ? ` · ${mentorCode}` : ""}${email ? ` · ${email}` : ""}`,
        fullName,
        mentorCode,
        email,
        status,
        // Eligibility, as the trusted create path defines it. A declined mentor
        // stays TRUE here, which is what keeps the individual re-invite path
        // working exactly as before.
        selectable: status === "eligible" || status === "renewal_declined",
        // Bulk-safe: declined mentors are withheld from sweep selection.
        batchSelectable: status === "eligible"
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "vi"));

  const rows: RenewalConsoleRow[] = invites.data
    .map((invite) => {
      const personId = String(invite.person_id);
      const person = peopleById.get(personId);
      // M070 binds an application to an invite ONLY for an accepted outcome, so
      // application_id is the whole lookup. A declined invite has none by
      // constraint, and its feedback is read from the invite itself rather than
      // searched for among applications by person and season.
      const app = invite.application_id ? applicationsById.get(String(invite.application_id)) : null;
      const profileRows = profilesByPerson.get(personId) ?? [];
      const profile = profileRows.length === 1 ? profileRows[0] : {};
      const raw = app?.raw_payload && typeof app.raw_payload === "object" ? app.raw_payload : {};
      const renewal = raw.renewal && typeof raw.renewal === "object" && !Array.isArray(raw.renewal) ? raw.renewal : {};
      const diff = app && invite.outcome === "accepted" ? buildRenewalProfileDiff(profile, buildRenewalProfileRefresh(renewal)) : [];
      const membershipStatus = membershipByPerson.get(personId)?.status ? String(membershipByPerson.get(personId)?.status) : null;
      const state = renewalInviteState(invite);
      const attention = renewalDeclineAttention(state, membershipStatus);
      return {
        id: String(invite.id),
        personId,
        personName: String(person?.full_name ?? "Không xác định"),
        personEmail: person?.email_primary ? String(person.email_primary) : null,
        seasonCode: season.code,
        inviteState: state,
        expiresAt: String(invite.expires_at),
        createdAt: String(invite.created_at),
        applicationId: invite.application_id ? String(invite.application_id) : null,
        applicationStatus: app?.status ? String(app.status) : null,
        renewalOutcome: invite.outcome ? String(invite.outcome) : null,
        membershipStatus,
        needsAttention: attention.needsAttention,
        attentionReason: attention.reason,
        diff,
        coreTeamNote: typeof renewal.core_team_note === "string" ? renewal.core_team_note : null,
        declineFeedback: typeof invite.decline_feedback === "string" ? invite.decline_feedback : null,
        commitmentsCompleted: typeof renewal.commitments_completed === "boolean" ? renewal.commitments_completed : null
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { season, mentors, invites: rows, error: null };
}
