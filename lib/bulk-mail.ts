import "server-only";

import {
  BULK_AUDIENCE_LABELS,
  BULK_SEND_CHUNK,
  BULK_TIME_BUDGET_MS,
  FIXED_BULK_AUDIENCES,
  STAFF_ROLES,
  buildRecipientValues,
  isCvRejected,
  isHeldFromInterviewLetter,
  isMembershipAudience,
  menteeInterviewLetterGroup,
  partitionRecipients,
  remainingRecipients,
  rolesForAudience,
  isBulkAudience,
  type BulkAudience,
  type BulkEventOption,
  type BulkRecipient,
  type FixedBulkAudience,
  type ProfileReviewVerdict,
  type RecipientPartition,
  type RecipientRole,
  type RecipientSource
} from "@/lib/bulk-mail-core";
import {
  EVENT_CHECKIN_FILTER_LABELS,
  matchesCheckinFilter,
  mergeCustomSources,
  type CustomListSpec,
  type EventCheckinFilter
} from "@/lib/bulk-mail-custom-core";
import { customRunAllowance, outboundRelationFor } from "@/lib/bulk-mail-external-core";
import { normalizeEmailAddress } from "@/lib/email-core";
import { DAILY_EMAIL_LIMIT } from "@/lib/email-quota-core";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import { escapeIlikePattern } from "@/lib/identity";
import { readAllPages, readAllPagesIn, readBounded } from "@/lib/paged-read";
import { formatDate } from "@/lib/utils";
import { displayCurrentMemberCode } from "@/lib/member-code-core";
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
 * Cả hệ thống dùng chung một trần thư trong ngày (lib/email-quota-core.ts), mà một
 * mùa có thể vượt số đó giữa mentor và mentee. Các lời gọi lại chạy tuần tự, nên một request cũng
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

  // Danh sách tùy chỉnh không có câu truy vấn nào dựng lại được — rơi xuống nhánh cuối
  // là đọc nhầm thành nhóm sự kiện. Lô `custom` đọc danh sách đã chốt (readFrozenRecipients).
  if (input.audience === "custom") {
    return { partition: empty, error: "Danh sách tùy chỉnh không dựng lại được từ tên nhóm." };
  }

  let result: RecipientRows;
  if (isMembershipAudience(input.audience)) {
    result = await membershipRecipients(client, input.seasonId, input.audience);
  } else if (input.audience === "staff") {
    result = await staffRecipients(client);
  } else if (input.audience === "returning_mentor") {
    result = await returningMentorRecipients(client, input.seasonId);
  } else if (input.audience === "mentee_cv_rejected" || input.audience === "mentee_invite_withdrawn") {
    result = await rejectedMenteeRecipients(client, input.seasonId, input.audience);
  } else if (input.audience === "mentee_interview_rejected") {
    result = await interviewRejectedMenteeRecipients(client, input.seasonId);
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
      .select("id, full_name, email_primary, member_code, gender")
      .in("id", chunk);

    if (error) {
      log("listBulkRecipients:people", error);
      return { rows: [], error: VI_ERROR };
    }

    for (const raw of (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email_primary: string | null;
      member_code?: string | null;
      gender?: string | null;
    }>) {
      const personId = String(raw.id);
      const memberCode = String(raw.member_code ?? "").trim();
      const gender = String(raw.gender ?? "").trim();
      rows.push({
        personId,
        fullName: String(raw.full_name ?? "").trim(),
        email: String(raw.email_primary ?? "").trim(),
        role: roleByPerson.get(personId) ?? "mentee",
        ...(memberCode ? { memberCode } : {}),
        ...(gender ? { gender } : {})
      });
    }
  }

  return attachLegacyCodes(client, rows);
}

/**
 * Người chưa có mã mới thì lấy mã cũ trong hồ sơ mentor/mentee, theo đúng vai
 * trò trong lô — cùng quy tắc `displayCurrentMemberCode` mà trang Mentor, Mentee
 * đang hiện (VAM00024). Thư và màn hình nói hai mã khác nhau cho một người là
 * thứ BTC sẽ phải giải thích với từng người nhận.
 *
 * Đọc hỏng thì trả lỗi cho cả danh sách, như mọi bước đọc khác ở đây: gửi tiếp
 * với mã thiếu nghĩa là ô {{ma_thanh_vien}} lặng lẽ trống ở những thư lẽ ra có mã.
 */
