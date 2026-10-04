import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { BULK_TIME_BUDGET_MS } from "@/lib/bulk-mail-core";
import { getReviewerPool } from "@/lib/data";
import { passwordSetupUrl, sendTemplatedEmail } from "@/lib/email";
import { getMailSeason } from "@/lib/email-templates";
import { createRecoveryToken, enableMentorAsReviewer, loadAuthSignInIndex } from "@/lib/enable-reviewer";
import { DAILY_EMAIL_LIMIT, DISPATCH_RESERVE } from "@/lib/mentee-invite-dispatch-core";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import {
  CONFIRMATION_EMAIL_KIND,
  MAX_SHEET_BYTES,
  buildInterviewBlocks,
  matchSignup,
  parseSignupSheet,
  planRecipients,
  renderConfirmation,
  roundAnchor,
  sheetCsvUrl,
  type InterviewBlock,
  type Participant,
  type PlannedRecipient
} from "@/lib/mentor-interview-confirmation-core";
import { canSendBulkEmail } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getPublicOrigin } from "@/lib/public-url";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/mentor-interview-confirmation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thư xác nhận lịch phỏng vấn cho mentor — MỘT thư mỗi người: lịch, địa điểm,
 * tài khoản, và với ai chưa từng đăng nhập thì cả link đặt mật khẩu (BTC chốt
 * 02/10/2026: không gửi thư mời tài khoản riêng).
 *
 * Hai bước, cùng cổng với gửi thư hàng loạt (quản trị viên, vận hành đúng mùa):
 * 1. Cấp quyền phỏng vấn cho người đăng ký chưa có quyền — chỉ mentor của đợt
 *    tuyển (cùng nguồn với công cụ cấp quyền hàng loạt), KHÔNG gửi thư mời.
 * 2. Gửi thư cho người đã có quyền và chưa nhận thư đợt này.
 *
 * Mỗi bước đọc lại sheet, quyền và sổ thư từ đầu — không tin danh sách trình
 * duyệt gửi lên.
 */

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const SHEET_ERROR =
  "Không đọc được sheet. Kiểm lại link và quyền chia sẻ \"Bất kỳ ai có đường liên kết đều xem được\".";

export type ConfirmationPlan = {
  seasonId: string;
  seasonCode: string;
  blocks: InterviewBlock[];
  recipients: PlannedRecipient[];
  duplicates: string[];
  anchorSessionId: string;
  origin: string;
};

type Gate =
  | { ok: true; actorId: string; actorEmail: string; seasonId: string; seasonCode: string; client: any }
  | { ok: false; message: string };

async function authorize(): Promise<Gate> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return { ok: false, message: "Bạn chưa đăng nhập." };
  if (!canSendBulkEmail(actor.role)) return { ok: false, message: "Chỉ quản trị viên gửi được thư cho mentor." };
  const season = await getMailSeason();
  if (!season.ok) return { ok: false, message: season.error };
  const scope = await getAdminScopeContext();
  if (scope.scopeError || !(await canOperateSeason(scope, season.id))) {
    return { ok: false, message: "Bạn không có phạm vi vận hành trên mùa này." };
  }
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  return { ok: true, actorId: actor.id, actorEmail: String(actor.email ?? "").trim().toLowerCase(), seasonId: season.id, seasonCode: season.code, client };
}

async function readSheet(link: unknown): Promise<{ ok: true; csv: string } | { ok: false; message: string }> {
  const url = sheetCsvUrl(link);
  if (!url) return { ok: false, message: "Link không phải link Google Sheets (https://docs.google.com/spreadsheets/d/…)." };
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get("content-type") ?? "";
    // Sheet không chia sẻ công khai thì Google trả trang đăng nhập (HTML), không phải CSV.
    if (!res.ok || !type.includes("text/csv")) return { ok: false, message: SHEET_ERROR };
    const csv = await res.text();
    if (csv.length > MAX_SHEET_BYTES) return { ok: false, message: "Sheet quá lớn — kiểm lại đúng trang tính đăng ký chưa." };
    return { ok: true, csv };
  } catch (error) {
    console.error("[mentor-interview-confirmation] sheet fetch failed", error);
    return { ok: false, message: SHEET_ERROR };
  }
}

