import "server-only";

import { readAllPages } from "@/lib/paged-read";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh, type RenewalProfileDiffEntry } from "@/lib/renewal-profile-safety";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;

export type RenewalMentorOption = {
  personId: string;
  label: string;
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
    readAllPages<Row>("person_season_invites", "id,person_id,program_id,season_id,role,created_at,expires_at,revoked_at,submitted_at,outcome,application_id", (columns) => client.from("person_season_invites").select(columns).eq("season_id", season.id).eq("role", "mentor")),
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

  const mentors = Array.from(profilesByPerson.entries())
    .filter(([personId, rows]) => rows.length === 1 && peopleById.has(personId) && !acceptedPeople.has(personId) && !livePeople.has(personId))
    .map(([personId, rows]) => {
      const person = peopleById.get(personId)!;
      const code = rows[0].mentor_code ? ` · ${rows[0].mentor_code}` : "";
      const email = person.email_primary ? ` · ${person.email_primary}` : "";
      return { personId, label: `${person.full_name || "Không tên"}${code}${email}` };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "vi"));

  const rows: RenewalConsoleRow[] = invites.data
    .map((invite) => {
      const personId = String(invite.person_id);
      const person = peopleById.get(personId);
      // For declined invites, there is no linked application_id, so we find it by person_id and season_id
      const app = invite.application_id
        ? applicationsById.get(String(invite.application_id))
        : (invite.outcome === "declined" ? applications.data.find(a => a.person_id === personId && a.status === 'declined_renewal') || null : null);
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
        declineFeedback: typeof renewal.decline_feedback === "string" ? renewal.decline_feedback : null,
        commitmentsCompleted: typeof renewal.commitments_completed === "boolean" ? renewal.commitments_completed : null
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { season, mentors, invites: rows, error: null };
}
