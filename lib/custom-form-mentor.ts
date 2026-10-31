import "server-only";

/**
 * Form tùy chỉnh: "Tự động gửi Submission cho Mentor" (VAM00011) — phần máy chủ.
 *
 * Một cửa cho việc gửi: `dispatchOne`, gọi từ cả lúc mentee gửi form lẫn lượt quét. Cặp được tạo bằng nhiều
 * đường (thủ công, Vòng 2, RPC, import), nên không móc vào từng đường mà quét định kỳ (cron) và nút bấm tay.
 *
 * Luật giữ dữ liệu mentee đúng chỗ:
 *   - nhận diện bằng email khớp ĐÚNG MỘT người; tên không bao giờ được dùng để nhận diện;
 *   - mentor lấy từ cặp active của đúng mùa hiện tại, đọc lại ngay trước khi gửi; hai mentor khác nhau thì
 *     dừng lại cho BTC xử lý (xem pickMentor);
 *   - lỗi đọc database ném ra, không bao giờ biến thành "gửi đại";
 *   - dòng được chiếm (`dang_gui`) TRƯỚC khi gửi, và chỉ một tiến trình chiếm được;
 *   - `da_gui` là điểm cuối: lượt quét không đọc lại, nên mentee đổi mentor sau đó KHÔNG làm thư đi lần hai.
 */
import { AUTO_REPLY_DAILY_CAP_PER_FORM, AUTO_REPLY_SYSTEM_HEADROOM, dedupeEmailField, storedFields, type CustomFormAnswers, type CustomFormField } from "@/lib/custom-form-core";
import {
  MENTOR_CLAIM_STALE_MS,
  MENTOR_SEND_BATCH,
  MENTOR_SEND_MAX_ATTEMPTS,
  MENTOR_SEND_RUN_MS,
  isOpenMentorSend,
  mentorAnswerRows,
  mentorSweepMessage,
  pickMentor,
  type ActiveMatchRow,
  type MentorSendStatus,
  type MentorSweepCounts,
  type MentorSweepStop
} from "@/lib/custom-form-mentor-core";
import { sendCustomFormMentorSubmission } from "@/lib/email";
import { DAILY_EMAIL_LIMIT, QUOTA_WINDOW_MS } from "@/lib/email-quota-core";
import { escapeIlikePattern, normalizeEmail } from "@/lib/identity";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

type Row = Record<string, any>;
type ServiceClient = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

const SENDS = "custom_form_mentor_sends";
const SEND_COLUMNS = "id,response_id,form_id,mentee_email,mentee_person_id,mentor_person_id,match_id,status,attempts,last_error,claimed_at,sent_at,updated_at";
const FORM_COLUMNS = "id,title,fields,event_id,mentor_forward,mentor_forward_subject,mentor_forward_body,mentor_forward_since";
const MAIL_KIND = "custom_form_mentor_submission";

function log(message: string, error?: unknown) {
  console.error(`[custom-form-mentor] ${message}`, error instanceof Error ? error.message : (error as { message?: string })?.message ?? error ?? "");
}

/** Trạng thái một lượt: hạn mức đọc một lần rồi trừ dần, người và cặp đọc một lần cho cả lượt. */
type Run = {
  client: ServiceClient;
  nowMs: number;
  seasonId: string | null;
  /** Có giá trị = lượt quét đã nạp sẵn cặp của cả mùa; null = lần gửi lẻ, tra đúng một người. */
  matches: ActiveMatchRow[] | null;
  people: Map<string, Row>;
  systemLeft: number | null;
  formLeft: Map<string, number>;
  attempted: number;
  stop: MentorSweepStop;
  counts: MentorSweepCounts;
};

const newRun = (client: ServiceClient, nowMs: number): Run => ({
  client,
  nowMs,
  seasonId: null,
  matches: null,
  people: new Map(),
  systemLeft: null,
  formLeft: new Map(),
  attempted: 0,
  stop: null,
  counts: { sent: 0, waiting: 0, unknown: 0, failed: 0 }
});

async function seasonIdOf(run: Run): Promise<string> {
  if (run.seasonId) return run.seasonId;
  const { data, error } = await run.client.from("seasons").select("id").eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("SEASON_UNAVAILABLE");
  run.seasonId = String((data as Row).id);
  return run.seasonId;
}

