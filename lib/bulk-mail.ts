import "server-only";

import {
  BULK_AUDIENCE_LABELS,
  BULK_SEND_CHUNK,
  BULK_TIME_BUDGET_MS,
  FIXED_BULK_AUDIENCES,
  STAFF_ROLES,
  buildRecipientValues,
  isMembershipAudience,
  partitionRecipients,
  remainingRecipients,
  rolesForAudience,
  isBulkAudience,
  type BulkAudience,
  type BulkEventOption,
  type BulkRecipient,
  type FixedBulkAudience,
  type RecipientPartition
} from "@/lib/bulk-mail-core";
import { escapeIlikePattern } from "@/lib/identity";
import { readAllPages, readAllPagesIn, readBounded } from "@/lib/paged-read";
import { formatDate } from "@/lib/utils";
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
  /** Chỉ dùng với nhóm `event`. */
  eventId?: string | null;
  /** Chỉ dùng với nhóm `event`. */
  coversSeries?: boolean;
}): Promise<{ partition: RecipientPartition; error: string | null; label?: string }> {
  const empty: RecipientPartition = { sendable: [], unreachable: [] };
  const client = getSupabaseServiceRoleClient();
  if (!client) return { partition: empty, error: VI_ERROR };

  let result: RecipientRows;
  if (isMembershipAudience(input.audience)) {
    result = await membershipRecipients(client, input.seasonId, input.audience);
  } else if (input.audience === "staff") {
    result = await staffRecipients(client);
  } else if (input.audience === "returning_mentor") {
    result = await returningMentorRecipients(client, input.seasonId);
  } else {
    result = await eventRecipients(client, input.seasonId, input.eventId ?? null, input.coversSeries === true);
  }
  if (result.error) return { partition: empty, error: result.error };

  const rows = result.rows
    .slice()
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "vi") || a.email.localeCompare(b.email));

  return {
    partition: partitionRecipients(rows),
    error: null,
    label: result.label ?? BULK_AUDIENCE_LABELS[input.audience]
  };
}

type RecipientRows = { rows: BulkRecipient[]; error: string | null; label?: string };

/** Mentor, mentee, hoặc cả hai — theo membership đang hoạt động của mùa. */
async function membershipRecipients(
  client: any,
  seasonId: string,
  audience: "mentee" | "mentor" | "both"
): Promise<RecipientRows> {
  const roles = rolesForAudience(audience);

  // Vai trò theo person_id. Một người có thể mang cả hai vai trò trong cùng một
  // mùa; giữ vai trò gặp trước, và `partitionRecipients` lo phần một-lá-một-người.
  const roleByPerson = new Map<string, "mentor" | "mentee">();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("person_season_memberships")
      .select("person_id, role")
      .eq("season_id", seasonId)
      .eq("status", "active")
      .in("role", roles)
      .range(from, from + PAGE - 1);

    if (error) {
      log("listBulkRecipients:memberships", error);
      return { rows: [], error: VI_ERROR };
    }

    const batch = (data ?? []) as Array<{ person_id: string; role: string }>;
    for (const row of batch) {
      const personId = String(row.person_id ?? "").trim();
      if (!personId || roleByPerson.has(personId)) continue;
      if (row.role === "mentor" || row.role === "mentee") {
        roleByPerson.set(personId, row.role);
      }
    }
    if (batch.length < PAGE) break;
  }

  return peopleRecipients(client, roleByPerson);
}

/** Họ tên và địa chỉ trong danh bạ của những người đã chọn ra, kèm vai trò. */
async function peopleRecipients(
  client: any,
  roleByPerson: Map<string, "mentor" | "mentee">
): Promise<RecipientRows> {
  const personIds = Array.from(roleByPerson.keys());
  if (!personIds.length) return { rows: [], error: null };

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
      return { rows: [], error: VI_ERROR };
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

  return { rows, error: null };
}

/**
 * Ban tổ chức: tài khoản đang hoạt động mang một vai trò trong STAFF_ROLES.
 *
 * Tài khoản trống họ tên thì lấy tên trong danh bạ theo cùng email. Lúc viết, 9
 * trên 20 tài khoản BTC trống họ tên, và cả 9 đều có tên trong danh bạ. Không
 * lấy tên từ đó thì gần nửa BTC rơi vào "không gửi được" chỉ vì màn hình tạo tài
 * khoản không bắt nhập tên.
 *
 * Không theo mùa: BTC là người vận hành chương trình, không phải người tham gia
 * một mùa.
 */
