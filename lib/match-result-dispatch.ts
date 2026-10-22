import "server-only";

/**
 * Gửi thư kết quả ghép cặp mùa 12 (BTC 22/10/2026).
 *
 * Khuôn là bộ gửi Vòng 2 (lib/matching-round2-dispatch.ts), vốn đã chạy thật: CLAIM nguyên tử trước khi
 * gửi để hai tab bấm cùng lúc không ai nhận hai thư, dừng ngay khi nhà cung cấp báo 429, nhả mọi claim
 * chưa gửi, dùng chung trần 1.000 thư/24 giờ và phần chừa 80 thư cho các thư khác.
 *
 * Khác Vòng 2 ở ba chỗ:
 *   1. Lô cắt theo NHÓM MENTOR (BTC 22/10): mentor và mọi mentee của họ đi cùng một lần bấm, để hai bên
 *      của một cặp nhận thư cùng ngày — cả mùa cần ~1.150 thư, quá hạn mức một ngày.
 *   2. Link hồ sơ tạo mã MỚI ngay trước khi gửi từng thư; chỉ sha256 của mã được ghi, mã gốc chỉ nằm
 *      trong thư. Ghi hash TRƯỚC khi gửi: người nhận bấm ngay vẫn mở được.
 *   3. Trước khi gửi một người đã có dòng thông báo, tra sổ thư: đã có thư "sent" cho dòng đó (lần trước
 *      gửi xong nhưng chưa kịp chốt) thì chỉ chốt — gửi lại sẽ tạo mã mới và làm chết link thư trước.
 */
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { mintBearerToken } from "@/lib/bearer-token";
import { sendMatchResultMentee, sendMatchResultMentor, type SendEmailResult } from "@/lib/email";
import { loadMatchResultState, type MatchResultState } from "@/lib/match-result";
import {
  HOLD_REASON_LABELS,
  RECIPIENT_STATUS_LABELS,
  batchSize,
  dispatchGroups,
  findMentorRecipient,
  normalizeEmail,
  planDispatchBatch,
  type MatchResultRecipient
} from "@/lib/match-result-core";
import { round2Operator, round2SeasonContext } from "@/lib/matching-round2";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import {
  DAILY_EMAIL_LIMIT,
  DISPATCH_RESERVE,
  DISPATCH_STALE_CLAIM_MS,
  DISPATCH_TIME_BUDGET_MS,
  dispatchAllowance
} from "@/lib/mentee-invite-dispatch-core";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { getPublicOrigin } from "@/lib/public-url";

type Row = Record<string, any>;
const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";
const DENIED = "Bạn không có quyền vận hành ghép cặp mùa này.";

export type MatchResultSendResult = { ok: boolean; message: string; sent: number; failed: number };

function log(message: string, error?: unknown) {
  const detail = error && typeof error === "object" ? (error as { message?: unknown; code?: unknown }) : null;
  console.error(`[match-result-dispatch] ${message}`, detail ? { code: detail.code, message: detail.message } : error ?? "");
}

const key = (r: { role: string; personId: string }) => `${r.role}:${r.personId}`;

async function readNotices(client: any, seasonId: string): Promise<Map<string, Row>> {
  const res = await readAllPages<Row>(
    "match_result_notices",
    "id,person_id,role,claimed_at,sent_at,send_count",
    (columns) => client.from("match_result_notices").select(columns).eq("season_id", seasonId)
  );
  if (res.error) throw res.error;
  return new Map(res.data.map((n) => [`${n.role}:${n.person_id}`, n]));
}

/** Dòng thông báo cho từng người — ignoreDuplicates: không bao giờ đè dòng đang có. */
async function ensureNotices(client: any, seasonId: string, people: readonly MatchResultRecipient[]) {
  const { error } = await client.from("match_result_notices").upsert(
    people.map((r) => ({ season_id: seasonId, person_id: r.personId, role: r.role })),
    { onConflict: "season_id,person_id,role", ignoreDuplicates: true }
  );
  if (error) throw error;
}

