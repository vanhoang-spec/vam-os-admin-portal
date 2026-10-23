import "server-only";

/**
 * Thư kết quả ghép cặp mùa 12 — đọc dữ liệu và ghi cài đặt cho trang /matches/ket-qua (BTC 22/10/2026).
 *
 * Phần quyết định (ai nhận, vì sao chưa nhận, khi nào khoá gửi) nằm ở lib/match-result-core.ts.
 * Đây chỉ đọc bảng, gọi phần thuần, và ghi đúng ba thứ: link trong thư, danh sách mentor giữ lại,
 * và dấu "đã xác nhận danh sách". Mọi đường ghi tự kiểm quyền (round2Operator: Core team trở lên,
 * có quyền vận hành mùa) — form đã ẩn nút không phải một phép kiểm.
 *
 * Bản này CHƯA gửi thư. Gửi thư đi ở bản sau, qua đúng các hàm thuần ở trên.
 */
import { loadProfileSources, getProfilePreview, profileSourceKey, type ProfileSubject } from "@/lib/match-profile";
import type { ProfileCard, ProfileRole } from "@/lib/match-profile-core";
import {
  batchSize,
  buildRecipients,
  countByStatus,
  dispatchGroups,
  holdsFingerprint,
  missingFieldLabels,
  normalizeEmail,
  parseHoldEmailInput,
  planDispatchBatch,
  profileCoverage,
  resolveHoldEmails,
  sendBlockedReasons,
  validateHttpsUrl,
  type ActiveMatch,
  type FieldCoverage,
  type HoldCandidate,
  type MatchResultRecipient,
  type MatchResultSettings,
  type NoticeInfo,
  type RecipientPerson,
  type StatusCounts
} from "@/lib/match-result-core";
import { round2Operator, round2SeasonContext } from "@/lib/matching-round2";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-quota-core";
import { DISPATCH_RESERVE, dispatchAllowance } from "@/lib/mentee-invite-dispatch-core";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";
import { HANDBOOKS } from "@/lib/handbook";

type Row = Record<string, any>;
type Result = { ok: boolean; message: string };