/** Cửa nhận diện mentee. Hai hồ sơ cùng email thì không đoán: chọn sai là gửi cho mentor của người khác. */
async function findMentee(client: ServiceClient, email: string): Promise<{ kind: "one"; id: string } | { kind: "none" | "many" }> {
  const wanted = normalizeEmail(email);
  if (!wanted) return { kind: "none" };
  const { data, error } = await client.from("people").select("id,email_primary").ilike("email_primary", escapeIlikePattern(wanted)).limit(20);
  if (error) throw error;
  const hits = ((data ?? []) as Row[]).filter((p) => normalizeEmail(p.email_primary) === wanted);
  if (hits.length === 0) return { kind: "none" };
  return hits.length === 1 ? { kind: "one", id: String(hits[0].id) } : { kind: "many" };
}

async function activeMatchesOf(run: Run, menteePersonId: string): Promise<ActiveMatchRow[]> {
  if (run.matches) return run.matches.filter((m) => String(m.mentee_person_id) === menteePersonId);
  const { data, error } = await run.client
    .from("matches")
    .select("id,mentor_person_id,mentee_person_id")
    .eq("season_id", await seasonIdOf(run))
    .eq("status", "active")
    .eq("mentee_person_id", menteePersonId);
  if (error) throw error;
  return (data ?? []) as Row[];
}

async function personOf(run: Run, id: string): Promise<Row | null> {
  const cached = run.people.get(id);
  if (cached) return cached;
  const { data, error } = await run.client.from("people").select("id,full_name,email_primary").eq("id", id).maybeSingle();
  if (error) throw error;
  if (data) run.people.set(id, data as Row);
  return (data as Row | null) ?? null;
}

/**
 * Còn được gửi một thư của form này không. Bản đang chờ không mất gì khi hụt hạn mức (khác thư tự động của
 * người điền): dòng giữ nguyên và đi ở lượt sau. Không đếm được thì coi như hết: gửi mù vào hạn mức chung là
 * đúng rủi ro mà trần này tồn tại để tránh.
 */
async function reserveQuota(run: Run, formId: string): Promise<boolean> {
  if (run.systemLeft === null) {
    const sent = await countSentInWindow(run.client, run.nowMs);
    run.systemLeft = sent === null ? 0 : DAILY_EMAIL_LIMIT - AUTO_REPLY_SYSTEM_HEADROOM - sent;
  }
  let formLeft = run.formLeft.get(formId);
  if (formLeft === undefined) {
    const { count, error } = await run.client
      .from(SENDS)
      .select("id", { count: "exact", head: true })
      .eq("form_id", formId)
      .eq("status", "da_gui")
      .gte("sent_at", new Date(run.nowMs - QUOTA_WINDOW_MS).toISOString());
    formLeft = error ? 0 : AUTO_REPLY_DAILY_CAP_PER_FORM - Number(count ?? 0);
    if (error) log("form cap read failed", error);
    run.formLeft.set(formId, formLeft);
  }
  if (run.systemLeft <= 0 || formLeft <= 0) return false;
  run.systemLeft -= 1;
  run.formLeft.set(formId, formLeft - 1);
  return true;
}

type Job = { id: string; status: MentorSendStatus; attempts: number; menteeEmail: string; menteePersonId: string | null; lastError: string | null };

const toJob = (row: Row): Job => ({
  id: String(row.id),
  status: String(row.status) as MentorSendStatus,
  attempts: Number(row.attempts ?? 0),
  menteeEmail: String(row.mentee_email ?? ""),
  menteePersonId: row.mentee_person_id ? String(row.mentee_person_id) : null,
  lastError: row.last_error ? String(row.last_error) : null
});

/**
 * Xử lý một bản: nhận diện, tìm mentor, chiếm dòng, gửi, chốt. Mọi lệnh ghi đều kèm trạng thái đã đọc, nên
 * dòng do tiến trình khác vừa đổi sẽ không bị đè. Lỗi đọc ném ra cho bên gọi: chưa gửi gì, dòng còn nguyên.
 */