/** Dòng thông báo đã có thư "sent"/"queued" trong sổ thư. Đọc lỗi thì ném: không biết thì không gửi. */
async function alreadyMailed(client: any, noticeIds: string[]): Promise<Set<string>> {
  if (!noticeIds.length) return new Set();
  const res = await readAllPagesIn<Row>(client, "outbound_emails", "related_id", noticeIds, "id,related_id,status", (q: any) =>
    q.eq("related_table", "match_result_notices").in("status", ["sent", "queued"])
  );
  if (res.error) throw res.error;
  return new Set(res.data.map((r) => String(r.related_id)));
}

/**
 * Tạo mã mới cho từng link hồ sơ trong thư của một người và ghi hash (một chiều của mỗi cặp một dòng,
 * gửi lại là thay hash của chính dòng đó — link trong thư cũ hết hiệu lực). Trả mã gốc theo thứ tự
 * người đồng hành, chỉ để đưa vào thư.
 */
async function issueProfileLinks(client: any, seasonId: string, r: MatchResultRecipient, rotate: boolean): Promise<string[]> {
  const subjectRole = r.role === "mentor" ? "mentee" : "mentor";
  const minted = r.partners.map(() => mintBearerToken());
  const now = new Date().toISOString();
  const { error } = await client.from("match_profile_links").upsert(
    r.partners.map((p, i) => ({
      season_id: seasonId,
      match_id: p.matchId,
      subject_role: subjectRole,
      viewer_person_id: r.personId,
      subject_person_id: p.personId,
      token_hash: minted[i].tokenHash,
      revoked_at: null,
      ...(rotate ? { rotated_at: now } : {})
    })),
    { onConflict: "match_id,subject_role" }
  );
  if (error) throw error;
  return minted.map((m) => m.token);
}

async function sendOne(
  r: MatchResultRecipient,
  tokens: string[],
  state: MatchResultState,
  noticeId: string,
  requestOrigin: string | null
): Promise<SendEmailResult> {
  const kickoffRegisterUrl = state.settings?.kickoffRegisterUrl ?? null;
  if (r.role === "mentor") {
    return sendMatchResultMentor({
      toEmail: r.email!,
      mentorName: r.fullName ?? "",
      mentees: r.partners.map((p, i) => ({ name: p.fullName ?? "", token: tokens[i] })),
      kickoffRegisterUrl,
      noticeId,
      requestOrigin
    });
  }
  return sendMatchResultMentee({
    toEmail: r.email!,
    menteeName: r.fullName ?? "",
    mentorName: r.partners[0]?.fullName ?? "",
    mentorToken: tokens[0],
    kickoffRegisterUrl,
    noticeId,
    requestOrigin
  });
}

/** Thư mentee chỉ mang một link mentor. Mentee hai cặp (đối chiếu 22/10 ra 0) để BTC xử lý tay. */
function unsendableReason(r: MatchResultRecipient): string | null {
  if (!r.email) return "Thiếu email.";
  if (!r.partners.length) return "Không còn cặp nào.";
  if (r.role === "mentee" && r.partners.length > 1) return "Mentee có hơn một cặp — BTC xử lý tay.";
  return null;
}

