import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canManageMktPlan, canViewMktPlan } from "@/lib/permissions";
import {
  addDays,
  generateWeekSlots,
  mergeIntoSlots,
  mondayOf,
  monthOfWeek,
  weeksInMonth,
  type MktChannel,
  type MktSlot
} from "@/lib/mkt-core";
import {
  buildMasterPlanPrompt,
  buildSystemPrompt,
  buildWeekPlanPrompt,
  type CalendarItem,
  type Direction,
  type MktOrder
} from "@/lib/mkt-prompt-core";
import { callMktJson } from "@/lib/mkt-ai";
import { getSpacePromptContext } from "@/lib/mkt-spaces";

/**
 * lib/mkt-plans.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The month, the week, and the moment the model is asked for ideas.
 *
 * Two rules run through everything here.
 *
 * THE SLOTS ARE DECIDED BEFORE ANYBODY ASKS FOR IDEAS. `generateWeekSlots` runs
 * on the channel mix and returns a fixed list of (day × channel × hour). That
 * list goes into the prompt and the answer is matched back onto it. A model
 * that returns six posts for seven slots costs one empty card the operator can
 * see, not a week with the wrong shape.
 *
 * REGENERATING NEVER DESTROYS SOMEBODY'S WORK. A post that has been approved,
 * posted, or already has artwork attached is left exactly as it is and counted
 * as preserved. The whole value of pressing "generate again" is gone the first
 * time it wipes a caption a person spent twenty minutes editing.
 */

const SAFE_ERROR = "Không thực hiện được thao tác. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[mkt-plans]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

// ── Master plan ──────────────────────────────────────────────────────────────

export type MasterPlan = {
  id: string;
  spaceId: string;
  month: string;
  theme: string | null;
  goals: string[];
  weeklyFocus: Array<{ week_start?: string; focus?: string; topic?: string; note?: string }>;
  contentNotes: string | null;
  notes: string | null;
  status: "draft" | "approved";
  aiModel: string | null;
  approvedAt: string | null;
};

function toMasterPlan(raw: unknown): MasterPlan {
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    spaceId: String(row.space_id ?? ""),
    month: String(row.month ?? ""),
    theme: (row.theme as string | null) ?? null,
    goals: Array.isArray(row.goals) ? (row.goals as string[]) : [],
    weeklyFocus: Array.isArray(row.weekly_focus) ? (row.weekly_focus as MasterPlan["weeklyFocus"]) : [],
    contentNotes: (row.content_notes as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    status: row.status === "approved" ? "approved" : "draft",
    aiModel: (row.ai_model as string | null) ?? null,
    approvedAt: (row.approved_at as string | null) ?? null
  };
}

const MASTER_COLUMNS =
  "id,space_id,month,theme,goals,weekly_focus,content_notes,notes,status,ai_model,approved_at";

export async function getMasterPlan(input: {
  spaceId: string;
  month: string;
}): Promise<MasterPlan | null> {
  const admin = await getCurrentAdminUser();
  if (!canViewMktPlan(admin?.role)) return null;
  if (!isValidUuid(input.spaceId)) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("mkt_master_plans")
    .select(MASTER_COLUMNS)
    .eq("space_id", input.spaceId)
    .eq("month", input.month)
    .maybeSingle();

  if (error) {
    log("read master plan", error);
    return null;
  }
  return data ? toMasterPlan(data) : null;
}

