import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageProgramDocuments } from "@/lib/permissions";
import { canOperateSeason, canReadSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { resolveSeason } from "@/lib/mentor-confirmations";
import { resolveEmailBaseUrl } from "@/lib/email";
import {
  buildDocumentSlug,
  defaultDocumentTitle,
  DOCUMENT_AUDIENCES,
  DOCUMENT_KINDS,
  isDocumentReady,
  isValidSlug,
  validateDocumentInput,
  type DocumentAudience,
  type DocumentKind
} from "@/lib/program-documents-core";

/**
 * lib/program-documents.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Storing and serving the code of conduct and the tips.
 *
 * Four documents per season — code of conduct and tips, for mentees and for
 * mentors — each with a fixed public address that the post-matching emails
 * link to. Linking rather than attaching is the point: a document corrected
 * after the emails went out is corrected for every reader.
 *
 * The public read path takes a slug and returns only a PUBLISHED document. A
 * draft is visible to an organiser previewing it, never to a visitor.
 */

const SAFE_ERROR = "Không thể thực hiện thao tác. Vui lòng thử lại hoặc liên hệ admin.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string };
  console.error("[program-documents]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint
  });
}

export type MutationResult = { ok: boolean; message: string; documentId?: string | null };

export type ProgramDocumentRow = {
  id: string;
  season_id: string;
  audience: DocumentAudience;
  kind: DocumentKind;
  title: string;
  slug: string;
  body: string;
  version: number;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  updated_at: string;
};

const ROW_COLUMNS =
  "id,season_id,audience,kind,title,slug,body,version,status,published_at,updated_at";

async function requireDocumentEditor(seasonId: string) {
  const admin = await getCurrentAdminUser();
  if (!admin?.id) return { ok: false as const, message: "Bạn chưa đăng nhập." };
  if (!canManageProgramDocuments(admin.role)) {
    return { ok: false as const, message: "Bạn không có quyền quản lý tài liệu chương trình." };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canOperateSeason(ctx, seasonId))) {
    return { ok: false as const, message: "Bạn không có quyền vận hành mùa này." };
  }
  return { ok: true as const, admin, adminId: admin.id };
}

// ── Reading ──────────────────────────────────────────────────────────────────

export type DocumentListResult = {
  ok: boolean;
  error: string | null;
  rows: ProgramDocumentRow[];
};

export async function listProgramDocuments(input: {
  seasonId: string;
}): Promise<DocumentListResult> {
  if (!isValidUuid(input.seasonId)) {
    return { ok: false, error: "Mùa không hợp lệ.", rows: [] };
  }

  const admin = await getCurrentAdminUser();
  if (!canManageProgramDocuments(admin?.role)) {
    return { ok: false, error: "Bạn không có quyền xem tài liệu chương trình.", rows: [] };
  }
  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, input.seasonId))) {
    return { ok: false, error: "Bạn không có quyền xem dữ liệu của mùa này.", rows: [] };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: SAFE_ERROR, rows: [] };

  const { data, error } = await client
    .from("program_documents")
    .select(ROW_COLUMNS)
    .eq("season_id", input.seasonId)
    .order("audience", { ascending: true })
    .order("kind", { ascending: true });

  if (error) {
    log("list documents", error);
    return { ok: false, error: SAFE_ERROR, rows: [] };
  }

  return { ok: true, error: null, rows: (data ?? []) as unknown as ProgramDocumentRow[] };
}

export type PublicDocumentView =
  | { state: "ready"; document: ProgramDocumentRow }
  | { state: "not_found" }
  | { state: "not_published" };

/**
 * The public read. Takes a slug from a URL, so it validates the shape before
 * touching the database and never reveals a draft.
 */
export async function getPublicDocumentBySlug(slug: string): Promise<PublicDocumentView> {
  if (!isValidSlug(slug)) return { state: "not_found" };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { state: "not_found" };

  const { data, error } = await client
    .from("program_documents")
    .select(ROW_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    log("public document lookup", error);
    return { state: "not_found" };
  }

  const document = data as unknown as ProgramDocumentRow | null;
  if (!document) return { state: "not_found" };
  if (document.status !== "published") return { state: "not_published" };
  return { state: "ready", document };
}