type AuthIndex = Map<string, { id: string; signedIn: boolean }>;

/** Người có quyền vào vòng phỏng vấn mùa này (cùng nguồn với ô "Người phỏng vấn"), kèm SĐT và đã đăng nhập chưa. */
async function readParticipants(client: any, seasonId: string, auth: AuthIndex): Promise<Participant[] | null> {
  const { data, error } = await client.rpc("vam110_list_recruitment_participants", {
    p_season_id: seasonId,
    p_review_stage: "interview",
    // Thư xác nhận lịch chấm phỏng vấn MENTEE trực tiếp — nhóm 'interviewer'.
    p_role_applied: "mentee"
  });
  if (error || !Array.isArray(data)) {
    console.error("[mentor-interview-confirmation] participants", error);
    return null;
  }
  const rows = (data as Array<{ email?: string | null; full_name?: string | null }>)
    .map((r) => ({ email: String(r.email ?? "").trim().toLowerCase(), fullName: String(r.full_name ?? "").trim() }))
    .filter((r) => r.email.includes("@"));
  if (!rows.length) return [];
  const { data: people, error: peopleError } = await client
    .from("people")
    .select("email_primary,phone_primary")
    .in("email_primary", rows.map((r) => r.email));
  if (peopleError) {
    console.error("[mentor-interview-confirmation] people", peopleError);
    return null;
  }
  const phoneByEmail = new Map(
    ((people ?? []) as Array<{ email_primary?: string | null; phone_primary?: string | null }>).map((p) => [
      String(p.email_primary ?? "").trim().toLowerCase(),
      String(p.phone_primary ?? "")
    ])
  );
  return rows.map((r) => ({ ...r, phone: phoneByEmail.get(r.email) ?? "", signedIn: auth.get(r.email)?.signedIn }));
}

async function readAlreadySent(client: any, anchorSessionId: string): Promise<Set<string> | null> {
  const { data, error } = await client
    .from("outbound_emails")
    .select("to_email")
    .eq("kind", CONFIRMATION_EMAIL_KIND)
    .eq("related_table", "interview_sessions")
    .eq("related_id", anchorSessionId)
    .in("status", ["sent", "queued"]);
  if (error) {
    console.error("[mentor-interview-confirmation] sent lookup", error);
    return null;
  }
  return new Set(((data ?? []) as Array<{ to_email?: string | null }>).map((r) => String(r.to_email ?? "").trim().toLowerCase()));
}

type Built = { ok: true; plan: ConfirmationPlan; auth: AuthIndex } | { ok: false; message: string };