const INACTIVE_MEMBERSHIP = new Set(["withdrawn", "opted_out"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DENIED = "Bạn không có quyền vận hành ghép cặp mùa này.";
const DEFAULT_HOLD_REASON = "Nhóm mentor cần tham gia Training 15/11 — BTC gửi thư riêng.";
const MAX_HOLD_REASON = 300;

function log(message: string, error?: unknown) {
  const detail = error && typeof error === "object" ? (error as { message?: unknown; code?: unknown }) : null;
  console.error(`[match-result] ${message}`, detail ? { code: detail.code, message: detail.message } : "");
}

function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

export type HoldView = {
  mentorPersonId: string;
  fullName: string | null;
  email: string | null;
  inputEmail: string | null;
  reason: string | null;
  createdAt: string | null;
  /** Số mentee đang ghép với mentor này — thư của họ cũng bị giữ. */
  menteeCount: number;
};

export type MatchResultData = {
  seasonId: string;
  seasonLabel: string;
  settings: MatchResultSettings | null;
  settingsReadOk: boolean;
  holds: HoldView[];
  holdsReadOk: boolean;
  holdsFingerprint: string;
  recipients: MatchResultRecipient[];
  counts: StatusCounts;
  blocked: string[];
  dispatch: MatchResultDispatchView;
};

/** Khung gửi: hạn mức còn lại và lô của lần bấm kế tiếp (trọn từng nhóm mentor). */
export type MatchResultDispatchView = {
  /** Thư cả hệ thống đã gửi trong 24 giờ; null = không đếm được (khoá gửi). */
  sentInWindow: number | null;
  allowance: number;
  readyGroups: number;
  readyPeople: number;
  nextBatchGroups: number;
  nextBatchPeople: number;
  /** Phần hạn mức 24 giờ còn lại cho thư này (đã chừa thư khác) — chế độ gửi liên tục đi tới đây là dừng. */
  roomToday: number;
};

type Loaded = {
  matches: ActiveMatch[];
  people: Map<string, RecipientPerson>;
  inactiveKeys: Set<string>;
  notices: NoticeInfo[];
  activeHolds: Row[] | null;
  settings: MatchResultSettings | null;
  settingsReadOk: boolean;
};

function settingsFromRow(row: Row | null): MatchResultSettings | null {
  if (!row) return null;
  return {
    kickoffRegisterUrl: text(row.kickoff_register_url),
    holdsConfirmedAt: text(row.holds_confirmed_at)
  };
}

async function readActiveHolds(client: any, seasonId: string) {
  return readAllPages<Row>("match_result_holds", "id,mentor_person_id,input_email,reason,created_at,removed_at", (columns) =>
    client.from("match_result_holds").select(columns).eq("season_id", seasonId).is("removed_at", null)
  );
}

/**
 * Mọi thứ trang và lúc gửi cần. Cặp, thư đã gửi, trạng thái thành viên, người: hỏng thì ném — không
 * ai nhận một danh sách thiếu mà tưởng là đủ. Danh sách giữ lại và cài đặt hỏng thì KHÔNG ném, mà
 * báo ra để phần thuần khoá gửi (fail-closed) trong khi BTC vẫn xem được phần còn lại.
 */
async function loadInputs(client: any, seasonId: string): Promise<Loaded> {
  const [matches, notices, memberships, holds, settings] = await Promise.all([
    readAllPages<Row>("matches", "id,mentor_person_id,mentee_person_id,status,matching_round,created_at", (columns) =>
      client.from("matches").select(columns).eq("season_id", seasonId).eq("status", "active")
    ),
    readAllPages<Row>("match_result_notices", "id,person_id,role,match_ids,sent_at,last_error", (columns) =>
      client.from("match_result_notices").select(columns).eq("season_id", seasonId)
    ),
    readAllPages<Row>("person_season_memberships", "id,person_id,role,status", (columns) =>
      client.from("person_season_memberships").select(columns).eq("season_id", seasonId).in("role", ["mentor", "mentee"])
    ),
    readActiveHolds(client, seasonId),
    client
      .from("match_result_settings")
      .select("season_id,kickoff_register_url,holds_confirmed_at")
      .eq("season_id", seasonId)
      .maybeSingle()
  ]);
  if (matches.error || notices.error || memberships.error) throw new Error("READ_FAILED");
  if (holds.error) log("holds read failed", holds.error);
  if (settings.error) log("settings read failed", settings.error);

  const active: ActiveMatch[] = matches.data
    .filter((m) => m.mentor_person_id && m.mentee_person_id)
    .map((m) => ({
      id: String(m.id),
      mentorPersonId: String(m.mentor_person_id),
      menteePersonId: String(m.mentee_person_id),
      createdAt: text(m.created_at),
      round: Number.isInteger(Number(m.matching_round)) && m.matching_round !== null ? Number(m.matching_round) : null
    }));
  const noticeRows: NoticeInfo[] = notices.data
    .filter((n) => n.role === "mentor" || n.role === "mentee")
    .map((n) => ({
      personId: String(n.person_id),
      role: n.role as ProfileRole,
      matchIds: Array.isArray(n.match_ids) ? n.match_ids.map(String) : [],
      sentAt: text(n.sent_at),
      lastError: text(n.last_error)
    }));
  const activeHolds = holds.error ? null : holds.data;

  const ids = Array.from(
    new Set([
      ...active.flatMap((m) => [m.mentorPersonId, m.menteePersonId]),
      ...noticeRows.map((n) => n.personId),
      ...(activeHolds ?? []).map((h) => String(h.mentor_person_id))
    ])
  );
  const [people, apps] = await Promise.all([
    readAllPagesIn<Row>(client, "people", "id", ids, "id,full_name,email_primary"),
    // Email dự phòng: đơn mùa này, khi hồ sơ người chưa có email.
    readAllPagesIn<Row>(client, "applications", "person_id", ids, "id,person_id,status,email_primary,created_at", (q: any) =>
      q.eq("season_id", seasonId)
    )
  ]);
  if (people.error || apps.error) throw new Error("READ_FAILED");

  const appEmail = new Map<string, string>();
  const ordered = [...apps.data].sort((a, b) => {
    const approved = (r: Row) => (String(r.status).startsWith("approved_as_") ? 0 : 1);
    return approved(a) - approved(b) || String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
  for (const a of ordered) {
    const email = normalizeEmail(a.email_primary);
    if (email && !appEmail.has(String(a.person_id))) appEmail.set(String(a.person_id), email);
  }
  const personMap = new Map<string, RecipientPerson>();
  for (const id of ids) personMap.set(id, { fullName: null, email: appEmail.get(id) ?? null });
  for (const p of people.data) {
    const id = String(p.id);
    personMap.set(id, { fullName: text(p.full_name), email: normalizeEmail(p.email_primary) ?? appEmail.get(id) ?? null });
  }

  const inactiveKeys = new Set(
    memberships.data.filter((m) => INACTIVE_MEMBERSHIP.has(String(m.status))).map((m) => `${m.role}:${m.person_id}`)
  );

  return {
    matches: active,
    people: personMap,
    inactiveKeys,
    notices: noticeRows,
    activeHolds,
    settings: settings.error ? null : settingsFromRow(settings.data ?? null),
    settingsReadOk: !settings.error
  };
}

export type MatchResultState = {
  matches: ActiveMatch[];
  people: Map<string, RecipientPerson>;
  activeHolds: Row[] | null;
  settings: MatchResultSettings | null;
  settingsReadOk: boolean;
  recipients: MatchResultRecipient[];
  /** Rỗng = gửi được. */
  blocked: string[];
};

/**
 * Trạng thái dùng chung cho trang và cho lúc gửi — cùng một hàm, để màn hình không đếm một kiểu còn
 * lúc bấm gửi lại tính kiểu khác. Không kiểm quyền: nơi gọi kiểm trước.
 */
export async function loadMatchResultState(client: any, seasonId: string, nowMs: number): Promise<MatchResultState> {
  const loaded = await loadInputs(client, seasonId);
  const heldIds = loaded.activeHolds ? new Set(loaded.activeHolds.map((h) => String(h.mentor_person_id))) : null;
  const recipients = buildRecipients({
    matches: loaded.matches,
    people: loaded.people,
    heldMentorIds: heldIds,
    inactiveKeys: loaded.inactiveKeys,
    notices: loaded.notices,
    now: nowMs
  });
  return {
    matches: loaded.matches,
    people: loaded.people,
    activeHolds: loaded.activeHolds,
    settings: loaded.settings,
    settingsReadOk: loaded.settingsReadOk,
    recipients,
    blocked: sendBlockedReasons({
      settings: loaded.settings,
      settingsReadOk: loaded.settingsReadOk,
      holdsReadOk: loaded.activeHolds !== null,
      handbooksReady: { mentee: HANDBOOKS.mentee.ready, mentor: HANDBOOKS.mentor.ready }
    })
  };
}

export async function getMatchResultData(): Promise<
  { ok: true; data: MatchResultData } | { ok: false; message: string; denied?: boolean }
> {
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return { ok: false, denied: true, message: DENIED };
    const nowMs = Date.now();
    const [loaded, sentInWindow] = await Promise.all([loadMatchResultState(client, seasonId, nowMs), countSentInWindow(client, nowMs)]);
    const recipients = loaded.recipients;
    const groups = dispatchGroups(recipients);
    const allowance = sentInWindow === null ? 0 : dispatchAllowance(sentInWindow);
    const next = planDispatchBatch(groups, allowance);
    const menteesOf = (mentorId: string) => loaded.matches.filter((m) => m.mentorPersonId === mentorId).length;
    const holds: HoldView[] = (loaded.activeHolds ?? [])
      .map((h) => {
        const id = String(h.mentor_person_id);
        const person = loaded.people.get(id);
        return {
          mentorPersonId: id,
          fullName: person?.fullName ?? null,
          email: person?.email ?? null,
          inputEmail: text(h.input_email),
          reason: text(h.reason),
          createdAt: text(h.created_at),
          menteeCount: menteesOf(id)
        };
      })
      .sort((a, b) => String(a.fullName ?? "").localeCompare(String(b.fullName ?? ""), "vi"));
    return {
      ok: true,
      data: {
        seasonId,
        seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
        settings: loaded.settings,
        settingsReadOk: loaded.settingsReadOk,
        holds,
        holdsReadOk: loaded.activeHolds !== null,
        holdsFingerprint: holdsFingerprint(holds.map((h) => h.mentorPersonId)),
        recipients,
        counts: countByStatus(recipients),
        blocked: loaded.blocked,
        dispatch: {
          sentInWindow,
          allowance,
          readyGroups: groups.length,
          readyPeople: batchSize(groups),
          nextBatchGroups: next.length,
          nextBatchPeople: batchSize(next),
          roomToday: sentInWindow === null ? 0 : Math.max(0, DAILY_EMAIL_LIMIT - DISPATCH_RESERVE - sentInWindow)
        }
      }
    };
  } catch (error) {
    log("load failed", error);
    return { ok: false, message: "Không đọc được dữ liệu kết quả ghép cặp. Thử tải lại trang; nếu vẫn lỗi, báo quản trị viên." };
  }
}

// ---------------------------------------------------------------------------
// Độ phủ và xem trước — chỉ chạy khi BTC bấm xem, không chạy mỗi lần mở trang
// ---------------------------------------------------------------------------

export type CoverageRow = { personId: string; role: ProfileRole; fullName: string | null; missing: string[] };
export type MatchResultCoverage = Record<ProfileRole, { total: number; fields: FieldCoverage[]; people: CoverageRow[] }>;

/**
 * Thẻ của mọi người đang có cặp (đúng thẻ người đồng hành sẽ thấy, kể cả SĐT/email) — đếm mỗi trường
 * có ở bao nhiêu thẻ và liệt kê ai thiếu gì.
 */
export async function getMatchResultCoverage(seasonId: string): Promise<{ ok: true; coverage: MatchResultCoverage } | { ok: false; message: string }> {
  try {
    const { client, seasonId: current } = await round2SeasonContext();
    if (current !== seasonId || !(await round2Operator(seasonId))) return { ok: false, message: DENIED };
    const loaded = await loadInputs(client, seasonId);
    const subjects: ProfileSubject[] = [];
    const seen = new Set<string>();
    for (const m of loaded.matches) {
      for (const s of [{ personId: m.mentorPersonId, role: "mentor" as const }, { personId: m.menteePersonId, role: "mentee" as const }]) {
        const key = profileSourceKey(s.personId, s.role);
        if (!seen.has(key)) {
          seen.add(key);
          subjects.push(s);
        }
      }
    }
    const sources = await loadProfileSources(client, seasonId, subjects);
    const coverage = {} as MatchResultCoverage;
    for (const role of ["mentor", "mentee"] as const) {
      const cards: { personId: string; card: ProfileCard }[] = [];
      for (const s of subjects.filter((x) => x.role === role)) {
        const src = sources.get(profileSourceKey(s.personId, role));
        if (src) cards.push({ personId: s.personId, card: src.card(src.contact) });
      }
      const people = cards
        .map(({ personId, card }) => ({ personId, role, fullName: loaded.people.get(personId)?.fullName ?? null, missing: missingFieldLabels(card) }))
        .filter((r) => r.missing.length > 0)
        .sort((a, b) => b.missing.length - a.missing.length || String(a.fullName ?? "").localeCompare(String(b.fullName ?? ""), "vi"));
      coverage[role] = { ...profileCoverage(role, cards.map((c) => c.card)), people };
    }
    return { ok: true, coverage };
  } catch (error) {
    log("coverage failed", error);
    return { ok: false, message: "Không tính được độ phủ dữ liệu. Thử lại sau ít phút." };
  }
}

/**
 * Thẻ của một người, đúng như người đồng hành sẽ thấy — chỉ cho người đang có cặp ở mùa này, không
 * tạo token nào.
 */
export async function getMatchResultPreview(
  seasonId: string,
  role: ProfileRole,
  personId: string
): Promise<{ ok: true; card: ProfileCard } | { ok: false; message: string }> {
  if (!UUID.test(personId) || (role !== "mentor" && role !== "mentee")) return { ok: false, message: "Không tìm thấy người này." };
  try {
    const { client, seasonId: current } = await round2SeasonContext();
    if (current !== seasonId || !(await round2Operator(seasonId))) return { ok: false, message: DENIED };
    const column = role === "mentor" ? "mentor_person_id" : "mentee_person_id";
    const { data, error } = await client
      .from("matches")
      .select("id")
      .eq("season_id", seasonId)
      .eq("status", "active")
      .eq(column, personId)
      .limit(1);
    if (error) throw error;
    if (!data?.length) return { ok: false, message: "Người này không có cặp nào đang hoạt động ở mùa này." };
    const card = await getProfilePreview(client, seasonId, personId, role);
    return card ? { ok: true, card } : { ok: false, message: "Không tìm thấy người này." };
  } catch (error) {
    log("preview failed", error);
    return { ok: false, message: "Không đọc được hồ sơ. Thử lại sau ít phút." };
  }
}

// ---------------------------------------------------------------------------
// Ghi
// ---------------------------------------------------------------------------

async function operator() {
  const { client, seasonId } = await round2SeasonContext();
  const actor = await round2Operator(seasonId);
  return { client, seasonId, actor: actor?.id ? actor : null };
}

/** Đổi danh sách giữ lại thì phải xác nhận lại: gỡ dấu xác nhận, chỉ chạm hai cột đó. */
async function resetHoldsConfirmation(client: any, seasonId: string) {
  const { error } = await client
    .from("match_result_settings")
    .upsert({ season_id: seasonId, holds_confirmed_at: null, holds_confirmed_by: null }, { onConflict: "season_id" });
  return error;
}

/**
 * Link đăng ký Kick-off. Chỉ chạm cột đó cùng người/giờ sửa — không đụng dấu xác nhận danh sách.
 * Handbook không nhập ở đây: file nằm trên VAM OS, link cố định (lib/handbook.ts).
 */
export async function saveMatchResultSettings(input: { kickoffRegisterUrl: unknown }): Promise<Result> {
  const checked = validateHttpsUrl(input.kickoffRegisterUrl);
  if (!checked.ok) return { ok: false, message: `Kick-off: ${checked.message}` };
  try {
    const { client, seasonId, actor } = await operator();
    if (!actor) return { ok: false, message: DENIED };
    const { error } = await client.from("match_result_settings").upsert(
      {
        season_id: seasonId,
        kickoff_register_url: checked.value,
        updated_by: actor.id,
        updated_at: new Date().toISOString()
      },
      { onConflict: "season_id" }
    );
    if (error) {
      log("settings save failed", error);
      return { ok: false, message: "Không lưu được. Thử lại; nếu vẫn lỗi, báo quản trị viên." };
    }
    return { ok: true, message: "Đã lưu link đăng ký Kick-off." };
  } catch (error) {
    log("settings save crashed", error);
    return { ok: false, message: "Không lưu được. Thử lại; nếu vẫn lỗi, báo quản trị viên." };
  }
}

/** Mentor đã duyệt của mùa, kèm mọi email biết được (hồ sơ người + đơn mùa này). */
async function holdCandidates(client: any, seasonId: string): Promise<HoldCandidate[]> {
  const apps = await readAllPages<Row>("applications", "id,person_id,email_primary", (columns) =>
    client.from("applications").select(columns).eq("season_id", seasonId).eq("status", "approved_as_mentor")
  );
  if (apps.error) throw new Error("READ_FAILED");
  const ids = Array.from(new Set(apps.data.map((a) => String(a.person_id ?? "")).filter(Boolean)));
  const people = await readAllPagesIn<Row>(client, "people", "id", ids, "id,full_name,email_primary");
  if (people.error) throw new Error("READ_FAILED");
  const byId = new Map<string, { fullName: string | null; emails: string[] }>();
  for (const id of ids) byId.set(id, { fullName: null, emails: [] });
  for (const p of people.data) {
    const entry = byId.get(String(p.id));
    if (!entry) continue;
    entry.fullName = text(p.full_name);
    if (p.email_primary) entry.emails.push(String(p.email_primary));
  }
  for (const a of apps.data) if (a.email_primary) byId.get(String(a.person_id))?.emails.push(String(a.email_primary));
  return Array.from(byId.entries()).map(([personId, v]) => ({ personId, fullName: v.fullName, emails: v.emails }));
}

/**
 * Thêm mentor vào danh sách giữ lại từ một ô dán email. Tất cả hoặc không: một email không đọc được,
 * không khớp, hay khớp hai người thì không ghi gì cả và báo lại đúng email đó — BTC sửa rồi dán lại,
 * không phải đoán xem dòng nào đã vào.
 */
export async function addMatchResultHolds(input: { text: unknown; reason: unknown }): Promise<Result> {
  const parsed = parseHoldEmailInput(input.text);
  if (parsed.invalid.length) return { ok: false, message: `Không đọc được email: ${parsed.invalid.join(", ")}. Chưa ghi gì.` };
  if (!parsed.emails.length) return { ok: false, message: "Dán ít nhất một email mentor." };
  const reason = (text(input.reason) ?? DEFAULT_HOLD_REASON).slice(0, MAX_HOLD_REASON);
  try {
    const { client, seasonId, actor } = await operator();
    if (!actor) return { ok: false, message: DENIED };
    const resolution = resolveHoldEmails(parsed.emails, await holdCandidates(client, seasonId));
    if (resolution.unmatched.length) {
      const lines = resolution.unmatched.map((u) =>
        u.reason === "ambiguous"
          ? `${u.email} (trùng ${u.names.length} người: ${u.names.map((n) => n ?? "chưa có tên").join(", ")})`
          : `${u.email} (không thấy mentor đã duyệt mùa này)`
      );
      return { ok: false, message: `Không khớp: ${lines.join("; ")}. Chưa ghi gì.` };
    }

    const existing = await readAllPages<Row>("match_result_holds", "id,mentor_person_id,removed_at", (columns) =>
      client.from("match_result_holds").select(columns).eq("season_id", seasonId)
    );
    if (existing.error) throw existing.error;
    const byMentor = new Map(existing.data.map((h) => [String(h.mentor_person_id), h]));
    const now = new Date().toISOString();
    const inserts: Row[] = [];
    let restored = 0;
    let already = 0;
    for (const m of resolution.matched) {
      const row = byMentor.get(m.personId);
      if (row && !row.removed_at) {
        already += 1;
        continue;
      }
      if (row) {
        const { error } = await client
          .from("match_result_holds")
          .update({ input_email: m.email, reason, created_by: actor.id, created_at: now, removed_at: null, removed_by: null })
          .eq("id", row.id);
        if (error) throw error;
        restored += 1;
        continue;
      }
      inserts.push({ season_id: seasonId, mentor_person_id: m.personId, input_email: m.email, reason, created_by: actor.id });
    }
    if (inserts.length) {
      const { error } = await client.from("match_result_holds").insert(inserts);
      if (error) throw error;
    }
    const added = inserts.length + restored;
    if (added) {
      const error = await resetHoldsConfirmation(client, seasonId);
      if (error) throw error;
    }
    const tail = already ? ` ${already} mentor đã có sẵn trong danh sách.` : "";
    return added
      ? { ok: true, message: `Đã giữ lại ${added} mentor.${tail} Danh sách đã đổi — cần bấm xác nhận lại.` }
      : { ok: true, message: `Không có gì mới.${tail}` };
  } catch (error) {
    log("add holds failed", error);
    return { ok: false, message: "Không lưu được danh sách giữ lại. Tải lại trang để xem phần nào đã vào." };
  }
}

/** Bỏ giữ một mentor: ghi removed_at, không xoá dòng — còn dấu ai đã giữ, ai đã bỏ. */
export async function removeMatchResultHold(input: { mentorPersonId: unknown }): Promise<Result> {
  const mentorPersonId = String(input.mentorPersonId ?? "").trim();
  if (!UUID.test(mentorPersonId)) return { ok: false, message: "Dữ liệu không hợp lệ — tải lại trang rồi thử lại." };
  try {
    const { client, seasonId, actor } = await operator();
    if (!actor) return { ok: false, message: DENIED };
    const { data, error } = await client
      .from("match_result_holds")
      .update({ removed_at: new Date().toISOString(), removed_by: actor.id })
      .eq("season_id", seasonId)
      .eq("mentor_person_id", mentorPersonId)
      .is("removed_at", null)
      .select("id");
    if (error) throw error;
    if (!data?.length) return { ok: false, message: "Mentor này không còn trong danh sách giữ lại — tải lại trang." };
    const resetError = await resetHoldsConfirmation(client, seasonId);
    if (resetError) throw resetError;
    return { ok: true, message: "Đã bỏ giữ. Danh sách đã đổi — cần bấm xác nhận lại." };
  } catch (error) {
    log("remove hold failed", error);
    return { ok: false, message: "Không bỏ giữ được. Tải lại trang rồi thử lại." };
  }
}

/**
 * Chốt danh sách giữ lại — chỉ đúng danh sách BTC đang nhìn. Nếu ai đó vừa thêm/bỏ một mentor ở tab
 * khác, dấu trên form không còn khớp và không chốt gì.
 */
export async function confirmMatchResultHolds(input: { fingerprint: unknown }): Promise<Result> {
  const shown = String(input.fingerprint ?? "");
  try {
    const { client, seasonId, actor } = await operator();
    if (!actor) return { ok: false, message: DENIED };
    const holds = await readActiveHolds(client, seasonId);
    if (holds.error) throw holds.error;
    if (holdsFingerprint(holds.data.map((h) => String(h.mentor_person_id))) !== shown) {
      return { ok: false, message: "Danh sách vừa được đổi ở nơi khác — tải lại trang, xem lại rồi xác nhận." };
    }
    const { error } = await client
      .from("match_result_settings")
      .upsert({ season_id: seasonId, holds_confirmed_at: new Date().toISOString(), holds_confirmed_by: actor.id }, { onConflict: "season_id" });
    if (error) throw error;
    return { ok: true, message: `Đã xác nhận danh sách giữ lại (${holds.data.length} mentor).` };
  } catch (error) {
    log("confirm holds failed", error);
    return { ok: false, message: "Không xác nhận được. Tải lại trang rồi thử lại." };
  }
}
