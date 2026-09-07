import "server-only";

import {
  OUTBOUND_EMAIL_STATUSES,
  type OutboundEmailFilters,
  type OutboundEmailStatus
} from "@/lib/outbound-emails-core";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/outbound-emails.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc sổ ghi thư đi cho màn hình /operations/emails.
 *
 * Bảng bật RLS và không có policy nào, nên chỉ service_role đọc được — đúng như
 * hợp đồng migration đặt ra. Ở đây chỉ có đọc; không hàm nào trong file này ghi
 * hay xoá.
 */

const VI_ERROR = "Không đọc được sổ thư đã gửi.";

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[outbound-emails]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

export type OutboundEmailRow = {
  id: string;
  kind: string;
  toEmail: string;
  subject: string | null;
  status: string;
  provider: string;
  providerMessageId: string | null;
  error: string | null;
  relatedTable: string | null;
  relatedId: string | null;
  createdAt: string;
};

export const OUTBOUND_EMAIL_PAGE_SIZE = 50;

export async function listOutboundEmails(
  filters: OutboundEmailFilters,
  pageSize = OUTBOUND_EMAIL_PAGE_SIZE
): Promise<{ rows: OutboundEmailRow[]; count: number; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { rows: [], count: 0, error: VI_ERROR };

  let query = client
    .from("outbound_emails")
    .select(
      "id, kind, to_email, subject, status, provider, provider_message_id, error, related_table, related_id, created_at",
      { count: "exact" }
    );

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.q) query = query.ilike("to_email", `%${filters.q}%`);

  const from = (filters.page - 1) * pageSize;

  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) {
    log("list failed", error);
    return { rows: [], count: 0, error: VI_ERROR };
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    kind: String(row.kind ?? ""),
    toEmail: String(row.to_email ?? ""),
    subject: row.subject === null || row.subject === undefined ? null : String(row.subject),
    status: String(row.status ?? ""),
    provider: String(row.provider ?? ""),
    providerMessageId:
      row.provider_message_id === null || row.provider_message_id === undefined
        ? null
        : String(row.provider_message_id),
    error: row.error === null || row.error === undefined ? null : String(row.error),
    relatedTable:
      row.related_table === null || row.related_table === undefined
        ? null
        : String(row.related_table),
    relatedId:
      row.related_id === null || row.related_id === undefined ? null : String(row.related_id),
    createdAt: String(row.created_at ?? "")
  }));

  return { rows, count: count ?? 0, error: null };
}

export type OutboundEmailStatusCounts = Record<OutboundEmailStatus, number>;

/**
 * Đếm theo trạng thái cho hàng thẻ trên đầu trang.
 *
 * Bốn truy vấn `head: true` thay vì gộp một lần và đếm ở tầng ứng dụng, vì gộp
 * sẽ phải kéo cả bảng về chỉ để đếm.
 */
export async function countOutboundEmailsByStatus(): Promise<OutboundEmailStatusCounts> {
  const empty: OutboundEmailStatusCounts = { queued: 0, sent: 0, failed: 0, skipped: 0 };
  const client = getSupabaseServiceRoleClient();
  if (!client) return empty;

  const results = await Promise.all(
    OUTBOUND_EMAIL_STATUSES.map(async (status) => {
      const { count, error } = await client
        .from("outbound_emails")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      if (error) {
        log(`count ${status} failed`, error);
        return [status, 0] as const;
      }
      return [status, count ?? 0] as const;
    })
  );

  const counts = { ...empty };
  for (const [status, value] of results) counts[status] = value;
  return counts;
}
