import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageProgramDocuments } from "@/lib/permissions";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { resolveSeason } from "@/lib/mentor-confirmations";
import { callProvider, getProviderConfig } from "@/lib/ai-provider";
import {
  buildDraftPrompt,
  DRAFT_PROMPT_VERSION,
  DRAFT_SYSTEM_PROMPT,
  parseDraft,
  TEMPLATE_KINDS,
  TEMPLATE_SPECS,
  validateTemplate,
  type TemplateKind
} from "@/lib/email-templates-core";

/**
 * lib/email-templates.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * The bodies of the post-matching emails: drafted, edited, approved, used.
 *
 * Two rules are enforced here rather than trusted to a habit.
 *
 * A BULK SEND MAY ONLY USE AN APPROVED TEMPLATE. Drafting is cheap and can be
 * assisted; approving is a person taking responsibility for what hundreds of
 * students are about to read. Editing an approved template sends it back to
 * draft, because the approval was of the old words.
 *
 * A DRAFT REQUEST CARRIES NO PERSON. The prompt is built in the pure core
 * module from the template's purpose and its placeholder names — never from a
 * mentee, a mentor or a match.
 */

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[email-templates]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string; templateId?: string | null };

export type EmailTemplateRow = {
  id: string;
  season_id: string;
  kind: TemplateKind;
  subject: string;
  body: string;
  status: "draft" | "approved" | "archived";
  ai_generated: boolean;
  ai_model: string | null;
  ai_prompt_version: string | null;
  approved_at: string | null;
  updated_at: string;
};

const ROW_COLUMNS =
  "id,season_id,kind,subject,body,status,ai_generated,ai_model,ai_prompt_version,approved_at,updated_at";

async function requireTemplateEditor(seasonId: string) {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false as const, message: "Bạn chưa đăng nhập." };
  if (!canManageProgramDocuments(admin.role)) {
    return { ok: false as const, message: "Bạn không có quyền quản lý mẫu thư." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, seasonId))) {
    return { ok: false as const, message: "Bạn không có quyền vận hành mùa này." };
  }
  return { ok: true as const, admin, adminId: admin.id };
}

async function writeLog(
  client: ServiceClient,
  row: {
    templateId: string;
    action: "created" | "ai_drafted" | "edited" | "approved" | "archived";
    actorId?: string | null;
    detail?: Record<string, unknown> | null;
  }
) {
  const { error } = await client.from("email_template_log").insert({
    template_id: row.templateId,
    action: row.action,
    detail: row.detail ?? null,
    actor_admin_user_id: row.actorId ?? null
  });
  if (error) log("write log (non-fatal)", error);
}

// ── Reading ──────────────────────────────────────────────────────────────────

export type TemplateListResult = { ok: boolean; error: string | null; rows: EmailTemplateRow[] };

export async function listEmailTemplates(input: {
  seasonId: string;
}): Promise<TemplateListResult> {
  if (!isValidUuid(input.seasonId)) return { ok: false, error: "Mùa không hợp lệ.", rows: [] };

  const admin = await getCurrentAdminUser();
  if (!canManageProgramDocuments(admin?.role)) {
    return { ok: false, error: "Bạn không có quyền xem mẫu thư.", rows: [] };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, input.seasonId))) {
    return { ok: false, error: "Bạn không có quyền xem dữ liệu của mùa này.", rows: [] };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: SAFE_ERROR, rows: [] };

  const { data, error } = await client
    .from("email_templates")
    .select(ROW_COLUMNS)
    .eq("season_id", input.seasonId)
    .neq("status", "archived")
    .order("kind", { ascending: true });

  if (error) {
    log("list templates", error);
    return { ok: false, error: SAFE_ERROR, rows: [] };
  }

  return { ok: true, error: null, rows: (data ?? []) as unknown as EmailTemplateRow[] };
}