async function staffRecipients(client: any): Promise<RecipientRows> {
  const accounts = await readBounded<{ id: string; full_name: string | null; email: string | null }>(
    "bulk mail staff accounts",
    client
      .from("admin_users")
      .select("id, full_name, email")
      .eq("status", "active")
      .in("role", Array.from(STAFF_ROLES))
  );
  if (accounts.error) {
    log("listBulkRecipients:staff", accounts.error);
    return { rows: [], error: VI_ERROR };
  }

  const nameByEmail = new Map<string, string>();
  for (const account of accounts.data) {
    const email = String(account.email ?? "").trim();
    if (!email || String(account.full_name ?? "").trim()) continue;

    // So khớp không phân biệt hoa thường, nhưng thoát `_` và `%`: một địa chỉ có
    // dấu gạch dưới không được khớp nhầm sang tên của một người khác.
    const people = await readBounded<{ full_name: string | null; email_primary: string | null }>(
      "bulk mail staff name",
      client.from("people").select("full_name, email_primary").ilike("email_primary", escapeIlikePattern(email))
    );
    if (people.error) {
      log("listBulkRecipients:staff-names", people.error);
      return { rows: [], error: VI_ERROR };
    }
    const match = people.data.find(
      (person) =>
        String(person.email_primary ?? "").trim().toLowerCase() === email.toLowerCase() &&
        String(person.full_name ?? "").trim()
    );
    if (match) nameByEmail.set(email.toLowerCase(), String(match.full_name).trim());
  }

  const rows: BulkRecipient[] = accounts.data.map((account) => {
    const email = String(account.email ?? "").trim();
    return {
      personId: String(account.id),
      fullName: String(account.full_name ?? "").trim() || nameByEmail.get(email.toLowerCase()) || "",
      email,
      role: "staff",
      relationTable: "admin_users"
    };
  });

  return { rows, error: null };
}

/**
 * Mentor đã chấp nhận lời mời quay lại mùa này, và vẫn còn tham gia.
 *
 * Giao với membership đang hoạt động: chấp nhận rồi rút khỏi chương trình thì
 * không còn là người cần nhận thư của mùa. Lúc viết, cả 204 người chấp nhận đều
 * còn hoạt động — phép giao này canh cho những lần sau.
 */
async function returningMentorRecipients(client: any, seasonId: string): Promise<RecipientRows> {
  const invites = await readAllPages<{ id: string; person_id: string }>(
    "person_season_invites",
    "person_id",
    (projection) =>
      client
        .from("person_season_invites")
        .select(projection)
        .eq("season_id", seasonId)
        .eq("role", "mentor")
        .eq("outcome", "accepted")
  );
  if (invites.error) {
    log("listBulkRecipients:invites", invites.error);
    return { rows: [], error: VI_ERROR };
  }

  const accepted = Array.from(
    new Set(invites.data.map((row) => String(row.person_id ?? "").trim()).filter(Boolean))
  );
  if (!accepted.length) return { rows: [], error: null };

  const active = await readAllPagesIn<{ id: string; person_id: string }>(
    client,
    "person_season_memberships",
    "person_id",
    accepted,
    "person_id",
    (query) => query.eq("season_id", seasonId).eq("role", "mentor").eq("status", "active")
  );
  if (active.error) {
    log("listBulkRecipients:returning-memberships", active.error);
    return { rows: [], error: VI_ERROR };
  }

  const acceptedSet = new Set(accepted);
  const roleByPerson = new Map<string, "mentor" | "mentee">();
  for (const row of active.data) {
    const personId = String(row.person_id ?? "").trim();
    if (acceptedSet.has(personId)) roleByPerson.set(personId, "mentor");
  }

  return peopleRecipients(client, roleByPerson);
}

/**
 * Người đã đăng ký một sự kiện của mùa — hoặc cả chuỗi mà sự kiện ấy thuộc về.
 *
 * Lấy họ tên và email từ PHIẾU ĐĂNG KÝ, không từ danh bạ: người đăng ký sự kiện
 * phần lớn chưa có trong danh bạ. Lúc viết, 25 người đăng ký Mentor Orientation
 * chỉ có 2 người có trong danh bạ; đi qua danh bạ là bỏ sót 23 người.
 *
 * Sự kiện phải thuộc đúng mùa đang gửi. Kiểm ở đây chứ không tin ô chọn: event id
 * là thứ người gửi form tự đặt được, và một id của mùa khác là gửi thư của mùa
 * này tới người của mùa kia.
 *
 * Không gồm phiếu đã huỷ và phiếu bị từ chối: người bị từ chối nhận một lá thư
 * "hẹn gặp ở buổi orientation" là một lá thư nói sai với họ.
 */
