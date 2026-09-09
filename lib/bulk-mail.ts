import "server-only";

import {
  BULK_SEND_CHUNK,
  BULK_TIME_BUDGET_MS,
  buildRecipientValues,
  partitionRecipients,
  remainingRecipients,
  rolesForAudience,
  isBulkAudience,
  type BulkAudience,
  type BulkRecipient,
  type RecipientPartition
} from "@/lib/bulk-mail-core";
import { renderTemplate, type TemplateKind } from "@/lib/email-templates-core";
import { sendTemplatedEmail } from "@/lib/email";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/bulk-mail.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Chạy một lượt gửi hàng loạt.
 *
 * ---------------------------------------------------------------------------
 * VÌ SAO MỘT LÔ KHÔNG GỬI XONG TRONG MỘT LẦN
 * ---------------------------------------------------------------------------
 * Gói Brevo đang dùng cho khoảng 300 thư một ngày, mà một mùa có hơn số đó
 * giữa mentor và mentee. Các lời gọi lại chạy tuần tự, nên một request cũng
 * không đủ dài để đi hết danh sách.
 *
 * Nên một lô là một BẢN GHI, không phải một tiến trình: `email_batches` giữ nó
 * lại, `outbound_emails.batch_id` nối từng lá thư vào nó, và lần chạy sau đọc
 * xem đã gửi tới ai rồi để đi tiếp. Bị cắt giữa chừng cũng không ai nhận hai
 * lá — điều đó đúng vì chỗ đã-gửi-tới-đâu nằm trong database chứ không nằm
 * trong bộ nhớ của tiến trình.
 */

const VI_ERROR = "Không chạy được lượt gửi.";
const PAGE = 1000;

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string; hint?: string; details?: string };
  console.error("[bulk-mail]", scope, {
    code: err?.code,
    message: err?.message ?? String(error),
    hint: err?.hint,
    details: err?.details
  });
}

/**
 * Người nhận của một mùa, theo đối tượng.
 *
 * Sắp theo tên để thứ tự ổn định: lần chạy sau phải nhìn thấy cùng một danh
 * sách theo cùng một thứ tự, nếu không thì việc "bỏ những người đã gửi rồi" tuy
 * vẫn đúng nhưng con số còn lại nhảy loạn giữa hai lần xem.
 */
export async function listBulkRecipients(input: {
  seasonId: string;
  audience: BulkAudience;
}): Promise<{ partition: RecipientPartition; error: string | null }> {
  const empty: RecipientPartition = { sendable: [], unreachable: [] };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { partition: empty, error: VI_ERROR };

  const roles = rolesForAudience(input.audience);

  // Vai trò theo person_id. Một người có thể mang cả hai vai trò trong cùng một
  // mùa; giữ vai trò gặp trước, và `partitionRecipients` lo phần một-lá-một-người.
  const roleByPerson = new Map<string, "mentor" | "mentee">();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("person_season_memberships")
      .select("person_id, role")
      .eq("season_id", input.seasonId)
      .eq("status", "active")
      .in("role", roles)
      .range(from, from + PAGE - 1);

    if (error) {
      log("listBulkRecipients:memberships", error);
      return { partition: empty, error: VI_ERROR };
    }

    const rows = (data ?? []) as Array<{ person_id: string; role: string }>;
    for (const row of rows) {
      const personId = String(row.person_id ?? "").trim();
      if (!personId || roleByPerson.has(personId)) continue;
      if (row.role === "mentor" || row.role === "mentee") {
        roleByPerson.set(personId, row.role);
      }
    }
    if (rows.length < PAGE) break;
  }

  const personIds = Array.from(roleByPerson.keys());
  if (!personIds.length) return { partition: empty, error: null };

  const rows: BulkRecipient[] = [];
  // Từng mẻ 500: một mệnh đề `in` với vài trăm UUID đã là một URL rất dài, và
  // PostgREST nhận qua query string.
  for (let index = 0; index < personIds.length; index += 500) {
    const chunk = personIds.slice(index, index + 500);
    const { data, error } = await client
      .from("people")
      .select("id, full_name, email_primary")
      .in("id", chunk);

    if (error) {
      log("listBulkRecipients:people", error);
      return { partition: empty, error: VI_ERROR };
    }

    for (const raw of (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email_primary: string | null;
    }>) {
      const personId = String(raw.id);
      rows.push({
        personId,
        fullName: String(raw.full_name ?? "").trim(),
        email: String(raw.email_primary ?? "").trim(),
        role: roleByPerson.get(personId) ?? "mentee"
      });
    }
  }

  rows.sort((a, b) => a.fullName.localeCompare(b.fullName, "vi") || a.email.localeCompare(b.email));

  return { partition: partitionRecipients(rows), error: null };
}

