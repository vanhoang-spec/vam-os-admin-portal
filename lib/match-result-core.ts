/**
 * Thư kết quả ghép cặp mùa 12 (BTC 22/10/2026) — phần thuần, không I/O.
 *
 * Ở đây quyết định AI nhận thư, vì sao một người chưa nhận, và khi nào nút gửi bị khoá. Trang quản
 * trị (lib/match-result.ts) và việc gửi thư (PR2) đều đi qua đúng những hàm này, để màn hình không
 * bao giờ đếm một kiểu còn lúc gửi lại tính kiểu khác.
 *
 * Fail-closed ở mọi chỗ: không đọc được danh sách giữ lại thì coi như ai cũng đang bị giữ; thiếu link
 * Handbook hoặc danh sách giữ lại chưa xác nhận thì không gửi.
 */
import { MENTEE_PROFILE_LABELS, MENTOR_PROFILE_LABELS, type ProfileCard, type ProfileRole } from "@/lib/match-profile-core";

export type ActiveMatch = {
  id: string;
  mentorPersonId: string;
  menteePersonId: string;
  createdAt: string | null;
  round: number | null;
};

export type RecipientPerson = {
  fullName: string | null;
  email: string | null;
};

export type NoticeInfo = {
  personId: string;
  role: ProfileRole;
  matchIds: readonly string[];
  sentAt: string | null;
  lastError: string | null;
};

export type RecipientStatus = "pending" | "held" | "missing_email" | "too_new" | "sent" | "changed_since_sent";

export type HoldReason = "mentor_held" | "partner_held" | "self_inactive" | "partner_inactive" | "holds_unreadable";

export type RecipientPartner = { personId: string; fullName: string | null; matchId: string; round: number | null };

export type MatchResultRecipient = {
  personId: string;
  role: ProfileRole;
  fullName: string | null;
  email: string | null;
  partners: RecipientPartner[];
  /** Cặp hiện có, đã sắp xếp — so với `match_ids` của thư đã gửi để biết cặp có đổi không. */
  matchIds: string[];
  status: RecipientStatus;
  holdReason: HoldReason | null;
  sentAt: string | null;
  lastError: string | null;
};

/** Cặp vừa ghi chờ chừng này phút mới gửi: BTC còn đang ghép tiếp thì thư không mang danh sách thiếu. */
export const SETTLE_MINUTES = 30;

export const RECIPIENT_STATUS_LABELS: Record<RecipientStatus, string> = {
  pending: "Chờ gửi",
  held: "Giữ lại",
  missing_email: "Thiếu email",
  too_new: `Cặp mới (< ${SETTLE_MINUTES} phút)`,
  sent: "Đã gửi",
  changed_since_sent: "Đổi cặp sau khi gửi"
};

export const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  mentor_held: "Mentor trong danh sách giữ lại",
  partner_held: "Mentor đồng hành trong danh sách giữ lại",
  self_inactive: "Đã rút khỏi mùa",
  partner_inactive: "Người đồng hành đã rút khỏi mùa",
  holds_unreadable: "Không đọc được danh sách giữ lại"
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  const s = String(value ?? "").trim().toLowerCase();
  return EMAIL_PATTERN.test(s) ? s : null;
}

function sameIds(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((id, i) => id === sorted[i]);
}

function byName(a: { fullName: string | null }, b: { fullName: string | null }) {
  return String(a.fullName ?? "").localeCompare(String(b.fullName ?? ""), "vi");
}

/**
 * Danh sách người nhận: mọi cặp đang hoạt động của mùa, KHÔNG lọc theo vòng (vòng 1, 2, 3 và cặp
 * BTC ghép tay đều nhận), gộp theo người — mentor có 3 mentee nhận MỘT thư mang 3 link.
 *
 * `heldMentorIds = null` nghĩa là không đọc được danh sách giữ lại: mọi người chưa nhận thư đều bị
 * giữ, không ai được coi là "chờ gửi".
 *
 * Người đã nhận thư giữ trạng thái "đã gửi" kể cả khi sau đó bị giữ lại — thư đã đi rồi. Nếu cặp của
 * họ đổi sau khi gửi (hoặc mất hết cặp), họ hiện ở "đổi cặp sau khi gửi" để BTC xử lý từng người.
 */