export async function runMatchResultDispatch(input: { now?: () => number } = {}): Promise<MatchResultSendResult> {
  const now = input.now ?? Date.now;
  const fail = (message: string): MatchResultSendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail(DENIED);
    const startedMs = now();
    const stamp = new Date(startedMs).toISOString();

    const state = await loadMatchResultState(client, seasonId, startedMs);
    if (state.blocked.length) return fail(state.blocked.join(" "));

    const sentInWindow = await countSentInWindow(client, startedMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    const allowance = dispatchAllowance(sentInWindow);
    const groups = dispatchGroups(state.recipients);
    if (!groups.length) return { ok: true, message: "Không còn ai chờ thư kết quả.", sent: 0, failed: 0 };
    if (allowance === 0) {
      return {
        ok: true,
        message: `Đã chạm phần hạn mức: cả hệ thống đã gửi ${sentInWindow}/${DAILY_EMAIL_LIMIT} thư trong 24 giờ qua, ${DISPATCH_RESERVE} thư chừa cho các thư khác. Thử lại sau vài giờ.`,
        sent: 0,
        failed: 0
      };
    }
    const plan = planDispatchBatch(groups, allowance);
    if (!plan.length) {
      return { ok: true, message: `Phần hạn mức còn ${allowance} thư, không đủ cho trọn một nhóm mentor. Thử lại sau vài giờ.`, sent: 0, failed: 0 };
    }
    const planned = plan.flatMap((g) => g.members);

    const staleIso = new Date(startedMs - DISPATCH_STALE_CLAIM_MS).toISOString();
    const { error: staleError } = await client
      .from("match_result_notices")
      .update({ claimed_at: null })
      .eq("season_id", seasonId)
      .is("sent_at", null)
      .lt("claimed_at", staleIso);
    if (staleError) log("stale release failed", staleError);

    await ensureNotices(client, seasonId, planned);
    const notices = await readNotices(client, seasonId);
    const candidateIds = planned
      .map((r) => notices.get(key(r)))
      .filter((n): n is Row => Boolean(n) && !n!.claimed_at && !n!.sent_at)
      .map((n) => String(n.id));
    if (!candidateIds.length) return { ok: true, message: "Không còn ai chờ thư ở lượt này — có thể một lượt gửi khác đang chạy.", sent: 0, failed: 0 };

    const { data: claimedRows, error: claimError } = await client
      .from("match_result_notices")
      .update({ claimed_at: stamp })
      .in("id", candidateIds)
      .is("claimed_at", null)
      .is("sent_at", null)
      .select("id");
    if (claimError) {
      log("claim failed", claimError);
      return fail(SAFE_ERROR);
    }
    const claimed = new Set(((claimedRows ?? []) as Row[]).map((r) => String(r.id)));
    const release = async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await client.from("match_result_notices").update({ claimed_at: null }).in("id", ids).eq("claimed_at", stamp);
      if (error) log("release failed", error);
    };

    let mailed: Set<string>;
    try {
      mailed = await alreadyMailed(client, Array.from(claimed));
    } catch (error) {
      log("outbound check failed", error);
      await release(Array.from(claimed));
      return fail("Không đọc được sổ thư để kiểm thư đã gửi, nên chưa gửi.");
    }

    const requestOrigin = await getPublicOrigin();
    let sent = 0;
    let failed = 0;
    let settled = 0;
    let stopped429 = false;
    const leftover: string[] = [];

    const finalize = async (noticeId: string, r: MatchResultRecipient, count: number | null) => {
      const nowIso = new Date().toISOString();
      const { error } = await client
        .from("match_result_notices")
        .update({ sent_at: nowIso, last_sent_at: nowIso, send_count: count ?? 1, match_ids: r.matchIds, last_error: null, claimed_at: null })
        .eq("id", noticeId)
        .eq("claimed_at", stamp);
      if (error) log("finalize failed", error);
    };

    for (const group of plan) {
      // Hết giờ hoặc bị 429 thì dừng TRƯỚC một nhóm, không giữa nhóm: hai bên một cặp đi cùng nhau.
      const stop = stopped429 || now() - startedMs > DISPATCH_TIME_BUDGET_MS;
      for (const r of group.members) {
        const notice = notices.get(key(r));
        const id = notice ? String(notice.id) : null;
        if (!id || !claimed.has(id)) continue;
        if (stop || stopped429) {
          leftover.push(id);
          continue;
        }
        const count = (Number(notice!.send_count) || 0) + 1;
        if (mailed.has(id)) {
          await finalize(id, r, count);
          settled += 1;
          continue;
        }
        const problem = unsendableReason(r);
        let outcome: SendEmailResult;
        if (problem) {
          outcome = { ok: false, skipped: false, reason: problem };
        } else {
          try {
            const tokens = await issueProfileLinks(client, seasonId, r, false);
            outcome = await sendOne(r, tokens, state, id, requestOrigin);
          } catch (error) {
            log("send crashed", error);
            outcome = { ok: false, skipped: false, reason: "Không tạo được link hồ sơ hoặc gửi lỗi." };
          }
        }
        if (outcome.ok && !outcome.skipped) {
          sent += 1;
          await finalize(id, r, count);
        } else {
          // Bị cổng gửi thư chặn (môi trường thử) thì KHÔNG tính lỗi; lỗi thật thì ghi lại.
          if (!outcome.skipped) failed += 1;
          if (outcome.providerStatus === 429) stopped429 = true;
          const { error } = await client
            .from("match_result_notices")
            .update({ claimed_at: null, last_error: (outcome.reason ?? "Gửi thất bại").slice(0, 500) })
            .eq("id", id)
            .eq("claimed_at", stamp);
          if (error) log("release failed", error);
        }
      }
    }
    await release(leftover);

    const left = Math.max(0, batchSize(groups) - sent - settled);
    if (stopped429) {
      return { ok: true, message: `Đã gửi ${sent} thư rồi nhà cung cấp báo chạm trần. Còn ${left} người chờ thư — bấm lại sau vài giờ.`, sent, failed };
    }
    const parts = [`Đã gửi ${sent} thư kết quả (${plan.length} nhóm mentor).`];
    if (settled) parts.push(`${settled} người đã có thư trong sổ từ lần trước — chỉ ghi nhận, không gửi lại.`);
    if (failed) parts.push(`${failed} thư lỗi, xem cột Trạng thái hoặc Vận hành → Mail → Nhật ký gửi.`);
    if (left) parts.push(`Còn ${left} người chờ thư — bấm lại để gửi tiếp.`);
    return { ok: true, message: parts.join(" "), sent, failed };
  } catch (error) {
    log("dispatch failed", error);
    return fail(SAFE_ERROR);
  }
}

