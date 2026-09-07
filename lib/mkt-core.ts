/**
 * lib/mkt-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The parts of the MKT plan that must never depend on a model answering well.
 *
 * The rule this module exists to hold: **the schedule is arithmetic, the words
 * are the model's.** The app decides which day, which channel and which hour;
 * the model is handed that list and fills in ideas and captions. A malformed
 * answer then costs the ideas for a few slots, visibly, instead of destroying
 * the week's shape.
 *
 * Everything here is pure and dependency-light — no `server-only`, no client —
 * because the slot arithmetic, the "who is this waiting on" label and the
 * publishing-hour suggestion are exactly the things worth unit tests.
 */

// ── Channels ─────────────────────────────────────────────────────────────────

export const MKT_CHANNELS = ["facebook", "tiktok", "youtube", "linkedin"] as const;
export type MktChannel = (typeof MKT_CHANNELS)[number];

export const CHANNEL_LABELS: Record<MktChannel, string> = {
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn"
};

/**
 * LinkedIn is one account for the whole of VAM, not one per school.
 *
 * The database says the same thing through a CHECK, and the two agree on
 * purpose: this predicate is what stops a programme's settings screen from
 * offering LinkedIn at all, and the CHECK is what stops anything that gets past
 * the screen.
 */
export function isSharedChannel(channel: unknown): boolean {
  return String(channel ?? "") === "linkedin";
}

/** The channels a space may run, given whether it is the shared VAM space. */
export function channelsForSpace(isShared: boolean): MktChannel[] {
  return MKT_CHANNELS.filter((channel) => isSharedChannel(channel) === isShared);
}

/**
 * Channels that are off until somebody switches them on.
 *
 * The owner asked for TikTok to be optional and decided later by the support
 * team. YouTube is in the same position — video is a different production
 * effort, and a programme should opt into it rather than out of it.
 */
export const OPTIONAL_CHANNELS: MktChannel[] = ["tiktok", "youtube"];

export function isOptionalChannel(channel: unknown): boolean {
  return OPTIONAL_CHANNELS.includes(String(channel ?? "") as MktChannel);
}

/**
 * Which weekdays each channel prefers, best first. 0 = Monday … 6 = Sunday.
 *
 * Spread rather than clustered: a programme posting three times on Facebook
 * wants Monday, Wednesday, Friday, not three days in a row. YouTube leans to
 * the weekend because that is when somebody will sit through a long video, and
 * LinkedIn to Monday morning because that is when its readers are at a desk.
 */
export const DAY_PRIORITY: Record<MktChannel, number[]> = {
  facebook: [0, 2, 4, 5, 1, 3, 6],
  tiktok: [1, 3, 5, 0, 2, 4, 6],
  youtube: [5, 6, 2, 0, 1, 3, 4],
  linkedin: [0, 2, 1, 3, 4, 5, 6]
};

const FALLBACK_TIME = "09:00";

// ── Dates, without a timezone trap ───────────────────────────────────────────

/**
 * The programme runs on Vietnamese wall-clock time, and `toISOString()` is how
 * a Monday becomes the Sunday before it.
 *
 * Everything below works on `YYYY-MM-DD` strings and explicit `+07:00`
 * offsets, so the answer does not depend on the clock of whatever machine is
 * rendering the page.
 */
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

export function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return date;
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of the week containing this date. Weeks start on Monday here. */
export function mondayOf(date: unknown): string {
  const text = String(date ?? "").slice(0, 10);
  const base = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return "";

  // getUTCDay(): 0 = Sunday. Shift so Monday is 0.
  const weekday = (base.getUTCDay() + 6) % 7;
  return addDays(text, -weekday);
}