export function buildRecipients(input: {
  matches: readonly ActiveMatch[];
  people: ReadonlyMap<string, RecipientPerson>;
  /** Mentor đang bị giữ ở mỗi vai: key là person_id mentor. */
  heldMentorIds: ReadonlySet<string> | null;
  /** Người rút khỏi mùa, theo vai: `mentor:<id>` / `mentee:<id>`. */
  inactiveKeys: ReadonlySet<string>;
  notices: readonly NoticeInfo[];
  now: number;
}): MatchResultRecipient[] {
  const settleMs = SETTLE_MINUTES * 60 * 1000;
  const isNew = (m: ActiveMatch) => {
    const at = Date.parse(String(m.createdAt ?? ""));
    // Không đọc được giờ tạo thì coi là mới: thà chờ thêm còn hơn gửi danh sách thiếu.
    return !Number.isFinite(at) || input.now - at < settleMs;
  };
  const inactive = (role: ProfileRole, personId: string) => input.inactiveKeys.has(`${role}:${personId}`);
  const heldMentorIds = input.heldMentorIds;

  const groups = new Map<string, { personId: string; role: ProfileRole; matches: ActiveMatch[] }>();
  for (const m of input.matches) {
    for (const [role, personId] of [["mentor", m.mentorPersonId], ["mentee", m.menteePersonId]] as const) {
      const key = `${role}:${personId}`;
      const group = groups.get(key) ?? { personId, role, matches: [] };
      group.matches.push(m);
      groups.set(key, group);
    }
  }
  const noticeByKey = new Map(input.notices.map((n) => [`${n.role}:${n.personId}`, n]));

  const out: MatchResultRecipient[] = [];
  for (const [key, g] of Array.from(groups.entries())) {
    const person = input.people.get(g.personId);
    const notice = noticeByKey.get(key) ?? null;
    const matchIds = g.matches.map((m) => m.id).sort();
    const partners = g.matches
      .map((m) => {
        const partnerId = g.role === "mentor" ? m.menteePersonId : m.mentorPersonId;
        return { personId: partnerId, fullName: input.people.get(partnerId)?.fullName ?? null, matchId: m.id, round: m.round };
      })
      .sort(byName);
    const partnerRole: ProfileRole = g.role === "mentor" ? "mentee" : "mentor";
    const mentorIds = g.role === "mentor" ? [g.personId] : g.matches.map((m) => m.mentorPersonId);

    let status: RecipientStatus;
    let holdReason: HoldReason | null = null;
    if (notice?.sentAt) {
      status = sameIds(notice.matchIds, matchIds) ? "sent" : "changed_since_sent";
    } else if (heldMentorIds === null) {
      status = "held";
      holdReason = "holds_unreadable";
    } else if (mentorIds.some((id) => heldMentorIds.has(id))) {
      status = "held";
      holdReason = g.role === "mentor" ? "mentor_held" : "partner_held";
    } else if (inactive(g.role, g.personId)) {
      status = "held";
      holdReason = "self_inactive";
    } else if (partners.some((p) => inactive(partnerRole, p.personId))) {
      // Link tới người đã rút sẽ báo "hết hiệu lực": giữ cả thư cho tới khi BTC kết thúc cặp đó.
      status = "held";
      holdReason = "partner_inactive";
    } else if (!normalizeEmail(person?.email)) {
      status = "missing_email";
    } else if (g.matches.some(isNew)) {
      status = "too_new";
    } else {
      status = "pending";
    }

    out.push({
      personId: g.personId,
      role: g.role,
      fullName: person?.fullName ?? null,
      email: normalizeEmail(person?.email),
      partners,
      matchIds,
      status,
      holdReason,
      sentAt: notice?.sentAt ?? null,
      lastError: notice?.lastError ?? null
    });
  }

  // Đã nhận thư nhưng giờ không còn cặp nào: vẫn phải hiện, để BTC báo lại cho người đó.
  for (const n of input.notices) {
    const key = `${n.role}:${n.personId}`;
    if (!n.sentAt || groups.has(key)) continue;
    const person = input.people.get(n.personId);
    out.push({
      personId: n.personId,
      role: n.role,
      fullName: person?.fullName ?? null,
      email: normalizeEmail(person?.email),
      partners: [],
      matchIds: [],
      status: "changed_since_sent",
      holdReason: null,
      sentAt: n.sentAt,
      lastError: n.lastError
    });
  }

  return out.sort((a, b) => (a.role === b.role ? byName(a, b) : a.role === "mentor" ? -1 : 1));
}

export type StatusCounts = Record<ProfileRole, Record<RecipientStatus, number>>;

export function countByStatus(recipients: readonly MatchResultRecipient[]): StatusCounts {
  const empty = (): Record<RecipientStatus, number> => ({ pending: 0, held: 0, missing_email: 0, too_new: 0, sent: 0, changed_since_sent: 0 });
  const counts: StatusCounts = { mentor: empty(), mentee: empty() };
  for (const r of recipients) counts[r.role][r.status] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Danh sách mentor giữ lại
// ---------------------------------------------------------------------------

/** Ô dán danh sách email: tách theo khoảng trắng, dấu phẩy, chấm phẩy, xuống dòng. */
export function parseHoldEmailInput(text: unknown): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const token of String(text ?? "").split(/[\s,;]+/)) {
    const raw = token.trim();
    if (!raw) continue;
    const email = normalizeEmail(raw);
    if (!email) {
      if (!invalid.includes(raw)) invalid.push(raw);
      continue;
    }
    if (!emails.includes(email)) emails.push(email);
  }
  return { emails, invalid };
}

export type HoldCandidate = { personId: string; fullName: string | null; emails: readonly string[] };

export type HoldResolution = {
  matched: { email: string; personId: string; fullName: string | null }[];
  unmatched: { email: string; reason: "not_found" | "ambiguous"; names: (string | null)[] }[];
};

