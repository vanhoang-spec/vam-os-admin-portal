import "server-only";

/**
 * Hồ sơ tóm tắt gửi kèm thư kết quả ghép cặp — đọc dữ liệu và cổng của trang /ho-so/<token>.
 *
 * Phần dựng thẻ nằm ở lib/match-profile-core.ts (thuần). Đây chỉ:
 *   1. kiểm link (cổng, fail-closed) — chỉ link của một cặp CÒN HOẠT ĐỘNG, đúng hai người của cặp,
 *      người được xem chưa rút, mới mở được; mọi trường hợp khác hiện một câu báo duy nhất;
 *   2. đọc đúng những cột/khoá thẻ cần — không kéo cả raw_payload (database Micro đã sập 11/10 vì
 *      kiểu đọc nặng lặp lại);
 *   3. ghi mốc mở link (first/last_viewed_at) — trong try/catch, không bao giờ chặn trang.
 *
 * SĐT/email chỉ được ghép vào thẻ SAU khi cổng cho qua. Không đếm lượt mở: trình quét link của
 * Gmail/Outlook mở mọi link trong thư, con số sẽ chỉ là nhiễu.
 */
import { bearerTokenHashEquals, safeHashBearerToken } from "@/lib/bearer-token";
import {
  MENTEE_PAYLOAD_KEYS,
  MENTOR_PAYLOAD_KEYS,
  PROFILE_LINK_FAILURE_MESSAGE,
  cleanText,
  latestDesiredMentorProfile,
  menteeProfileCard,
  mentorProfileCard,
  payloadFromProjectedRow,
  profilePayloadProjection,
  type ProfileCard,
  type ProfileContact,
  type ProfileRole
} from "@/lib/match-profile-core";
import { readAllPagesIn } from "@/lib/paged-read";
import { SEASON_CONFIG } from "@/lib/season-config";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;

const INACTIVE_MEMBERSHIP = new Set(["withdrawn", "opted_out"]);

function log(message: string, error?: unknown) {
  // Không bao giờ ghi token hay hash vào log.
  const detail = error && typeof error === "object" ? (error as { message?: unknown; code?: unknown }) : null;
  console.error(`[match-profile] ${message}`, detail ? { code: detail.code, message: detail.message } : "");
}

/** Mùa hiện hành theo mã, không theo bất cứ thứ gì người mở link gửi lên. */
export async function currentSeasonId(client: any): Promise<string | null> {
  const { data, error } = await client.from("seasons").select("id").eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).maybeSingle();
  if (error || !data) return null;
  return String(data.id);
}

export type ProfileSubject = { personId: string; role: ProfileRole };

/** Mọi nguồn của một người cho thẻ, cộng khối liên hệ (chưa ghép vào thẻ). */
export type ProfileSources = {
  card: (contact: ProfileContact | null) => ProfileCard;
  contact: ProfileContact;
};

function byRecency(a: Row, b: Row) {
  return (Date.parse(String(b.created_at ?? "")) || 0) - (Date.parse(String(a.created_at ?? "")) || 0);
}

/**
 * Đọc nguồn cho nhiều người cùng lúc (trang xem trước, báo cáo độ phủ, thư gửi đi) — mỗi bảng một
 * lượt đọc theo danh sách, không đọc từng người một. Ném lỗi khi một lượt đọc hỏng: nơi gọi tự
 * quyết fail-closed thế nào, không ai nhận một thẻ thiếu nửa mà tưởng là đủ.
 */