/** The one template a bulk send is allowed to use. */
export async function getApprovedTemplate(input: {
  seasonId: string;
  kind: TemplateKind;
}): Promise<EmailTemplateRow | null> {
  if (!isValidUuid(input.seasonId)) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("email_templates")
    .select(ROW_COLUMNS)
    .eq("season_id", input.seasonId)
    .eq("kind", input.kind)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle();

  if (error) {
    log("load approved template", error);
    return null;
  }
  return (data as unknown as EmailTemplateRow | null) ?? null;
}

// ── Creating the four rows for a season ──────────────────────────────────────

export type EnsureTemplatesResult = { ok: boolean; message: string; created: number };

export async function ensureSeasonTemplates(input: {
  seasonIdOrCode: string;
}): Promise<EnsureTemplatesResult> {
  const season = await resolveSeason(String(input.seasonIdOrCode ?? "").trim());
  if (!season) return { ok: false, message: "Không tìm thấy mùa.", created: 0 };

  const guard = await requireTemplateEditor(season.id);
  if (!guard.ok) return { ok: false, message: guard.message, created: 0 };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR, created: 0 };

  const { data: existingRows, error: existingErr } = await client
    .from("email_templates")
    .select("kind")
    .eq("season_id", season.id)
    .neq("status", "archived");

  if (existingErr) {
    log("load existing templates", existingErr);
    return { ok: false, message: SAFE_ERROR, created: 0 };
  }

  const have = new Set(((existingRows ?? []) as Array<{ kind: string }>).map((row) => row.kind));
  const missing = TEMPLATE_KINDS.filter((kind) => !have.has(kind));

  if (!missing.length) {
    return { ok: true, message: "Mùa này đã có đủ 4 mẫu thư.", created: 0 };
  }

  const { data: inserted, error: insertErr } = await client
    .from("email_templates")
    .insert(
      missing.map((kind) => ({
        season_id: season.id,
        kind,
        subject: "",
        body: "",
        status: "draft",
        created_by: guard.adminId
      }))
    )
    .select("id");

  if (insertErr) {
    log("create templates", insertErr);
    return { ok: false, message: SAFE_ERROR, created: 0 };
  }

  for (const row of (inserted ?? []) as Array<{ id: string }>) {
    await writeLog(client, { templateId: row.id, action: "created", actorId: guard.adminId });
  }

  return {
    ok: true,
    message: `Đã tạo ${missing.length} mẫu thư trống cho mùa này.`,
    created: missing.length
  };
}

// ── Editing and approving ────────────────────────────────────────────────────

async function loadTemplate(client: ServiceClient, templateId: string) {
  const { data, error } = await client
    .from("email_templates")
    .select(ROW_COLUMNS)
    .eq("id", templateId)
    .maybeSingle();
  if (error) {
    log("load template", error);
    return null;
  }
  return (data as unknown as EmailTemplateRow | null) ?? null;
}

