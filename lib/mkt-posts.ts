import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canManageMktPlan, canViewMktPlan } from "@/lib/permissions";
import {
  canApprove,
  derivedStatus,
  mondayOf,
  nextStep,
  suggestScheduledAt,
  type MktChannel,
  type NextStep
} from "@/lib/mkt-core";
import {
  buildPostRewritePrompt,
  buildSystemPrompt,
  draftNeedsChecking,
  type Direction
} from "@/lib/mkt-prompt-core";
import { callMktJson } from "@/lib/mkt-ai";
import { getSpacePromptContext } from "@/lib/mkt-spaces";
import { getMasterPlan, getWeekPlan, writeLog } from "@/lib/mkt-plans";
import { monthOfWeek } from "@/lib/mkt-core";

/**
 * lib/mkt-posts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * One card in the week, and the requests that put things on it.
 *
 * Nothing here publishes. `approvePost` fixes the hour and stops; a person then
 * opens Facebook and posts, and `markPosted` records that they did, with the
 * link as evidence. That boundary is deliberate and it is the same one the
 * email layer draws: what has left the building cannot be recalled, so the
 * moment it leaves is a person's decision, not a job's.
 */

const SAFE_ERROR = "Không thực hiện được thao tác. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[mkt-posts]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string };

// ── Reading ──────────────────────────────────────────────────────────────────

export type MktPost = {
  id: string;
  spaceId: string;
  weekPlanId: string;
  channel: MktChannel;
  postDate: string;
  slotTime: string | null;
  variantGroup: string | null;
  pillar: string | null;
  idea: string | null;
  content: string | null;
  hashtags: string[];
  cta: string | null;
  brief: Record<string, unknown> | null;
  assetUrls: string[];
  status: string;
  scheduledAt: string | null;
  postedAt: string | null;
  postedUrl: string | null;
  orderId: string | null;
  step: NextStep;
};

const POST_COLUMNS =
  "id,space_id,week_plan_id,channel,post_date,slot_time,variant_group,pillar,idea,content,hashtags,cta,brief,asset_urls,status,scheduled_at,posted_at,posted_url,order_id";

function toPost(raw: unknown): MktPost {
  const row = raw as Record<string, unknown>;
  const assetUrls = Array.isArray(row.asset_urls) ? (row.asset_urls as string[]) : [];

  const post = {
    id: String(row.id ?? ""),
    spaceId: String(row.space_id ?? ""),
    weekPlanId: String(row.week_plan_id ?? ""),
    channel: String(row.channel ?? "") as MktChannel,
    postDate: String(row.post_date ?? "").slice(0, 10),
    slotTime: row.slot_time ? String(row.slot_time).slice(0, 5) : null,
    variantGroup: (row.variant_group as string | null) ?? null,
    pillar: (row.pillar as string | null) ?? null,
    idea: (row.idea as string | null) ?? null,
    content: (row.content as string | null) ?? null,
    hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [],
    cta: (row.cta as string | null) ?? null,
    brief: (row.brief as Record<string, unknown> | null) ?? null,
    assetUrls,
    status: String(row.status ?? "planned"),
    scheduledAt: (row.scheduled_at as string | null) ?? null,
    postedAt: (row.posted_at as string | null) ?? null,
    postedUrl: (row.posted_url as string | null) ?? null,
    orderId: (row.order_id as string | null) ?? null
  };

  return { ...post, step: nextStep({ status: post.status, content: post.content, assetUrls }) };
}

export async function listWeekPosts(input: {
  spaceId: string;
  weekStart: string;
}): Promise<MktPost[]> {
  const admin = await getCurrentAdminUser();
  if (!canViewMktPlan(admin?.role)) return [];

  const monday = mondayOf(input.weekStart);
  if (!isValidUuid(input.spaceId) || !monday) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const { data, error } = await client
    .from("mkt_posts")
    .select(POST_COLUMNS)
    .eq("space_id", input.spaceId)
    .gte("post_date", monday)
    .lte("post_date", addDaysLocal(monday, 6))
    .order("post_date", { ascending: true });

  if (error) {
    log("list week posts", error);
    return [];
  }

  return (data ?? []).map(toPost);
}