export async function loadProfileSources(
  client: any,
  seasonId: string,
  subjects: readonly ProfileSubject[]
): Promise<Map<string, ProfileSources>> {
  const key = (s: ProfileSubject) => `${s.role}:${s.personId}`;
  const out = new Map<string, ProfileSources>();
  for (const role of ["mentor", "mentee"] as const) {
    const ids = Array.from(new Set(subjects.filter((s) => s.role === role).map((s) => s.personId)));
    if (!ids.length) continue;
    const keys = role === "mentor" ? MENTOR_PAYLOAD_KEYS : MENTEE_PAYLOAD_KEYS;
    const projection = `id,person_id,season_id,role_applied,status,source,full_name,email_primary,phone_primary,created_at,${profilePayloadProjection(keys)}`;
    const [people, apps, groups, profiles] = await Promise.all([
      readAllPagesIn<Row>(client, "people", "id", ids, "id,full_name,email_primary,phone_primary"),
      readAllPagesIn<Row>(client, "applications", "person_id", ids, projection, (q: any) => q.eq("role_applied", role)),
      readAllPagesIn<Row>(client, "matching_industry_assignments", "person_id", ids, "id,person_id,role,group_code", (q: any) =>
        q.eq("season_id", seasonId).eq("role", role)
      ),
      role === "mentor"
        ? readAllPagesIn<Row>(client, "mentor_profiles", "person_id", ids,
            "id,person_id,title_current,company_current,industry,function_area,years_experience_text,years_experience_min,bio_url")
        : readAllPagesIn<Row>(client, "mentee_profiles", "person_id", ids, "id,person_id,school_raw,major")
    ]);
    for (const r of [people, apps, groups, profiles]) if (r.error) throw r.error;

    // Phiếu phỏng vấn của đơn mentee mùa này: mục "Chân dung Mentor phù hợp".
    const currentMenteeApps = role === "mentee" ? apps.data.filter((a) => String(a.season_id) === seasonId) : [];
    const reviews = currentMenteeApps.length
      ? await readAllPagesIn<Row>(client, "application_reviews", "application_id", currentMenteeApps.map((a) => String(a.id)),
          "id,application_id,desired_mentor_profile,updated_at")
      : { data: [] as Row[], error: null };
    if (reviews.error) throw reviews.error;
    const desired = latestDesiredMentorProfile(reviews.data);

    const personById = new Map(people.data.map((p) => [String(p.id), p]));
    const groupByPerson = new Map(groups.data.map((g) => [String(g.person_id), g.group_code]));
    const profileByPerson = new Map<string, Row>();
    for (const p of profiles.data) if (!profileByPerson.has(String(p.person_id))) profileByPerson.set(String(p.person_id), p);

    for (const personId of ids) {
      const person = personById.get(personId) ?? null;
      const own = apps.data.filter((a) => String(a.person_id) === personId).sort(byRecency);
      // Đơn mùa này: ưu tiên đơn đã duyệt đúng vai; các đơn mùa khác là "hồ sơ đăng ký cũ".
      const approved = `approved_as_${role}`;
      const current =
        own.find((a) => String(a.season_id) === seasonId && a.status === approved) ??
        own.find((a) => String(a.season_id) === seasonId) ??
        null;
      const older = own.filter((a) => String(a.season_id) !== seasonId);
      const payload = current ? payloadFromProjectedRow(current, keys) : null;
      const olderPayloads = older.map((a) => payloadFromProjectedRow(a, keys));
      const contact: ProfileContact = {
        phone: cleanText(person?.phone_primary) ?? cleanText(current?.phone_primary),
        email: cleanText(person?.email_primary) ?? cleanText(current?.email_primary)
      };
      const fullName = person?.full_name ?? current?.full_name ?? null;
      const groupCode = groupByPerson.get(personId) ?? null;
      const profile = profileByPerson.get(personId) ?? null;
      const card =
        role === "mentor"
          ? (c: ProfileContact | null) =>
              mentorProfileCard({ fullName, groupCode, contact: c, payload, mentorProfile: profile, olderPayloads })
          : (c: ProfileContact | null) =>
              menteeProfileCard({
                fullName,
                groupCode,
                contact: c,
                payload,
                olderPayloads,
                menteeProfile: profile,
                desiredMentorProfile: current ? desired.get(String(current.id)) ?? null : null
              });
      out.set(key({ personId, role }), { card, contact });
    }
  }
  return out;
}

export function profileSourceKey(personId: string, role: ProfileRole) {
  return `${role}:${personId}`;
}

export type MatchProfilePage =
  | { state: "ok"; role: ProfileRole; card: ProfileCard; seasonLabel: string }
  | { state: "invalid"; message: string; seasonLabel: string };

