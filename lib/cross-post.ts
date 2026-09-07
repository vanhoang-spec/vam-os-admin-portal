import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { canTriageCrossRequest } from "@/lib/permissions";
import { callProvider, getProviderConfig } from "@/lib/ai-provider";
import { fieldLabel } from "@/lib/cross-fields-core";
import {
  buildPostPrompt,
  draftLooksSafe,
  parsePostDraft,
  POST_PROMPT_VERSION,
  POST_SYSTEM_PROMPT,
  type PostMentor
} from "@/lib/cross-post-core";
import { formatVietnameseDateTime } from "@/lib/cross-requests";

/**
 * lib/cross-post.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Asking a model for a first draft of the fanpage post.
 *
 * Draft-then-human-edit, the same shape `email_templates` and `draftMentorBios`
 * already use here: the model writes, an organiser reads and edits, and nothing
 * reaches Facebook without a person having approved it. `post_status` never
 * leaves `drafted` on this path — only `publishCrossSession` sets `approved`.
 *
 * The interesting decision is upstream, in cross-post-core: what the model is
 * allowed to know. Mentor name, title, company and field — all of it about to
 * be published anyway. Nothing about the mentee.
 */

const SAFE_ERROR = "Chưa viết được bản nháp. Vui lòng thử lại.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[cross-post]", scope, { message: err?.message ?? String(error) });
}

export type MutationResult = { ok: boolean; message: string };

/**
 * Write a draft post for one scheduled session.
 *
 * Returns a warning rather than a refusal when the draft comes back holding
 * something that looks like contact details: the organiser is going to read it
 * either way, and hiding a suspicious draft would teach them nothing.
 */
export async function draftCrossPost(input: { requestId?: unknown }): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canTriageCrossRequest(admin.role)) {
    return { ok: false, message: "Bạn không có quyền viết bài cho buổi cross." };
  }

  const provider = getProviderConfig();
  if (!provider.ok) {
    return {
      ok: false,
      message: `Tính năng AI chưa bật: ${provider.reason}. Ban tổ chức vẫn tự viết bài được ở ô bên dưới.`
    };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data, error } = await client
    .from("cross_requests")
    .select("id,season_id,status,field_kind,field_code,topic,scheduled_at,location,event_id")
    .eq("id", requestId)
    .maybeSingle();

  if (error || !data) return { ok: false, message: "Không tìm thấy đề xuất." };

  const request = data as {
    season_id: string;
    status: string;
    field_kind: string;
    field_code: string;
    topic: string | null;
    scheduled_at: string | null;
    location: string | null;
    event_id: string | null;
  };

  if (!["scheduled", "published"].includes(request.status)) {
    return { ok: false, message: "Cần chốt lịch trước khi viết bài đăng." };
  }

  const mentors = await readSelectedMentors(client, requestId);
  if (!mentors.length) return { ok: false, message: "Chưa có mentor được chọn cho buổi này." };

  const { data: season } = await client
    .from("seasons")
    .select("name,code")
    .eq("id", request.season_id)
    .maybeSingle();

  const seasonRow = season as { name?: string; code?: string } | null;

  const prompt = buildPostPrompt({
    fieldLabel: fieldLabel(request.field_kind, request.field_code),
    topic: request.topic,
    mentors,
    timeLabel: formatVietnameseDateTime(request.scheduled_at),
    location: request.location,
    seasonLabel: seasonRow?.name || seasonRow?.code || null,
    registerUrl: null
  });

  let reply;
  try {
    reply = await callProvider({
      config: provider,
      systemPrompt: POST_SYSTEM_PROMPT,
      userPrompt: prompt,
      temperature: 0.7,
      maxTokens: 900
    });
  } catch (err) {
    log("provider call failed", err);
    return { ok: false, message: SAFE_ERROR };
  }

  const draft = parsePostDraft(reply.content);
  if (!draft) return { ok: false, message: SAFE_ERROR };

  const { error: saveErr } = await client
    .from("cross_requests")
    .update({
      post_draft: draft,
      post_status: "drafted",
      ai_model: reply.model,
      ai_prompt_version: POST_PROMPT_VERSION
    })
    .eq("id", requestId);

  if (saveErr) {
    log("save draft", saveErr);
    return { ok: false, message: SAFE_ERROR };
  }

  const safety = draftLooksSafe(draft);
  return {
    ok: true,
    message: safety.ok
      ? "Đã có bản nháp. Vui lòng đọc lại và sửa trước khi gửi team truyền thông."
      : `Đã có bản nháp, nhưng ${safety.reason}`
  };
}

/** An organiser rewrites the draft by hand. */
export async function saveCrossPostDraft(input: {
  requestId?: unknown;
  draft?: unknown;
}): Promise<MutationResult> {
  const requestId = String(input.requestId ?? "").trim();
  if (!isValidUuid(requestId)) return { ok: false, message: "Đề xuất không hợp lệ." };

  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canTriageCrossRequest(admin.role)) {
    return { ok: false, message: "Bạn không có quyền sửa bài đăng." };
  }

  const draft = String(input.draft ?? "").trim().slice(0, 8000);
  if (!draft) return { ok: false, message: "Nội dung bài đăng đang trống." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  // Hand-written drafts keep `drafted` too: `approved` is what publishing sets,
  // and nothing else should be able to claim a post was signed off.
  const { error } = await client
    .from("cross_requests")
    .update({ post_draft: draft, post_status: "drafted" })
    .eq("id", requestId);

  if (error) {
    log("save manual draft", error);
    return { ok: false, message: SAFE_ERROR };
  }

  return { ok: true, message: "Đã lưu bài đăng." };
}

/** The chosen mentors, with the details that are going to be published anyway. */
async function readSelectedMentors(
  client: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  requestId: string
): Promise<PostMentor[]> {
  const { data: invitations, error } = await client
    .from("cross_invitations")
    .select("mentor_person_id")
    .eq("request_id", requestId)
    .eq("status", "selected");

  if (error) {
    log("read selected mentors", error);
    return [];
  }

  const personIds = ((invitations ?? []) as Array<{ mentor_person_id: string }>).map(
    (row) => row.mentor_person_id
  );
  if (!personIds.length) return [];

  const [{ data: people }, { data: profiles }] = await Promise.all([
    client.from("people").select("id,full_name").in("id", personIds),
    client.from("mentor_profiles").select("person_id,title_current,company_current").in("person_id", personIds)
  ]);

  const profileByPerson = new Map(
    ((profiles ?? []) as Array<{
      person_id: string | null;
      title_current: string | null;
      company_current: string | null;
    }>)
      .filter((row) => row.person_id)
      .map((row) => [row.person_id as string, row])
  );

  return ((people ?? []) as Array<{ id: string; full_name: string | null }>)
    .filter((person) => person.full_name)
    .map((person) => ({
      fullName: person.full_name as string,
      jobTitle: profileByPerson.get(person.id)?.title_current ?? null,
      company: profileByPerson.get(person.id)?.company_current ?? null
    }));
}