async function dispatchOne(run: Run, form: Row, fields: CustomFormField[], answers: CustomFormAnswers, job: Job): Promise<void> {
  const { client, nowMs } = run;
  const nowIso = new Date(nowMs).toISOString();
  const note = async (patch: Row) => {
    const { error } = await client.from(SENDS).update({ ...patch, updated_at: nowIso }).eq("id", job.id).eq("status", job.status);
    if (error) throw error;
    job.status = (patch.status ?? job.status) as MentorSendStatus;
    if ("last_error" in patch) job.lastError = patch.last_error;
  };
  const fail = async (reason: string) => {
    if (job.status !== "loi" || job.lastError !== reason) await note({ status: "loi", last_error: reason });
    run.counts.failed += 1;
  };

  let menteeId = job.menteePersonId;
  if (!menteeId) {
    const found = await findMentee(client, job.menteeEmail);
    if (found.kind !== "one") {
      const reason = found.kind === "many" ? "Email này khớp nhiều hồ sơ, cần BTC gộp lại." : "Email không khớp hồ sơ nào trên hệ thống.";
      if (job.status !== "khong_nhan_ra" || job.lastError !== reason) await note({ status: "khong_nhan_ra", last_error: reason });
      run.counts.unknown += 1;
      return;
    }
    menteeId = found.id;
    await note({ mentee_person_id: menteeId, status: "cho_ghep_cap", last_error: null });
  }

  const pick = pickMentor(await activeMatchesOf(run, menteeId));
  if (pick.kind === "none") {
    // Lỗi cũ (vd. hai mentor) đã hết vì cặp bị kết thúc: dòng trở lại đúng là đang chờ.
    if (job.status !== "cho_ghep_cap") await note({ status: "cho_ghep_cap", mentor_person_id: null, match_id: null, last_error: null });
    run.counts.waiting += 1;
    return;
  }
  if (pick.kind === "many") return fail(`Mentee đang có ${pick.count} mentor ở các cặp active, cần BTC xem lại cặp. Chưa gửi cho ai.`);

  const [mentor, mentee] = await Promise.all([personOf(run, pick.mentorPersonId), personOf(run, menteeId)]);
  const mentorEmail = normalizeEmail(mentor?.email_primary);
  if (!mentorEmail) return fail("Mentor chưa có email trên hệ thống.");

  if (!(await reserveQuota(run, String(form.id)))) {
    run.stop = "quota";
    return;
  }

  const previous = job.status;
  const { data: claimed, error: claimError } = await client
    .from(SENDS)
    .update({ status: "dang_gui", claimed_at: nowIso, mentor_person_id: pick.mentorPersonId, match_id: pick.matchId, updated_at: nowIso })
    .eq("id", job.id)
    .eq("status", previous)
    .select("id");
  if (claimError) throw claimError;
  if (!claimed?.length) return;
  run.attempted += 1;

  const settle = async (patch: Row) => {
    const { error } = await client.from(SENDS).update({ ...patch, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "dang_gui");
    // Dòng kẹt ở dang_gui sẽ được settleStale xử lý; không thử lại ở đây để khỏi che mất lỗi database.
    if (error) log("settle failed", error);
  };

  let outcome: Awaited<ReturnType<typeof sendCustomFormMentorSubmission>>;
  try {
    outcome = await sendCustomFormMentorSubmission({
      toEmail: mentorEmail,
      sendId: job.id,
      formId: String(form.id),
      formTitle: String(form.title ?? ""),
      subject: String(form.mentor_forward_subject ?? ""),
      body: String(form.mentor_forward_body ?? ""),
      menteeName: String(mentee?.full_name ?? ""),
      answers: mentorAnswerRows(fields, answers)
    });
  } catch (error) {
    log("send crashed", error);
    outcome = { ok: false, skipped: false, reason: "Gửi thất bại" };
  }
  if (outcome.skipped) {
    // Môi trường tắt thư: chưa có gì đi, dòng phải về như cũ, và gửi tiếp cũng vô ích.
    await settle({ status: previous });
    run.stop = "mail_off";
    return;
  }
  if (outcome.ok) {
    await settle({ status: "da_gui", sent_at: new Date().toISOString(), last_error: null });
    run.counts.sent += 1;
    return;
  }
  log("send failed", outcome.reason);
  await settle({ status: "loi", attempts: job.attempts + 1, last_error: String(outcome.reason ?? "Gửi thất bại").slice(0, 500) });
  run.counts.failed += 1;
}

/** Ghi dòng theo dõi. Đã có dòng (23505) trả null: tiến trình kia đang lo, chiếm chỗ sẽ quyết định ai gửi. */
async function openRow(client: ServiceClient, formId: string, responseId: string, email: string): Promise<Job | null> {
  const { data, error } = await client
    .from(SENDS)
    .insert({ response_id: responseId, form_id: formId, mentee_email: email, status: "cho_ghep_cap" })
    .select(SEND_COLUMNS)
    .maybeSingle();
  if (error) {
    if ((error as { code?: string }).code === "23505") return null;
    throw error;
  }
  return data ? toJob(data as Row) : null;
}

const emailOf = (fields: CustomFormField[], answers: CustomFormAnswers): string => {
  const field = dedupeEmailField(fields);
  const value = field ? answers[field.id] : undefined;
  return typeof value === "string" ? normalizeEmail(value) : "";
};

/**
 * Sau khi câu trả lời đã GHI xong. Không bao giờ làm hỏng lần gửi của mentee: mọi lỗi chỉ ghi log, và bản
 * chưa xử lý được sẽ do lượt quét nhặt lại nhờ `mentor_forward_since`.
 */
export async function forwardAfterSubmit(client: ServiceClient, form: Row, fields: CustomFormField[], answers: CustomFormAnswers, responseId: string | null, nowMs: number): Promise<void> {
  try {
    if (form.mentor_forward !== true || !responseId) return;
    const job = await openRow(client, String(form.id), responseId, emailOf(fields, answers));
    if (job) await dispatchOne(newRun(client, nowMs), form, fields, answers, job);
  } catch (error) {
    log("forward failed", error);
  }
}

/**
 * Dòng `dang_gui` quá lâu: tiến trình đã chết giữa chừng và không ai biết thư đi chưa. Sổ thư ghi đã gửi thì
 * chốt `da_gui`. Không thấy thì dừng hẳn ở `loi` cho BTC xem, không tự gửi lại: thà BTC gửi tay một bản còn
 * hơn mentor nhận hai lần cùng dữ liệu mentee.
 */
async function settleStale(run: Run, rows: Row[]): Promise<void> {
  const staleBefore = run.nowMs - MENTOR_CLAIM_STALE_MS;
  for (const row of rows) {
    if (row.status !== "dang_gui" || !row.claimed_at || Date.parse(row.claimed_at) >= staleBefore) continue;
    const { count, error } = await run.client
      .from("outbound_emails")
      .select("id", { count: "exact", head: true })
      .eq("kind", MAIL_KIND)
      .eq("related_id", String(row.id))
      .eq("status", "sent");
    if (error) throw error;
    const nowIso = new Date(run.nowMs).toISOString();
    const patch =
      Number(count ?? 0) > 0
        ? { status: "da_gui", sent_at: row.claimed_at, last_error: null }
        : { status: "loi", attempts: MENTOR_SEND_MAX_ATTEMPTS, last_error: "Lượt gửi trước bị ngắt giữa chừng, chưa rõ thư đã đi chưa. Xem Nhật ký gửi trước khi gửi tay." };
    const { error: updateError } = await run.client
      .from(SENDS)
      .update({ ...patch, claimed_at: null, updated_at: nowIso })
      .eq("id", String(row.id))
      .eq("status", "dang_gui")
      .eq("claimed_at", String(row.claimed_at));
    if (updateError) throw updateError;
  }
}

async function sweepForm(run: Run, form: Row, recheckUnknown: boolean, deadlineMs: number): Promise<void> {
  const formId = String(form.id);
  const fields = storedFields(form.fields);
  const [responses, sends] = await Promise.all([
    readAllPages<Row>("custom_form_responses", "id,answers,created_at", (columns) => run.client.from("custom_form_responses").select(columns).eq("form_id", formId)),
    readAllPages<Row>("custom_form_mentor_sends", SEND_COLUMNS, (columns) => run.client.from(SENDS).select(columns).eq("form_id", formId))
  ]);
  if (responses.error) throw responses.error;
  if (sends.error) throw sends.error;
  await settleStale(run, sends.data);

  const tracked = new Set(sends.data.map((s) => String(s.response_id)));
  const since = form.mentor_forward_since ? Date.parse(form.mentor_forward_since) : Number.NaN;
  const jobs = new Map(sends.data.filter((s) => isOpenMentorSend(s, recheckUnknown)).map((s) => [String(s.response_id), toJob(s)]));
  // Lưới đỡ: câu trả lời đã lưu mà dòng theo dõi chưa ghi được. Không bao giờ nhặt bản trước mốc bật.
  for (const response of responses.data) {
    const id = String(response.id);
    if (tracked.has(id) || !(Date.parse(response.created_at) >= since)) continue;
    const job = await openRow(run.client, formId, id, emailOf(fields, (response.answers ?? {}) as CustomFormAnswers));
    if (job) jobs.set(id, job);
  }

  const ordered = responses.data.filter((r) => jobs.has(String(r.id))).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const response of ordered) {
    if (run.attempted >= MENTOR_SEND_BATCH) run.stop = "batch";
    else if (Date.now() >= deadlineMs) run.stop = "time";
    if (run.stop) return;
    await dispatchOne(run, form, fields, (response.answers ?? {}) as CustomFormAnswers, jobs.get(String(response.id)) as Job);
  }
}