export type EmailBatchRow = {
  id: string;
  seasonId: string;
  kind: TemplateKind;
  templateId: string | null;
  /**
   * Đối tượng nhận thư, chốt lúc mở lô.
   *
   * Lần chạy tiếp theo đọc từ đây chứ không nhận từ màn hình — một lô mở cho
   * mentor mà bấm tiếp được với mentee thì những người chưa từng nằm trong lô
   * ấy nhận thư như thể họ có.
   *
   * Nullable trong database vì cột được thêm sau; ở đây null nghĩa là lô cũ
   * không dùng tiếp được, và `runEmailBatch` từ chối nó.
   */
  audience: BulkAudience | null;
  status: "running" | "completed" | "failed";
  requestedCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
};

function toBatch(raw: Record<string, unknown>): EmailBatchRow {
  return {
    id: String(raw.id),
    seasonId: String(raw.season_id),
    kind: raw.kind as TemplateKind,
    templateId: raw.template_id ? String(raw.template_id) : null,
    audience: isBulkAudience(raw.audience) ? raw.audience : null,
    status: raw.status as EmailBatchRow["status"],
    requestedCount: Number(raw.requested_count ?? 0),
    sentCount: Number(raw.sent_count ?? 0),
    skippedCount: Number(raw.skipped_count ?? 0),
    failedCount: Number(raw.failed_count ?? 0),
    note: raw.note ? String(raw.note) : null,
    createdAt: String(raw.created_at ?? ""),
    completedAt: raw.completed_at ? String(raw.completed_at) : null
  };
}

const BATCH_COLUMNS =
  "id, season_id, kind, template_id, audience, status, requested_count, sent_count, skipped_count, failed_count, note, created_at, completed_at";

export async function listEmailBatches(
  seasonId: string,
  limit = 20
): Promise<{ rows: EmailBatchRow[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { rows: [], error: VI_ERROR };

  const { data, error } = await client
    .from("email_batches")
    .select(BATCH_COLUMNS)
    .eq("season_id", seasonId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    log("listEmailBatches", error);
    return { rows: [], error: VI_ERROR };
  }
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(toBatch), error: null };
}

export async function createEmailBatch(input: {
  seasonId: string;
  kind: TemplateKind;
  templateId: string;
  audience: BulkAudience;
  requestedCount: number;
  note: string;
  actorAdminUserId: string | null;
}): Promise<{ batch: EmailBatchRow | null; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { batch: null, error: VI_ERROR };

  const { data, error } = await client
    .from("email_batches")
    .insert({
      season_id: input.seasonId,
      kind: input.kind,
      template_id: input.templateId,
      audience: input.audience,
      requested_count: input.requestedCount,
      note: input.note,
      created_by: input.actorAdminUserId,
      status: "running"
    })
    .select(BATCH_COLUMNS)
    .single();

  if (error || !data) {
    log("createEmailBatch", error);
    return { batch: null, error: VI_ERROR };
  }
  return { batch: toBatch(data as Record<string, unknown>), error: null };
}

/** Các địa chỉ đã có kết quả trong lô này, để lần chạy sau không gửi lại. */
async function alreadyHandled(batchId: string): Promise<{ emails: string[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { emails: [], error: VI_ERROR };

  const emails: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("outbound_emails")
      .select("to_email")
      .eq("batch_id", batchId)
      .range(from, from + PAGE - 1);

    if (error) {
      log("alreadyHandled", error);
      return { emails: [], error: VI_ERROR };
    }
    const rows = (data ?? []) as Array<{ to_email: string }>;
    for (const row of rows) emails.push(String(row.to_email ?? ""));
    if (rows.length < PAGE) break;
  }
  return { emails, error: null };
}

export type BulkRunResult = {
  ok: boolean;
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  /** Người không nhận được thư, kèm lý do — tối đa vài dòng để còn đọc nổi. */
  problems: string[];
  error: string | null;
};

/**
 * Gửi phần tiếp theo của một lô.
 *
 * Dừng lại khi hết chỉ tiêu của một lần chạy hoặc hết ngân sách thời gian, tuỳ
 * cái nào tới trước, rồi báo còn bao nhiêu người. Lô chỉ được đánh dấu xong khi
 * thật sự không còn ai.
 *
 * Một bức thư hỏng KHÔNG dừng cả lô: nó được đếm, được nêu tên, và lô đi tiếp.
 * Những người đã nhận thì đã nhận — nói đúng điều đó có ích hơn là dừng lại và
 * để phần còn lại không bao giờ đi.
 */
