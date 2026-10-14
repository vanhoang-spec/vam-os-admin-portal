import "server-only";

/**
 * Ghép cặp Vòng 2 — trang mentor chọn mentee (máy chủ). Người mở là mentor KHÔNG có tài
 * khoản; token trong URL là thứ duy nhất xác định họ. Trang chỉ đọc; mọi lượt chọn/bỏ
 * chọn đi qua hai RPC vam113, nơi mọi luật được kiểm lại trong database.
 *
 * Mỗi lần mở chỉ đọc hồ sơ của 15 bạn trong danh sách riêng của mentor đó (lấy từ cụm chọn của
 * mentor — BTC 14/10/2026), và chỉ đọc các trường thẻ cần: hàng trăm mentor mở trang cùng lúc lúc
 * vòng mở.
 */
import { industryGroupLabel } from "@/lib/matching-round2-groups-core";
import {
  CARD_SUMMARY_KEYS,
  DETAIL_TEXT_KEYS,
  menteeCard,
  menteeDetailTexts,
  payloadFromRow,
  payloadProjection,
  pickMessage,
  stableOrderKey,
  undoDeadline,
  undoMinutesLeft,
  windowState,
  type MenteeCard,
  type WindowState
} from "@/lib/matching-round2-link-core";
import { mentorPoolLabel, poolGroups, poolMapFromRows } from "@/lib/matching-round2-pools-core";
import { round2Circle, round2MentorIndex, round2Window, round2WindowStart, ROUND2_WINDOW_SIZE } from "@/lib/matching-round2-window-core";
import { round2Slots, ROUND2_MENTOR_CAP } from "@/lib/matching-round2-core";
import { effectiveMentorCapacity } from "@/lib/mentor-capacity";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INACTIVE = new Set(["withdrawn", "opted_out"]);

export type MyPick = { matchId: string; menteeName: string; undoMinutesLeft: number; undoDeadline: string | null };

export type Round2PickPage =
  | { state: "invalid"; message: string }
  | { state: "error"; message: string }
  | {
      state: "ready";
      mentorName: string;
      groupLabel: string | null;
      /** Các nhóm trong danh sách chọn của mentor (một nhóm, hoặc cả cụm), để lọc trên trang. */
      poolGroups: Array<{ code: number; label: string }>;
      window: WindowState;
      opensAt: string | null;
      closesAt: string | null;
      /** Lý do không chọn được (đã rút, chưa có nhóm, nhiều hồ sơ…), null = chọn được. */
      blocked: string | null;
      limit: number;
      slots: number;
      picks: MyPick[];
      /** Danh sách của RIÊNG mentor này: tối đa `windowSize` bạn (BTC 14/10/2026). */
      mentees: MenteeCard[];
      /** Tổng số bạn còn trống trong cụm chọn (để trang nói "15 trong tổng số N bạn"). */
      poolOpen: number;
      windowSize: number;
    };