async function buildPlan(gate: Extract<Gate, { ok: true }>, link: unknown): Promise<Built> {
  const sheet = await readSheet(link);
  if (!sheet.ok) return sheet;

  const { data: sessions, error: sessionError } = await gate.client
    .from("interview_sessions")
    .select("id,starts_at,ends_at,venue")
    .eq("season_id", gate.seasonId);
  if (sessionError) return { ok: false, message: SAFE_ERROR };
  const blocks = buildInterviewBlocks(
    ((sessions ?? []) as Array<{ id: string; starts_at: string; ends_at: string; venue: string | null }>).map((s) => ({
      id: String(s.id),
      startsAtIso: new Date(s.starts_at).toISOString(),
      endsAtIso: new Date(s.ends_at).toISOString(),
      venue: s.venue
    })),
    new Date().toISOString()
  );
  const anchor = roundAnchor(blocks);
  if (!anchor) return { ok: false, message: "Mùa này không còn ca phỏng vấn nào sắp diễn ra." };

  const parsed = parseSignupSheet(sheet.csv, blocks);
  if (!parsed.ok) return parsed;

  // Không đọc được quyền, danh bạ đăng nhập hay sổ thư thì dừng: đoán "chưa ai
  // nhận" là gửi trùng, đoán "ai cũng có quyền" là gửi tài khoản không vào được.
  let auth: AuthIndex;
  try {
    auth = await loadAuthSignInIndex(gate.client);
  } catch (error) {
    console.error("[mentor-interview-confirmation] auth index", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const participants = await readParticipants(gate.client, gate.seasonId, auth);
  if (!participants) return { ok: false, message: SAFE_ERROR };
  const sent = await readAlreadySent(gate.client, anchor.sessionId);
  if (!sent) return { ok: false, message: SAFE_ERROR };

  const origin = (await getPublicOrigin()) ?? "https://os.alumni-mentoring.edu.vn";
  return {
    ok: true,
    auth,
    plan: {
      seasonId: gate.seasonId,
      seasonCode: gate.seasonCode,
      blocks,
      recipients: planRecipients(parsed.rows, participants, sent),
      duplicates: parsed.duplicates,
      anchorSessionId: anchor.sessionId,
      origin
    }
  };
}

function render(plan: ConfirmationPlan, r: PlannedRecipient, passwordLink: string | "placeholder" | null) {
  return renderConfirmation({
    name: r.name,
    loginEmail: r.loginEmail ?? r.email,
    matchedBy: r.matchedBy,
    note: r.note,
    blocks: plan.blocks.filter((b) => r.blockKeys.includes(b.key)),
    origin: plan.origin,
    passwordLink
  });
}

export type PreviewResult =
  | { ok: true; plan: ConfirmationPlan; sample: { to: string; subject: string; body: string } | null }
  | { ok: false; message: string };

export async function previewMentorConfirmations(link: unknown): Promise<PreviewResult> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  const built = await buildPlan(gate, link);
  if (!built.ok) return built;
  const ready = built.plan.recipients.filter((r) => r.status === "ready");
  // Ưu tiên thư mẫu có dòng link đặt mật khẩu: đó là dạng thư BTC cần soát kỹ nhất.
  const first = ready.find((r) => r.needsPasswordLink) ?? ready[0];
  const sample = first
    ? { to: first.loginEmail ?? first.email, ...render(built.plan, first, first.needsPasswordLink ? "placeholder" : null) }
    : null;
  return { ok: true, plan: built.plan, sample };
}

/**
 * Bản thử: thư của một người sẵn sàng, gửi cho CHÍNH người bấm. Link đặt mật khẩu
 * thay bằng chữ giữ chỗ — link thật trong hộp thư người bấm là chìa khoá tài khoản
 * của mentor. Không ghi theo mốc đợt nên không tính là đã gửi.
 */
export async function sendMentorConfirmationTest(link: unknown): Promise<{ ok: boolean; message: string }> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  if (!gate.actorEmail.includes("@")) return { ok: false, message: "Tài khoản của bạn chưa có email để nhận bản thử." };
  const built = await buildPlan(gate, link);
  if (!built.ok) return built;
  const ready = built.plan.recipients.filter((r) => r.status === "ready");
  const first = ready.find((r) => r.needsPasswordLink) ?? ready[0];
  if (!first) return { ok: false, message: "Chưa có mentor nào sẵn sàng để làm bản thử." };
  const mail = render(built.plan, first, first.needsPasswordLink ? "placeholder" : null);
  const result = await sendTemplatedEmail({
    kind: CONFIRMATION_EMAIL_KIND,
    toEmail: gate.actorEmail,
    subject: `[THỬ] ${mail.subject}`,
    body: mail.body
  });
  if (result.skipped) return { ok: false, message: "Môi trường này đang tắt gửi thư — bản thử không đi." };
  if (!result.ok) return { ok: false, message: "Gửi bản thử không thành công. Xem sổ thư để biết lý do." };
  return { ok: true, message: `Đã gửi bản thử (thư của ${first.name}) tới ${gate.actorEmail}.` };
}

