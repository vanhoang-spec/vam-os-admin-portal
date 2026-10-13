import "server-only";

/**
 * Mentee đặc cách (Support team) — phần máy chủ (BTC 11/10/2026).
 *
 * Ba việc: dựng bảng cho BTC (danh sách + người được gợi ý), gọi các hàm database để
 * thêm/gỡ/xác nhận, và gửi thư mời. Luật nằm trong migration 20261011150000; ở đây không
 * có phép kiểm nào thay cho luật đó — chỉ có cổng quyền của màn hình và câu chữ.
 *
 * Bộ gửi thư chép khuôn lib/matching-round2-dispatch.ts (đã chạy thật): CLAIM nguyên tử
 * trước khi gửi để hai lần bấm cùng lúc không ai nhận hai thư, dừng ngay khi nhà cung cấp
 * báo 429, nhả mọi claim chưa gửi, dùng chung trần thư 1.000/24 giờ.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendMenteeExemptionConfirm } from "@/lib/email";
import {
  countExemptions,
  exemptionConfirmMessage,
  exemptionState,
  isExemptionRecipient,
  suggestExemptionCandidates,
  summarizeAddOutcomes,
  type ConfirmPageState,
  type ExemptionCandidate,
  type ExemptionCounts,
  type ExemptionRow,
  type ExemptionState
} from "@/lib/mentee-exemption-core";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import {
  DAILY_EMAIL_LIMIT,
  DISPATCH_RESERVE,
  DISPATCH_STALE_CLAIM_MS,
  DISPATCH_TIME_BUDGET_MS,
  dispatchAllowance
} from "@/lib/mentee-invite-dispatch-core";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { canManageMatches } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getPublicOrigin } from "@/lib/public-url";
import { SEASON_CONFIG } from "@/lib/season-config";
import { CURRENT_APPLICATION_SEASON_LABEL } from "@/lib/season-labels";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;
const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXEMPTION_COLUMNS =
  "id,season_id,person_id,token,added_at,send_count,first_sent_at,last_sent_at,claimed_at,last_error,confirmed_at,revoked_at";

function log(message: string, error?: unknown) {
  console.error(`[mentee-exemption] ${message}`, error ?? "");
}

const text = (value: unknown): string | null => {
  const raw = String(value ?? "").trim();
  return raw === "" ? null : raw;
};

export async function exemptionSeasonContext() {
  const client = getSupabaseServiceRoleClient();
  if (!client) throw new Error("DATABASE_UNAVAILABLE");
  const code = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
  const { data, error } = await client.from("seasons").select("id").eq("code", code).maybeSingle();
  if (error || !data) throw new Error("SEASON_UNAVAILABLE");
  return { client, seasonId: String(data.id), seasonCode: code };
}

/**
 * Người được quản lý danh sách đặc cách: cùng nhóm vai trò với người quản lý ghép cặp
 * (Core team trở lên) VÀ có quyền vận hành mùa. Fail-closed: đọc không ra thì là không.
 * Database kiểm lại bằng vam084_operator_for_season ở mọi lệnh ghi.
 */
export async function exemptionOperator(seasonId: string) {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || !canManageMatches(actor.role)) return null;
  const ctx = await getAdminScopeContext();
  return (await canOperateSeason(ctx, seasonId)) ? actor : null;
}

function toExemptionRow(row: Row): ExemptionRow {
  return {
    id: String(row.id),
    personId: String(row.person_id),
    token: String(row.token ?? ""),
    addedAt: text(row.added_at),
    sendCount: Number(row.send_count) || 0,
    lastSentAt: text(row.last_sent_at),
    claimedAt: text(row.claimed_at),
    lastError: text(row.last_error),
    confirmedAt: text(row.confirmed_at),
    revokedAt: text(row.revoked_at)
  };
}