/** Ask the model for a month: a theme, goals, and a focus for each week. */
export async function generateMasterPlan(input: {
  spaceId?: unknown;
  month?: unknown;
}): Promise<MutationResult> {
  const spaceId = String(input.spaceId ?? "").trim();
  const month = String(input.month ?? "").trim();

  if (!isValidUuid(spaceId)) return { ok: false, message: "Không xác định được không gian." };

  const weeks = weeksInMonth(month);
  if (!weeks.length) return { ok: false, message: "Tháng không hợp lệ (định dạng YYYY-MM)." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền lập plan MKT." };
  }

  const context = await getSpacePromptContext(spaceId);
  if (!context) return { ok: false, message: "Không tìm thấy không gian." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const existing = await getMasterPlan({ spaceId, month });
  if (existing?.status === "approved") {
    return {
      ok: false,
      message: "Master plan tháng này đã duyệt. Muốn sinh lại thì mở khoá trước."
    };
  }

  const previous = await getMasterPlan({ spaceId, month: previousMonth(month) });

  const calendar = await readCalendar(client, {
    programId: context.space.programId,
    from: weeks[0],
    to: addDays(weeks[weeks.length - 1], 6)
  });

  const reply = await callMktJson<{
    theme?: string;
    goals?: string[];
    content_notes?: string;
    weekly_focus?: MasterPlan["weeklyFocus"];
    notes?: string;
  }>({
    systemPrompt: buildSystemPrompt({
      brandName: context.brandName,
      brandScope: context.brandScope,
      brand: context.space.brand,
      channels: context.briefs
    }),
    userPrompt: buildMasterPlanPrompt({
      brandName: context.brandName,
      month,
      weekStarts: weeks,
      calendar,
      previousTheme: previous?.theme ?? null
    }),
    maxTokens: 3000
  });

  if (!reply.ok) return { ok: false, message: reply.message };

  const payload = {
    space_id: spaceId,
    month,
    theme: text(reply.data.theme, 500),
    goals: Array.isArray(reply.data.goals) ? reply.data.goals.slice(0, 10) : [],
    weekly_focus: Array.isArray(reply.data.weekly_focus)
      ? reply.data.weekly_focus.slice(0, weeks.length)
      : [],
    content_notes: text(reply.data.content_notes, 4000),
    notes: text(reply.data.notes, 4000),
    status: "draft",
    ai_raw: reply.raw as Record<string, unknown>,
    ai_model: reply.model,
    created_by: admin.id
  };

  const { error } = existing
    ? await client.from("mkt_master_plans").update(payload).eq("id", existing.id)
    : await client.from("mkt_master_plans").insert(payload);

  if (error) {
    log("save master plan", error);
    return { ok: false, message: SAFE_ERROR };
  }

  const gaps = weeks.length - (payload.weekly_focus as unknown[]).length;
  return {
    ok: true,
    message: gaps > 0
      ? `Đã có bản nháp tháng, nhưng thiếu định hướng cho ${gaps} tuần — vui lòng điền tay.`
      : "Đã có bản nháp master plan. Vui lòng đọc lại và sửa trước khi duyệt."
  };
}

/** An organiser edits the month by hand. */
export async function saveMasterPlan(input: {
  spaceId?: unknown;
  month?: unknown;
  theme?: unknown;
  contentNotes?: unknown;
  notes?: unknown;
}): Promise<MutationResult> {
  const spaceId = String(input.spaceId ?? "").trim();
  const month = String(input.month ?? "").trim();

  if (!isValidUuid(spaceId) || !weeksInMonth(month).length) {
    return { ok: false, message: "Không xác định được tháng." };
  }

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa plan MKT." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client.from("mkt_master_plans").upsert(
    {
      space_id: spaceId,
      month,
      theme: text(input.theme, 500),
      content_notes: text(input.contentNotes, 4000),
      notes: text(input.notes, 4000),
      created_by: admin.id
    },
    { onConflict: "space_id,month" }
  );

  if (error) {
    log("upsert master plan", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: "Đã lưu master plan tháng." };
}

export async function approveMasterPlan(input: { planId?: unknown }): Promise<MutationResult> {
  const planId = String(input.planId ?? "").trim();
  if (!isValidUuid(planId)) return { ok: false, message: "Không xác định được plan." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền duyệt plan MKT." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client
    .from("mkt_master_plans")
    .update({ status: "approved", approved_by: admin.id, approved_at: new Date().toISOString() })
    .eq("id", planId);

  if (error) {
    log("approve master plan", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: "Đã duyệt master plan tháng." };
}

// ── Week plan ────────────────────────────────────────────────────────────────

export type WeekPlan = {
  id: string;
  spaceId: string;
  weekStart: string;
  topic: string | null;
  focus: string | null;
  contentNotes: string | null;
  orderReview: Array<{ order_ref?: string; relation?: string; handling?: string }>;
  ordersUnplaced: string[];
  status: "draft" | "approved";
  aiModel: string | null;
};

const WEEK_COLUMNS =
  "id,space_id,week_start,topic,focus,content_notes,order_review,orders_unplaced,status,ai_model";

function toWeekPlan(raw: unknown): WeekPlan {
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    spaceId: String(row.space_id ?? ""),
    weekStart: String(row.week_start ?? "").slice(0, 10),
    topic: (row.topic as string | null) ?? null,
    focus: (row.focus as string | null) ?? null,
    contentNotes: (row.content_notes as string | null) ?? null,
    orderReview: Array.isArray(row.order_review) ? (row.order_review as WeekPlan["orderReview"]) : [],
    ordersUnplaced: Array.isArray(row.orders_unplaced) ? (row.orders_unplaced as string[]) : [],
    status: row.status === "approved" ? "approved" : "draft",
    aiModel: (row.ai_model as string | null) ?? null
  };
}

export async function getWeekPlan(input: {
  spaceId: string;
  weekStart: string;
}): Promise<WeekPlan | null> {
  const admin = await getCurrentAdminUser();
  if (!canViewMktPlan(admin?.role)) return null;

  const monday = mondayOf(input.weekStart);
  if (!isValidUuid(input.spaceId) || !monday) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("mkt_week_plans")
    .select(WEEK_COLUMNS)
    .eq("space_id", input.spaceId)
    .eq("week_start", monday)
    .maybeSingle();

  if (error) {
    log("read week plan", error);
    return null;
  }
  return data ? toWeekPlan(data) : null;
}

export type WeekGenerationResult = MutationResult & {
  filled?: number;
  missing?: number;
  preserved?: number;
  unplacedOrders?: string[];
};

/**
 * Plan a week: divide the slots, ask the model to fill them, put the answer
 * back where it belongs.
 *
 * The counts in the returned message are not decoration. An operator who
 * expected twelve posts and got nine needs to know that two slots came back
 * empty and one was left alone because a designer had already worked on it —
 * otherwise the only way to find out is to scroll.
 */
export async function generateWeekPlan(input: {
  spaceId?: unknown;
  weekStart?: unknown;
}): Promise<WeekGenerationResult> {
  const spaceId = String(input.spaceId ?? "").trim();
  const monday = mondayOf(input.weekStart);

  if (!isValidUuid(spaceId)) return { ok: false, message: "Không xác định được không gian." };
  if (!monday) return { ok: false, message: "Tuần không hợp lệ." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền lập plan MKT." };
  }

  const context = await getSpacePromptContext(spaceId);
  if (!context) return { ok: false, message: "Không tìm thấy không gian." };

  const slots = generateWeekSlots({ weekStart: monday, channels: context.plans });
  if (!slots.length) {
    return {
      ok: false,
      message:
        "Chưa có kênh nào đang bật, hoặc số bài mỗi tuần đang là 0. Vui lòng mở tab Cấu hình trước."
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const [master, existingPlan, orders, calendar] = await Promise.all([
    getMasterPlan({ spaceId, month: monthOfWeek(monday) }),
    getWeekPlan({ spaceId, weekStart: monday }),
    readOpenOrders(client, spaceId),
    readCalendar(client, {
      programId: context.space.programId,
      from: monday,
      to: addDays(monday, 6)
    })
  ]);

  const weekFocus = master?.weeklyFocus?.find(
    (item) => String(item?.week_start ?? "").slice(0, 10) === monday
  );

  const direction: Direction = {
    monthTheme: master?.theme ?? null,
    monthNotes: master?.contentNotes ?? null,
    weekTopic: existingPlan?.topic ?? weekFocus?.topic ?? null,
    weekFocus: existingPlan?.focus ?? weekFocus?.focus ?? null,
    weekNotes: existingPlan?.contentNotes ?? weekFocus?.note ?? null
  };

  const reply = await callMktJson<{
    topic?: string;
    focus?: string;
    content_notes?: string;
    order_review?: WeekPlan["orderReview"];
    orders_unplaced?: string[];
    posts?: Array<Record<string, unknown>>;
  }>({
    systemPrompt: buildSystemPrompt({
      brandName: context.brandName,
      brandScope: context.brandScope,
      brand: context.space.brand,
      channels: context.briefs
    }),
    userPrompt: buildWeekPlanPrompt({
      brandName: context.brandName,
      weekStart: monday,
      slots,
      direction,
      orders,
      calendar
    }),
    maxTokens: 8000
  });

  if (!reply.ok) return { ok: false, message: reply.message };

  const { merged, missing } = mergeIntoSlots(
    slots,
    Array.isArray(reply.data.posts) ? reply.data.posts : []
  );

  // The week plan row first: the posts hang off it.
  const planPayload = {
    space_id: spaceId,
    week_start: monday,
    master_plan_id: master?.id ?? null,
    topic: text(reply.data.topic, 500) ?? direction.weekTopic,
    focus: text(reply.data.focus, 500) ?? direction.weekFocus,
    content_notes: text(reply.data.content_notes, 4000) ?? direction.weekNotes,
    order_review: Array.isArray(reply.data.order_review) ? reply.data.order_review.slice(0, 50) : [],
    orders_unplaced: Array.isArray(reply.data.orders_unplaced)
      ? reply.data.orders_unplaced.map((item) => String(item)).slice(0, 50)
      : [],
    ai_raw: reply.raw as Record<string, unknown>,
    ai_model: reply.model,
    created_by: admin.id
  };

  const { data: savedPlan, error: planError } = await client
    .from("mkt_week_plans")
    .upsert(planPayload, { onConflict: "space_id,week_start" })
    .select("id")
    .maybeSingle();

  if (planError || !savedPlan) {
    log("save week plan", planError);
    return { ok: false, message: SAFE_ERROR };
  }

  const weekPlanId = (savedPlan as { id: string }).id;
  const written = await writePosts(client, {
    weekPlanId,
    spaceId,
    merged,
    orders
  });

  await writeLog(client, {
    spaceId,
    weekPlanId,
    changeType: "plan_generated",
    reason: `${written.filled} bài, ${missing} ô trống, ${written.preserved} bài giữ nguyên.`,
    changedBy: admin.id
  });

  const parts = [`Đã điền ${written.filled} bài`];
  if (missing) parts.push(`${missing} ô AI chưa trả về — vui lòng viết tay`);
  if (written.preserved) parts.push(`${written.preserved} bài giữ nguyên vì đã có hình hoặc đã duyệt`);
  if (planPayload.orders_unplaced.length) {
    parts.push(`${planPayload.orders_unplaced.length} đề nghị chưa xếp được`);
  }

  return {
    ok: true,
    message: `${parts.join(", ")}.`,
    filled: written.filled,
    missing,
    preserved: written.preserved,
    unplacedOrders: planPayload.orders_unplaced
  };
}

export async function saveWeekPlan(input: {
  spaceId?: unknown;
  weekStart?: unknown;
  topic?: unknown;
  focus?: unknown;
  contentNotes?: unknown;
}): Promise<MutationResult> {
  const spaceId = String(input.spaceId ?? "").trim();
  const monday = mondayOf(input.weekStart);

  if (!isValidUuid(spaceId) || !monday) {
    return { ok: false, message: "Không xác định được tuần." };
  }

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa plan MKT." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { error } = await client.from("mkt_week_plans").upsert(
    {
      space_id: spaceId,
      week_start: monday,
      topic: text(input.topic, 500),
      focus: text(input.focus, 500),
      content_notes: text(input.contentNotes, 4000),
      created_by: admin.id
    },
    { onConflict: "space_id,week_start" }
  );

  if (error) {
    log("upsert week plan", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: "Đã lưu định hướng tuần." };
}

// ── Writing the posts back ───────────────────────────────────────────────────

type MergedSlot = MktSlot & { answer: Record<string, unknown> | null };

/**
 * Put the model's answers onto the week's posts.
 *
 * Anything a person has already committed to — approved, posted, skipped, or
 * carrying artwork — is left untouched and counted. Everything else is created
 * or overwritten.
 */
async function writePosts(
  client: ServiceClient,
  input: {
    weekPlanId: string;
    spaceId: string;
    merged: MergedSlot[];
    orders: MktOrder[];
  }
): Promise<{ filled: number; preserved: number }> {
  const { data: existingRows } = await client
    .from("mkt_posts")
    .select("id,channel,post_date,status,asset_urls")
    .eq("week_plan_id", input.weekPlanId);

  const existing = new Map<string, { id: string; status: string; assetUrls: string[] }>();
  for (const row of (existingRows ?? []) as Array<Record<string, unknown>>) {
    existing.set(`${String(row.channel)}:${String(row.post_date).slice(0, 10)}`, {
      id: String(row.id),
      status: String(row.status),
      assetUrls: Array.isArray(row.asset_urls) ? (row.asset_urls as string[]) : []
    });
  }

  let filled = 0;
  let preserved = 0;

  for (const slot of input.merged) {
    const key = `${slot.channel}:${slot.postDate}`;
    const found = existing.get(key);

    const committed =
      found &&
      (["approved", "posted", "skipped"].includes(found.status) || found.assetUrls.length > 0);

    if (committed) {
      preserved++;
      continue;
    }

    const answer = slot.answer;
    const payload = {
      week_plan_id: input.weekPlanId,
      space_id: input.spaceId,
      channel: slot.channel as MktChannel,
      post_date: slot.postDate,
      slot_time: slot.slotTime,
      variant_group: slot.variantGroup,
      pillar: text(answer?.pillar, 200),
      idea: text(answer?.idea, 1000),
      content: text(answer?.content, 8000),
      hashtags: Array.isArray(answer?.hashtags)
        ? (answer!.hashtags as unknown[]).map((tag) => String(tag)).slice(0, 12)
        : [],
      cta: text(answer?.cta, 300),
      brief: (answer?.brief as Record<string, unknown>) ?? null,
      order_id: resolveOrderId(answer?.order_ref, input.orders),
      status: answer?.content ? "content_ready" : "planned"
    };

    const { error } = found
      ? await client.from("mkt_posts").update(payload).eq("id", found.id)
      : await client.from("mkt_posts").insert(payload);

    if (error) {
      log("write post", error);
      continue;
    }

    if (answer?.content) filled++;
  }

  return { filled, preserved };
}

/** The model refers to a request by the first eight characters of its id. */
function resolveOrderId(ref: unknown, orders: MktOrder[]): string | null {
  const text = String(ref ?? "").trim().toLowerCase();
  if (!text) return null;

  const match = orders.find((order) => order.id.toLowerCase().startsWith(text.slice(0, 8)));
  return match?.id ?? null;
}

// ── What is genuinely happening ──────────────────────────────────────────────

/**
 * The real calendar, read out of the application's own tables.
 *
 * Events and scheduled cross-mentoring sessions in the window, so the plan
 * announces things that exist on the days they exist. Names of activities go
 * to the model; nothing belonging to a person does, and the prompt builder
 * scrubs the labels again on the way past.
 */
async function readCalendar(
  client: ServiceClient,
  input: { programId: string | null; from: string; to: string }
): Promise<CalendarItem[]> {
  // The shared VAM space has no programme, so it sees every programme's
  // calendar — which is right: it speaks for the organisation.
  const seasonIds = input.programId ? await readSeasonIds(client, input.programId) : null;
  if (seasonIds && !seasonIds.length) return [];

  const items: CalendarItem[] = [];

  try {
    let query = client
      .from("events")
      .select("event_name,event_type,starts_at,season_id")
      .gte("starts_at", `${input.from}T00:00:00+07:00`)
      .lte("starts_at", `${input.to}T23:59:59+07:00`)
      .order("starts_at", { ascending: true })
      .limit(40);

    if (seasonIds) query = query.in("season_id", seasonIds);

    const { data, error } = await query;
    if (error) log("read events (non-fatal)", error);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      items.push({
        label: String(row.event_name ?? "").trim(),
        date: String(row.starts_at ?? "").slice(0, 10),
        kind: String(row.event_type ?? "") || null
      });
    }
  } catch (error) {
    log("read events crashed (non-fatal)", error);
  }

  return items.filter((item) => item.label);
}

async function readSeasonIds(client: ServiceClient, programId: string): Promise<string[]> {
  const { data, error } = await client.from("seasons").select("id").eq("program_id", programId);

  if (error) {
    log("read seasons (non-fatal)", error);
    return [];
  }
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

async function readOpenOrders(client: ServiceClient, spaceId: string): Promise<MktOrder[]> {
  const { data, error } = await client
    .from("mkt_orders")
    .select("id,title,purpose,body,wanted_channels,needed_by,is_urgent,content_priority,created_at")
    .eq("space_id", spaceId)
    .eq("status", "new")
    .limit(40);

  if (error) {
    log("read orders (non-fatal)", error);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    purpose: (row.purpose as string | null) ?? null,
    body: (row.body as string | null) ?? null,
    wantedChannels: Array.isArray(row.wanted_channels) ? (row.wanted_channels as string[]) : [],
    neededBy: (row.needed_by as string | null) ?? null,
    isUrgent: row.is_urgent === true,
    contentPriority: String(row.content_priority ?? "normal"),
    createdAt: String(row.created_at ?? "")
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function text(value: unknown, max: number): string | null {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
}

function previousMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

export async function writeLog(
  client: ServiceClient,
  entry: {
    spaceId: string;
    postId?: string | null;
    weekPlanId?: string | null;
    changeType: string;
    oldStatus?: string | null;
    newStatus?: string | null;
    reason?: string | null;
    changedBy?: string | null;
  }
) {
  const { error } = await client.from("mkt_post_log").insert({
    space_id: entry.spaceId,
    post_id: entry.postId ?? null,
    week_plan_id: entry.weekPlanId ?? null,
    change_type: entry.changeType,
    old_status: entry.oldStatus ?? null,
    new_status: entry.newStatus ?? null,
    reason: entry.reason ?? null,
    changed_by: entry.changedBy ?? null
  });

  if (error) log("write log (non-fatal)", error);
}
