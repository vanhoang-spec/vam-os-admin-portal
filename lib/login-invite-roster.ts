import "server-only";

import { evaluateEmailGate } from "@/lib/email-core";
import { normalizeEmail } from "@/lib/identity";
import { countOutboundEmailsSince, readParticipantInviteSends } from "@/lib/outbound-emails";
import { readAllPagesIn, readBounded } from "@/lib/paged-read";
import {
  deriveRosterRow,
  inviteBudgetRemaining,
  summarizeRoster,
  type LinkRow,
  type RosterRow,
  type RosterSummary
} from "@/lib/participant-invite-core";
import { getSeasonCohortRoleMap } from "@/lib/season-cohort";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/login-invite-roster.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dữ liệu cho màn hình /participant-accounts: mentor và mentee chính thức của
 * một mùa, kèm trạng thái tài khoản của từng người.
 *
 * Tên file cố ý KHÔNG bắt đầu bằng `participant-`: file này đọc
 * `outbound_emails`, và bộ quét của migration danh tính đòi mọi cột mà các file
 * `lib/participant-*.ts` đọc phải có trong gói migration ấy.
 *
 * ---------------------------------------------------------------------------
 * KHÔNG HIỆN SỐ SAI
 * ---------------------------------------------------------------------------
 * Một phép đọc hỏng thì cả trang chỉ hiện hộp lỗi. Hiện danh sách thiếu mối nối
 * là hiện cả mùa thành "chưa mời", và người vận hành bấm gửi lại thư cho những
 * người đang dùng tài khoản.
 *
 * Chỉ dùng client service-role. Hai bảng ở đây bật RLS không policy; một phép
 * lùi về client thường trả về không dòng nào mà không báo lỗi.
 */

const ROSTER_ERROR =
  "Không đọc được trạng thái tài khoản của mùa này. Trang không hiện số liệu để tránh báo sai — vui lòng tải lại.";
const DAY_MS = 24 * 60 * 60 * 1000;

export type LoginInviteRoster =
  | {
      ok: true;
      rows: RosterRow[];
      summary: RosterSummary;
      /** Thư đã gửi hoặc đang gửi trong 24 giờ, mọi loại. Null khi không đếm được. */
      sentLast24h: number | null;
      /** Thư mời còn gửi được. Null khi không đếm được — và khi đó không mở mời hàng loạt. */
      budgetLeft: number | null;
      gateOpen: boolean;
    }
  | { ok: false; error: string };

function log(scope: string, error: unknown) {
  const err = error as { code?: string; message?: string };
  console.error("[login-invite-roster]", scope, { code: err?.code, message: err?.message ?? String(error) });
}

export async function loadLoginInviteRoster(seasonId: string, nowMs: number = Date.now()): Promise<LoginInviteRoster> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, error: ROSTER_ERROR };

  const cohort = await getSeasonCohortRoleMap(seasonId);
  if (cohort.error) return { ok: false, error: ROSTER_ERROR };
  const personIds = Array.from(cohort.data.keys());

  const [people, links, sends, staff, counted] = await Promise.all([
    readAllPagesIn<Record<string, unknown>>(client, "people", "id", personIds, "id,full_name,email_primary"),
    readAllPagesIn<Record<string, unknown>>(
      client,
      "account_person_auth_links",
      "person_id",
      personIds,
      "id,person_id,auth_user_id,status,activated_at"
    ),
    readParticipantInviteSends(personIds),
    readBounded<Record<string, unknown>>("admin_users", client.from("admin_users").select("id,email")),
    countOutboundEmailsSince(new Date(nowMs - DAY_MS).toISOString())
  ]);

  if (people.error) log("đọc danh bạ", people.error);
  if (links.error) log("đọc mối nối", links.error);
  if (staff.error) log("đọc nhân sự", staff.error);
  if (people.error || links.error || staff.error || !sends.ok) return { ok: false, error: ROSTER_ERROR };

  const peopleById = new Map<string, { fullName: string | null; emailPrimary: string | null }>();
  for (const row of people.data) {
    peopleById.set(String(row.id), {
      fullName: row.full_name === null || row.full_name === undefined ? null : String(row.full_name),
      emailPrimary: row.email_primary === null || row.email_primary === undefined ? null : String(row.email_primary)
    });
  }

  const linkByPerson = new Map<string, LinkRow>();
  for (const row of links.data) {
    linkByPerson.set(String(row.person_id ?? ""), {
      authUserId: String(row.auth_user_id ?? ""),
      personId: String(row.person_id ?? ""),
      status: String(row.status ?? ""),
      activatedAt: row.activated_at ? String(row.activated_at) : null
    });
  }

  const staffEmails = new Set<string>();
  for (const row of staff.data) {
    const email = normalizeEmail(row.email);
    if (email) staffEmails.add(email);
  }

  // Trùng email TRONG mùa. Trùng với người ngoài mùa thì máy chủ bắt lúc gửi.
  const cohortEmailCounts = new Map<string, number>();
  for (const personId of personIds) {
    const email = normalizeEmail(peopleById.get(personId)?.emailPrimary);
    if (email) cohortEmailCounts.set(email, (cohortEmailCounts.get(email) ?? 0) + 1);
  }

  const rows = personIds
    .map((personId) =>
      deriveRosterRow({
        personId,
        roles: cohort.data.get(personId) ?? [],
        person: peopleById.get(personId) ?? null,
        link: linkByPerson.get(personId) ?? null,
        sends: sends.byPersonId.get(personId) ?? [],
        staffEmails,
        cohortEmailCounts,
        nowMs
      })
    )
    .sort(
      (a, b) =>
        a.fullName.localeCompare(b.fullName, "vi") || String(a.email ?? "").localeCompare(String(b.email ?? ""))
    );

  return {
    ok: true,
    rows,
    summary: summarizeRoster(rows),
    sentLast24h: counted.ok ? counted.count : null,
    budgetLeft: counted.ok ? inviteBudgetRemaining(counted.count) : null,
    gateOpen: evaluateEmailGate(process.env).canSend
  };
}