/**
 * Everything that has words and artwork and is waiting on one click.
 *
 * Its own screen because that is the queue the support team lives in: the week
 * grid is for planning, this is for getting through a pile.
 */
export async function listPostsAwaitingApproval(spaceId?: string): Promise<MktPost[]> {
  const admin = await getCurrentAdminUser();
  if (!canViewMktPlan(admin?.role)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  let query = client
    .from("mkt_posts")
    .select(POST_COLUMNS)
    .in("status", ["planned", "content_ready", "draft_ready"])
    .order("post_date", { ascending: true })
    .limit(200);

  if (spaceId && isValidUuid(spaceId)) query = query.eq("space_id", spaceId);

  const { data, error } = await query;
  if (error) {
    log("list awaiting approval", error);
    return [];
  }

  // "Ready" means both words and artwork; the database cannot express that, so
  // the filter is here rather than in the query.
  return (data ?? []).map(toPost).filter((post) => post.step.waitingOn === "approver");
}

// ── Editing ──────────────────────────────────────────────────────────────────

export async function updatePost(input: {
  postId?: unknown;
  idea?: unknown;
  pillar?: unknown;
  content?: unknown;
  hashtags?: unknown;
  cta?: unknown;
  assetUrls?: unknown;
}): Promise<MutationResult> {
  const postId = String(input.postId ?? "").trim();
  if (!isValidUuid(postId)) return { ok: false, message: "Không xác định được bài." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa bài." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const current = await readPost(client, postId);
  if (!current) return { ok: false, message: "Không tìm thấy bài." };
  if (current.status === "posted") {
    return { ok: false, message: "Bài đã đăng rồi, không sửa được nữa." };
  }

  const assetUrls = normalizeUrls(input.assetUrls);
  const badUrl = assetUrls.find((url) => !/^https?:\/\//i.test(url));
  if (badUrl) {
    return { ok: false, message: "Link hình phải bắt đầu bằng http:// hoặc https://" };
  }

  const content = text(input.content, 8000);

  const payload = {
    idea: text(input.idea, 1000),
    pillar: text(input.pillar, 200),
    content,
    hashtags: normalizeHashtags(input.hashtags),
    cta: text(input.cta, 300),
    asset_urls: assetUrls,
    // Approving is a decision; everything below it is recomputed from what the
    // row now holds, in one place, so the card's label cannot disagree with it.
    status: derivedStatus({ status: current.status, content, assetUrls })
  };

  const { error } = await client.from("mkt_posts").update(payload).eq("id", postId);
  if (error) {
    log("update post", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    spaceId: current.spaceId,
    postId,
    weekPlanId: current.weekPlanId,
    changeType: "edited",
    oldStatus: current.status,
    newStatus: payload.status,
    changedBy: admin.id
  });

  const warning = content ? draftNeedsChecking(content) : { ok: true as const };
  return {
    ok: true,
    message: warning.ok ? "Đã lưu bài." : `Đã lưu, nhưng ${warning.reason}`
  };
}

/** Ask the model to write this one post again, with the week's direction. */
export async function rewritePost(input: {
  postId?: unknown;
  instruction?: unknown;
}): Promise<MutationResult> {
  const postId = String(input.postId ?? "").trim();
  if (!isValidUuid(postId)) return { ok: false, message: "Không xác định được bài." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa bài." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const post = await readPost(client, postId);
  if (!post) return { ok: false, message: "Không tìm thấy bài." };
  if (["approved", "posted"].includes(post.status)) {
    return { ok: false, message: "Bài đã duyệt hoặc đã đăng. Bỏ duyệt trước nếu muốn viết lại." };
  }

  const context = await getSpacePromptContext(post.spaceId);
  if (!context) return { ok: false, message: "Không tìm thấy không gian." };

  // The direction block goes into the rewrite too. Leaving it out is how each
  // rewritten post drifts onto a topic of its own.
  const monday = mondayOf(post.postDate);
  const [master, week] = await Promise.all([
    getMasterPlan({ spaceId: post.spaceId, month: monthOfWeek(monday) }),
    getWeekPlan({ spaceId: post.spaceId, weekStart: monday })
  ]);

  const direction: Direction = {
    monthTheme: master?.theme ?? null,
    monthNotes: master?.contentNotes ?? null,
    weekTopic: week?.topic ?? null,
    weekFocus: week?.focus ?? null,
    weekNotes: week?.contentNotes ?? null
  };

  const reply = await callMktJson<{
    idea?: string;
    content?: string;
    hashtags?: string[];
    cta?: string;
    brief?: Record<string, unknown>;
  }>({
    systemPrompt: buildSystemPrompt({
      brandName: context.brandName,
      brandScope: context.brandScope,
      brand: context.space.brand,
      channels: context.briefs
    }),
    userPrompt: buildPostRewritePrompt({
      brandName: context.brandName,
      post: {
        postDate: post.postDate,
        channel: post.channel,
        pillar: post.pillar,
        idea: post.idea,
        content: post.content
      },
      instruction: text(input.instruction, 1000),
      direction
    }),
    maxTokens: 2000
  });

  if (!reply.ok) return { ok: false, message: reply.message };

  const content = text(reply.data.content, 8000);
  if (!content) return { ok: false, message: "DeepSeek không trả về nội dung. Vui lòng thử lại." };

  const { error } = await client
    .from("mkt_posts")
    .update({
      idea: text(reply.data.idea, 1000) ?? post.idea,
      content,
      hashtags: normalizeHashtags(reply.data.hashtags),
      cta: text(reply.data.cta, 300) ?? post.cta,
      brief: reply.data.brief ?? post.brief,
      status: derivedStatus({ status: post.status, content, assetUrls: post.assetUrls })
    })
    .eq("id", postId);

  if (error) {
    log("save rewrite", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    spaceId: post.spaceId,
    postId,
    weekPlanId: post.weekPlanId,
    changeType: "content_generated",
    reason: reply.model,
    changedBy: admin.id
  });

  const warning = draftNeedsChecking(content);
  return {
    ok: true,
    message: warning.ok
      ? "Đã viết lại. Vui lòng đọc lại trước khi duyệt."
      : `Đã viết lại, nhưng ${warning.reason}`
  };
}

// ── Approving, publishing, skipping ──────────────────────────────────────────

/**
 * Approve a post and fix the hour it goes out.
 *
 * The hour is suggested rather than copied from the slot: approving Monday's
 * post on Wednesday should not schedule it into the past.
 */
export async function approvePost(input: { postId?: unknown }): Promise<MutationResult> {
  const postId = String(input.postId ?? "").trim();
  if (!isValidUuid(postId)) return { ok: false, message: "Không xác định được bài." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền duyệt bài." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const post = await readPost(client, postId);
  if (!post) return { ok: false, message: "Không tìm thấy bài." };

  if (!canApprove({ status: post.status, content: post.content, assetUrls: post.assetUrls })) {
    return {
      ok: false,
      message: post.status === "approved" ? "Bài này đã duyệt rồi." : `Chưa duyệt được: ${post.step.label.toLowerCase()}.`
    };
  }

  const { data: channelRow } = await client
    .from("mkt_space_channels")
    .select("best_times")
    .eq("space_id", post.spaceId)
    .eq("channel", post.channel)
    .maybeSingle();

  const bestTimes = Array.isArray((channelRow as { best_times?: string[] } | null)?.best_times)
    ? ((channelRow as { best_times: string[] }).best_times)
    : [];

  const scheduledAt = suggestScheduledAt({
    postDate: post.postDate,
    slotTime: post.slotTime,
    bestTimes
  });

  const { error } = await client
    .from("mkt_posts")
    .update({
      status: "approved",
      scheduled_at: scheduledAt,
      approved_by: admin.id,
      approved_at: new Date().toISOString()
    })
    .eq("id", postId)
    .eq("status", post.status);

  if (error) {
    log("approve post", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    spaceId: post.spaceId,
    postId,
    weekPlanId: post.weekPlanId,
    changeType: "approved",
    oldStatus: post.status,
    newStatus: "approved",
    changedBy: admin.id
  });

  return {
    ok: true,
    message: "Đã duyệt. Tới giờ thì người phụ trách mở trang và đăng — hệ thống không tự đăng."
  };
}

/** Record that a person published it, with the link as evidence. */
export async function markPosted(input: {
  postId?: unknown;
  postedUrl?: unknown;
}): Promise<MutationResult> {
  const postId = String(input.postId ?? "").trim();
  if (!isValidUuid(postId)) return { ok: false, message: "Không xác định được bài." };

  const postedUrl = String(input.postedUrl ?? "").trim();
  if (!/^https?:\/\//i.test(postedUrl)) {
    return { ok: false, message: "Vui lòng dán link bài đã đăng để đối chiếu sau này." };
  }

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền ghi nhận bài đã đăng." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const post = await readPost(client, postId);
  if (!post) return { ok: false, message: "Không tìm thấy bài." };
  if (post.status !== "approved") {
    return { ok: false, message: "Chỉ ghi nhận được bài đã duyệt." };
  }

  const { error } = await client
    .from("mkt_posts")
    .update({
      status: "posted",
      posted_at: new Date().toISOString(),
      posted_url: postedUrl.slice(0, 1000),
      posted_by: admin.id
    })
    .eq("id", postId)
    .eq("status", "approved");

  if (error) {
    log("mark posted", error);
    return { ok: false, message: SAFE_ERROR };
  }

  // The request this post served is now answered. Closing it here means the
  // person who asked can see it went out, rather than having to ask.
  if (post.orderId) {
    const { error: orderError } = await client
      .from("mkt_orders")
      .update({ status: "done" })
      .eq("id", post.orderId)
      .in("status", ["new", "planned"]);

    if (orderError) log("close order (non-fatal)", orderError);
  }

  await writeLog(client, {
    spaceId: post.spaceId,
    postId,
    weekPlanId: post.weekPlanId,
    changeType: "posted",
    oldStatus: "approved",
    newStatus: "posted",
    changedBy: admin.id
  });

  return { ok: true, message: "Đã ghi nhận bài đăng." };
}

export async function skipPost(input: {
  postId?: unknown;
  reason?: unknown;
}): Promise<MutationResult> {
  const postId = String(input.postId ?? "").trim();
  if (!isValidUuid(postId)) return { ok: false, message: "Không xác định được bài." };

  const reason = text(input.reason, 500);
  if (!reason) return { ok: false, message: "Vui lòng ghi lý do bỏ qua slot này." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền bỏ qua bài." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const post = await readPost(client, postId);
  if (!post) return { ok: false, message: "Không tìm thấy bài." };
  if (post.status === "posted") return { ok: false, message: "Bài đã đăng rồi." };

  const { error } = await client.from("mkt_posts").update({ status: "skipped" }).eq("id", postId);
  if (error) {
    log("skip post", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    spaceId: post.spaceId,
    postId,
    weekPlanId: post.weekPlanId,
    changeType: "skipped",
    oldStatus: post.status,
    newStatus: "skipped",
    reason,
    changedBy: admin.id
  });

  return { ok: true, message: "Đã bỏ qua slot này." };
}

// ── Requests ─────────────────────────────────────────────────────────────────

export type MktOrderRow = {
  id: string;
  title: string;
  purpose: string | null;
  body: string;
  wantedChannels: string[];
  neededBy: string | null;
  isUrgent: boolean;
  contentPriority: string;
  status: string;
  declineReason: string | null;
  createdAt: string;
};

export async function listOrders(spaceId: string): Promise<MktOrderRow[]> {
  const admin = await getCurrentAdminUser();
  if (!canViewMktPlan(admin?.role)) return [];
  if (!isValidUuid(spaceId)) return [];

  const client = getSupabaseServiceRoleClient();
  if (!client) return [];

  const { data, error } = await client
    .from("mkt_orders")
    .select(
      "id,title,purpose,body,wanted_channels,needed_by,is_urgent,content_priority,status,decline_reason,created_at"
    )
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    log("list orders", error);
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    purpose: (row.purpose as string | null) ?? null,
    body: String(row.body ?? ""),
    wantedChannels: Array.isArray(row.wanted_channels) ? (row.wanted_channels as string[]) : [],
    neededBy: (row.needed_by as string | null) ?? null,
    isUrgent: row.is_urgent === true,
    contentPriority: String(row.content_priority ?? "normal"),
    status: String(row.status ?? "new"),
    declineReason: (row.decline_reason as string | null) ?? null,
    createdAt: String(row.created_at ?? "")
  }));
}

export async function createOrder(input: {
  spaceId?: unknown;
  title?: unknown;
  purpose?: unknown;
  body?: unknown;
  wantedChannels?: unknown;
  neededBy?: unknown;
  isUrgent?: unknown;
  contentPriority?: unknown;
}): Promise<MutationResult> {
  const spaceId = String(input.spaceId ?? "").trim();
  if (!isValidUuid(spaceId)) return { ok: false, message: "Không xác định được không gian." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền gửi đề nghị đăng bài." };
  }

  const title = text(input.title, 300);
  const body = text(input.body, 4000);

  if (!title || title.length < 3) return { ok: false, message: "Vui lòng đặt tiêu đề cho đề nghị." };
  if (!body || body.length < 10) {
    return { ok: false, message: "Vui lòng mô tả nội dung cần đăng (ít nhất 10 ký tự)." };
  }

  const priority = String(input.contentPriority ?? "normal");
  if (!["high", "priority", "normal"].includes(priority)) {
    return { ok: false, message: "Mức ưu tiên không hợp lệ." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: created, error } = await client
    .from("mkt_orders")
    .insert({
      space_id: spaceId,
      title,
      purpose: text(input.purpose, 1000),
      body,
      wanted_channels: normalizeChannels(input.wantedChannels),
      needed_by: normalizeDate(input.neededBy),
      is_urgent: String(input.isUrgent ?? "") === "true",
      content_priority: priority,
      requested_by: admin.id
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    log("create order", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    spaceId,
    changeType: "order_placed",
    reason: title,
    changedBy: admin.id
  });

  return {
    ok: true,
    message: "Đã gửi đề nghị. Nó sẽ được đưa vào plan ở lần lập kế hoạch tuần tới."
  };
}

/** Turn a request down. The reason is required, because it will be asked for. */
export async function declineOrder(input: {
  orderId?: unknown;
  reason?: unknown;
}): Promise<MutationResult> {
  const orderId = String(input.orderId ?? "").trim();
  if (!isValidUuid(orderId)) return { ok: false, message: "Không xác định được đề nghị." };

  const reason = text(input.reason, 1000);
  if (!reason) return { ok: false, message: "Vui lòng ghi lý do để người gửi hiểu." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canManageMktPlan(admin.role)) {
    return { ok: false, message: "Bạn không có quyền từ chối đề nghị." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: updated, error } = await client
    .from("mkt_orders")
    .update({ status: "declined", decline_reason: reason })
    .eq("id", orderId)
    .select("space_id")
    .maybeSingle();

  if (error || !updated) {
    log("decline order", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    spaceId: String((updated as { space_id: string }).space_id),
    changeType: "order_declined",
    reason,
    changedBy: admin.id
  });

  return { ok: true, message: "Đã từ chối và ghi lại lý do." };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readPost(client: ServiceClient, postId: string): Promise<MktPost | null> {
  const { data, error } = await client
    .from("mkt_posts")
    .select(POST_COLUMNS)
    .eq("id", postId)
    .maybeSingle();

  if (error) {
    log("read post", error);
    return null;
  }
  return data ? toPost(data) : null;
}

function text(value: unknown, max: number): string | null {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
}

function addDaysLocal(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  return new Date(base.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function normalizeUrls(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/);
  return Array.from(
    new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))
  ).slice(0, 10);
}

function normalizeHashtags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  return Array.from(
    new Set(
      raw
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .map((item) => (item.startsWith("#") ? item : `#${item}`))
    )
  ).slice(0, 12);
}

function normalizeChannels(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(",");
  const allowed = ["facebook", "tiktok", "youtube", "linkedin"];
  return Array.from(
    new Set(raw.map((item) => String(item ?? "").trim().toLowerCase()).filter((item) => allowed.includes(item)))
  );
}

function normalizeDate(value: unknown): string | null {
  const text = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
