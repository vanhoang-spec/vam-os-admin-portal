/**
 * lib/recap-import-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reading a Facebook recap post: the address, the date, and the few lines at
 * the top that say who and what.
 *
 * Pure and dependency-light, because every rule here is a guess about somebody
 * else's text and guesses need tests. Three of them carry real weight:
 *
 * NORMALISING THE PERMALINK is what makes a second scan of the same window
 * harmless. Facebook hands out the same post as m.facebook, web.facebook and
 * www.facebook, with a different tracking query each time. Unless those collapse
 * to one string, the unique index in migration 070 protects nothing.
 *
 * THE DATE OF THE MEETING is not the date of the post. Students write up a
 * session days later and put the real date in the header, "[RECAP BUỔI 3 -
 * 14/03/2026]". That wins over the posting time whenever it is there.
 *
 * PARSING THE HEADER is deliberately forgiving. A post that does not follow the
 * house format still becomes a row — with empty fields and a reviewer's
 * attention — because a missed recap is worse than an unparsed one.
 */

// ── Permalink ────────────────────────────────────────────────────────────────

/** Query parameters Facebook attaches for its own tracking; none identify the post. */
const TRACKING_PARAM_PREFIXES = ["__cft__", "__tn__", "__eep__"];

/**
 * One post, one string.
 *
 * Keeps only the path, drops every query parameter and fragment, and settles on
 * one host spelling. Returns null for anything that is not a group post URL, so
 * a stray link in the feed cannot enter the staging table.
 */
export function normalizePermalink(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase().replace(/^(m|web|mbasic|touch)\./, "");
  if (host !== "facebook.com" && host !== "www.facebook.com") return null;

  // Strip the trailing slash but keep the path shape: /groups/<id>/posts/<id>
  const path = url.pathname.replace(/\/+$/, "");
  if (!/^\/groups\/[^/]+\/(posts|permalink)\/[^/]+/.test(path)) return null;

  return `https://www.facebook.com${path}`;
}

