import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { BULK_TIME_BUDGET_MS } from "@/lib/bulk-mail-core";
import { sendTemplatedEmail } from "@/lib/email";
import { getMailSeason } from "@/lib/email-templates";
import { DAILY_EMAIL_LIMIT, DISPATCH_RESERVE } from "@/lib/mentee-invite-dispatch-core";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import {
  CONFIRMATION_EMAIL_KIND,
  MAX_SHEET_BYTES,
  buildInterviewBlocks,
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
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/mentor-interview-confirmation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc sheet đăng ký + ca + quyền phỏng vấn + sổ thư, và gửi thư xác nhận lịch cho
 * mentor. Cùng cổng với gửi thư hàng loạt (quản trị viên, vận hành đúng mùa):
 * đây là thư tới hàng chục người thật một lúc.
 *
 * Mỗi lần xem và mỗi lần gửi đều đọc lại sheet và sổ thư từ đầu — không tin danh
 * sách lấy từ trình duyệt gửi lên. Người đã nhận thư của đợt này (ghi sổ theo ca
 * đầu tiên của đợt) không nhận lần hai.
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

/** Người có quyền vào vòng phỏng vấn mùa này (cùng nguồn với ô "Người phỏng vấn"), kèm SĐT để khớp dự phòng. */
async function readParticipants(client: any, seasonId: string): Promise<Participant[] | null> {
  const { data, error } = await client.rpc("vam084_list_recruitment_participants", {
    p_season_id: seasonId,
    p_review_stage: "interview"
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
  return rows.map((r) => ({ ...r, phone: phoneByEmail.get(r.email) ?? "" }));
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

async function buildPlan(gate: Extract<Gate, { ok: true }>, link: unknown): Promise<{ ok: true; plan: ConfirmationPlan } | { ok: false; message: string }> {
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

  // Không đọc được quyền hay sổ thư thì dừng: đoán "chưa ai nhận" là gửi trùng,
  // đoán "ai cũng có quyền" là gửi tài khoản không vào được.
  const participants = await readParticipants(gate.client, gate.seasonId);
  if (!participants) return { ok: false, message: SAFE_ERROR };
  const sent = await readAlreadySent(gate.client, anchor.sessionId);
  if (!sent) return { ok: false, message: SAFE_ERROR };

  const origin = (await getPublicOrigin()) ?? "https://os.alumni-mentoring.edu.vn";
  return {
    ok: true,
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

function render(plan: ConfirmationPlan, r: PlannedRecipient) {
  return renderConfirmation({
    name: r.name,
    loginEmail: r.loginEmail ?? r.email,
    matchedBy: r.matchedBy,
    note: r.note,
    blocks: plan.blocks.filter((b) => r.blockKeys.includes(b.key)),
    origin: plan.origin
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
  const first = built.plan.recipients.find((r) => r.status === "ready") ?? built.plan.recipients.find((r) => r.loginEmail);
  const sample = first ? { to: first.loginEmail ?? first.email, ...render(built.plan, first) } : null;
  return { ok: true, plan: built.plan, sample };
}

/** Bản thử: thư của người đầu tiên sẵn sàng, gửi cho CHÍNH người bấm. Không ghi theo mốc đợt nên không tính là đã gửi. */
export async function sendMentorConfirmationTest(link: unknown): Promise<{ ok: boolean; message: string }> {
  const gate = await authorize();
  if (!gate.ok) return gate;
  if (!gate.actorEmail.includes("@")) return { ok: false, message: "Tài khoản của bạn chưa có email để nhận bản thử." };
  const built = await buildPlan(gate, link);
  if (!built.ok) return built;
  const first = built.plan.recipients.find((r) => r.status === "ready");
  if (!first) return { ok: false, message: "Chưa có mentor nào sẵn sàng để làm bản thử." };
  const mail = render(built.plan, first);
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
  const failed: string[] = [];
  for (const r of ready.slice(0, allowance)) {
    if (Date.now() - started > BULK_TIME_BUDGET_MS) break;
    const mail = render(built.plan, r);
    const result = await sendTemplatedEmail({
      kind: CONFIRMATION_EMAIL_KIND,
      toEmail: r.loginEmail!,
      subject: mail.subject,
      body: mail.body,
      relation: { table: "interview_sessions", id: built.plan.anchorSessionId }
    });
    if (result.skipped) return { ok: false, message: "Môi trường này đang tắt gửi thư — không thư nào đi.", sent, failed, remaining: ready.length - sent };
    if (result.ok) sent++;
    else {
      failed.push(r.loginEmail!);
      // 429: Brevo báo hết hạn mức ngày — dừng ngay, đừng đốt phần còn lại từng lỗi một.
      if (result.providerStatus === 429) break;
    }
  }
  const remaining = ready.length - sent - failed.length;
  const parts = [`Đã gửi ${sent}/${ready.length} thư.`];
  if (failed.length) parts.push(`${failed.length} thư lỗi — bấm gửi lại để thử tiếp đúng những người này.`);
  if (remaining > 0) parts.push(`Còn ${remaining} người chưa gửi (hết thời gian một lượt) — bấm gửi tiếp.`);
  return { ok: true, message: parts.join(" "), sent, failed, remaining };
}