/** Today and now, as Vietnam sees them. */
export function vietnamNow(now: Date = new Date()): { date: string; time: string } {
  const shifted = new Date(now.getTime() + VIETNAM_OFFSET_MS);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** A precise instant written the way a Vietnamese reader means it. */
export function vietnamInstant(date: string, time: string): string {
  const day = String(date ?? "").slice(0, 10);
  const clock = normalizeTime(time);
  return `${day}T${clock}:00+07:00`;
}

function normalizeTime(value: unknown): string {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return FALLBACK_TIME;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ── Slots ────────────────────────────────────────────────────────────────────

export type ChannelPlan = {
  channel: MktChannel;
  postsPerWeek: number;
  bestTimes: string[];
  /** True when this channel speaks to a different audience than the rest. */
  distinctAudience?: boolean;
};

export type MktSlot = {
  postDate: string;
  channel: MktChannel;
  slotTime: string;
  variantGroup: string;
};

/**
 * Divide a week into slots.
 *
 * Pure arithmetic over the channel mix and the golden hours. No model is
 * consulted, which is the whole point: the shape of the week is decided before
 * anybody asks for ideas, so a bad answer cannot change it.
 *
 * At most one post per channel per day — the database says the same thing with
 * a unique constraint, so a hand edit obeys it too.
 */
export function generateWeekSlots(input: {
  weekStart: string;
  channels: ChannelPlan[];
}): MktSlot[] {
  const monday = mondayOf(input.weekStart);
  if (!monday) return [];

  const slots: MktSlot[] = [];

  for (const channel of MKT_CHANNELS) {
    const plan = (input.channels ?? []).find((item) => item?.channel === channel);
    if (!plan) continue;

    const count = Math.max(0, Math.min(7, Math.round(Number(plan.postsPerWeek) || 0)));
    if (count === 0) continue;

    const times = (plan.bestTimes ?? []).map(normalizeTime).filter(Boolean);
    const hours = times.length ? times : [FALLBACK_TIME];

    const days = DAY_PRIORITY[channel].slice(0, count).sort((a, b) => a - b);

    days.forEach((day, index) => {
      slots.push({
        postDate: addDays(monday, day),
        channel,
        slotTime: hours[index % hours.length],
        // A channel written for a different audience gets its own group, so the
        // model reuses one idea across the channels that share readers and
        // starts fresh for the one that does not.
        variantGroup: plan.distinctAudience
          ? `${monday}-${channel.slice(0, 2).toUpperCase()}-D${day + 1}`
          : `${monday}-D${day + 1}`
      });
    });
  }

  return slots.sort(
    (a, b) =>
      a.postDate.localeCompare(b.postDate) ||
      MKT_CHANNELS.indexOf(a.channel) - MKT_CHANNELS.indexOf(b.channel)
  );
}

/** How many posts a week's mix produces — the number a design team feels. */
export function weeklyLoad(channels: ChannelPlan[]): number {
  return (channels ?? []).reduce(
    (total, plan) => total + Math.max(0, Math.min(7, Math.round(Number(plan?.postsPerWeek) || 0))),
    0
  );
}

// ── Where a post has got to ──────────────────────────────────────────────────

export const POST_STATUSES = [
  "planned",
  "content_ready",
  "draft_ready",
  "approved",
  "posted",
  "skipped"
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export type WaitingOn = "ai" | "designer" | "approver" | "publisher" | "done";

export type NextStep = { label: string; waitingOn: WaitingOn };

/**
 * One sentence saying who has the ball.
 *
 * The label on the card and the button next to it both come from here. Deriving
 * "what happens next" in two places is a guarantee that one day they disagree,
 * and the day they disagree is the day somebody publishes a post that was not
 * approved.
 */
export function nextStep(post: {
  status?: unknown;
  content?: unknown;
  assetUrls?: unknown;
}): NextStep {
  const status = String(post?.status ?? "planned");

  if (status === "posted") return { label: "Đã đăng", waitingOn: "done" };
  if (status === "skipped") return { label: "Đã bỏ qua", waitingOn: "done" };
  if (status === "approved") {
    return { label: "Đã duyệt — tới giờ thì đăng", waitingOn: "publisher" };
  }

  const content = String(post?.content ?? "").trim();
  if (!content) return { label: "Chờ viết nội dung", waitingOn: "ai" };

  const assets = Array.isArray(post?.assetUrls) ? post.assetUrls.filter(Boolean) : [];
  if (!assets.length) return { label: "Chờ thiết kế gắn hình", waitingOn: "designer" };

  return { label: "Sẵn sàng duyệt", waitingOn: "approver" };
}

/** The status a post should carry given what it now holds. */
export function derivedStatus(post: {
  status?: unknown;
  content?: unknown;
  assetUrls?: unknown;
}): PostStatus {
  const status = String(post?.status ?? "planned") as PostStatus;

  // Approved and beyond are decisions somebody made; they are not recomputed
  // from the contents of the row.
  if (["approved", "posted", "skipped"].includes(status)) return status;

  const step = nextStep(post);
  if (step.waitingOn === "ai") return "planned";
  if (step.waitingOn === "designer") return "content_ready";
  return "draft_ready";
}

/** Only a post that has both words and artwork may be approved. */
export function canApprove(post: { status?: unknown; content?: unknown; assetUrls?: unknown }): boolean {
  return nextStep(post).waitingOn === "approver";
}

// ── When it actually goes out ────────────────────────────────────────────────

/**
 * Suggest the hour to publish, when somebody approves a post.
 *
 * A slot still in the future keeps its hour. A slot whose hour has passed moves
 * to the next golden hour left today, and if there is none left, to the first
 * golden hour tomorrow — approving a Monday post on Wednesday should not
 * schedule it into the past.
 */
export function suggestScheduledAt(input: {
  postDate: string;
  slotTime?: string | null;
  bestTimes?: string[];
  now?: Date;
}): string {
  const now = vietnamNow(input.now ?? new Date());
  const slotTime = normalizeTime(input.slotTime ?? FALLBACK_TIME);
  const hours = (input.bestTimes ?? []).map(normalizeTime).filter(Boolean);
  const golden = hours.length ? Array.from(new Set(hours)).sort() : [slotTime];

  const date = String(input.postDate ?? "").slice(0, 10);

  // Still ahead of us: leave it exactly where the plan put it.
  if (date > now.date) return vietnamInstant(date, slotTime);
  if (date === now.date && slotTime > now.time) return vietnamInstant(date, slotTime);

  const remainingToday = golden.filter((hour) => hour > now.time);
  if (remainingToday.length) return vietnamInstant(now.date, remainingToday[0]);

  return vietnamInstant(addDays(now.date, 1), golden[0]);
}

// ── The AI switch ────────────────────────────────────────────────────────────

export type MktAiEnv = {
  VAM_OS_MKT_AI_ENABLED?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  DEEPSEEK_BASE_URL?: string;
};

export type MktAiGate =
  | { canRun: true; apiKey: string; model: string; baseUrl: string }
  | { canRun: false; reason: string };

export const MKT_DEFAULT_MODEL = "deepseek-chat";
export const MKT_DEFAULT_BASE_URL = "https://api.deepseek.com";

/**
 * DeepSeek, and only DeepSeek.
 *
 * The owner asked for this module to run entirely on DeepSeek, and the
 * application's single provider call site already speaks nothing else — there
 * is no Anthropic branch to fall back to and none is added here.
 *
 * The switch is its own, not the matching module's: a programme may well want
 * help writing posts while it wants no help pairing people, and one flag for
 * both would make that impossible to express.
 */
export function evaluateMktAiGate(env: MktAiEnv): MktAiGate {
  if (env.VAM_OS_MKT_AI_ENABLED !== "true") {
    return { canRun: false, reason: "VAM_OS_MKT_AI_ENABLED chưa bật" };
  }

  const apiKey = (env.DEEPSEEK_API_KEY ?? "").trim();
  if (!apiKey) return { canRun: false, reason: "DEEPSEEK_API_KEY chưa cấu hình" };

  const baseUrl = (env.DEEPSEEK_BASE_URL ?? MKT_DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) {
    return { canRun: false, reason: "DEEPSEEK_BASE_URL phải là https" };
  }

  return {
    canRun: true,
    apiKey,
    model: (env.DEEPSEEK_MODEL ?? "").trim() || MKT_DEFAULT_MODEL,
    baseUrl
  };
}

// ── Reading what the model sent back ─────────────────────────────────────────

/**
 * Pull one JSON object out of an answer.
 *
 * Models fence their JSON in markdown and introduce it with a sentence often
 * enough that not handling it is a bug, not a nicety.
 */
export function readJsonObject(text: unknown): unknown {
  const raw = String(text ?? "");
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();

  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  const candidate = first >= 0 && last > first ? body.slice(first, last + 1) : body;

  return JSON.parse(candidate);
}

/**
 * Put the model's answer back on the slots the app decided.
 *
 * The last line of defence. Whatever comes back is matched to a slot by date
 * and channel, then by variant group and channel; anything unmatched is
 * dropped, and any slot with no answer stays empty and is counted.
 *
 * Empty and counted, never invented: a slot the operator can see is missing
 * costs five minutes, and a slot quietly filled with something plausible costs
 * a post nobody meant to publish.
 */
export function mergeIntoSlots<T extends Record<string, unknown>>(
  slots: MktSlot[],
  answers: T[]
): { merged: Array<MktSlot & { answer: T | null }>; missing: number } {
  const pool = Array.isArray(answers) ? answers.filter(Boolean) : [];
  const used = new Set<number>();

  const merged = (slots ?? []).map((slot) => {
    let index = pool.findIndex(
      (item, i) =>
        !used.has(i) &&
        String(item.date ?? item.post_date ?? "").slice(0, 10) === slot.postDate &&
        String(item.channel ?? "") === slot.channel
    );

    if (index < 0) {
      index = pool.findIndex(
        (item, i) =>
          !used.has(i) &&
          String(item.variant_group ?? item.variantGroup ?? "") === slot.variantGroup &&
          String(item.channel ?? "") === slot.channel
      );
    }

    if (index >= 0) used.add(index);
    return { ...slot, answer: index >= 0 ? pool[index] : null };
  });

  return { merged, missing: merged.filter((item) => !item.answer).length };
}

/**
 * The Mondays a month's planning covers.
 *
 * Every week that has at least one day inside the month, which means the first
 * Monday may fall in the previous month and the last week may run into the
 * next. A month planned as four clean blocks leaves the days at its edges with
 * nobody responsible for them.
 */
export function weeksInMonth(month: unknown): string[] {
  const text = String(month ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return [];

  const first = `${text}-01`;
  const nextMonth = new Date(`${first}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const last = new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10);

  const weeks: string[] = [];
  let cursor = mondayOf(first);
  const stop = mondayOf(last);

  while (cursor && cursor <= stop) {
    weeks.push(cursor);
    cursor = addDays(cursor, 7);
  }

  return weeks;
}

/** The month a week belongs to — the month its Monday falls in. */
export function monthOfWeek(weekStart: unknown): string {
  const monday = mondayOf(weekStart);
  return monday ? monday.slice(0, 7) : "";
}