export type GrantResult = {
  ok: boolean;
  message: string;
  granted: string[];
  failed: string[];
  notMentor: string[];
  remaining: number;
};

/**
 * Cấp quyền phỏng vấn cho người đăng ký buổi đợt này mà CHƯA có quyền — không
 * gửi thư mời riêng (thông tin đăng nhập đi trong thư xác nhận).
 *
 * Chỉ người là mentor của đợt tuyển hiện hành (getReviewerPool — cùng nguồn với
 * công cụ cấp quyền hàng loạt): hàm cấp quyền ở database không tự kiểm điều đó,
 * nên một email lạ trên sheet không được trở thành tài khoản chấm.
 */
export async function grantInterviewAccessFromSheet(link: unknown): Promise<GrantResult> {
  const empty = (message: string): GrantResult => ({ ok: false, message, granted: [], failed: [], notMentor: [], remaining: 0 });
  const gate = await authorize();
  if (!gate.ok) return empty(gate.message);
  const built = await buildPlan(gate, link);
  if (!built.ok) return empty(built.message);
  const targets = built.plan.recipients.filter((r) => r.status === "no_access");
  if (!targets.length) return { ok: true, message: "Mọi người đăng ký đợt này đã có quyền phỏng vấn.", granted: [], failed: [], notMentor: [], remaining: 0 };

  const { data: batches, error: batchError } = await gate.client
    .from("intake_batches")
    .select("id")
    .eq("season_id", gate.seasonId)
    .eq("code", SEASON_CONFIG.CURRENT_APPLICATION_BATCH_CODE);
  const batchId = String((batches as Array<{ id?: string }> | null)?.[0]?.id ?? "");
  if (batchError || !batchId) return empty(SAFE_ERROR);
  const pool = await getReviewerPool({ intakeBatchId: batchId });
  if (pool.error) return empty(SAFE_ERROR);
  const poolRows = pool.data.filter((p) => p.person_id && p.email_primary);
  const { data: people, error: peopleError } = await gate.client
    .from("people")
    .select("id,phone_primary")
    .in("id", poolRows.map((p) => p.person_id));
  if (peopleError) return empty(SAFE_ERROR);
  const phoneById = new Map(((people ?? []) as Array<{ id: string; phone_primary?: string | null }>).map((p) => [p.id, String(p.phone_primary ?? "")]));
  const candidates = poolRows.map((p) => ({
    personId: String(p.person_id),
    email: String(p.email_primary).trim().toLowerCase(),
    fullName: String(p.full_name ?? ""),
    phone: phoneById.get(String(p.person_id)) ?? ""
  }));

  const granted: string[] = [];
  const failed: string[] = [];
  const notMentor: string[] = [];
  const started = Date.now();
  let processed = 0;
  for (const row of targets) {
    if (Date.now() - started > BULK_TIME_BUDGET_MS) break;
    processed++;
    const match = matchSignup(row, candidates);
    if (!match) {
      notMentor.push(`${row.name} <${row.email}>`);
      continue;
    }
    const result = await enableMentorAsReviewer({
      personId: match.candidate.personId,
      seasonId: gate.seasonId,
      participationRole: "interviewer",
      notify: false
    });
    (result.ok ? granted : failed).push(match.candidate.email);
  }
  const remaining = targets.length - processed;
  const parts = [`Đã cấp quyền phỏng vấn cho ${granted.length} người (không gửi thư riêng).`];
  if (failed.length) parts.push(`${failed.length} người lỗi: ${failed.join(", ")}.`);
  if (notMentor.length) parts.push(`${notMentor.length} người không phải mentor của đợt tuyển này nên chưa cấp: ${notMentor.join(", ")}.`);
  if (remaining > 0) parts.push(`Còn ${remaining} người chưa xử lý (hết thời gian một lượt) — bấm lại.`);
  return { ok: true, message: parts.join(" "), granted, failed, notMentor, remaining };
}

export type SendResult = {
  ok: boolean;
  message: string;
  sent: number;
  failed: string[];
  remaining: number;
};