/** Admin preview of a document that is not published yet. */
export async function getProgramDocument(input: {
  documentId: string;
}): Promise<ProgramDocumentRow | null> {
  if (!isValidUuid(input.documentId)) return null;

  const client = getSupabaseServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("program_documents")
    .select(ROW_COLUMNS)
    .eq("id", input.documentId)
    .maybeSingle();

  if (error) {
    log("load document", error);
    return null;
  }

  const document = data as unknown as ProgramDocumentRow | null;
  if (!document) return null;

  const admin = await getCurrentAdminUser();
  if (!canManageProgramDocuments(admin?.role)) return null;
  const ctx = await getAdminScopeContext();
  if (!(await canReadSeason(ctx, document.season_id))) return null;

  return document;
}

// ── Creating the four rows for a season ──────────────────────────────────────

export type EnsureDocumentsResult = {
  ok: boolean;
  message: string;
  created: number;
  existing: number;
};

/**
 * Make sure the season has its four documents, as empty drafts.
 *
 * Called from the admin page so the organisers always see the four things they
 * have to write, rather than an empty screen with a "create" button.
 */
export async function ensureSeasonDocuments(input: {
  seasonIdOrCode: string;
}): Promise<EnsureDocumentsResult> {
  const season = await resolveSeason(String(input.seasonIdOrCode ?? "").trim());
  if (!season) return { ok: false, message: "Không tìm thấy mùa.", created: 0, existing: 0 };

  const guard = await requireDocumentEditor(season.id);
  if (!guard.ok) return { ok: false, message: guard.message, created: 0, existing: 0 };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR, created: 0, existing: 0 };

  const { data: existingRows, error: existingErr } = await client
    .from("program_documents")
    .select("audience,kind")
    .eq("season_id", season.id);

  if (existingErr) {
    log("load existing documents", existingErr);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: 0 };
  }

  const have = new Set(
    ((existingRows ?? []) as Array<{ audience: string; kind: string }>).map(
      (row) => `${row.audience}:${row.kind}`
    )
  );

  const missing: Array<Record<string, unknown>> = [];
  for (const audience of DOCUMENT_AUDIENCES) {
    for (const kind of DOCUMENT_KINDS) {
      if (have.has(`${audience}:${kind}`)) continue;
      missing.push({
        season_id: season.id,
        audience,
        kind,
        title: defaultDocumentTitle(audience, kind),
        slug: buildDocumentSlug({ seasonCode: season.code, audience, kind }),
        body: "",
        status: "draft",
        created_by: guard.adminId,
        updated_by: guard.adminId
      });
    }
  }

  if (!missing.length) {
    return { ok: true, message: "Mùa này đã có đủ 4 tài liệu.", created: 0, existing: have.size };
  }

  const { error: insertErr } = await client.from("program_documents").insert(missing);
  if (insertErr) {
    log("create documents", insertErr);
    return { ok: false, message: SAFE_ERROR, created: 0, existing: have.size };
  }

  return {
    ok: true,
    message: `Đã tạo ${missing.length} tài liệu trống cho mùa này.`,
    created: missing.length,
    existing: have.size
  };
}

// ── Editing ──────────────────────────────────────────────────────────────────