export async function saveEmailTemplate(input: {
  templateId?: unknown;
  subject?: unknown;
  body?: unknown;
}): Promise<MutationResult> {
  const templateId = String(input.templateId ?? "").trim();
  if (!isValidUuid(templateId)) return { ok: false, message: "Mẫu thư không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const template = await loadTemplate(client, templateId);
  if (!template) return { ok: false, message: "Không tìm thấy mẫu thư." };

  const guard = await requireTemplateEditor(template.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  const validated = validateTemplate({
    kind: template.kind,
    subject: input.subject,
    body: input.body
  });
  if (!validated.ok) return { ok: false, message: validated.message };

  const wasApproved = template.status === "approved";

  const { error } = await client
    .from("email_templates")
    .update({
      subject: validated.subject,
      body: validated.body,
      // The approval was of the previous wording.
      status: "draft",
      approved_by: null,
      approved_at: null
    })
    .eq("id", templateId);

  if (error) {
    log("save template", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    templateId,
    action: "edited",
    actorId: guard.adminId,
    detail: { warnings: validated.warnings }
  });

  const warning = validated.warnings.length ? ` ${validated.warnings.join(" ")}` : "";
  return {
    ok: true,
    templateId,
    message: wasApproved
      ? `Đã lưu. Mẫu thư quay lại trạng thái nháp, cần duyệt lại trước khi gửi.${warning}`
      : `Đã lưu bản nháp.${warning}`
  };
}

export async function approveEmailTemplate(input: {
  templateId?: unknown;
}): Promise<MutationResult> {
  const templateId = String(input.templateId ?? "").trim();
  if (!isValidUuid(templateId)) return { ok: false, message: "Mẫu thư không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const template = await loadTemplate(client, templateId);
  if (!template) return { ok: false, message: "Không tìm thấy mẫu thư." };

  const guard = await requireTemplateEditor(template.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  // The same check the editor ran, in case the row was written another way.
  const validated = validateTemplate({
    kind: template.kind,
    subject: template.subject,
    body: template.body
  });
  if (!validated.ok) return { ok: false, message: validated.message };

  // Only one approved template per kind: retire the previous one first.
  const { data: previousRows } = await client
    .from("email_templates")
    .select("id")
    .eq("season_id", template.season_id)
    .eq("kind", template.kind)
    .eq("status", "approved")
    .neq("id", templateId);

  for (const row of (previousRows ?? []) as Array<{ id: string }>) {
    await client
      .from("email_templates")
      .update({ status: "archived", approved_at: null, approved_by: null })
      .eq("id", row.id);
    await writeLog(client, { templateId: row.id, action: "archived", actorId: guard.adminId });
  }

  const { error } = await client
    .from("email_templates")
    .update({
      status: "approved",
      approved_by: guard.adminId,
      approved_at: new Date().toISOString()
    })
    .eq("id", templateId);

  if (error) {
    log("approve template", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, { templateId, action: "approved", actorId: guard.adminId });

  return {
    ok: true,
    templateId,
    message: `Đã duyệt mẫu "${TEMPLATE_SPECS[template.kind]?.label ?? template.kind}". Có thể dùng để gửi hàng loạt.`
  };
}

// ── Assisted drafting ────────────────────────────────────────────────────────

export async function draftEmailTemplateWithAi(input: {
  templateId?: unknown;
}): Promise<MutationResult> {
  const templateId = String(input.templateId ?? "").trim();
  if (!isValidUuid(templateId)) return { ok: false, message: "Mẫu thư không hợp lệ." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const template = await loadTemplate(client, templateId);
  if (!template) return { ok: false, message: "Không tìm thấy mẫu thư." };

  const guard = await requireTemplateEditor(template.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  if (template.status === "approved") {
    return {
      ok: false,
      message: "Mẫu thư đã duyệt. Nếu muốn soạn lại, hãy sửa nội dung — mẫu sẽ quay về bản nháp."
    };
  }

  const provider = getProviderConfig();
  if (!provider.ok) {
    return { ok: false, message: `Chưa bật soạn thảo bằng AI: ${provider.reason}.` };
  }

  let reply;
  try {
    reply = await callProvider({
      config: provider,
      systemPrompt: DRAFT_SYSTEM_PROMPT,
      // Built from the template's purpose and placeholder names only — no
      // mentee, mentor or match is part of this request.
      userPrompt: buildDraftPrompt(template.kind)
    });
  } catch (err) {
    log("draft request", err);
    return { ok: false, message: `Không soạn được bản nháp: ${(err as Error)?.message ?? "lỗi không rõ"}` };
  }

  const draft = parseDraft(reply.content, template.kind);
  if (!draft.ok) return { ok: false, message: draft.message };

  const { error } = await client
    .from("email_templates")
    .update({
      subject: draft.subject,
      body: draft.body,
      status: "draft",
      ai_generated: true,
      ai_model: reply.model,
      ai_prompt_version: DRAFT_PROMPT_VERSION
    })
    .eq("id", templateId);

  if (error) {
    log("store draft", error);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeLog(client, {
    templateId,
    action: "ai_drafted",
    actorId: guard.adminId,
    detail: { model: reply.model, prompt_version: DRAFT_PROMPT_VERSION }
  });

  return {
    ok: true,
    templateId,
    message: "Đã có bản nháp. Vui lòng đọc lại, sửa cho đúng giọng của chương trình rồi mới duyệt."
  };
}