/**
 * Gửi thử cho chính BTC đang bấm: một thư mentee và một thư mentor (2 mentee ví dụ). Link hồ sơ là câu
 * giữ chỗ — không mã nào được tạo, không dòng nào được ghi. Gửi được cả khi chưa đủ điều kiện gửi thật,
 * để BTC soát chữ trước.
 */
export async function sendMatchResultTest(nowMs = Date.now()): Promise<MatchResultSendResult> {
  const fail = (message: string): MatchResultSendResult => ({ ok: false, message, sent: 0, failed: 0 });
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail(DENIED);
    const actor = await getCurrentAdminUser();
    if (!actor?.email) return fail("Cần đăng nhập.");
    const sentInWindow = await countSentInWindow(client, nowMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    if (sentInWindow + 2 > DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");
    const state = await loadMatchResultState(client, seasonId, nowMs);
    const settings = state.settings;
    const requestOrigin = await getPublicOrigin();
    const name = String(actor.full_name ?? "").trim();
    const results = [
      await sendMatchResultMentee({
        toEmail: actor.email,
        menteeName: name || "(tên Mentee)",
        mentorName: "(tên Mentor đồng hành)",
        mentorToken: null,
        kickoffRegisterUrl: settings?.kickoffRegisterUrl ?? null,
        noticeId: null,
        requestOrigin,
        testFor: "mentee mẫu"
      }),
      await sendMatchResultMentor({
        toEmail: actor.email,
        mentorName: name || "(tên Mentor)",
        mentees: [
          { name: "(tên Mentee 1)", token: null },
          { name: "(tên Mentee 2)", token: null }
        ],
        kickoffRegisterUrl: settings?.kickoffRegisterUrl ?? null,
        noticeId: null,
        requestOrigin,
        testFor: "mentor mẫu"
      })
    ];
    if (results.some((r) => r.skipped)) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
    const ok = results.filter((r) => r.ok).length;
    if (ok < 2) return fail(`Gửi thư thử chưa trọn (${ok}/2 thư). Xem Vận hành → Mail → Nhật ký gửi.`);
    return { ok: true, message: `Đã gửi 2 thư thử (bản mentee và bản mentor) tới ${actor.email}.`, sent: 2, failed: 0 };
  } catch (error) {
    log("test send failed", error);
    return fail(SAFE_ERROR);
  }
}

/** Email của một tài khoản nhân sự đang hoạt động. Đọc lỗi thì ném: không biết thì không gửi. */
async function isActiveStaffEmail(client: any, email: string): Promise<boolean> {
  const res = await readAllPages<Row>("admin_users", "id,email,status", (columns) =>
    client.from("admin_users").select(columns).eq("status", "active")
  );
  if (res.error) throw res.error;
  return res.data.some((u) => normalizeEmail(u.email) === email);
}

/**
 * Gửi thử đúng các lá thư của MỘT nhóm mentor — thư của mentor và thư của từng mentee của họ (BTC
 * 22/10/2026: team support xem trước thư thật trước khi gửi hàng loạt). Chữ, tên, link Handbook và
 * Kick-off như thư thật; link hồ sơ là câu giữ chỗ, không mã nào được tạo, không dòng nào được ghi.
 *
 * Gửi tới người bấm, hoặc tới email của một tài khoản nhân sự đang hoạt động — KHÔNG BAO GIỜ tới mentor
 * hay mentee: ô "gửi tới" là thứ người bấm tự gõ được. Gửi được cả khi chưa đủ điều kiện gửi thật và cả
 * với mentor đang bị giữ, vì đây chỉ là bản xem trước.
 */
export async function sendMatchResultGroupTest(input: { mentor: unknown; toEmail?: unknown }, nowMs = Date.now()): Promise<MatchResultSendResult> {
  const fail = (message: string): MatchResultSendResult => ({ ok: false, message, sent: 0, failed: 0 });
  const typedTarget = String(input.toEmail ?? "").trim();
  const target = typedTarget ? normalizeEmail(typedTarget) : null;
  if (typedTarget && !target) return fail("Email người nhận thư thử không hợp lệ.");
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail(DENIED);
    const actor = await getCurrentAdminUser();
    const actorEmail = normalizeEmail(actor?.email);
    if (!actorEmail) return fail("Cần đăng nhập.");
    const toEmail = target ?? actorEmail;
    if (toEmail !== actorEmail && !(await isActiveStaffEmail(client, toEmail))) {
      return fail(`${toEmail} không phải tài khoản nhân sự đang hoạt động trên VAM OS — thư thử chỉ gửi cho nhân sự.`);
    }

    const state = await loadMatchResultState(client, seasonId, nowMs);
    const found = findMentorRecipient(state.recipients, input.mentor);
    if (!found.ok) return fail(found.message);
    const mentor = found.mentor;
    const count = 1 + mentor.partners.length;
    const sentInWindow = await countSentInWindow(client, nowMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    if (sentInWindow + count > DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");

    const requestOrigin = await getPublicOrigin();
    const kickoffRegisterUrl = state.settings?.kickoffRegisterUrl ?? null;
    const mentorName = mentor.fullName ?? "";
    const results = [
      await sendMatchResultMentor({
        toEmail,
        mentorName,
        mentees: mentor.partners.map((p) => ({ name: p.fullName ?? "", token: null })),
        kickoffRegisterUrl,
        noticeId: null,
        requestOrigin,
        testFor: `mentor ${mentorName}`
      })
    ];
    for (const p of mentor.partners) {
      results.push(
        await sendMatchResultMentee({
          toEmail,
          menteeName: p.fullName ?? "",
          mentorName,
          mentorToken: null,
          kickoffRegisterUrl,
          noticeId: null,
          requestOrigin,
          testFor: `mentee ${p.fullName ?? ""}`
        })
      );
    }
    if (results.some((r) => r.skipped)) return fail("Môi trường này đang tắt gửi thư — thư thử chưa đi.");
    const ok = results.filter((r) => r.ok).length;
    if (ok < count) return fail(`Gửi thư thử chưa trọn (${ok}/${count} thư). Xem Vận hành → Mail → Nhật ký gửi.`);
    return {
      ok: true,
      message: `Đã gửi ${count} thư thử tới ${toEmail}: thư của mentor ${mentorName} và ${mentor.partners.length} mentee (${mentor.partners.map((p) => p.fullName).join(", ")}).`,
      sent: count,
      failed: 0
    };
  } catch (error) {
    log("group test send failed", error);
    return fail(SAFE_ERROR);
  }
}

const RESENDABLE = new Set(["pending", "sent", "changed_since_sent"]);

/**
 * Gửi riêng một người — dùng để thí điểm (một cặp BTC quen) và để gửi lại khi cặp đổi sau khi gửi.
 * Luôn tạo mã MỚI: link trong thư trước của người này hết hiệu lực. Không tra sổ thư — gửi lại là ý định.
 */
export async function resendMatchResultNotice(input: { personId: unknown; role: unknown }, nowMs = Date.now()): Promise<MatchResultSendResult> {
  const fail = (message: string): MatchResultSendResult => ({ ok: false, message, sent: 0, failed: 0 });
  const personId = String(input.personId ?? "").trim();
  const role = input.role === "mentor" || input.role === "mentee" ? input.role : null;
  if (!role || !/^[0-9a-f-]{36}$/i.test(personId)) return fail("Dữ liệu không hợp lệ — tải lại trang rồi thử lại.");
  try {
    const { client, seasonId } = await round2SeasonContext();
    if (!(await round2Operator(seasonId))) return fail(DENIED);
    const state = await loadMatchResultState(client, seasonId, nowMs);
    if (state.blocked.length) return fail(state.blocked.join(" "));
    const r = state.recipients.find((x) => x.role === role && x.personId === personId);
    if (!r) return fail("Người này không có cặp nào đang hoạt động.");
    if (!RESENDABLE.has(r.status)) {
      const why = r.holdReason ? HOLD_REASON_LABELS[r.holdReason] : RECIPIENT_STATUS_LABELS[r.status];
      return fail(`Chưa gửi được: ${why}.`);
    }
    const problem = unsendableReason(r);
    if (problem) return fail(problem);
    const sentInWindow = await countSentInWindow(client, nowMs);
    if (sentInWindow === null) return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa gửi.");
    if (sentInWindow >= DAILY_EMAIL_LIMIT) return fail("Đã chạm hạn mức thư trong 24 giờ. Thử lại sau vài giờ.");

    await ensureNotices(client, seasonId, [r]);
    const notice = (await readNotices(client, seasonId)).get(key(r));
    if (!notice) return fail(SAFE_ERROR);
    const stamp = new Date(nowMs).toISOString();
    const { data: claimedRows, error: claimError } = await client
      .from("match_result_notices")
      .update({ claimed_at: stamp })
      .eq("id", notice.id)
      .is("claimed_at", null)
      .select("id");
    if (claimError) throw claimError;
    if (!claimedRows?.length) return fail("Thư của người này đang được gửi ở một lượt khác — thử lại sau ít phút.");

    let outcome: SendEmailResult;
    try {
      const tokens = await issueProfileLinks(client, seasonId, r, Boolean(notice.sent_at));
      outcome = await sendOne(r, tokens, state, String(notice.id), await getPublicOrigin());
    } catch (error) {
      log("resend crashed", error);
      outcome = { ok: false, skipped: false, reason: "Không tạo được link hồ sơ hoặc gửi lỗi." };
    }
    const nowIso = new Date().toISOString();
    if (outcome.ok && !outcome.skipped) {
      const { error } = await client
        .from("match_result_notices")
        .update({
          sent_at: notice.sent_at ?? nowIso,
          last_sent_at: nowIso,
          send_count: (Number(notice.send_count) || 0) + 1,
          match_ids: r.matchIds,
          last_error: null,
          claimed_at: null
        })
        .eq("id", notice.id)
        .eq("claimed_at", stamp);
      if (error) log("resend finalize failed", error);
      const tail = notice.sent_at ? " Link trong thư trước đã hết hiệu lực." : "";
      return { ok: true, message: `Đã gửi thư kết quả tới ${r.fullName ?? r.email}.${tail}`, sent: 1, failed: 0 };
    }
    const { error } = await client
      .from("match_result_notices")
      .update({ claimed_at: null, last_error: outcome.skipped ? null : (outcome.reason ?? "Gửi thất bại").slice(0, 500) })
      .eq("id", notice.id)
      .eq("claimed_at", stamp);
    if (error) log("resend release failed", error);
    if (outcome.skipped) return fail("Môi trường này đang tắt gửi thư — thư chưa đi.");
    return { ok: false, message: "Gửi không thành công. Xem Vận hành → Mail → Nhật ký gửi.", sent: 0, failed: 1 };
  } catch (error) {
    log("resend failed", error);
    return fail(SAFE_ERROR);
  }
}