async function eventRecipients(
  client: any,
  seasonId: string,
  eventId: string | null,
  coversSeries: boolean
): Promise<RecipientRows> {
  if (!eventId) return { rows: [], error: "Chưa chọn sự kiện cho nhóm người đã đăng ký." };

  const anchor = await readBounded<{
    id: string;
    season_id: string | null;
    series_id: string | null;
    event_name: string | null;
    starts_at: string | null;
  }>(
    "bulk mail event",
    client.from("events").select("id, season_id, series_id, event_name, starts_at").eq("id", eventId),
    2
  );
  if (anchor.error) {
    log("listBulkRecipients:event", anchor.error);
    return { rows: [], error: VI_ERROR };
  }

  const event = anchor.data[0];
  if (!event || String(event.season_id ?? "") !== seasonId) {
    return { rows: [], error: "Sự kiện này không thuộc mùa đang gửi thư." };
  }

  const seriesId = String(event.series_id ?? "").trim();
  let eventIds = [String(event.id)];
  if (coversSeries && seriesId) {
    const siblings = await readBounded<{ id: string }>(
      "bulk mail event series",
      client
        .from("events")
        .select("id")
        .eq("series_id", seriesId)
        .eq("season_id", seasonId)
        .neq("status", "cancelled")
    );
    if (siblings.error) {
      log("listBulkRecipients:event-series", siblings.error);
      return { rows: [], error: VI_ERROR };
    }
    eventIds = Array.from(new Set(eventIds.concat(siblings.data.map((row) => String(row.id)))));
  }

  const registrations = await readAllPagesIn<{
    id: string;
    full_name: string | null;
    email: string | null;
    registration_status: string | null;
  }>(client, "event_registrations", "event_id", eventIds, "id, full_name, email, registration_status");
  if (registrations.error) {
    log("listBulkRecipients:event-registrations", registrations.error);
    return { rows: [], error: VI_ERROR };
  }

  const rows: BulkRecipient[] = [];
  for (const row of registrations.data) {
    const status = String(row.registration_status ?? "").trim();
    if (status === "cancelled" || status === "rejected") continue;
    rows.push({
      personId: String(row.id),
      fullName: String(row.full_name ?? "").trim(),
      email: String(row.email ?? "").trim(),
      role: "attendee",
      relationTable: "event_registrations"
    });
  }

  const name = String(event.event_name ?? "").trim() || "sự kiện";
  const when = event.starts_at ? formatDate(event.starts_at) : "";
  const label = `Người đã đăng ký ${name}${when ? ` · ${when}` : ""}${coversSeries && seriesId ? " (cả chuỗi)" : ""}`;

  return { rows, error: null, label };
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
  /** Sự kiện của nhóm `event`, chốt lúc mở lô. Null với mọi nhóm khác. */
  audienceEventId: string | null;
  /** Nhóm `event` có gồm cả các buổi khác cùng chuỗi không. */
  audienceCoversSeries: boolean;
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
    audienceEventId: raw.audience_event_id ? String(raw.audience_event_id) : null,
    audienceCoversSeries: raw.audience_covers_series === true,
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
  "id, season_id, kind, template_id, audience, audience_event_id, audience_covers_series, status, requested_count, sent_count, skipped_count, failed_count, note, created_at, completed_at";

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
  audienceEventId?: string | null;
  audienceCoversSeries?: boolean;
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
      // Chỉ nhóm `event` mang sự kiện. Ràng buộc hình dạng trong database cũng
      // bắt điều này; ghi đúng ngay từ đây để không lô nào bị từ chối lúc mở.
      audience_event_id: input.audience === "event" ? input.audienceEventId ?? null : null,
      audience_covers_series: input.audience === "event" && input.audienceCoversSeries === true,
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

  // Nhóm `event` mà lô không nhớ sự kiện nào thì cũng như lô không nhớ gửi cho
  // ai: dựng lại danh sách bằng một giá trị đoán là gửi nhầm người.
  if (audience === "event" && !input.batch.audienceEventId) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      skipped: 0,
      remaining: 0,
      problems: [],
      error: "Lô này không ghi lại sự kiện của nhóm người nhận. Vui lòng mở lô mới."
    };
  }

  const recipients = await listBulkRecipients({
    seasonId: input.batch.seasonId,
    audience,
    eventId: input.batch.audienceEventId,
    coversSeries: input.batch.audienceCoversSeries
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
      relation: { table: recipient.relationTable ?? "people", id: recipient.personId },
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
 * Số người nhận của từng nhóm cố định, và danh sách sự kiện chọn được.
 *
 * Mỗi nhóm một lượt đọc riêng chứ không suy ra từ nhau: người vừa là mentor vừa là
 * mentee của cùng một mùa chỉ nhận một lá, nên "mentor + mentee" không bằng
 * "cả hai", và số hiện trên màn hình phải bằng ĐÚNG số mà lệnh gửi tự đếm lại —
 * lệch một người là người bấm không xác nhận nổi con số nào.
 */
export async function countBulkRecipients(
  seasonId: string
): Promise<{
  counts: Record<FixedBulkAudience, AudienceCount>;
  events: BulkEventOption[];
  error: string | null;
}> {
  const counts = {} as Record<FixedBulkAudience, AudienceCount>;
  for (const audience of FIXED_BULK_AUDIENCES) counts[audience] = { sendable: 0, unreachable: 0 };

  for (const audience of FIXED_BULK_AUDIENCES) {
    const result = await listBulkRecipients({ seasonId, audience });
    if (result.error) return { counts, events: [], error: result.error };
    counts[audience] = {
      sendable: result.partition.sendable.length,
      unreachable: result.partition.unreachable.length
    };
  }

  const events = await listEventOptions(seasonId);
  if (events.error) return { counts, events: [], error: events.error };

  return { counts, events: events.options, error: null };
}

/**
 * Các sự kiện của mùa chọn được cho nhóm "đã đăng ký một sự kiện".
 *
 * Số người nhận của từng lựa chọn đi qua ĐÚNG `listBulkRecipients` mà lệnh gửi
 * dùng, không đếm tắt bằng số phiếu: phiếu trùng email chỉ nhận một lá, và con
 * số hiện trong ô chọn phải bằng đúng con số người bấm gõ xác nhận.
 *
 * Chỉ liệt kê sự kiện chưa huỷ và có ít nhất một người nhận — một lựa chọn
 * "0 người" chỉ làm ô chọn dài thêm.
 */
async function listEventOptions(
  seasonId: string
): Promise<{ options: BulkEventOption[]; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { options: [], error: VI_ERROR };

  const events = await readBounded<{
    id: string;
    event_name: string | null;
    starts_at: string | null;
    series_id: string | null;
    series_index: number | null;
    series_total: number | null;
    status: string | null;
  }>(
    "bulk mail season events",
    client
      .from("events")
      .select("id, event_name, starts_at, series_id, series_index, series_total, status")
      .eq("season_id", seasonId)
  );
  if (events.error) {
    log("listEventOptions", events.error);
    return { options: [], error: VI_ERROR };
  }

  const collected: Array<{ option: BulkEventOption; startsAt: string }> = [];
  for (const event of events.data) {
    if (String(event.status ?? "") === "cancelled") continue;

    const eventId = String(event.id);
    const single = await listBulkRecipients({ seasonId, audience: "event", eventId, coversSeries: false });
    if (single.error) return { options: [], error: single.error };

    const seriesId = String(event.series_id ?? "").trim() || null;
    const inSeries = Boolean(seriesId) && Number(event.series_total ?? 0) > 1;
    const series = inSeries
      ? await listBulkRecipients({ seasonId, audience: "event", eventId, coversSeries: true })
      : null;
    if (series?.error) return { options: [], error: series.error };

    const sendable = single.partition.sendable.length;
    const seriesSendable = series ? series.partition.sendable.length : null;
    if (sendable === 0 && !seriesSendable) continue;

    const name = String(event.event_name ?? "").trim() || "Sự kiện";
    const when = event.starts_at ? formatDate(event.starts_at) : "";
    const part = inSeries && event.series_index ? ` (buổi ${event.series_index}/${event.series_total})` : "";

    collected.push({
      startsAt: String(event.starts_at ?? ""),
      option: {
        id: eventId,
        label: `${name}${when ? ` · ${when}` : ""}${part}`,
        seriesId,
        sendable,
        unreachable: single.partition.unreachable.length,
        seriesSendable,
        seriesUnreachable: series ? series.partition.unreachable.length : null
      }
    });
  }

  // Mới nhất trước: sự kiện người ta cần gửi thư thường là sự kiện sắp tới.
  collected.sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { options: collected.map((row) => row.option), error: null };
}