/**
 * Trang /ho-so/<token>. Cổng kiểm MỖI lần mở, theo đúng thứ tự, và mọi nhánh hỏng ra cùng một
 * câu báo — người cầm một link sai không biết được nó sai vì đâu:
 *   token đúng định dạng → hash có trong bảng, khớp, chưa thu hồi → cặp tồn tại, đang hoạt động,
 *   thuộc mùa hiện hành → người xem và người được xem vẫn đúng là hai người của cặp → người được xem
 *   chưa rút khỏi mùa.
 */
export async function getMatchProfilePage(rawToken: unknown, client: any = getSupabaseServiceRoleClient()): Promise<MatchProfilePage> {
  const seasonLabel = CURRENT_APPLICATION_SEASON_LABEL;
  const invalid: MatchProfilePage = { state: "invalid", message: PROFILE_LINK_FAILURE_MESSAGE, seasonLabel };
  const tokenHash = safeHashBearerToken(rawToken);
  if (!tokenHash || !client) return invalid;
  try {
    const { data: link, error: linkError } = await client
      .from("match_profile_links")
      .select("id,season_id,match_id,viewer_person_id,subject_person_id,subject_role,token_hash,revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (linkError) {
      log("link read failed", linkError);
      return invalid;
    }
    if (!link || !bearerTokenHashEquals(link.token_hash, tokenHash) || link.revoked_at) return invalid;
    const role = link.subject_role === "mentor" || link.subject_role === "mentee" ? (link.subject_role as ProfileRole) : null;
    if (!role) return invalid;

    const seasonId = await currentSeasonId(client);
    if (!seasonId || String(link.season_id) !== seasonId) return invalid;

    const { data: match, error: matchError } = await client
      .from("matches")
      .select("id,season_id,status,mentor_person_id,mentee_person_id")
      .eq("id", link.match_id)
      .maybeSingle();
    if (matchError) {
      log("match read failed", matchError);
      return invalid;
    }
    if (!match || match.status !== "active" || String(match.season_id) !== seasonId) return invalid;
    const subject = String(link.subject_person_id);
    const viewer = String(link.viewer_person_id);
    const partiesOk =
      role === "mentor"
        ? String(match.mentor_person_id) === subject && String(match.mentee_person_id) === viewer
        : String(match.mentee_person_id) === subject && String(match.mentor_person_id) === viewer;
    if (!partiesOk) return invalid;

    const { data: memberships, error: membershipError } = await client
      .from("person_season_memberships")
      .select("status")
      .eq("person_id", subject)
      .eq("season_id", seasonId)
      .eq("role", role);
    if (membershipError) {
      log("membership read failed", membershipError);
      return invalid;
    }
    if ((memberships ?? []).some((m: Row) => INACTIVE_MEMBERSHIP.has(String(m.status)))) return invalid;

    const sources = (await loadProfileSources(client, seasonId, [{ personId: subject, role }])).get(profileSourceKey(subject, role));
    if (!sources) return invalid;
    const card = sources.card(sources.contact);

    await recordView(client, String(link.id));
    return { state: "ok", role, card, seasonLabel };
  } catch (error) {
    log("profile page crashed", error);
    return invalid;
  }
}

/** Ghi hẹp đúng hai cột mốc mở link. Hỏng thì bỏ qua — trang vẫn phải hiện. */
async function recordView(client: any, linkId: string) {
  const now = new Date().toISOString();
  try {
    await client.from("match_profile_links").update({ first_viewed_at: now }).eq("id", linkId).is("first_viewed_at", null);
    await client.from("match_profile_links").update({ last_viewed_at: now }).eq("id", linkId);
  } catch (error) {
    log("view stamp failed", error);
  }
}

/**
 * Xem trước thẻ cho BTC (trang /matches/ket-qua) — đọc theo person_id, KHÔNG tạo token. Nơi gọi
 * phải kiểm quyền trước; hàm này không tự kiểm.
 */
export async function getProfilePreview(client: any, seasonId: string, personId: string, role: ProfileRole): Promise<ProfileCard | null> {
  const sources = (await loadProfileSources(client, seasonId, [{ personId, role }])).get(profileSourceKey(personId, role));
  return sources ? sources.card(sources.contact) : null;
}