/** The group a permalink belongs to, for checking a batch is what it claims. */
export function groupIdFromPermalink(permalink: string): string | null {
  const match = String(permalink ?? "").match(/facebook\.com\/groups\/([^/]+)\//);
  return match?.[1] ?? null;
}

/** True when a URL carries only Facebook's own tracking noise beyond the path. */
export function hasOnlyTrackingParams(value: string): boolean {
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (!TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** The programme runs on Vietnamese wall-clock time, like the interview schedule. */
export const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

function toVnDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** YYYY-MM-DD in Vietnam time, or null when the value is not a time at all. */
export function toVnDate(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return toVnDateString(parsed);
}

/** The operational month a recap belongs to, from its date. */
export function monthFromDate(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : null;
}

/**
 * A date written by a person, as it appears in a recap header.
 *
 * Accepts 14/03/2026, 14-3-26 and 2026-03-14. Day comes first: this is a
 * Vietnamese programme, and "03/04" means the third of April to everyone who
 * writes it.
 */
export function parseWrittenDate(value: unknown, now = new Date()): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = raw.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (!dmy) return null;

  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  let year = dmy[3] ? Number(dmy[3]) : Number(toVnDateString(now).slice(0, 4));
  if (year < 100) year += 2000;

  return buildDate(year, month, day);
}

function buildDate(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Reject the 31st of February and friends.
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== day) return null;
  return iso;
}

/**
 * The relative timestamps Facebook prints on a post, in Vietnamese.
 *
 * "2 giờ", "Hôm qua", "3 ngày", "1 tuần" — resolved against the moment of
 * collection. Accurate to the day, which is all the monthly reporting needs, and
 * a day either way at the edge of a window is absorbed by the permalink dedupe.
 */
export function parseRelativeVietnameseTime(value: unknown, now = new Date()): string | null {
  const raw = String(value ?? "").toLowerCase().trim();
  if (!raw) return null;

  // An absolute date in the label wins: "14 Tháng 3, 2026" or "14/03/2026".
  const written = parseWrittenDate(raw, now);
  if (written) return written;

  const monthName = raw.match(/(\d{1,2})\s*tháng\s*(\d{1,2})(?:[,\s]+(\d{4}))?/);
  if (monthName) {
    const year = monthName[3] ? Number(monthName[3]) : Number(toVnDateString(now).slice(0, 4));
    const built = buildDate(year, Number(monthName[2]), Number(monthName[1]));
    if (built) return built;
  }

  const shift = (days: number) => toVnDateString(new Date(now.getTime() - days * 86_400_000));

  if (/vừa xong|vài giây|một phút|1 phút|\d+\s*phút|\d+\s*giờ|hôm nay/.test(raw)) return shift(0);
  if (/hôm qua/.test(raw)) return shift(1);

  const days = raw.match(/(\d+)\s*ngày/);
  if (days) return shift(Number(days[1]));

  const weeks = raw.match(/(\d+)\s*tuần/);
  if (weeks) return shift(Number(weeks[1]) * 7);

  return null;
}

// ── The header of a recap post ───────────────────────────────────────────────

export type ParsedHeader = {
  mssv: string | null;
  meetingType: string | null;
  meetingTypeRaw: string | null;
  topic: string | null;
  mentorNames: string | null;
  menteeNames: string | null;
  location: string | null;
  meetingTimeRaw: string | null;
  /** A date written in the header, which beats the posting time. */
  writtenDate: string | null;
};

/** The hashtags the programme uses, mapped onto mentoring_recaps.meeting_type. */
const MEETING_TYPE_BY_TAG: Record<string, string> = {
  mentoring: "1on1_primary",
  crossmentoring: "1on1_cross",
  "cross-mentoring": "1on1_cross",
  cross: "1on1_cross",
  groupmentoring: "group",
  training: "group",
  online: "online",
  offline: "offline"
};

/** Student ids as the programme writes them: #UEHEM11104, #HAM2045. */
const DEFAULT_STUDENT_ID_PATTERN = /#((?:uehe[mf]|ueh|ham)[a-z]*\d{3,})/i;

export function mapMeetingType(tag: unknown): string | null {
  const key = String(tag ?? "").toLowerCase().replace(/^#/, "").trim();
  if (!key) return null;
  return MEETING_TYPE_BY_TAG[key] ?? null;
}

/**
 * Read the first lines of a post.
 *
 * Every field is optional. A post that ignores the house format yields a row
 * with nulls and lands in the reviewer's "needs a decision" pile, which is the
 * right outcome: the organisers would rather see it than lose it.
 */
export function parsePostHeader(content: unknown, now = new Date()): ParsedHeader {
  const text = String(content ?? "").replace(/\r\n/g, "\n");

  // The header is what comes before the first rule line, when there is one.
  const [beforeRule] = text.split(/\n\s*[_\-–—]{3,}\s*\n/);
  // Failing that, the first few lines carry the metadata.
  const header = (beforeRule ?? text).split("\n").slice(0, 12).join("\n");

  const mssvMatch = header.match(DEFAULT_STUDENT_ID_PATTERN);
  const mssv = mssvMatch ? mssvMatch[1].toUpperCase() : null;

  // Every hashtag except the student id is a candidate for the meeting type.
  const tags = Array.from(header.matchAll(/#([a-zA-ZÀ-ỹ0-9_-]+)/g)).map((match) => match[1]);
  let meetingTypeRaw: string | null = null;
  let meetingType: string | null = null;
  for (const tag of tags) {
    if (mssv && tag.toUpperCase() === mssv) continue;
    const mapped = mapMeetingType(tag);
    if (mapped) {
      meetingTypeRaw = tag;
      meetingType = mapped;
      break;
    }
    if (!meetingTypeRaw) meetingTypeRaw = tag;
  }

  const bracket = header.match(/\[([^\]]{2,160})\]/);
  const topic = bracket ? clean(bracket[1]) : null;

  // A date inside the header, usually in "[RECAP BUỔI 3 - 14/03/2026]".
  const writtenDate = bracket ? parseWrittenDate(bracket[1], now) : null;

  return {
    mssv,
    meetingType,
    meetingTypeRaw,
    topic,
    mentorNames: matchLabel(header, /mentor\s*:\s*(.+)/gi),
    menteeNames: matchLabel(header, /mentee\s*:\s*(.+)/gi),
    location: matchLabel(header, /(?:địa điểm|dia diem|location)\s*:\s*(.+)/gi),
    meetingTimeRaw: matchLabel(header, /(?:thời gian|thoi gian|time)\s*:\s*(.+)/gi),
    writtenDate
  };
}

/**
 * Collect every occurrence of a label, not just the first.
 *
 * A cross-mentoring post lists two mentors on two lines; the tool this replaces
 * kept only one of them, which is how the second mentor disappeared from the
 * record.
 */
function matchLabel(text: string, pattern: RegExp): string | null {
  const values: string[] = [];
  for (const match of Array.from(text.matchAll(pattern))) {
    const value = clean(match[1]);
    if (value && !values.includes(value)) values.push(value);
  }
  return values.length ? values.join(", ") : null;
}

function clean(value: unknown, maxLength = 300): string {
  const text = String(value ?? "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// ── Truncation ───────────────────────────────────────────────────────────────

/**
 * Did Facebook cut the text off?
 *
 * The collector clicks "Xem thêm" before reading, but a post can still arrive
 * shortened. Half a recap imported silently is worse than one flagged for a
 * human to open.
 */
export function looksTruncated(content: unknown): boolean {
  const text = String(content ?? "").trimEnd();
  if (!text) return false;
  if (/(?:xem thêm|see more|hiển thị thêm)$/i.test(text)) return true;
  return /[…]$|\.{3}$/.test(text);
}

// ── The payload the extension sends ──────────────────────────────────────────

export type IncomingItem = {
  permalink: string;
  postedAt: string | null;
  authorName: string | null;
  content: string | null;
  /** What the collector read off the post's timestamp, already resolved to a date. */
  postedDate: string | null;
};

export type PreparedItem = {
  permalink: string;
  posted_at: string | null;
  meeting_date: string | null;
  author_name: string | null;
  mssv_raw: string | null;
  meeting_type: string | null;
  topic: string | null;
  mentor_names: string | null;
  mentee_names: string | null;
  location: string | null;
  meeting_time_raw: string | null;
  content_full: string | null;
  content_truncated: boolean;
};

export type PreparePayloadResult =
  | { ok: true; groupId: string; items: PreparedItem[]; skipped: string[] }
  | { ok: false; message: string };

export const MAX_ITEMS_PER_BATCH = 300;
export const MAX_CONTENT_LENGTH = 20_000;

/**
 * Turn what the extension collected into rows, or refuse the whole payload.
 *
 * Anything without a usable permalink is dropped and named in `skipped`: the
 * operator should be told the collector saw something it could not file, rather
 * than discovering the gap a month later.
 */
export function preparePayload(payload: unknown, now = new Date()): PreparePayloadResult {
  const body = (payload ?? {}) as { group_id?: unknown; items?: unknown };

  const groupId = String(body.group_id ?? "").trim();
  if (!groupId || !/^[a-zA-Z0-9._-]{3,64}$/.test(groupId)) {
    return { ok: false, message: "Thiếu hoặc sai mã group Facebook." };
  }

  if (!Array.isArray(body.items)) {
    return { ok: false, message: "Payload không có danh sách bài viết." };
  }
  if (body.items.length === 0) {
    return { ok: false, message: "Không có bài viết nào trong khoảng thời gian đã chọn." };
  }
  if (body.items.length > MAX_ITEMS_PER_BATCH) {
    return {
      ok: false,
      message: `Mỗi lượt gửi tối đa ${MAX_ITEMS_PER_BATCH} bài. Vui lòng thu hẹp khoảng thời gian.`
    };
  }

  const items: PreparedItem[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const raw of body.items as Array<Record<string, unknown>>) {
    const permalink = normalizePermalink(raw?.permalink);
    if (!permalink) {
      skipped.push(String(raw?.permalink ?? "(không có đường dẫn)").slice(0, 120));
      continue;
    }
    // The same post can appear twice in one scan when the feed re-renders.
    if (seen.has(permalink)) continue;
    seen.add(permalink);

    const content = raw?.content == null ? null : String(raw.content).slice(0, MAX_CONTENT_LENGTH);
    const header = parsePostHeader(content, now);

    const postedDate =
      toVnDate(raw?.posted_at) ??
      parseRelativeVietnameseTime(raw?.posted_label, now) ??
      (typeof raw?.posted_date === "string" ? raw.posted_date : null);

    items.push({
      permalink,
      posted_at: typeof raw?.posted_at === "string" ? raw.posted_at : null,
      // The header date wins: it is when they met, not when they wrote it up.
      meeting_date: header.writtenDate ?? postedDate,
      author_name: raw?.author_name ? clean(raw.author_name, 160) : null,
      mssv_raw: header.mssv,
      meeting_type: header.meetingType,
      topic: header.topic,
      mentor_names: header.mentorNames,
      mentee_names: header.menteeNames,
      location: header.location,
      meeting_time_raw: header.meetingTimeRaw,
      content_full: content,
      content_truncated: looksTruncated(content)
    });
  }

  if (!items.length) {
    return { ok: false, message: "Không có bài viết nào đọc được đường dẫn hợp lệ." };
  }

  return { ok: true, groupId, items, skipped };
}

/** Normalised student id for comparing against mentee_profiles.mssv. */
export function normalizeStudentId(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ── The collection rhythm ────────────────────────────────────────────────────

export type CollectionPeriod = {
  /** "Kỳ 1 tháng 03/2026" — what the reminder calls it. */
  label: string;
  start: string;
  end: string;
};

/** How many days a month has, February included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The period that closes today, or null on any other day.
 *
 * Two dates matter: the 15th closes the first half, the last day of the month
 * closes the second. Every other day the reminder route does nothing, which is
 * why it can safely run daily.
 *
 * The dedupe on permalink means a period is a suggestion, not a boundary — an
 * organiser who collects late, or twice, loses nothing.
 */
export function resolveCollectionPeriod(dateIso: string): CollectionPeriod | null {
  const match = String(dateIso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const last = daysInMonth(year, month);
  const mm = String(month).padStart(2, "0");

  if (day === 15) {
    return {
      label: `Kỳ 1 tháng ${mm}/${year}`,
      start: `${year}-${mm}-01`,
      end: `${year}-${mm}-15`
    };
  }

  if (day === last) {
    return {
      label: `Kỳ 2 tháng ${mm}/${year}`,
      start: `${year}-${mm}-16`,
      end: `${year}-${mm}-${String(last).padStart(2, "0")}`
    };
  }

  return null;
}

/** Today's date in Vietnam, as the reminder route sees it. */
export function todayInVietnam(now = new Date()): string {
  return toVnDateString(now);
}