async function sweep(run: Run, forms: Row[], recheckUnknown: boolean): Promise<void> {
  const open = forms.filter((f) => f.mentor_forward === true && !f.event_id);
  if (!open.length) return;
  const seasonId = await seasonIdOf(run);
  const matches = await readAllPages<Row>("matches", "id,mentor_person_id,mentee_person_id", (columns) =>
    run.client.from("matches").select(columns).eq("season_id", seasonId).eq("status", "active")
  );
  if (matches.error) throw matches.error;
  run.matches = matches.data;
  const deadlineMs = Date.now() + MENTOR_SEND_RUN_MS;
  for (const form of open) {
    await sweepForm(run, form, recheckUnknown, deadlineMs);
    if (run.stop) return;
  }
}

export type MentorSweepResult = { ok: boolean; message: string; counts: MentorSweepCounts; stop: MentorSweepStop };

const emptyCounts = (): MentorSweepCounts => ({ sent: 0, waiting: 0, unknown: 0, failed: 0 });

/** Lượt quét của cron: mọi form đang bật. Lỗi đọc dừng cả lượt, những gì đã gửi vẫn được ghi nhận. */
export async function runMentorForwardSweep(nowMs = Date.now()): Promise<MentorSweepResult> {
  const client = getSupabaseServiceRoleClient();
  if (!client) return { ok: false, message: "Không kết nối được database.", counts: emptyCounts(), stop: null };
  const run = newRun(client, nowMs);
  try {
    const forms = await readAllPages<Row>("custom_forms", FORM_COLUMNS, (columns) => client.from("custom_forms").select(columns).eq("mentor_forward", true));
    if (forms.error) throw forms.error;
    await sweep(run, forms.data, false);
    return { ok: true, message: mentorSweepMessage(run.counts, run.stop), counts: run.counts, stop: run.stop };
  } catch (error) {
    log("sweep failed", error);
    return { ok: false, message: "Lượt quét dừng vì lỗi đọc database.", counts: run.counts, stop: run.stop };
  }
}