/**
 * Mỗi email phải khớp ĐÚNG MỘT mentor đã duyệt của mùa (email trên hồ sơ người hoặc email trong đơn).
 * Khớp không ai hoặc khớp hai người thì báo lại, không đoán — giữ nhầm người là gửi nhầm thư.
 */
export function resolveHoldEmails(emails: readonly string[], candidates: readonly HoldCandidate[]): HoldResolution {
  const byEmail = new Map<string, HoldCandidate[]>();
  for (const c of candidates) {
    for (const raw of c.emails) {
      const email = normalizeEmail(raw);
      if (!email) continue;
      const list = byEmail.get(email) ?? [];
      if (!list.some((x) => x.personId === c.personId)) list.push(c);
      byEmail.set(email, list);
    }
  }
  const matched: HoldResolution["matched"] = [];
  const unmatched: HoldResolution["unmatched"] = [];
  for (const email of emails) {
    const hits = byEmail.get(email) ?? [];
    if (hits.length === 1) {
      if (!matched.some((m) => m.personId === hits[0].personId)) matched.push({ email, personId: hits[0].personId, fullName: hits[0].fullName });
    } else {
      unmatched.push({ email, reason: hits.length ? "ambiguous" : "not_found", names: hits.map((h) => h.fullName) });
    }
  }
  return { matched, unmatched };
}

/** Dấu của danh sách giữ lại đang hiện trên màn hình — nút xác nhận chỉ chốt đúng danh sách đã xem. */
export function holdsFingerprint(mentorPersonIds: readonly string[]): string {
  return Array.from(new Set(mentorPersonIds)).sort().join(",");
}

// ---------------------------------------------------------------------------
// Cài đặt và lý do khoá gửi
// ---------------------------------------------------------------------------

export const SETTINGS_URL_MAX_LENGTH = 500;

/** Link trong thư: chỉ https, không khoảng trắng, tối đa 500 ký tự. Để trống = null (hợp lệ). */
export function validateHttpsUrl(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: true, value: null };
  if (value.length > SETTINGS_URL_MAX_LENGTH) return { ok: false, message: `Link dài quá ${SETTINGS_URL_MAX_LENGTH} ký tự.` };
  if (!/^https:\/\/[^\s]+$/.test(value)) return { ok: false, message: "Link phải bắt đầu bằng https:// và không có khoảng trắng." };
  try {
    if (!new URL(value).hostname) return { ok: false, message: "Link không hợp lệ." };
  } catch {
    return { ok: false, message: "Link không hợp lệ." };
  }
  return { ok: true, value };
}

export type MatchResultSettings = {
  menteeHandbookUrl: string | null;
  mentorHandbookUrl: string | null;
  kickoffRegisterUrl: string | null;
  holdsConfirmedAt: string | null;
};

/**
 * Vì sao chưa gửi được — rỗng nghĩa là gửi được. Link Kick-off KHÔNG chặn: thư ghi "BTC sẽ cập nhật
 * sau" khi chưa có. Không đọc được cài đặt hay danh sách giữ lại thì khoá, không đoán.
 */
export function sendBlockedReasons(input: {
  settings: MatchResultSettings | null;
  settingsReadOk: boolean;
  holdsReadOk: boolean;
}): string[] {
  const reasons: string[] = [];
  if (!input.settingsReadOk) reasons.push("Không đọc được cài đặt thư — tạm khoá gửi.");
  if (!input.holdsReadOk) reasons.push("Không đọc được danh sách mentor giữ lại — tạm khoá gửi.");
  if (input.settingsReadOk) {
    const s = input.settings;
    const ok = (v: string | null | undefined) => {
      const r = validateHttpsUrl(v);
      return r.ok && r.value !== null;
    };
    if (!ok(s?.menteeHandbookUrl)) reasons.push("Chưa nhập link Handbook cho mentee.");
    if (!ok(s?.mentorHandbookUrl)) reasons.push("Chưa nhập link Handbook cho mentor.");
    if (!s?.holdsConfirmedAt) reasons.push("Danh sách mentor giữ lại chưa được xác nhận.");
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Độ phủ dữ liệu hồ sơ
// ---------------------------------------------------------------------------

export function profileLabels(role: ProfileRole): readonly (readonly [string, string])[] {
  return role === "mentor" ? MENTOR_PROFILE_LABELS : MENTEE_PROFILE_LABELS;
}

export type FieldCoverage = { key: string; label: string; present: number };

/** Mỗi trường có ở bao nhiêu thẻ — trường nào thấp là chỗ BTC cần xem trước khi gửi. */
export function profileCoverage(role: ProfileRole, cards: readonly ProfileCard[]): { total: number; fields: FieldCoverage[] } {
  return {
    total: cards.length,
    fields: profileLabels(role).map(([key, label]) => ({
      key,
      label,
      present: cards.filter((c) => c.fields.some((f) => f.key === key)).length
    }))
  };
}

/** Nhãn các trường bị ẩn trên một thẻ (vì không có dữ liệu ở nguồn nào). */
export function missingFieldLabels(card: ProfileCard): string[] {
  const present = new Set(card.fields.map((f) => f.key));
  return profileLabels(card.role).filter(([key]) => !present.has(key)).map(([, label]) => label);
}