export async function saveProgramDocument(input: {
  documentId?: unknown;
  title?: unknown;
  body?: unknown;
}): Promise<MutationResult> {
  const documentId = String(input.documentId ?? "").trim();
  if (!isValidUuid(documentId)) return { ok: false, message: "Tài liệu không hợp lệ." };

  const validated = validateDocumentInput({ title: input.title, body: input.body });
  if (!validated.ok) return { ok: false, message: validated.message };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: currentRow, error: loadErr } = await client
    .from("program_documents")
    .select("id,season_id,version,status")
    .eq("id", documentId)
    .maybeSingle();

  if (loadErr) {
    log("load document for save", loadErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const current = currentRow as {
    id: string;
    season_id: string;
    version: number;
    status: string;
  } | null;
  if (!current) return { ok: false, message: "Không tìm thấy tài liệu." };

  const guard = await requireDocumentEditor(current.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  const nextVersion = (current.version ?? 1) + 1;

  const { error: updateErr } = await client
    .from("program_documents")
    .update({
      title: validated.title,
      body: validated.body,
      version: nextVersion,
      updated_by: guard.adminId
    })
    .eq("id", documentId);

  if (updateErr) {
    log("save document", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  // The text a cohort was given stays readable after the next edit.
  await writeRevision(client, {
    documentId,
    version: nextVersion,
    title: validated.title,
    body: validated.body,
    status: current.status,
    savedBy: guard.adminId
  });

  return { ok: true, message: "Đã lưu tài liệu.", documentId };
}

async function writeRevision(
  client: ServiceClient,
  row: {
    documentId: string;
    version: number;
    title: string;
    body: string;
    status: string;
    savedBy: string | null;
  }
) {
  const { error } = await client.from("program_document_revisions").insert({
    document_id: row.documentId,
    version: row.version,
    title: row.title,
    body: row.body,
    status: row.status,
    saved_by: row.savedBy
  });
  if (error) log("write revision (non-fatal)", error);
}

export async function setDocumentStatus(input: {
  documentId?: unknown;
  status?: unknown;
}): Promise<MutationResult> {
  const documentId = String(input.documentId ?? "").trim();
  const status = String(input.status ?? "").trim();
  if (!isValidUuid(documentId)) return { ok: false, message: "Tài liệu không hợp lệ." };
  if (!["draft", "published", "archived"].includes(status)) {
    return { ok: false, message: "Trạng thái không hợp lệ." };
  }

  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const { data: currentRow, error: loadErr } = await client
    .from("program_documents")
    .select("id,season_id,body,version,title,status")
    .eq("id", documentId)
    .maybeSingle();

  if (loadErr) {
    log("load document for status change", loadErr);
    return { ok: false, message: SAFE_ERROR };
  }
  const current = currentRow as {
    season_id: string;
    body: string;
    version: number;
    title: string;
  } | null;
  if (!current) return { ok: false, message: "Không tìm thấy tài liệu." };

  const guard = await requireDocumentEditor(current.season_id);
  if (!guard.ok) return { ok: false, message: guard.message };

  // An empty page is worse than no link at all: the reader assumes the program
  // has nothing to say.
  if (status === "published" && !String(current.body ?? "").trim()) {
    return { ok: false, message: "Tài liệu chưa có nội dung nên chưa xuất bản được." };
  }

  const { error: updateErr } = await client
    .from("program_documents")
    .update({
      status,
      published_at: status === "published" ? new Date().toISOString() : null,
      updated_by: guard.adminId
    })
    .eq("id", documentId);

  if (updateErr) {
    log("set document status", updateErr);
    return { ok: false, message: SAFE_ERROR };
  }

  await writeRevision(client, {
    documentId,
    version: (current.version ?? 1) + 1,
    title: current.title,
    body: current.body ?? "",
    status,
    savedBy: guard.adminId
  });

  return {
    ok: true,
    documentId,
    message:
      status === "published"
        ? "Đã xuất bản. Đường dẫn công khai đã hoạt động."
        : status === "archived"
        ? "Đã lưu trữ tài liệu."
        : "Đã chuyển về bản nháp. Đường dẫn công khai tạm ngừng."
  };
}

// ── Links for the emails ─────────────────────────────────────────────────────

export type DocumentLinks = {
  codeOfConduct: string | null;
  tips: string | null;
  /** Kinds that are not ready to be linked yet, for the send screen to warn. */
  missing: DocumentKind[];
};

/**
 * Absolute links for one audience, for use in an email body.
 *
 * A document that is not published, or published but empty, is reported as
 * missing rather than linked — a bulk send should refuse to go out with a link
 * to a blank page.
 */
export async function getDocumentLinks(input: {
  seasonId: string;
  audience: DocumentAudience;
  requestOrigin?: string | null;
}): Promise<DocumentLinks> {
  const empty: DocumentLinks = {
    codeOfConduct: null,
    tips: null,
    missing: [...DOCUMENT_KINDS]
  };

  if (!isValidUuid(input.seasonId)) return empty;

  const client = getSupabaseServiceRoleClient();
  if (!client) return empty;

  const base = resolveEmailBaseUrl(input.requestOrigin ?? null);
  if (!base) return empty;

  const { data, error } = await client
    .from("program_documents")
    .select("kind,slug,status,body")
    .eq("season_id", input.seasonId)
    .eq("audience", input.audience);

  if (error) {
    log("document links", error);
    return empty;
  }

  const links: DocumentLinks = { codeOfConduct: null, tips: null, missing: [] };

  for (const kind of DOCUMENT_KINDS) {
    const row = ((data ?? []) as Array<{
      kind: string;
      slug: string;
      status: string;
      body: string;
    }>).find((item) => item.kind === kind);

    if (!row || !isDocumentReady(row)) {
      links.missing.push(kind);
      continue;
    }
    const url = `${base}/documents/${row.slug}`;
    if (kind === "code_of_conduct") links.codeOfConduct = url;
    else links.tips = url;
  }

  return links;
}