export async function getRound2PickPageData(token: string, nowMs = Date.now()): Promise<Round2PickPage> {
  if (!UUID.test(token)) return { state: "invalid", message: pickMessage("invalid_token") };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { state: "error", message: pickMessage("") };
  try {
    const { data: link, error: linkError } = await client
      .from("matching_round2_links")
      .select("id,season_id,mentor_person_id,revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (linkError) throw linkError;
    if (!link) return { state: "invalid", message: pickMessage("invalid_token") };
    if (link.revoked_at) return { state: "invalid", message: pickMessage("link_revoked") };
    const seasonId = String(link.season_id);
    const mentorId = String(link.mentor_person_id);

    const [settingsRes, personRes, mentorAssignRes, mentorAppsRes, profilesRes, membershipsRes, activeRes, picksRes, poolsRes] = await Promise.all([
      client.from("matching_round2_settings").select("opens_at,closes_at").eq("season_id", seasonId).maybeSingle(),
      client.from("people").select("id,full_name").eq("id", mentorId).maybeSingle(),
      client.from("matching_industry_assignments").select("group_code").eq("season_id", seasonId).eq("person_id", mentorId).eq("role", "mentor").maybeSingle(),
      client.from("applications").select("id").eq("season_id", seasonId).eq("person_id", mentorId).eq("status", "approved_as_mentor").limit(1),
      client.from("mentor_profiles").select("id,capacity_target").eq("person_id", mentorId).limit(5),
      readAllPages<Row>("person_season_memberships", "id,person_id,role,status", (columns) =>
        client.from("person_season_memberships").select(columns).eq("season_id", seasonId).in("status", Array.from(INACTIVE))
      ),
      readAllPages<Row>("matches", "id,mentor_person_id,mentee_person_id,matching_round", (columns) =>
        client.from("matches").select(columns).eq("season_id", seasonId).eq("status", "active")
      ),
      client.from("matching_round2_picks").select("match_id,created_at").eq("link_id", link.id).eq("action", "pick").eq("outcome", "ok").limit(50),
      // Tối đa 9 dòng mỗi mùa (khoá chính mùa + nhóm).
      client.from("matching_round2_pools").select("group_code,pool_code").eq("season_id", seasonId).limit(9)
    ]);
    for (const res of [settingsRes, personRes, mentorAssignRes, mentorAppsRes, profilesRes, membershipsRes, activeRes, picksRes, poolsRes]) {
      if ((res as { error?: unknown }).error) throw (res as { error: unknown }).error;
    }

    const settings = settingsRes.data as Row | null;
    const window = windowState(settings ? { opensAt: settings.opens_at, closesAt: settings.closes_at } : null, nowMs);
    const group = mentorAssignRes.data ? Number((mentorAssignRes.data as Row).group_code) : null;
    const pools = poolMapFromRows((poolsRes.data ?? []) as Row[]);
    const listGroups = group === null ? [] : poolGroups(pools, group);
    const profiles = (profilesRes.data ?? []) as Row[];
    const inactive = new Set(membershipsRes.data.map((m) => `${m.role}|${m.person_id}`));
    const active = activeRes.data;
    const mine = active.filter((m) => String(m.mentor_person_id) === mentorId);
    const capacity = profiles.length === 1 ? profiles[0].capacity_target : null;
    const limit = Math.min(ROUND2_MENTOR_CAP, effectiveMentorCapacity(capacity));
    const slots = round2Slots(capacity, mine.length);

    let blocked: string | null = null;
    if (!(mentorAppsRes.data ?? []).length || inactive.has(`mentor|${mentorId}`)) blocked = pickMessage("mentor_not_eligible");
    else if (group === null) blocked = pickMessage("mentor_not_classified");
    else if (profiles.length !== 1) blocked = pickMessage("mentor_identity_ambiguous");

    // Mentee mentor này đã chọn ở vòng 2 (để bỏ chọn trong 30 phút).
    const pickedAt = new Map(((picksRes.data ?? []) as Row[]).map((p) => [String(p.match_id), String(p.created_at)]));
    const myRound2 = mine.filter((m) => Number(m.matching_round) === 2);
    const nameIds = myRound2.map((m) => String(m.mentee_person_id));

    let mentees: MenteeCard[] = [];
    let poolOpen = 0;
    if (!blocked && window === "open" && slots > 0 && group !== null) {
      const view = await loadMentorWindow(client, { seasonId, linkId: String(link.id), token, listGroups });
      mentees = view.cards;
      poolOpen = view.total;
    }

    let pickNames = new Map<string, string>();
    if (nameIds.length) {
      const people = await readAllPagesIn<Row>(client, "people", "id", nameIds, "id,full_name");
      if (people.error) throw people.error;
      pickNames = new Map(people.data.map((p) => [String(p.id), String(p.full_name ?? "").trim()]));
    }
    const picks: MyPick[] = myRound2.map((m) => {
      const at = pickedAt.get(String(m.id)) ?? null;
      return {
        matchId: String(m.id),
        menteeName: pickNames.get(String(m.mentee_person_id)) || "(chưa có tên)",
        undoMinutesLeft: undoMinutesLeft(at, nowMs),
        undoDeadline: undoDeadline(at)
      };
    });

    return {
      state: "ready",
      mentorName: String((personRes.data as Row | null)?.full_name ?? "").trim() || "anh/chị",
      groupLabel: group === null ? null : mentorPoolLabel(pools, group),
      poolGroups: listGroups.map((code) => ({ code, label: industryGroupLabel(code) })),
      window,
      opensAt: settings?.opens_at ?? null,
      closesAt: settings?.closes_at ?? null,
      blocked,
      limit,
      slots,
      picks,
      mentees,
      poolOpen,
      windowSize: ROUND2_WINDOW_SIZE
    };
  } catch (error) {
    console.error("[round2-pick] page load failed", { message: error instanceof Error ? error.message : String(error) });
    return { state: "error", message: pickMessage("") };
  }
}

/**
 * Danh sách 15 hồ sơ của MỘT mentor (BTC 14/10/2026) — xem lib/matching-round2-window-core.ts.
 * Ai còn trống lấy từ vam123_round2_available, cùng luật với lượt chọn và lệnh tự cập nhật 20 giây.
 * Chỉ đọc hồ sơ của các bạn trong danh sách, không đọc cả nhóm.
 */
async function loadMentorWindow(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  input: { seasonId: string; linkId: string; token: string; listGroups: number[] }
): Promise<{ cards: MenteeCard[]; total: number }> {
  const { seasonId, linkId, token, listGroups } = input;
  const [availableRes, poolAssign, mentorAssign] = await Promise.all([
    client.rpc("vam123_round2_available", { p_token: token }),
    readAllPages<Row>("matching_industry_assignments", "id,person_id,application_id,group_code", (columns) =>
      client.from("matching_industry_assignments").select(columns).eq("season_id", seasonId).eq("role", "mentee").in("group_code", listGroups)
    ),
    readAllPages<Row>("matching_industry_assignments", "id,person_id", (columns) =>
      client.from("matching_industry_assignments").select(columns).eq("season_id", seasonId).eq("role", "mentor").in("group_code", listGroups)
    )
  ]);
  if (availableRes.error) throw availableRes.error;
  if (poolAssign.error || mentorAssign.error) throw poolAssign.error ?? mentorAssign.error;
  // Link của mọi mentor cùng cụm, KỂ CẢ link đã thu hồi: thứ tự của từng mentor không đổi khi BTC thu hồi một link.
  const links = await readAllPagesIn<Row>(
    client,
    "matching_round2_links",
    "mentor_person_id",
    mentorAssign.data.map((m) => String(m.person_id)),
    "id,created_at",
    (query) => query.eq("season_id", seasonId)
  );
  if (links.error) throw links.error;

  const available = new Set(((availableRes.data ?? []) as unknown[]).map(String));
  const withApp = poolAssign.data.filter((a) => a.application_id);
  const circle = round2Circle(seasonId, listGroups, withApp.map((a) => String(a.application_id)));
  const index = Math.max(0, round2MentorIndex(links.data.map((l) => ({ id: String(l.id), createdAt: String(l.created_at) })), linkId));
  const ids = round2Window(circle, available, round2WindowStart(index, circle.length));
  if (!ids.length) return { cards: [], total: available.size };

  const assignByApp = new Map(withApp.map((a) => [String(a.application_id), a]));
  const [apps, people, reviews] = await Promise.all([
    readAllPagesIn<Row>(client, "applications", "id", ids, `id,person_id,status,${payloadProjection(CARD_SUMMARY_KEYS)}`),
    readAllPagesIn<Row>(client, "people", "id", ids.map((id) => String(assignByApp.get(id)?.person_id ?? "")), "id,full_name"),
    readAllPagesIn<Row>(client, "application_reviews", "application_id", ids, "id,application_id,desired_mentor_profile,updated_at")
  ]);
  if (apps.error || people.error || reviews.error) throw apps.error ?? people.error ?? reviews.error;
  const names = new Map(people.data.map((p) => [String(p.id), String(p.full_name ?? "").trim()]));
  // (5) Chân dung Mentor phù hợp: phiếu mới nhất có ghi mục này.
  const desired = new Map<string, { text: string; at: number }>();
  for (const r of reviews.data) {
    const text = String(r.desired_mentor_profile ?? "").trim();
    if (!text) continue;
    const at = Date.parse(String(r.updated_at ?? "")) || 0;
    const key = String(r.application_id);
    const prev = desired.get(key);
    if (!prev || at > prev.at) desired.set(key, { text, at });
  }
  const cards = apps.data
    .filter((a) => a.status === "approved_as_mentee")
    .map((a) => {
      const assignment = assignByApp.get(String(a.id));
      const groupCode = assignment ? Number(assignment.group_code) : null;
      return menteeCard({
        applicationId: String(a.id),
        name: names.get(String(a.person_id)) || "(chưa có tên)",
        payload: payloadFromRow(a, CARD_SUMMARY_KEYS),
        groupCode,
        groupLabel: groupCode === null ? null : industryGroupLabel(groupCode),
        desiredMentorProfile: desired.get(String(a.id))?.text ?? null
      });
    })
    // Thứ tự hiện xáo riêng từng mentor: bạn đứng đầu vòng không vì thế mà luôn nằm đầu trang.
    .sort((x, y) => stableOrderKey(token, x.applicationId) - stableOrderKey(token, y.applicationId));
  return { cards, total: available.size };
}

/**
 * Hồ sơ bù khi một bạn trong danh sách vừa được mentor khác chọn — trang gọi lệnh này thay vì tải lại
 * cả trang. Token đến từ trình duyệt: mọi thứ (link, nhóm, ai còn trống) được tính lại ở máy chủ.
 */
export async function getRound2WindowCards(token: string): Promise<{ ok: true; cards: MenteeCard[]; total: number } | { ok: false }> {
  if (!UUID.test(token)) return { ok: false };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false };
  try {
    const { data: link, error } = await client
      .from("matching_round2_links")
      .select("id,season_id,mentor_person_id,revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (error) throw error;
    if (!link || link.revoked_at) return { ok: false };
    const seasonId = String(link.season_id);
    const [mentorAssignRes, poolsRes] = await Promise.all([
      client
        .from("matching_industry_assignments")
        .select("group_code")
        .eq("season_id", seasonId)
        .eq("person_id", String(link.mentor_person_id))
        .eq("role", "mentor")
        .maybeSingle(),
      client.from("matching_round2_pools").select("group_code,pool_code").eq("season_id", seasonId).limit(9)
    ]);
    if (mentorAssignRes.error || poolsRes.error) throw mentorAssignRes.error ?? poolsRes.error;
    if (!mentorAssignRes.data) return { ok: false };
    const group = Number((mentorAssignRes.data as Row).group_code);
    const listGroups = poolGroups(poolMapFromRows((poolsRes.data ?? []) as Row[]), group);
    const view = await loadMentorWindow(client, { seasonId, linkId: String(link.id), token, listGroups });
    return { ok: true, ...view };
  } catch (error) {
    console.error("[round2-pick] window refill failed", { message: error instanceof Error ? error.message : String(error) });
    return { ok: false };
  }
}

/**
 * Mã đơn các bạn còn trống trong cụm của mentor — trang gọi lại mỗi 20 giây để ẩn bạn vừa được
 * người khác chọn. Một truy vấn (vam123_round2_available), vài KB, thay vì tải lại cả trang.
 * null = không đọc được (trang giữ nguyên danh sách đang có, không ẩn nhầm ai).
 */
export async function getRound2AvailableIds(token: string): Promise<string[] | null> {
  if (!UUID.test(token)) return [];
  const client = getSupabaseServiceRoleClient();
  if (!client) return null;
  const { data, error } = await client.rpc("vam123_round2_available", { p_token: token });
  if (error) {
    console.error("[round2-pick] available failed", { message: error.message });
    return null;
  }
  return Array.isArray(data) ? data.map(String) : [];
}

/**
 * Bốn câu tự luận của MỘT bạn, khi mentor bấm "Xem đầy đủ hồ sơ". Chỉ trả hồ sơ của bạn còn
 * nằm trong danh sách của chính mentor đó (cùng cụm, còn trống, vòng đang mở) — token khác,
 * mã đơn ngoài cụm hay bạn đã có mentor đều không đọc được gì.
 */
export async function getRound2MenteeDetail(
  token: string,
  applicationId: string
): Promise<{ ok: true; texts: Array<[string, string]> } | { ok: false; message: string }> {
  if (!UUID.test(token)) return { ok: false, message: pickMessage("invalid_token") };
  if (!UUID.test(applicationId)) return { ok: false, message: pickMessage("mentee_not_found") };
  const ids = await getRound2AvailableIds(token);
  if (ids === null) return { ok: false, message: pickMessage("") };
  if (!ids.includes(applicationId)) {
    return { ok: false, message: "Bạn này không còn trong danh sách của anh/chị — có thể vừa được mentor khác chọn." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: pickMessage("") };
  const { data, error } = await client
    .from("applications")
    .select(`id,${payloadProjection(DETAIL_TEXT_KEYS)}`)
    .eq("id", applicationId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[round2-pick] detail failed", { message: error.message });
    return { ok: false, message: pickMessage("") };
  }
  return { ok: true, texts: menteeDetailTexts(payloadFromRow(data as Row, DETAIL_TEXT_KEYS)) };
}

export async function pickRound2Mentee(input: { token: string; menteeApplicationId: string }): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(input.token)) return { ok: false, message: pickMessage("invalid_token") };
  if (!UUID.test(input.menteeApplicationId)) return { ok: false, message: pickMessage("mentee_not_found") };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: pickMessage("") };
  const { data, error } = await client.rpc("vam113_round2_pick", { p_token: input.token, p_mentee_application: input.menteeApplicationId });
  if (error) {
    console.error("[round2-pick] pick failed", { message: error.message });
    return { ok: false, message: pickMessage("") };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string; remaining?: number };
  if (!result.ok) return { ok: false, message: pickMessage(result.code) };
  const remaining = Number(result.remaining ?? 0);
  return {
    ok: true,
    message:
      remaining > 0
        ? `Đã chọn. Anh/chị còn có thể chọn thêm ${remaining} mentee. Có thể bỏ chọn trong 30 phút.`
        : "Đã chọn. Anh/chị đã nhận đủ mentee của vòng này. Có thể bỏ chọn trong 30 phút."
  };
}

export async function unpickRound2Match(input: { token: string; matchId: string }): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(input.token)) return { ok: false, message: pickMessage("invalid_token") };
  if (!UUID.test(input.matchId)) return { ok: false, message: pickMessage("match_not_found") };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: pickMessage("") };
  const { data, error } = await client.rpc("vam113_round2_unpick", { p_token: input.token, p_match: input.matchId });
  if (error) {
    console.error("[round2-pick] unpick failed", { message: error.message });
    return { ok: false, message: pickMessage("") };
  }
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  return result.ok ? { ok: true, message: "Đã bỏ chọn. Bạn ấy đã trở lại danh sách." } : { ok: false, message: pickMessage(result.code) };
}