/** Nút trên trang câu trả lời. Quyền kiểm ở lib/custom-forms.ts. Xét lại cả bản "không nhận ra": BTC vừa sửa email thì bấm là đi. */
export async function sweepOneForm(client: ServiceClient, formId: string, nowMs = Date.now()): Promise<MentorSweepResult> {
  const run = newRun(client, nowMs);
  const { data, error } = await client.from("custom_forms").select(FORM_COLUMNS).eq("id", formId).maybeSingle();
  if (error) throw error;
  const form = data as Row | null;
  if (form?.mentor_forward !== true) return { ok: false, message: "Tính năng gửi cho mentor đang tắt ở form này, nên không bản nào được gửi.", counts: run.counts, stop: null };
  await sweep(run, [form], true);
  return { ok: true, message: mentorSweepMessage(run.counts, run.stop), counts: run.counts, stop: run.stop };
}

export type MentorSendView = { responseId: string; status: MentorSendStatus; mentorName: string; sentAt: string | null; lastError: string | null };

/** Trạng thái từng bản cho trang câu trả lời, kèm tên mentor (BTC không tra được từ mã người). */
export async function listMentorSends(client: ServiceClient, formId: string): Promise<MentorSendView[]> {
  const sends = await readAllPages<Row>("custom_form_mentor_sends", SEND_COLUMNS, (columns) => client.from(SENDS).select(columns).eq("form_id", formId));
  if (sends.error) throw sends.error;
  const mentorIds = sends.data.map((s) => String(s.mentor_person_id ?? "")).filter(Boolean);
  const people = await readAllPagesIn<Row>(client, "people", "id", mentorIds, "id,full_name");
  if (people.error) throw people.error;
  const names = new Map(people.data.map((p) => [String(p.id), String(p.full_name ?? "")]));
  return sends.data.map((s) => ({
    responseId: String(s.response_id),
    status: String(s.status) as MentorSendStatus,
    mentorName: names.get(String(s.mentor_person_id ?? "")) ?? "",
    sentAt: s.sent_at ?? null,
    lastError: s.last_error ? String(s.last_error) : null
  }));
}
