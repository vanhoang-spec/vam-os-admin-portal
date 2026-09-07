"use server";

import { revalidatePath } from "next/cache";

import {
  approveMasterPlan,
  generateMasterPlan,
  generateWeekPlan,
  saveMasterPlan,
  saveWeekPlan
} from "@/lib/mkt-plans";
import {
  approvePost,
  createOrder,
  declineOrder,
  markPosted,
  rewritePost,
  skipPost,
  updatePost
} from "@/lib/mkt-posts";
import { updateMktBrand, updateMktChannel } from "@/lib/mkt-spaces";
import type { MktActionState, MktWeekActionState } from "@/lib/mkt-action-types";

/**
 * app/actions/mkt.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin by house rule: parse the form, call the library, revalidate, return.
 *
 * Every authorization check and every validation lives in `lib/`, so posting
 * straight at one of these actions is treated exactly as the form is.
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function textList(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function revalidateSpace(spaceId: string) {
  revalidatePath(`/operations/mkt/${spaceId}`);
  revalidatePath(`/operations/mkt/${spaceId}/thang`);
  revalidatePath(`/operations/mkt/${spaceId}/cho-duyet`);
  revalidatePath(`/operations/mkt/${spaceId}/cau-hinh`);
}

// ── The month ────────────────────────────────────────────────────────────────

export async function generateMasterPlanAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const spaceId = text(formData, "space_id");
  const result = await generateMasterPlan({ spaceId, month: text(formData, "month") });

  if (result.ok) revalidateSpace(spaceId);
  return { ok: result.ok, message: result.message };
}

export async function saveMasterPlanAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const spaceId = text(formData, "space_id");

  const result = await saveMasterPlan({
    spaceId,
    month: text(formData, "month"),
    theme: text(formData, "theme"),
    contentNotes: text(formData, "content_notes"),
    notes: text(formData, "notes")
  });

  if (result.ok) revalidateSpace(spaceId);
  return { ok: result.ok, message: result.message };
}

export async function approveMasterPlanAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const result = await approveMasterPlan({ planId: text(formData, "plan_id") });

  if (result.ok) revalidateSpace(text(formData, "space_id"));
  return { ok: result.ok, message: result.message };
}

// ── The week ─────────────────────────────────────────────────────────────────

export async function generateWeekPlanAction(
  _previous: MktWeekActionState,
  formData: FormData
): Promise<MktWeekActionState> {
  const spaceId = text(formData, "space_id");
  const result = await generateWeekPlan({ spaceId, weekStart: text(formData, "week_start") });

  if (result.ok) revalidateSpace(spaceId);

  return {
    ok: result.ok,
    message: result.message,
    filled: result.filled,
    missing: result.missing,
    preserved: result.preserved,
    unplacedOrders: result.unplacedOrders
  };
}

export async function saveWeekPlanAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const spaceId = text(formData, "space_id");

  const result = await saveWeekPlan({
    spaceId,
    weekStart: text(formData, "week_start"),
    topic: text(formData, "topic"),
    focus: text(formData, "focus"),
    contentNotes: text(formData, "content_notes")
  });

  if (result.ok) revalidateSpace(spaceId);
  return { ok: result.ok, message: result.message };
}

// ── One post ─────────────────────────────────────────────────────────────────

export async function updatePostAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const result = await updatePost({
    postId: text(formData, "post_id"),
    idea: text(formData, "idea"),
    pillar: text(formData, "pillar"),
    content: text(formData, "content"),
    hashtags: text(formData, "hashtags"),
    cta: text(formData, "cta"),
    assetUrls: text(formData, "asset_urls")
  });

  if (result.ok) revalidateSpace(text(formData, "space_id"));
  return { ok: result.ok, message: result.message };
}

export async function rewritePostAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const result = await rewritePost({
    postId: text(formData, "post_id"),
    instruction: text(formData, "instruction")
  });

  if (result.ok) revalidateSpace(text(formData, "space_id"));
  return { ok: result.ok, message: result.message };
}

export async function approvePostAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const result = await approvePost({ postId: text(formData, "post_id") });

  if (result.ok) revalidateSpace(text(formData, "space_id"));
  return { ok: result.ok, message: result.message };
}

export async function markPostedAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const result = await markPosted({
    postId: text(formData, "post_id"),
    postedUrl: text(formData, "posted_url")
  });

  if (result.ok) revalidateSpace(text(formData, "space_id"));
  return { ok: result.ok, message: result.message };
}

export async function skipPostAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const result = await skipPost({
    postId: text(formData, "post_id"),
    reason: text(formData, "reason")
  });

  if (result.ok) revalidateSpace(text(formData, "space_id"));
  return { ok: result.ok, message: result.message };
}

// ── Requests ─────────────────────────────────────────────────────────────────

export async function createOrderAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const spaceId = text(formData, "space_id");

  const result = await createOrder({
    spaceId,
    title: text(formData, "title"),
    purpose: text(formData, "purpose"),
    body: text(formData, "body"),
    wantedChannels: textList(formData, "wanted_channels"),
    neededBy: text(formData, "needed_by"),
    isUrgent: text(formData, "is_urgent"),
    contentPriority: text(formData, "content_priority") || "normal"
  });

  if (result.ok) revalidateSpace(spaceId);
  return { ok: result.ok, message: result.message };
}

export async function declineOrderAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const result = await declineOrder({
    orderId: text(formData, "order_id"),
    reason: text(formData, "reason")
  });

  if (result.ok) revalidateSpace(text(formData, "space_id"));
  return { ok: result.ok, message: result.message };
}

// ── Configuration ────────────────────────────────────────────────────────────

export async function updateMktBrandAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const spaceId = text(formData, "space_id");

  // Pillars arrive as parallel arrays from a repeating fieldset.
  const names = formData.getAll("pillar_name").map((item) => String(item ?? "").trim());
  const ratios = formData.getAll("pillar_ratio").map((item) => String(item ?? "").trim());

  const result = await updateMktBrand({
    spaceId,
    pageUrl: text(formData, "page_url"),
    notes: text(formData, "notes"),
    brand: {
      description: text(formData, "description"),
      audience: text(formData, "audience"),
      voice: text(formData, "voice"),
      pillars: names
        .map((name, index) => ({ name, ratio: Number(ratios[index] ?? 0) }))
        .filter((pillar) => pillar.name),
      cta: splitLines(formData, "cta"),
      hashtags: splitLines(formData, "hashtags"),
      doList: splitLines(formData, "do_list"),
      avoidList: splitLines(formData, "avoid_list"),
      diagnosis: text(formData, "diagnosis")
    }
  });

  if (result.ok) revalidateSpace(spaceId);
  return { ok: result.ok, message: result.message };
}

export async function updateMktChannelAction(
  _previous: MktActionState,
  formData: FormData
): Promise<MktActionState> {
  const spaceId = text(formData, "space_id");

  const result = await updateMktChannel({
    spaceId,
    channel: text(formData, "channel"),
    isActive: text(formData, "is_active"),
    postsPerWeek: text(formData, "posts_per_week"),
    bestTimes: text(formData, "best_times"),
    audience: text(formData, "audience"),
    topics: text(formData, "topics"),
    doWrite: text(formData, "do_write"),
    avoidWrite: text(formData, "avoid_write"),
    distinctAudience: text(formData, "distinct_audience")
  });

  if (result.ok) revalidateSpace(spaceId);
  return { ok: result.ok, message: result.message };
}

function splitLines(formData: FormData, key: string): string[] {
  return text(formData, key)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