async function readExemptions(client: any, seasonId: string): Promise<Row[]> {
  const rows = await readAllPages<Row>("mentee_exemptions", EXEMPTION_COLUMNS, (columns) =>
    client.from("mentee_exemptions").select(columns).eq("season_id", seasonId)
  );
  if (rows.error) throw rows.error;
  return rows.data;
}

export type ExemptionListItem = {
  id: string;
  personId: string;
  name: string;
  email: string | null;
  state: ExemptionState;
  /** Trạng thái đơn mentee mùa này; null = chưa có đơn (xác nhận sẽ tạo một đơn đặc cách). */
  applicationStatus: string | null;
  sendCount: number;
  lastSentAt: string | null;
  lastError: string | null;
  confirmedAt: string | null;
  addedAt: string | null;
};

export type ExemptionBoard = {
  seasonCode: string;
  canEdit: boolean;
  counts: ExemptionCounts;
  items: ExemptionListItem[];
  candidates: ExemptionCandidate[];
  /** Số người sẽ nhận thư nếu bấm gửi ngay bây giờ. */
  pending: number;
  sentInWindow: number | null;
  allowance: number;
};

/** Đọc toàn bộ dữ liệu cho màn hình BTC. Không ghi gì. */
export async function getExemptionBoard(nowMs = Date.now()): Promise<{ ok: true; data: ExemptionBoard } | { ok: false; message: string }> {
  try {
    const { client, seasonId, seasonCode } = await exemptionSeasonContext();
    const [exemptionRows, applications, memberships, operations, supportAccounts, sentInWindow, actor] = await Promise.all([
      readExemptions(client, seasonId),
      readAllPages<Row>("applications", "id,person_id,email_primary,status,role_applied", (columns) =>
        client.from("applications").select(columns).eq("season_id", seasonId).eq("role_applied", "mentee")
      ),
      readAllPages<Row>("person_season_memberships", "id,person_id,role,status", (columns) =>
        client.from("person_season_memberships").select(columns).eq("season_id", seasonId).eq("role", "mentee").eq("status", "active")
      ),
      readAllPages<Row>("mentee_interview_operations", "id", (columns) => client.from("mentee_interview_operations").select(columns)),
      readAllPages<Row>("admin_users", "id,email,role,status", (columns) =>
        client.from("admin_users").select(columns).eq("role", "support_team").eq("status", "active")
      ),
      countSentInWindow(client, nowMs),
      exemptionOperator(seasonId)
    ]);
    for (const read of [applications, memberships, operations, supportAccounts]) {
      if (read.error) throw read.error;
    }

    const interviewed = new Set(operations.data.map((o) => String(o.id)));
    const supportEmails = supportAccounts.data.map((u) => String(u.email ?? "")).filter(Boolean);
    const menteeApps = applications.data.map((a) => ({
      id: String(a.id),
      personId: text(a.person_id),
      email: text(a.email_primary),
      status: String(a.status ?? "")
    }));

    // Hồ sơ người cần đọc: người trong danh sách, người đang là mentee mùa này, chủ các đơn
    // đã duyệt mà chưa qua phỏng vấn, và người trùng email tài khoản Support team.
    const personIds = new Set<string>();
    for (const row of exemptionRows) personIds.add(String(row.person_id));
    for (const m of memberships.data) personIds.add(String(m.person_id));
    for (const a of menteeApps) if (a.personId && a.status === "approved_as_mentee" && !interviewed.has(a.id)) personIds.add(a.personId);
    const [peopleById, peopleByEmail] = await Promise.all([
      readAllPagesIn<Row>(client, "people", "id", Array.from(personIds), "id,full_name,email_primary"),
      supportEmails.length
        ? readAllPagesIn<Row>(client, "people", "email_primary", supportEmails, "id,full_name,email_primary")
        : Promise.resolve({ data: [] as Row[], error: null })
    ]);
    if (peopleById.error || peopleByEmail.error) throw peopleById.error ?? peopleByEmail.error;
    const people = new Map<string, { id: string; name: string; email: string | null }>();
    for (const p of [...peopleById.data, ...peopleByEmail.data]) {
      people.set(String(p.id), { id: String(p.id), name: text(p.full_name) ?? "(chưa có tên)", email: text(p.email_primary) });
    }

    const rows = exemptionRows.map(toExemptionRow);
    const statusOf = (personId: string, email: string | null) => {
      const key = String(email ?? "").trim().toLowerCase();
      const own = menteeApps.find((a) => a.personId === personId || (key !== "" && String(a.email ?? "").trim().toLowerCase() === key));
      return own ? own.status : null;
    };
    const items: ExemptionListItem[] = rows
      .map((row) => {
        const person = people.get(row.personId);
        return {
          id: row.id,
          personId: row.personId,
          name: person?.name ?? "(không rõ tên)",
          email: person?.email ?? null,
          state: exemptionState(row),
          applicationStatus: statusOf(row.personId, person?.email ?? null),
          sendCount: row.sendCount,
          lastSentAt: row.lastSentAt,
          lastError: row.lastError,
          confirmedAt: row.confirmedAt,
          addedAt: row.addedAt
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "vi") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const candidates = suggestExemptionCandidates({
      people: Array.from(people.values()),
      supportAccountEmails: supportEmails,
      activeMenteePersonIds: memberships.data.map((m) => String(m.person_id)),
      applications: menteeApps,
      interviewedApplicationIds: Array.from(interviewed),
      listedPersonIds: rows.filter((r) => !r.revokedAt).map((r) => r.personId)
    });
    const pending = rows.filter((row) => isExemptionRecipient({ ...row, email: people.get(row.personId)?.email ?? null }, nowMs)).length;

    return {
      ok: true,
      data: {
        seasonCode,
        canEdit: Boolean(actor),
        counts: countExemptions(rows),
        items,
        candidates,
        pending,
        sentInWindow,
        allowance: sentInWindow === null ? 0 : dispatchAllowance(sentInWindow)
      }
    };
  } catch (error) {
    log("board failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

export type ExemptionActionResult = { ok: boolean; message: string };

/** BTC thêm người vào danh sách. `personIds` đến từ biểu mẫu: database kiểm lại từng người. */
export async function addMenteeExemptions(personIds: string[]): Promise<ExemptionActionResult> {
  const ids = Array.from(new Set(personIds.map((id) => id.trim()).filter((id) => UUID.test(id))));
  if (!ids.length) return { ok: false, message: "Chưa chọn ai để thêm vào danh sách." };
  if (ids.length > 200) return { ok: false, message: "Mỗi lần thêm tối đa 200 người." };
  try {
    const { client, seasonId } = await exemptionSeasonContext();
    const actor = await exemptionOperator(seasonId);
    if (!actor) return { ok: false, message: "Bạn không có quyền quản lý danh sách đặc cách của mùa này." };
    const { data, error } = await client.rpc("vam117_add_mentee_exemptions", { p_actor: actor.id, p_season: seasonId, p_people: ids });
    if (error) {
      log("add failed", error);
      return { ok: false, message: String(error.message ?? "").includes("ACCESS_DENIED") ? "Bạn không có quyền quản lý danh sách đặc cách của mùa này." : SAFE_ERROR };
    }
    const outcomes = Array.isArray((data as Row | null)?.results)
      ? ((data as Row).results as Row[]).map((r) => ({ personId: String(r.personId), code: String(r.code) }))
      : [];
    const people = await readAllPagesIn<Row>(client, "people", "id", ids, "id,full_name");
    const names = new Map((people.data ?? []).map((p) => [String(p.id), text(p.full_name) ?? "(chưa có tên)"]));
    return summarizeAddOutcomes(outcomes, names);
  } catch (error) {
    log("add crashed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

/** BTC gỡ một người chưa xác nhận khỏi danh sách; link của người đó ngừng dùng được. */
export async function revokeMenteeExemption(exemptionId: string): Promise<ExemptionActionResult> {
  if (!UUID.test(exemptionId)) return { ok: false, message: "Dữ liệu không hợp lệ — tải lại trang rồi thử lại." };
  try {
    const { client, seasonId } = await exemptionSeasonContext();
    const actor = await exemptionOperator(seasonId);
    if (!actor) return { ok: false, message: "Bạn không có quyền quản lý danh sách đặc cách của mùa này." };
    const { error } = await client.rpc("vam117_revoke_mentee_exemption", { p_actor: actor.id, p_season: seasonId, p_id: exemptionId });
    if (error) {
      const message = String(error.message ?? "");
      if (message.includes("ALREADY_CONFIRMED")) {
        return { ok: false, message: "Bạn này đã xác nhận tham gia rồi nên không gỡ ở đây được. Muốn ngừng, xử lý tư cách mentee ở trang hồ sơ." };
      }
      if (message.includes("EXEMPTION_NOT_FOUND")) return { ok: false, message: "Không tìm thấy dòng này — tải lại trang rồi thử lại." };
      if (message.includes("ACCESS_DENIED")) return { ok: false, message: "Bạn không có quyền quản lý danh sách đặc cách của mùa này." };
      log("revoke failed", error);
      return { ok: false, message: SAFE_ERROR };
    }
    return { ok: true, message: "Đã gỡ khỏi danh sách đặc cách. Đường dẫn trong thư của bạn này không còn dùng được." };
  } catch (error) {
    log("revoke crashed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}

export type ExemptionSendResult = { ok: boolean; message: string; sent: number; failed: number };

/** Gửi thư mời xác nhận cho mọi người đang chờ thư (xem isExemptionRecipient). */
export async function runMenteeExemptionDispatch(input: { now?: () => number } = {}): Promise<ExemptionSendResult> {
  const now = input.now ?? Date.now;
  const fail = (message: string): ExemptionSendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await exemptionSeasonContext();
    if (!(await exemptionOperator(seasonId))) return fail("Bạn không có quyền quản lý danh sách đặc cách của mùa này.");
    const startedMs = now();
    const nowIso = new Date(startedMs).toISOString();

    const sentInWindow = await countSentInWindow(client, startedMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    const allowance = dispatchAllowance(sentInWindow);
    if (allowance === 0) {
      return {
        ok: true,
        message: `Đã chạm phần hạn mức: cả hệ thống đã gửi ${sentInWindow}/${DAILY_EMAIL_LIMIT} thư trong 24 giờ qua, ${DISPATCH_RESERVE} thư chừa cho các thư khác. Thử lại sau vài giờ.`,
        sent: 0,
        failed: 0
      };
    }

    // Nhả claim treo của một lượt gửi đã chết giữa chừng, rồi mới đọc danh sách.
    const staleIso = new Date(startedMs - DISPATCH_STALE_CLAIM_MS).toISOString();
    const { error: staleError } = await client
      .from("mentee_exemptions")
      .update({ claimed_at: null })
      .eq("season_id", seasonId)
      .lt("claimed_at", staleIso);
    if (staleError) log("stale release failed", staleError);

    const rows = (await readExemptions(client, seasonId)).map((row) => ({ raw: row, row: toExemptionRow(row) }));
    const people = await readAllPagesIn<Row>(client, "people", "id", rows.map((r) => r.row.personId), "id,full_name,email_primary");
    if (people.error) throw people.error;
    const peopleById = new Map(people.data.map((p) => [String(p.id), p]));

    const due = rows
      .filter(({ row }) => !row.claimedAt && Boolean(row.token) && isExemptionRecipient({ ...row, email: text(peopleById.get(row.personId)?.email_primary) }, startedMs))
      .sort((a, b) => String(a.row.addedAt ?? "").localeCompare(String(b.row.addedAt ?? "")) || a.row.id.localeCompare(b.row.id));
    if (!due.length) return { ok: true, message: "Không còn ai chờ thư mời xác nhận.", sent: 0, failed: 0 };

    const chunk = due.slice(0, allowance);
    const claimStamp = nowIso;
    const { data: claimedRows, error: claimError } = await client
      .from("mentee_exemptions")
      .update({ claimed_at: claimStamp })
      .in("id", chunk.map(({ row }) => row.id))
      .is("claimed_at", null)
      .select("id");
    if (claimError) {
      log("claim failed", claimError);
      return fail(SAFE_ERROR);
    }
    const claimedIds = new Set(((claimedRows ?? []) as Row[]).map((r) => String(r.id)));
    const claimed = chunk.filter(({ row }) => claimedIds.has(row.id));

    const requestOrigin = await getPublicOrigin();
    let sent = 0;
    let failed = 0;
    let stopped429 = false;
    const release: string[] = [];

    for (const { raw, row } of claimed) {
      const person = peopleById.get(row.personId);
      const email = text(person?.email_primary);
      if (stopped429 || now() - startedMs > DISPATCH_TIME_BUDGET_MS || !email) {
        release.push(row.id);
        continue;
      }
      let outcome: { ok: boolean; skipped: boolean; reason?: string; providerStatus?: number | null };
      try {
        outcome = await sendMenteeExemptionConfirm({
          toEmail: email,
          recipientName: text(person?.full_name) ?? "bạn",
          seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
          token: row.token,
          exemptionId: row.id,
          requestOrigin
        });
      } catch (error) {
        log("send crashed", error);
        outcome = { ok: false, skipped: false, reason: String(error) };
      }
      if (outcome.ok && !outcome.skipped) {
        sent += 1;
        const { error } = await client
          .from("mentee_exemptions")
          .update({
            send_count: row.sendCount + 1,
            first_sent_at: raw.first_sent_at ?? nowIso,
            last_sent_at: nowIso,
            last_error: null,
            claimed_at: null
          })
          .eq("id", row.id)
          .eq("claimed_at", claimStamp);
        if (error) log("finalize failed", error);
      } else {
        // Bị cổng gửi thư chặn (môi trường thử) thì KHÔNG đốt lượt; lỗi thật thì ghi lại.
        if (!outcome.skipped) failed += 1;
        if (outcome.providerStatus === 429) stopped429 = true;
        const { error } = await client
          .from("mentee_exemptions")
          .update({ claimed_at: null, last_error: (outcome.reason ?? "Gửi thất bại").slice(0, 500) })
          .eq("id", row.id)
          .eq("claimed_at", claimStamp);
        if (error) log("release failed", error);
      }
    }
    if (release.length) {
      const { error } = await client.from("mentee_exemptions").update({ claimed_at: null }).in("id", release).eq("claimed_at", claimStamp);
      if (error) log("release leftovers failed", error);
    }
    const left = Math.max(0, due.length - sent);
    if (stopped429) {
      return { ok: true, message: `Đã gửi ${sent} thư rồi nhà cung cấp báo chạm trần. Còn ${left} người chờ thư — bấm lại sau vài giờ.`, sent, failed };
    }
    const parts = [`Đã gửi ${sent} thư mời xác nhận.`];
    if (failed) parts.push(`${failed} thư lỗi, xem Vận hành → Mail → Nhật ký gửi.`);
    if (left) parts.push(`Còn ${left} người chờ thư — bấm lại để gửi tiếp.`);
    return { ok: true, message: parts.join(" "), sent, failed };
  } catch (error) {
    log("dispatch failed", error);
    return fail(SAFE_ERROR);
  }
}

/** Gửi thử cho chính BTC đang bấm: đường dẫn là câu giữ chỗ, không link thật nào rời hệ thống. */
export async function sendMenteeExemptionTest(nowMs = Date.now()): Promise<ExemptionSendResult> {
  const fail = (message: string): ExemptionSendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await exemptionSeasonContext();
    const actor = await exemptionOperator(seasonId);
    if (!actor) return fail("Bạn không có quyền quản lý danh sách đặc cách của mùa này.");
    if (!actor.email) return fail("Tài khoản của bạn chưa có email nên không gửi thử được.");
    const sentInWindow = await countSentInWindow(client, nowMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    if (sentInWindow >= DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");
    const outcome = await sendMenteeExemptionConfirm({
      toEmail: actor.email,
      recipientName: String(actor.full_name ?? "").trim() || "bạn",
      seasonLabel: CURRENT_APPLICATION_SEASON_LABEL,
      token: null,
      exemptionId: null
    });
    if (outcome.skipped) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
    if (!outcome.ok) return fail("Gửi thư thử không thành công. Xem Vận hành → Mail → Nhật ký gửi.");
    return { ok: true, message: `Đã gửi thư thử tới ${actor.email}.`, sent: 1, failed: 0 };
  } catch (error) {
    log("test send failed", error);
    return fail(SAFE_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Trang công khai của người nhận
// ---------------------------------------------------------------------------

export type ExemptionConfirmPage = { state: ConfirmPageState; name: string | null; seasonLabel: string; message: string };

/**
 * Dữ liệu cho trang link riêng. Chỉ trả tên người nhận — không email, không số điện thoại:
 * ai cầm link cũng mở được trang này.
 */
export async function getExemptionConfirmPage(token: string): Promise<ExemptionConfirmPage> {
  const seasonLabel = CURRENT_APPLICATION_SEASON_LABEL;
  const invalid: ExemptionConfirmPage = { state: "invalid", name: null, seasonLabel, message: exemptionConfirmMessage("invalid_token") };
  if (!UUID.test(token)) return invalid;
  try {
    const client = getSupabaseServiceRoleClient();
    if (!client) return { ...invalid, message: SAFE_ERROR };
    const { data, error } = await client
      .from("mentee_exemptions")
      .select("id,person_id,confirmed_at,revoked_at")
      .eq("token", token)
      .maybeSingle();
    if (error) {
      log("confirm page read failed", error);
      return { ...invalid, message: SAFE_ERROR };
    }
    if (!data) return invalid;
    const { data: person } = await client.from("people").select("full_name").eq("id", (data as Row).person_id).maybeSingle();
    const name = text((person as Row | null)?.full_name);
    const row = data as Row;
    if (row.confirmed_at) return { state: "confirmed", name, seasonLabel, message: exemptionConfirmMessage("already_confirmed") };
    if (row.revoked_at) return { state: "revoked", name, seasonLabel, message: exemptionConfirmMessage("revoked") };
    return { state: "ready", name, seasonLabel, message: "" };
  } catch (error) {
    log("confirm page crashed", error);
    return { ...invalid, message: SAFE_ERROR };
  }
}

/** Người nhận bấm "Xác nhận tham gia". Mọi luật do vam117_confirm_mentee_exemption quyết. */
export async function confirmMenteeExemption(token: string): Promise<{ ok: boolean; message: string }> {
  if (!UUID.test(token)) return { ok: false, message: exemptionConfirmMessage("invalid_token") };
  try {
    const client = getSupabaseServiceRoleClient();
    if (!client) return { ok: false, message: SAFE_ERROR };
    const { data, error } = await client.rpc("vam117_confirm_mentee_exemption", { p_token: token });
    if (error) {
      log("confirm failed", error);
      return { ok: false, message: SAFE_ERROR };
    }
    const result = (data ?? {}) as { ok?: boolean; code?: string; reason?: string };
    if (!result.ok && result.code === "needs_btc") log("confirm needs BTC", { reason: result.reason });
    return { ok: Boolean(result.ok), message: exemptionConfirmMessage(result.code) };
  } catch (error) {
    log("confirm crashed", error);
    return { ok: false, message: SAFE_ERROR };
  }
}