export async function runEmailBatch(input: {
  batch: EmailBatchRow;
  seasonCode: string;
  subject: string;
  body: string;
  now?: () => number;
}): Promise<BulkRunResult> {
  const client = getSupabaseServiceRoleClient();
  if (!client) {
    return { ok: false, sent: 0, failed: 0, skipped: 0, remaining: 0, problems: [], error: VI_ERROR };
  }

  // Lô không nhớ mình gửi cho ai thì không đi tiếp được. Đoán bằng một giá
  // trị mặc định là gửi thư cho những người chưa từng nằm trong lô ấy.
  const audience = input.batch.audience;
  if (!audience) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
      problems: [],
      error: "Lô này không ghi lại đối tượng nhận thư. Vui lòng mở lô mới."
    };
  }

  const now = input.now ?? (() => Date.now());
  const startedAt = now();

  const recipients = await listBulkRecipients({
    seasonId: input.batch.seasonId,
    audience
  });
  if (recipients.error) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
      problems: [],
      error: recipients.error
    };
  }

  const handled = await alreadyHandled(input.batch.id);
  if (handled.error) {
    return { ok: false, sent: 0, failed: 0, skipped: 0, remaining: 0, problems: [], error: handled.error };
  }

  const pending = remainingRecipients(recipients.partition.sendable, handled.emails);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const recipient of pending) {
    if (sent + failed + skipped >= BULK_SEND_CHUNK) break;
    if (now() - startedAt >= BULK_TIME_BUDGET_MS) break;

    const filled = renderTemplate({
      kind: input.batch.kind,
      subject: input.subject,
      body: input.body,
      values: buildRecipientValues({
        kind: input.batch.kind,
        recipient,
        seasonCode: input.seasonCode
      })
    });

    if (!filled.ok) {
      // Thiếu dữ liệu cho một ô: bức thư này không đi, và không có dòng nào ghi
      // vào sổ cho nó — nên lần chạy sau sẽ gặp lại đúng người này. Đó là chủ
      // ý: sửa dữ liệu của họ rồi chạy tiếp là xong, không phải làm lô mới.
      failed += 1;
      if (problems.length < 10) problems.push(`${recipient.fullName}: ${filled.message}`);
      continue;
    }

    const result = await sendTemplatedEmail({
      kind: input.batch.kind,
      toEmail: recipient.email,
      subject: filled.subject,
      body: filled.body,
      relation: { table: "people", id: recipient.personId },
      batchId: input.batch.id
    });

    if (result.skipped) skipped += 1;
    else if (result.ok) sent += 1;
    else {
      failed += 1;
      if (problems.length < 10) problems.push(`${recipient.fullName}: ${result.reason ?? "lỗi gửi"}`);
    }
  }

  const remaining = Math.max(0, pending.length - (sent + failed + skipped));
  const done = remaining === 0;

  const { error: updateError } = await client
    .from("email_batches")
    .update({
      sent_count: input.batch.sentCount + sent,
      skipped_count: input.batch.skippedCount + skipped,
      failed_count: input.batch.failedCount + failed,
      status: done ? "completed" : "running",
      completed_at: done ? new Date().toISOString() : null
    })
    .eq("id", input.batch.id);

  if (updateError) {
    // Thư đã đi rồi. Con số trên lô sai là chuyện phải sửa, nhưng nói "lượt gửi
    // thất bại" lúc này là nói dối — và tệ hơn, nó mời người ta bấm gửi lại.
    log("runEmailBatch:update", updateError);
  }

  return { ok: true, sent, failed, skipped, remaining, problems, error: null };
}

export type AudienceCount = { sendable: number; unreachable: number };

/**
 * Số người nhận của cả ba đối tượng.
 *
 * Ba lượt đọc riêng chứ không suy ra từ một lượt: người vừa là mentor vừa là
 * mentee của cùng một mùa chỉ nhận một lá, nên "mentor + mentee" không bằng
 * "cả hai", và số hiện trên màn hình phải bằng ĐÚNG số mà lệnh gửi tự đếm lại —
 * lệch một người là người bấm không xác nhận nổi con số nào.
 */
export async function countBulkRecipients(
  seasonId: string
): Promise<{ counts: Record<BulkAudience, AudienceCount>; error: string | null }> {
  const counts: Record<BulkAudience, AudienceCount> = {
    mentee: { sendable: 0, unreachable: 0 },
    mentor: { sendable: 0, unreachable: 0 },
    both: { sendable: 0, unreachable: 0 }
  };

  for (const audience of ["mentee", "mentor", "both"] as const) {
    const result = await listBulkRecipients({ seasonId, audience });
    if (result.error) return { counts, error: result.error };
    counts[audience] = {
      sendable: result.partition.sendable.length,
      unreachable: result.partition.unreachable.length
    };
  }

  return { counts, error: null };
}