/**
 * Gửi cho người SẴN SÀNG và chưa nhận thư đợt này. BTC phải gõ đúng số người sẽ
 * nhận — danh sách đổi giữa lúc xem và lúc bấm (ai đó vừa sửa sheet) thì con số
 * lệch và không thư nào đi.
 */
export async function sendMentorConfirmations(link: unknown, typedCount: unknown, nowMs = Date.now()): Promise<SendResult> {
  const empty = (message: string): SendResult => ({ ok: false, message, sent: 0, failed: [], remaining: 0 });
  const gate = await authorize();
  if (!gate.ok) return empty(gate.message);
  const built = await buildPlan(gate, link);
  if (!built.ok) return empty(built.message);
  const ready = built.plan.recipients.filter((r) => r.status === "ready" && r.loginEmail);
  if (!ready.length) return { ok: true, message: "Không còn ai cần gửi — mọi mentor sẵn sàng đã nhận thư đợt này.", sent: 0, failed: [], remaining: 0 };
  if (String(typedCount ?? "").trim() !== String(ready.length)) {
    return empty(`Số người sẽ nhận hiện là ${ready.length}. Tải lại danh sách, kiểm lại rồi gõ đúng con số này.`);
  }

  const sentInWindow = await countSentInWindow(gate.client, nowMs);
  if (sentInWindow === null) return empty("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
  const allowance = Math.max(0, DAILY_EMAIL_LIMIT - DISPATCH_RESERVE - sentInWindow);
  if (allowance === 0) return empty(`Đã chạm hạn mức thư trong 24 giờ (${sentInWindow} thư). Thử lại sau vài giờ.`);

  const started = Date.now();
  let sent = 0;
  let withoutLink = 0;
  const failed: string[] = [];
  for (const r of ready.slice(0, allowance)) {
    if (Date.now() - started > BULK_TIME_BUDGET_MS) break;
    const to = r.loginEmail!;
    let passwordLink: string | null = null;
    if (r.needsPasswordLink) {
      // Link mới làm link cũ hết hiệu lực — tạo ngay trước khi gửi, cho đúng người nhận.
      const account = built.auth.get(to);
      const token = account ? await createRecoveryToken(gate.client, to, account.id) : null;
      passwordLink = token ? passwordSetupUrl({ tokenHash: token, type: "recovery", requestOrigin: built.plan.origin }) : null;
      // Không dựng được link: vẫn gửi — thư đã chỉ cách bấm "Đặt lại mật khẩu".
      if (!passwordLink) withoutLink++;
    }
    const mail = render(built.plan, r, passwordLink);
    const result = await sendTemplatedEmail({
      kind: CONFIRMATION_EMAIL_KIND,
      toEmail: to,
      subject: mail.subject,
      body: mail.body,
      relation: { table: "interview_sessions", id: built.plan.anchorSessionId }
    });
    if (result.skipped) return { ok: false, message: "Môi trường này đang tắt gửi thư — không thư nào đi.", sent, failed, remaining: ready.length - sent };
    if (result.ok) sent++;
    else {
      failed.push(to);
      // 429: Brevo báo hết hạn mức ngày — dừng ngay, đừng đốt phần còn lại từng lỗi một.
      if (result.providerStatus === 429) break;
    }
  }
  const remaining = ready.length - sent - failed.length;
  const parts = [`Đã gửi ${sent}/${ready.length} thư.`];
  if (withoutLink) parts.push(`${withoutLink} thư không kèm được link đặt mật khẩu (thư vẫn hướng dẫn bấm "Đặt lại mật khẩu").`);
  if (failed.length) parts.push(`${failed.length} thư lỗi — bấm gửi lại để thử tiếp đúng những người này.`);
  if (remaining > 0) parts.push(`Còn ${remaining} người chưa gửi (hết thời gian một lượt) — bấm gửi tiếp.`);
  return { ok: true, message: parts.join(" "), sent, failed, remaining };
}