async function attachLegacyCodes(client: any, rows: BulkRecipient[]): Promise<RecipientRows> {
  const tables = [
    { role: "mentor" as const, table: "mentor_profiles", column: "mentor_code" },
    { role: "mentee" as const, table: "mentee_profiles", column: "mentee_code" }
  ];

  for (const { role, table, column } of tables) {
    const needing = rows.filter((row) => row.role === role && !row.memberCode);
    if (!needing.length) continue;

    const legacyByPerson = new Map<string, string>();
    const ids = needing.map((row) => row.personId);
    for (let index = 0; index < ids.length; index += 500) {
      const { data, error } = await client
        .from(table)
        .select(`person_id, ${column}`)
        .in("person_id", ids.slice(index, index + 500));
      if (error) {
        log(`listBulkRecipients:${table}`, error);
        return { rows: [], error: VI_ERROR };
      }
      for (const raw of (data ?? []) as Array<Record<string, string | null>>) {
        const personId = String(raw.person_id ?? "").trim();
        const code = String(raw[column] ?? "").trim();
        if (personId && code && !legacyByPerson.has(personId)) legacyByPerson.set(personId, code);
      }
    }

    for (const row of needing) {
      const code = displayCurrentMemberCode(null, legacyByPerson.get(row.personId));
      if (code) row.memberCode = code;
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

/** Đơn đã dừng ở vòng hồ sơ. Đơn ở mọi trạng thái khác là đơn "còn sống". */
const CV_STAGE_END_STATUSES = new Set(["screening_completed", "rejected_or_not_fit"]);
const DEAD_APPLICATION_STATUSES = new Set(["screening_completed", "rejected_or_not_fit", "withdrawn"]);

/**
 * Mentee rớt vòng hồ sơ (CV) của mùa — BTC 07/10/2026.
 *
 * Một lá thư rớt gửi nhầm không rút lại được, nên nhóm này loại theo lối
 * fail-closed — mỗi phép loại dưới đây đều đã có người thật khớp vào lúc viết:
 *   - phiếu chấm phải nói rớt (`isCvRejected`): reject, hoặc đề xuất khác dưới 13;
 *   - đơn đang ở `screening_completed` / `rejected_or_not_fit` — đơn đã được mời,
 *     đã phỏng vấn hay đã đậu thì không ở hai trạng thái này;
 *   - chưa từng có thư mời chọn ca, chưa từng giữ chỗ, chưa từng check-in — kể cả
 *     khi trạng thái đơn đã bị đổi ngược (15 bạn bị tạm khoá link ngày 07/10 đang
 *     ở `screening_completed` nhưng đã nhận thư mời: BTC quyết riêng cho họ);
 *   - người đó không có tư cách đang hoạt động nào trong mùa, không có tài khoản
 *     BTC, và không có đơn nào khác của mùa còn sống (vd. đơn mentor đã duyệt);
 *   - CHƯA nhận thư rớt ở một lô nào của hai nhóm thư rớt (08/10/2026) — mỗi người
 *     nhận đúng MỘT lá thư rớt.
 *
 * Nhóm `mentee_invite_withdrawn` (BTC 08/10/2026) là nửa còn lại: người ĐÃ nhận thư
 * mời chọn ca đợt 2 rồi bị khoá link và BTC chuyển "Không đạt" — đơn ở
 * `rejected_or_not_fit`, đã có thư mời, chưa từng giữ chỗ, chưa từng check-in. Họ cần
 * một lá thư riêng có nhắc tới thư mời đã nhận; thư rớt chung nói "chưa thể chọn hồ sơ
 * của bạn để bước tiếp vào vòng phỏng vấn" sẽ khó hiểu với người đã được mời.
 *
 * Đọc hỏng bất kỳ bảng nào thì trả lỗi chứ không trả danh sách thiếu phép loại.
 *
 * Họ tên và email lấy từ ĐƠN, nối thư về `applications`: phần lớn người rớt vòng
 * hồ sơ chưa có trong danh bạ (07/10: 144/146 bạn không có person_id).
 */
const REJECTION_LETTER_AUDIENCES = ["mentee_cv_rejected", "mentee_invite_withdrawn", "mentee_interview_rejected"] as const;

async function rejectedMenteeRecipients(
  client: any,
  seasonId: string,
  audience: "mentee_cv_rejected" | "mentee_invite_withdrawn"
): Promise<RecipientRows> {
  const withdrawn = audience === "mentee_invite_withdrawn";
  type AppRow = {
    id: string;
    person_id: string | null;
    full_name: string | null;
    email_primary: string | null;
    role_applied: string | null;
    status: string | null;
  };
  const apps = await readAllPages<AppRow>(
    "applications",
    "id, person_id, full_name, email_primary, role_applied, status",
    (projection) => client.from("applications").select(projection).eq("season_id", seasonId)
  );
  if (apps.error) {
    log("listBulkRecipients:cv-rejected-applications", apps.error);
    return { rows: [], error: VI_ERROR };
  }

  const candidates = apps.data.filter((app) => {
    if (String(app.role_applied ?? "") !== "mentee") return false;
    const status = String(app.status ?? "");
    // Người đã được mời rồi bị rút lời mời: chỉ khi BTC đã chốt "Không đạt".
    return withdrawn ? status === "rejected_or_not_fit" : CV_STAGE_END_STATUSES.has(status);
  });
  if (!candidates.length) return { rows: [], error: null };
  const ids = candidates.map((app) => String(app.id));

  const [reviews, invites, bookings, operations, memberships, accounts] = await Promise.all([
    readAllPagesIn<{ id: string; application_id: string } & ProfileReviewVerdict>(
      client,
      "application_reviews",
      "application_id",
      ids,
      "id, application_id, status, recommendation, total_score",
      (query) => query.eq("review_round", "profile_screening")
    ),
    readAllPagesIn<{ id: string; application_id: string; first_sent_at: string | null }>(
      client,
      "mentee_interview_invites",
      "application_id",
      ids,
      "id, application_id, first_sent_at"
    ),
    readAllPagesIn<{ id: string; application_id: string }>(client, "mentee_interview_bookings", "application_id", ids, "id, application_id"),
    readAllPagesIn<{ id: string }>(client, "mentee_interview_operations", "id", ids, "id"),
    readAllPages<{ id: string; person_id: string | null }>(
      "person_season_memberships",
      "id, person_id",
      (projection) => client.from("person_season_memberships").select(projection).eq("season_id", seasonId).eq("status", "active")
    ),
    readAllPages<{ id: string; email: string | null }>("admin_users", "id, email", (projection) =>
      client.from("admin_users").select(projection)
    )
  ]);
  const failed = [reviews, invites, bookings, operations, memberships, accounts].find((result) => result.error);
  if (failed) {
    log("listBulkRecipients:cv-rejected-exclusions", failed.error);
    return { rows: [], error: VI_ERROR };
  }

  // BTC 08/10/2026: sáng gửi 146 bạn, chiều có thêm 11 hồ sơ vừa chấm rớt — mở lô mới thì
  // chỉ được gửi 11 bạn đó; và không ai nhận hai lá thư rớt.
  const receipts = await readRejectionLetterReceipts(client, seasonId);
  if (receipts.error) {
    log("listBulkRecipients:cv-rejected-received", receipts.error);
    return { rows: [], error: VI_ERROR };
  }

  const reviewsByApp = new Map<string, ProfileReviewVerdict[]>();
  for (const review of reviews.data) {
    const key = String(review.application_id);
    reviewsByApp.set(key, [...(reviewsByApp.get(key) ?? []), review]);
  }
  const invited = new Set(invites.data.map((row) => String(row.application_id)));
  const invitationSent = new Set(invites.data.filter((row) => row.first_sent_at).map((row) => String(row.application_id)));
  const bookedOrSeen = new Set<string>([
    ...bookings.data.map((row) => String(row.application_id)),
    ...operations.data.map((row) => String(row.id))
  ]);
  const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const activePeople = new Set(memberships.data.map((row) => String(row.person_id ?? "")).filter(Boolean));
  const staffEmails = new Set(accounts.data.map((row) => normalizeEmail(row.email)).filter(Boolean));
  const livePeople = new Set<string>();
  const liveEmails = new Set<string>();
  for (const app of apps.data) {
    if (DEAD_APPLICATION_STATUSES.has(String(app.status ?? ""))) continue;
    if (app.person_id) livePeople.add(String(app.person_id));
    const email = normalizeEmail(app.email_primary);
    if (email) liveEmails.add(email);
  }

  const rows: BulkRecipient[] = [];
  for (const app of candidates) {
    const id = String(app.id);
    if (!isCvRejected(reviewsByApp.get(id) ?? [])) continue;
    // Chưa từng giữ chỗ, chưa từng check-in — ở cả hai nhóm.
    if (bookedOrSeen.has(id)) continue;
    // Thư rớt chung: chưa từng có lời mời. Thư rút lời mời: đã THẬT SỰ nhận thư mời.
    if (withdrawn ? !invitationSent.has(id) : invited.has(id)) continue;
    const personId = String(app.person_id ?? "");
    const email = normalizeEmail(app.email_primary);
    if (personId && (activePeople.has(personId) || livePeople.has(personId))) continue;
    if (email && (staffEmails.has(email) || liveEmails.has(email))) continue;
    // Theo cả email lẫn đơn: BTC sửa email của đơn sau khi đã gửi thì vẫn là người đã nhận.
    if (receipts.apps.has(id) || (email && receipts.emails.has(email))) continue;
    rows.push({
      personId: id,
      fullName: String(app.full_name ?? "").trim(),
      email: String(app.email_primary ?? "").trim(),
      role: "mentee",
      relationTable: "applications"
    });
  }
  return { rows, error: null };
}

/**
 * Ai đã nhận một lá thư rớt (của bất kỳ nhóm thư rớt nào) trong mùa — theo cả đơn lẫn email. Tính cả lô
 * đang chạy, để "Gửi tiếp" đếm đúng phần còn lại; thư hỏng không tính là đã nhận.
 */
async function readRejectionLetterReceipts(
  client: any,
  seasonId: string
): Promise<{ apps: Set<string>; emails: Set<string>; error: unknown }> {
  const empty = { apps: new Set<string>(), emails: new Set<string>() };
  const batches = await readBounded<{ id: string }>(
    "bulk mail rejection batches",
    client.from("email_batches").select("id").eq("season_id", seasonId).in("audience", Array.from(REJECTION_LETTER_AUDIENCES)),
    500
  );
  if (batches.error) return { ...empty, error: batches.error };
  const batchIds = batches.data.map((row) => String(row.id));
  if (!batchIds.length) return { ...empty, error: null };
  const received = await readAllPagesIn<{ id: string; to_email: string | null; related_id: string | null }>(
    client,
    "outbound_emails",
    "batch_id",
    batchIds,
    "id, to_email, related_id",
    (query) => query.in("status", ["sent", "queued"])
  );
  if (received.error) return { ...empty, error: received.error };
  return {
    apps: new Set(received.data.map((row) => String(row.related_id ?? "")).filter(Boolean)),
    emails: new Set(received.data.map((row) => String(row.to_email ?? "").trim().toLowerCase()).filter(Boolean)),
    error: null
  };
}

/**
 * Mentee không trúng tuyển vòng phỏng vấn mùa 12 (BTC 24/10/2026): rớt phỏng vấn; check-in, phân bàn
 * hoặc chọn ca mà không phỏng vấn; được mời mà không chọn ca. Đơn nào vào nhóm nào: xem
 * `menteeInterviewLetterGroup` (lib/bulk-mail-core.ts).
 *
 * Cùng nếp fail-closed với thư rớt hồ sơ — một lá thư rớt gửi nhầm không rút lại được:
 *   - đọc hỏng bất kỳ bảng nào thì trả lỗi, không trả danh sách thiếu phép loại;
 *   - không gửi cho người đang có tư cách hoạt động trong mùa (đang là mentee — kể cả đặc cách — hay
 *     mentor), tài khoản BTC, người có một đơn đã được duyệt, đơn đã rút;
 *   - mỗi người nhận đúng MỘT lá thư rớt, tính chung cả ba nhóm thư rớt;
 *   - giữ lại 5 bạn BTC dặn (`MENTEE_INTERVIEW_LETTER_HELD_NAMES`), so cả tên trên đơn lẫn tên hồ sơ.
 *
 * Họ tên và email lấy từ ĐƠN, nối thư về `applications` — như hai nhóm thư rớt trước.
 */
async function interviewRejectedMenteeRecipients(client: any, seasonId: string): Promise<RecipientRows> {
  type AppRow = {
    id: string;
    person_id: string | null;
    full_name: string | null;
    email_primary: string | null;
    role_applied: string | null;
    status: string | null;
  };
  const apps = await readAllPages<AppRow>(
    "applications",
    "id, person_id, full_name, email_primary, role_applied, status",
    (projection) => client.from("applications").select(projection).eq("season_id", seasonId)
  );
  if (apps.error) {
    log("listBulkRecipients:interview-rejected-applications", apps.error);
    return { rows: [], error: VI_ERROR };
  }
  const mentees = apps.data.filter((app) => String(app.role_applied ?? "") === "mentee");
  if (!mentees.length) return { rows: [], error: null };
  const ids = mentees.map((app) => String(app.id));
  const personIds = Array.from(new Set(mentees.map((app) => String(app.person_id ?? "")).filter(Boolean)));

  const [operations, bookings, invites, memberships, accounts, people] = await Promise.all([
    readAllPagesIn<{ id: string; outcome: string | null; checked_in_at: string | null; interviewer_id: string | null }>(
      client,
      "mentee_interview_operations",
      "id",
      ids,
      "id, outcome, checked_in_at, interviewer_id"
    ),
    readAllPagesIn<{ id: string; application_id: string; status: string | null }>(
      client,
      "mentee_interview_bookings",
      "application_id",
      ids,
      "id, application_id, status"
    ),
    readAllPagesIn<{ id: string; application_id: string; first_sent_at: string | null }>(
      client,
      "mentee_interview_invites",
      "application_id",
      ids,
      "id, application_id, first_sent_at"
    ),
    readAllPages<{ id: string; person_id: string | null }>(
      "person_season_memberships",
      "id, person_id",
      (projection) => client.from("person_season_memberships").select(projection).eq("season_id", seasonId).eq("status", "active")
    ),
    readAllPages<{ id: string; email: string | null }>("admin_users", "id, email", (projection) =>
      client.from("admin_users").select(projection)
    ),
    readAllPagesIn<{ id: string; full_name: string | null }>(client, "people", "id", personIds, "id, full_name")
  ]);
  const failed = [operations, bookings, invites, memberships, accounts, people].find((result) => result.error);
  if (failed) {
    log("listBulkRecipients:interview-rejected-sources", failed.error);
    return { rows: [], error: VI_ERROR };
  }
  const receipts = await readRejectionLetterReceipts(client, seasonId);
  if (receipts.error) {
    log("listBulkRecipients:interview-rejected-received", receipts.error);
    return { rows: [], error: VI_ERROR };
  }

  const normalizeEmail = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const opById = new Map(operations.data.map((row) => [String(row.id), row]));
  const booked = new Set(bookings.data.filter((row) => row.status === "booked").map((row) => String(row.application_id)));
  const everBooked = new Set(bookings.data.map((row) => String(row.application_id)));
  const invited = new Set(invites.data.filter((row) => row.first_sent_at).map((row) => String(row.application_id)));
  const activePeople = new Set(memberships.data.map((row) => String(row.person_id ?? "")).filter(Boolean));
  const staffEmails = new Set(accounts.data.map((row) => normalizeEmail(row.email)).filter(Boolean));
  const profileName = new Map(people.data.map((row) => [String(row.id), row.full_name]));
  const approvedPeople = new Set<string>();
  const approvedEmails = new Set<string>();
  for (const app of apps.data) {
    if (!String(app.status ?? "").startsWith("approved_as_")) continue;
    if (app.person_id) approvedPeople.add(String(app.person_id));
    const email = normalizeEmail(app.email_primary);
    if (email) approvedEmails.add(email);
  }

  const rows: BulkRecipient[] = [];
  for (const app of mentees) {
    const id = String(app.id);
    const group = menteeInterviewLetterGroup({
      applicationStatus: app.status,
      operation: opById.get(id) ?? null,
      hasBookedSeat: booked.has(id),
      hadAnyBooking: everBooked.has(id),
      inviteSent: invited.has(id)
    });
    if (!group) continue;
    if (String(app.status ?? "") === "withdrawn") continue;
    const personId = String(app.person_id ?? "");
    if (isHeldFromInterviewLetter(app.full_name, personId ? profileName.get(personId) : null)) continue;
    const email = normalizeEmail(app.email_primary);
    if (personId && (activePeople.has(personId) || approvedPeople.has(personId))) continue;
    if (email && (staffEmails.has(email) || approvedEmails.has(email))) continue;
    if (receipts.apps.has(id) || (email && receipts.emails.has(email))) continue;
    rows.push({
      personId: id,
      fullName: String(app.full_name ?? "").trim(),
      email: String(app.email_primary ?? "").trim(),
      role: "mentee",
      relationTable: "applications"
    });
  }
  return { rows, error: null };
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
  coversSeries: boolean,
  // Chỉ danh sách tùy chỉnh truyền khác "all"; nhóm `event` cũ luôn đi "all", nên danh
  // sách của nó không đổi (VAM00026).
  checkin: EventCheckinFilter = "all"
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
    attendance_status: string | null;
  }>(client, "event_registrations", "event_id", eventIds, "id, full_name, email, registration_status, attendance_status");
  if (registrations.error) {
    log("listBulkRecipients:event-registrations", registrations.error);
    return { rows: [], error: VI_ERROR };
  }

  const rows: BulkRecipient[] = [];
  for (const row of registrations.data) {
    const status = String(row.registration_status ?? "").trim();
    if (status === "cancelled" || status === "rejected") continue;
    if (!matchesCheckinFilter(row.attendance_status, checkin)) continue;
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
  const checkinPart = checkin === "all" ? "" : ` · ${EVENT_CHECKIN_FILTER_LABELS[checkin].toLowerCase()}`;
  const label = `Người đã đăng ký ${name}${when ? ` · ${when}` : ""}${coversSeries && seriesId ? " (cả chuỗi)" : ""}${checkinPart}`;

  return { rows, error: null, label };
}

// ─────────────────────────────────────────────────────────────────────────────
// Danh sách tùy chỉnh (VAM00026)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tập ứng viên của một danh sách tùy chỉnh: hợp của các nguồn đã tick, cộng người thêm tay,
 * mỗi email một lá.
 *
 * Mỗi nguồn đi qua ĐÚNG hàm đọc của nhóm cũ tương ứng — membershipRecipients, staffRecipients,
 * eventRecipients — để "Mentor đang tham gia mùa này" ở đây là cùng những người với nhóm cố
 * định cùng tên, không phải một câu truy vấn thứ hai có thể trôi lệch.
 *
 * Thứ tự nguồn quyết định bản giữ lại khi trùng email: mentor/mentee → BTC → người đăng ký sự
 * kiện → người thêm tay. Một mentor cũng đăng ký sự kiện nhận thư với vai trò "mentor".
 *
 * Một nguồn đọc hỏng, sự kiện không thuộc mùa, hay một người thêm tay không thuộc mùa là lỗi
 * cho cả danh sách — không trả về một danh sách thiếu mà trông như đủ.
 */
export async function buildCustomRecipientUniverse(input: {
  seasonId: string;
  spec: CustomListSpec;
}): Promise<{ partition: RecipientPartition; error: string | null; label: string }> {
  const empty: RecipientPartition = { sendable: [], unreachable: [] };
  const label = BULK_AUDIENCE_LABELS.custom;
  const client = getSupabaseServiceRoleClient();
  if (!client) return { partition: empty, error: VI_ERROR, label };

  const { spec, seasonId } = input;
  const groups: BulkRecipient[][] = [];
  const parts: string[] = [];

  if (spec.mentor || spec.mentee) {
    const audience = spec.mentor && spec.mentee ? "both" : spec.mentor ? "mentor" : "mentee";
    const result = await membershipRecipients(client, seasonId, audience);
    if (result.error) return { partition: empty, error: result.error, label };
    groups.push(result.rows);
    if (spec.mentor) parts.push("mentor");
    if (spec.mentee) parts.push("mentee");
  }
  if (spec.staff) {
    const result = await staffRecipients(client);
    if (result.error) return { partition: empty, error: result.error, label };
    groups.push(result.rows);
    parts.push("BTC");
  }
  if (spec.event) {
    const result = await eventRecipients(client, seasonId, spec.event.eventId, spec.event.coversSeries, spec.event.checkin);
    if (result.error) return { partition: empty, error: result.error, label };
    groups.push(result.rows);
    parts.push(lowerFirstChar(result.label ?? "người đăng ký sự kiện"));
  }
  if (spec.addedPersonIds.length) {
    const result = await manualPeopleRecipients(client, seasonId, spec.addedPersonIds);
    if (result.error) return { partition: empty, error: result.error, label };
    groups.push(result.rows);
    parts.push(`${spec.addedPersonIds.length} người thêm tay`);
  }

  return {
    partition: mergeCustomSources(groups),
    error: null,
    label: parts.length ? `${label}: ${parts.join(" + ")}` : label
  };
}

function lowerFirstChar(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export type CustomListPerson = {
  personId: string;
  fullName: string;
  email: string;
  memberCode: string | null;
  role: RecipientRole;
};

/**
 * Những người trong danh bạ được phép thêm tay vào thư của mùa này.
 *
 * "Thuộc mùa" nghĩa là có một dòng membership của mùa (mọi vai trò, mọi trạng thái), có một
 * đơn của mùa, hoặc là BTC đang hoạt động (cùng email với một tài khoản trong STAFF_ROLES).
 * Người chỉ có trong danh bạ từ các mùa trước thì không: id là thứ form tự đặt được, và một
 * id bất kỳ trong danh bạ không được là một đường gửi thư của mùa này tới người không liên quan.
 *
 * Vai trò điền vào {{vai_tro}}: mentor/mentee theo membership ĐANG HOẠT ĐỘNG của mùa (mentor
 * thắng nếu có cả hai); không có thì "ban tổ chức" nếu là BTC; còn lại là "người tham dự" — chữ
 * trung tính nhất trong RECIPIENT_ROLE_WORDS cho người có liên hệ với mùa mà không đang giữ vai
 * trò nào (vd. ứng viên, mentor đã rút). Không đoán một vai trò người đó không có.
 */
async function seasonScopedPeople(
  client: any,
  seasonId: string,
  personIds: string[]
): Promise<{ people: Map<string, CustomListPerson>; error: string | null }> {
  const people = new Map<string, CustomListPerson>();
  if (!personIds.length) return { people, error: null };

  const [rows, memberships, applications, staff] = await Promise.all([
    readAllPagesIn<{ id: string; full_name: string | null; email_primary: string | null; member_code: string | null }>(
      client,
      "people",
      "id",
      personIds,
      "id, full_name, email_primary, member_code"
    ),
    readAllPagesIn<{ id: string; person_id: string; role: string | null; status: string | null }>(
      client,
      "person_season_memberships",
      "person_id",
      personIds,
      "id, person_id, role, status",
      (query) => query.eq("season_id", seasonId)
    ),
    readAllPagesIn<{ id: string; person_id: string }>(
      client,
      "applications",
      "person_id",
      personIds,
      "id, person_id",
      (query) => query.eq("season_id", seasonId)
    ),
    readBounded<{ id: string; email: string | null }>(
      "bulk mail custom staff emails",
      client.from("admin_users").select("id, email").eq("status", "active").in("role", Array.from(STAFF_ROLES))
    )
  ]);
  const failed = [rows, memberships, applications, staff].find((result) => result.error);
  if (failed) {
    log("customList:scope", failed.error);
    return { people: new Map(), error: VI_ERROR };
  }

  const staffEmails = new Set(staff.data.map((row) => normalizeEmailAddress(row.email)).filter(Boolean) as string[]);
  const inSeason = new Set<string>([
    ...memberships.data.map((row) => String(row.person_id)),
    ...applications.data.map((row) => String(row.person_id))
  ]);
  const activeRoles = new Map<string, Set<string>>();
  for (const row of memberships.data) {
    if (row.status !== "active") continue;
    const key = String(row.person_id);
    activeRoles.set(key, (activeRoles.get(key) ?? new Set()).add(String(row.role ?? "")));
  }

  for (const row of rows.data) {
    const personId = String(row.id);
    const email = String(row.email_primary ?? "").trim();
    const isStaff = Boolean(normalizeEmailAddress(email) && staffEmails.has(normalizeEmailAddress(email) as string));
    if (!inSeason.has(personId) && !isStaff) continue;
    const roles = activeRoles.get(personId);
    const role: RecipientRole = roles?.has("mentor")
      ? "mentor"
      : roles?.has("mentee")
        ? "mentee"
        : isStaff
          ? "staff"
          : "attendee";
    people.set(personId, {
      personId,
      fullName: String(row.full_name ?? "").trim(),
      email,
      memberCode: String(row.member_code ?? "").trim() || null,
      role
    });
  }
  return { people, error: null };
}

/**
 * Người thêm tay. Mọi id phải là một người thuộc mùa — một id lạ là từ chối cả danh sách, vì
 * người bấm đã thấy người đó trên màn hình, và bỏ đi lặng lẽ là gửi thiếu mà không ai biết.
 * Họ tên và email lấy từ danh bạ, nối thư về `people`.
 */
async function manualPeopleRecipients(client: any, seasonId: string, personIds: string[]): Promise<RecipientRows> {
  const scoped = await seasonScopedPeople(client, seasonId, personIds);
  if (scoped.error) return { rows: [], error: scoped.error };
  const missing = personIds.filter((id) => !scoped.people.has(id)).length;
  if (missing) {
    return {
      rows: [],
      error: `${missing} người thêm tay không còn trong hệ thống hoặc không thuộc mùa này. Bỏ họ ra rồi xem lại danh sách.`
    };
  }
  return {
    rows: personIds.map((id) => {
      const person = scoped.people.get(id) as CustomListPerson;
      return {
        personId: person.personId,
        fullName: person.fullName,
        email: person.email,
        role: person.role,
        relationTable: "people" as const
      };
    }),
    error: null
  };
}

/** Bao nhiêu dòng danh bạ quét qua cho một lần tìm, và bao nhiêu người trả về. */
const PEOPLE_SEARCH_SCAN = 200;
const PEOPLE_SEARCH_RESULTS = 20;

/**
 * Tìm người trong danh bạ để thêm tay — theo họ tên, email hoặc mã thành viên.
 *
 * Chỉ trả về người thuộc mùa (seasonScopedPeople), để ô tìm không gợi ý người mà lệnh gửi sẽ
 * từ chối. Bỏ các ký tự có nghĩa trong cú pháp lọc của PostgREST (dấu phẩy, ngoặc, nháy) và ký
 * tự đại diện của LIKE: chữ người gõ là chữ để tìm, không phải một bộ lọc.
 */
export async function searchCustomListPeople(input: {
  seasonId: string;
  query: string;
}): Promise<{ rows: CustomListPerson[]; error: string | null }> {
  const cleaned = String(input.query ?? "")
    .replace(/[,()"'%_*:\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2) return { rows: [], error: "Gõ ít nhất 2 ký tự để tìm." };

  const client = getSupabaseServiceRoleClient();
  if (!client) return { rows: [], error: VI_ERROR };

  const pattern = `%${cleaned}%`;
  const { data, error } = await client
    .from("people")
    .select("id")
    .or(`full_name.ilike.${pattern},email_primary.ilike.${pattern},member_code.ilike.${pattern}`)
    .limit(PEOPLE_SEARCH_SCAN);
  if (error) {
    log("customList:search", error);
    return { rows: [], error: VI_ERROR };
  }

  const ids = Array.from(new Set(((data ?? []) as Array<{ id: string }>).map((row) => String(row.id))));
  const scoped = await seasonScopedPeople(client, input.seasonId, ids);
  if (scoped.error) return { rows: [], error: scoped.error };

  const rows = Array.from(scoped.people.values())
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "vi") || a.email.localeCompare(b.email))
    .slice(0, PEOPLE_SEARCH_RESULTS);
  return { rows, error: null };
}

const FROZEN_SOURCES = new Set<RecipientSource>(["people", "admin_users", "event_registrations", "applications", "external"]);
const FROZEN_ROLES = new Set<RecipientRole>(["mentor", "mentee", "staff", "attendee", "external"]);

/**
 * Danh sách đã chốt của một lô `custom`, đúng thứ tự lúc chốt.
 *
 * Số dòng phải bằng `requested_count` của lô: ít hơn nghĩa là lần ghi danh sách đã hỏng giữa
 * chừng, và đi tiếp với nửa danh sách là gửi thiếu mà lô vẫn báo "xong".
 */
async function readFrozenRecipients(
  client: any,
  batch: EmailBatchRow
): Promise<{ partition: RecipientPartition; error: string | null }> {
  const empty: RecipientPartition = { sendable: [], unreachable: [] };
  const result = await readAllPages<{
    id: string;
    position: number;
    relation_table: string;
    relation_id: string | null;
    email: string;
    full_name: string;
    role: string;
  }>("email_batch_recipients", "id, position, relation_table, relation_id, email, full_name, role", (projection) =>
    client.from("email_batch_recipients").select(projection).eq("batch_id", batch.id)
  );
  if (result.error) {
    log("runEmailBatch:frozen", result.error);
    return { partition: empty, error: VI_ERROR };
  }

  const broken = "Danh sách đã chốt của lô này không đầy đủ. Vui lòng mở lô mới.";
  if (!result.data.length || result.data.length !== batch.requestedCount) return { partition: empty, error: broken };

  const sendable: BulkRecipient[] = [];
  for (const row of result.data.slice().sort((a, b) => Number(a.position) - Number(b.position))) {
    const email = normalizeEmailAddress(row.email);
    const source = row.relation_table as RecipientSource;
    const role = row.role as RecipientRole;
    if (!email || !FROZEN_SOURCES.has(source) || !FROZEN_ROLES.has(role)) return { partition: empty, error: broken };
    // Người ngoài VAM (VAM00027) không trỏ vào hồ sơ nào: id của họ là id dòng chốt, để sổ thư nối
    // lá thư về đúng dòng này. Dòng VAM mà thiếu relation_id, hay dòng ngoài mà lại có, là danh sách hỏng.
    const external = source === "external";
    if (external !== (row.relation_id === null || row.relation_id === undefined)) return { partition: empty, error: broken };
    sendable.push({
      personId: external ? String(row.id) : String(row.relation_id),
      fullName: String(row.full_name ?? "").trim(),
      email,
      role,
      relationTable: source
    });
  }
  const details = await attachFrozenPeopleDetails(client, sendable);
  if (details.error) return { partition: empty, error: details.error };
  return { partition: { sendable, unreachable: [] }, error: null };
}

/**
 * Mã thành viên và giới tính cho các dòng chốt nối về `people` (VAM00024), đọc LÚC GỬI chứ không
 * chốt vào lô: mã được cấp hay sửa giữa hai lần "Gửi tiếp" thì thư sau mang mã đúng, và bảng danh
 * sách chốt không phải giữ thêm dữ liệu cá nhân nào.
 *
 * Cùng quy tắc với các nhóm đọc từ danh bạ: mã mới trong `people.member_code`, chưa có thì mã cũ
 * theo vai trò (attachLegacyCodes). Dòng nối về tài khoản BTC hay phiếu đăng ký sự kiện không có hai
 * giá trị này — như nhóm "Ban tổ chức" và nhóm sự kiện — nên ô của họ để trống.
 *
 * Đọc hỏng thì báo lỗi cho cả lượt, không gửi thư với ô mã lặng lẽ trống.
 */
async function attachFrozenPeopleDetails(client: any, rows: BulkRecipient[]): Promise<{ error: string | null }> {
  const people = rows.filter((row) => (row.relationTable ?? "people") === "people");
  if (!people.length) return { error: null };

  const read = await readAllPagesIn<{ id: string; member_code: string | null; gender: string | null }>(
    client,
    "people",
    "id",
    people.map((row) => row.personId),
    "id, member_code, gender"
  );
  if (read.error) {
    log("runEmailBatch:frozen-people", read.error);
    return { error: VI_ERROR };
  }
  const byId = new Map(read.data.map((row) => [String(row.id), row]));
  for (const row of people) {
    const found = byId.get(row.personId);
    const memberCode = String(found?.member_code ?? "").trim();
    const gender = String(found?.gender ?? "").trim();
    if (memberCode) row.memberCode = memberCode;
    if (gender) row.gender = gender;
  }

  // Chỉ dòng `people`: id của dòng BTC hay phiếu đăng ký không phải person_id của hồ sơ nào.
  const legacy = await attachLegacyCodes(client, people);
  return { error: legacy.error };
}

/** Mỗi lần ghi danh sách chốt bao nhiêu dòng. */
const FREEZE_CHUNK = 500;

/**
 * Mở một lô `custom` và chốt danh sách người nhận vào nó.
 *
 * Hai bước không nằm trong một transaction (PostgREST), nên bước hai hỏng thì lô bị ĐÓNG
 * (failed) ngay — chưa lá thư nào đi, và "Gửi tiếp" không bao giờ chạy trên một danh sách
 * chốt dở. readFrozenRecipients còn kiểm lại số dòng, phòng cả khi lần đóng lô cũng hỏng.
 */
export async function createCustomEmailBatch(input: {
  seasonId: string;
  kind: TemplateKind;
  templateId: string;
  recipients: BulkRecipient[];
  note: string;
  actorAdminUserId: string | null;
}): Promise<{ batch: EmailBatchRow | null; error: string | null }> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { batch: null, error: VI_ERROR };
  if (!input.recipients.length) return { batch: null, error: "Danh sách chưa có ai được chọn." };

  const created = await createEmailBatch({
    seasonId: input.seasonId,
    kind: input.kind,
    templateId: input.templateId,
    audience: "custom",
    requestedCount: input.recipients.length,
    note: input.note,
    actorAdminUserId: input.actorAdminUserId
  });
  if (created.error || !created.batch) return created;
  const batch = created.batch;

  for (let start = 0; start < input.recipients.length; start += FREEZE_CHUNK) {
    const chunk = input.recipients.slice(start, start + FREEZE_CHUNK).map((row, index) => ({
      batch_id: batch.id,
      position: start + index,
      relation_table: row.relationTable ?? "people",
      // Người ngoài VAM không có hồ sơ để trỏ vào (VAM00027); ràng buộc trong database bắt đúng điều này.
      relation_id: row.relationTable === "external" ? null : row.personId,
      email: row.email,
      full_name: row.fullName,
      role: row.role
    }));
    const { error } = await client.from("email_batch_recipients").insert(chunk);
    if (error) {
      log("createCustomEmailBatch:freeze", error);
      const { error: closeError } = await client
        .from("email_batches")
        .update({ status: "failed", completed_at: new Date().toISOString() })
        .eq("id", batch.id);
      if (closeError) log("createCustomEmailBatch:close", closeError);
      return { batch: null, error: "Không chốt được danh sách người nhận. Lô đã đóng, chưa lá thư nào đi." };
    }
  }
  return { batch, error: null };
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

  // Lô `custom` đọc ĐÚNG danh sách đã chốt lúc mở lô, không dựng lại gì: người không nằm
  // trong bản xem trước thì không nhận thư, kể cả khi dữ liệu nguồn đã đổi.
  const recipients =
    audience === "custom"
      ? await readFrozenRecipients(client, input.batch)
      : await listBulkRecipients({
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

  // Lô Danh sách tùy chỉnh (có thể mang email ngoài VAM, VAM00027) đi trong hạn mức chung 24 giờ
  // như các bộ gửi khác. Các nhóm cố định giữ nguyên cách chạy cũ. Không đếm được thì không gửi.
  let runCap = BULK_SEND_CHUNK;
  if (audience === "custom" && pending.length) {
    const sentInWindow = await countSentInWindow(client, now());
    if (sentInWindow === null) {
      return {
        ok: false, sent: 0, failed: 0, skipped: 0, remaining: pending.length, problems: [],
        error: "Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi. Thử lại sau ít phút."
      };
    }
    runCap = customRunAllowance(sentInWindow);
    if (runCap === 0) {
      return {
        ok: false, sent: 0, failed: 0, skipped: 0, remaining: pending.length, problems: [],
        error: `Đã chạm hạn mức chung: cả hệ thống đã gửi ${sentInWindow}/${DAILY_EMAIL_LIMIT} thư trong 24 giờ qua. Danh sách vẫn nằm trong lô; bấm “Gửi tiếp” sau vài giờ.`
      };
    }
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const recipient of pending) {
    if (sent + failed + skipped >= runCap) break;
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
      if (problems.length < 10) problems.push(`${recipient.fullName || recipient.email}: ${filled.message}`);
      continue;
    }

    const result = await sendTemplatedEmail({
      kind: input.batch.kind,
      toEmail: recipient.email,
      subject: filled.subject,
      body: filled.body,
      relation: outboundRelationFor(recipient),
      batchId: input.batch.id
    });

    if (result.skipped) skipped += 1;
    else if (result.ok) sent += 1;
    else {
      failed += 1;
      if (problems.length < 10) problems.push(`${recipient.fullName || recipient.email}: ${result.reason ?? "lỗi gửi"}`);
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
