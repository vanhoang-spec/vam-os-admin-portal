import "server-only";

import { S12_BINDING } from "@/lib/application-form-controls";
import {
  DEFAULT_APPLICATION_FORM_TEXTS,
  resolveApplicationFormTexts,
  type ApplicationFormTexts
} from "@/lib/application-form-text-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/application-form-texts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc các khối chữ admin đã sửa trên form nộp đơn của đợt tuyển hiện hành.
 *
 * Tách khỏi đường ghi (lib/application-form-text-write.ts) có chủ ý: form công
 * khai chỉ cần đọc, và không có lý do gì để trang mà hàng trăm người mở kéo theo
 * cả module sự kiện chỉ để có hàm ghi nhật ký.
 */

export type FormTextOverride = {
  body: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type FormTextOverrideLookup =
  | { ok: true; seasonId: string; intakeBatchId: string; overrides: Record<string, FormTextOverride> }
  | { ok: false; reason: string };

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[application-form-texts]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

type Client = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

export async function readApplicationFormTextOverrides(
  client: Client | null = getSupabaseServiceRoleClient()
): Promise<FormTextOverrideLookup> {
  if (!client) return { ok: false, reason: "client_unavailable" };

  const { data: season, error: seasonError } = await client
    .from("seasons")
    .select("id")
    .eq("code", S12_BINDING.seasonCode)
    .maybeSingle();
  if (seasonError) {
    log("season", seasonError);
    return { ok: false, reason: "season_unreadable" };
  }
  const seasonId = String((season as { id?: string } | null)?.id ?? "");
  if (!seasonId) return { ok: false, reason: "season_missing" };

  const { data: batch, error: batchError } = await client
    .from("intake_batches")
    .select("id")
    .eq("code", S12_BINDING.intakeBatchCode)
    .eq("season_id", seasonId)
    .maybeSingle();
  if (batchError) {
    log("intake_batch", batchError);
    return { ok: false, reason: "batch_unreadable" };
  }
  const intakeBatchId = String((batch as { id?: string } | null)?.id ?? "");
  if (!intakeBatchId) return { ok: false, reason: "batch_missing" };

  const { data: rows, error: rowsError } = await client
    .from("application_form_texts")
    .select("text_key, body, updated_at, admin_users(full_name)")
    .eq("intake_batch_id", intakeBatchId);
  if (rowsError) {
    log("rows", rowsError);
    return { ok: false, reason: "texts_unreadable" };
  }

  const overrides: Record<string, FormTextOverride> = {};
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const key = String(row.text_key ?? "");
    if (!key || typeof row.body !== "string") continue;
    const by = (Array.isArray(row.admin_users) ? row.admin_users[0] : row.admin_users) as
      | { full_name?: string | null }
      | null
      | undefined;
    overrides[key] = {
      body: row.body,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      updatedByName: by?.full_name ?? null
    };
  }

  return { ok: true, seasonId, intakeBatchId, overrides };
}

export function overrideBodies(overrides: Record<string, FormTextOverride>): Record<string, string> {
  return Object.fromEntries(Object.entries(overrides).map(([key, override]) => [key, override.body]));
}

/**
 * Chữ của các form công khai.
 *
 * Đọc hỏng — bảng chưa có, mạng chập chờn — thì trả chữ mặc định, KHÔNG đóng form.
 * Đây là chữ, không phải một cổng quyền: một lỗi đọc không được biến một form đang
 * mở thành một trang lỗi ngay giữa đợt tuyển. Lỗi vẫn được ghi log.
 */
export async function getApplicationFormTexts(): Promise<ApplicationFormTexts> {
  try {
    const lookup = await readApplicationFormTextOverrides();
    if (!lookup.ok) {
      log("getApplicationFormTexts", lookup.reason);
      return DEFAULT_APPLICATION_FORM_TEXTS;
    }
    return resolveApplicationFormTexts(overrideBodies(lookup.overrides));
  } catch (error) {
    log("getApplicationFormTexts:crash", error);
    return DEFAULT_APPLICATION_FORM_TEXTS;
  }
}
