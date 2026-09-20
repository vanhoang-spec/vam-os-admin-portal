import "server-only";

/**
 * lib/event-survey.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Khảo sát cuối buổi: trang công khai đọc gì, phiếu nộp lên ghi ra sao, và thư
 * khảo sát đi tới ai.
 *
 * ---------------------------------------------------------------------------
 * NỘP PHIẾU LÀ CHECK OUT — VÀ KHÔNG PHẢI LÀ CHECK IN
 * ---------------------------------------------------------------------------
 * Phiếu ghi một lượt quét ở trạm check out, rồi dừng lại ở đó. Nó KHÔNG đặt
 * `attendance_status = 'checked_in'` như máy quét vẫn làm, và đó là điều quan
 * trọng nhất của file này: căn cứ đề xuất điểm rèn luyện là "có check in VÀ có
 * check out". Nếu phiếu tự đánh dấu check in thì mọi người nộp phiếu đều thành
 * "đủ cả hai", kể cả người chưa từng tới — tức là làm hỏng đúng con số mà buổi
 * này cần.
 *
 * Người nộp phiếu mà chưa có lượt check in nào vẫn được lưu phiếu, và màn hình
 * nói thẳng cho họ biết để báo ban tổ chức điểm danh bù.
 *
 * ---------------------------------------------------------------------------
 * HÀNG ĐỢI GỬI THƯ KHÔNG CHỐT MỘT LẦN
 * ---------------------------------------------------------------------------
 * Khác "Gửi remind": danh sách người nhận được quét LẠI ở mỗi lần gọi, và ai đủ
 * điều kiện mà chưa có dòng thì được xếp thêm vào. Người check in muộn lúc 18:40
 * vì thế vẫn nhận được thư. Ràng buộc `(event_id, registration_id)` là thứ làm
 * việc quét lại an toàn: đã có dòng thì không xếp hàng lần hai, nên không ai
 * nhận hai thư.
 */

import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { readAllPages } from "@/lib/paged-read";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { isValidUuid, requireEventAdmin } from "@/lib/events";
import { findExistingRegistration } from "@/lib/event-registration-match";
import { buildCheckinSteps, checkinStepsOf } from "@/lib/event-checkin-steps";
import { listEventScans } from "@/lib/event-checkin";
import { resolveEmailBaseUrl, sendEventSurvey } from "@/lib/email";
import { getPublicOrigin } from "@/lib/public-url";
import { formatDate } from "@/lib/utils";
import type { Event } from "@/lib/types";
import {
  EMPTY_SURVEY_COUNTS,
  QUESTION_PROMPT,
  SURVEY_CHUNK,
  SURVEY_STALE_SENDING_MS,
  SURVEY_TIME_BUDGET_MS,
  checkoutStationFor,
  countSurveyStates,
  describeSurveyCounts,
  hasEntranceScan,
  impressionQuestion,
  isSurveyRecipient,
  surveyRemaining,
  surveySendBlockReason,
  surveyTotal,
  surveyUrl,
  trackingNotice,
  validateSurveyInput,
  type SurveyAudience,
  type SurveyCounts,
  type SurveyInput,
  type SurveySendResult,
  type SurveySource
} from "@/lib/event-survey-core";

type Json = Record<string, any>;

const SAFE_ERROR = "Không thực hiện được. Vui lòng thử lại; nếu lỗi lặp lại, xem server logs.";
const NO_PERMISSION = "Bạn không có quyền vận hành trong mùa của sự kiện này.";
const STALE_SENDING_ERROR = "Lần gửi bị ngắt giữa chừng — không xác nhận được thư đã đi hay chưa.";
const NOT_ELIGIBLE = "Không còn đủ điều kiện nhận thư lúc gửi (đã huỷ, bị từ chối, hoặc không còn check-in).";

function log(message: string, error?: unknown) {
  const err = error as { code?: string; message?: string } | undefined;
  console.error(
    `[event-survey] ${message}`,
    err ? { code: err.code ?? null, message: err.message ?? String(error) } : ""
  );
}

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function serviceClient(): any | null {
  try {
    return getSupabaseServiceRoleClient();
  } catch (error) {
    log("service client unavailable", error);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Trang công khai
// ───────────────────────────────────────────────────────────────────────────

export type PublicSurveyStatus = "ready" | "not_found" | "inactive" | "not_open" | "closed" | "cancelled" | "error";

export type PublicSurveyData = {
  ok: boolean;
  status: PublicSurveyStatus;
  message: string;
  event: Event | null;
  linkId: string | null;
};

const NOT_FOUND_MESSAGE = "Không tìm thấy phiếu khảo sát này. Kiểm lại đường dẫn hoặc mã QR của ban tổ chức.";

/**
 * Buổi mà một link khảo sát trỏ tới, kèm lý do nếu phiếu đang đóng.
 *
 * Câu chữ riêng chứ không dùng lại `getPublicRegistrationData`: những câu ở đó
 * nói về "đăng ký", và một người cầm điện thoại cuối buổi đọc được "Đăng ký sự
 * kiện đã đóng" sẽ tưởng mình vào nhầm trang.
 */
export async function getPublicSurveyData(token: unknown): Promise<PublicSurveyData> {
  const client = serviceClient();
  if (!client) return { ok: false, status: "error", message: SAFE_ERROR, event: null, linkId: null };

  const cleanToken = clean(token);
  if (!cleanToken || !isValidUuid(cleanToken)) {
    return { ok: false, status: "not_found", message: NOT_FOUND_MESSAGE, event: null, linkId: null };
  }

  const { data, error } = await client
    .from("event_links")
    .select("id,event_id,is_active,opens_at,closes_at,events(*)")
    .eq("token", cleanToken)
    .eq("link_type", "survey")
    .maybeSingle();

  if (error) {
    log("load survey link failed", error);
    return { ok: false, status: "error", message: SAFE_ERROR, event: null, linkId: null };
  }
  if (!data) return { ok: false, status: "not_found", message: NOT_FOUND_MESSAGE, event: null, linkId: null };

  const row = data as Json;
  const event = (Array.isArray(row.events) ? row.events[0] : row.events) as Event | undefined;
  const linkId = String(row.id);
  if (!event) {
    return { ok: false, status: "not_found", message: NOT_FOUND_MESSAGE, event: null, linkId };
  }
  if (String(event.status ?? "") === "cancelled") {
    return { ok: false, status: "cancelled", message: "Buổi này đã huỷ.", event, linkId };
  }
  if (row.is_active === false) {
    return {
      ok: false,
      status: "inactive",
      message: "Phiếu khảo sát này đã đóng. Nếu bạn cần gửi câu trả lời, vui lòng liên hệ ban tổ chức.",
      event,
      linkId
    };
  }

  const now = Date.now();
  const opensAt = row.opens_at ? Date.parse(String(row.opens_at)) : NaN;
  if (Number.isFinite(opensAt) && now < opensAt) {
    return { ok: false, status: "not_open", message: "Phiếu khảo sát chưa mở.", event, linkId };
  }
  const closesAt = row.closes_at ? Date.parse(String(row.closes_at)) : NaN;
  if (Number.isFinite(closesAt) && now > closesAt) {
    return { ok: false, status: "closed", message: "Phiếu khảo sát đã đóng.", event, linkId };
  }

  return { ok: true, status: "ready", message: "Sẵn sàng.", event, linkId };
}

export type SurveySubmitResult = {
  ok: boolean;
  status: "success" | "validation_error" | "link_error" | "server_error";
  message: string;
  field?: keyof SurveyInput;
  /** Khớp được lượt đăng ký nào không — quyết định câu nói với người vừa nộp. */
  matched?: boolean;
  /** Người này đã có lượt quét Check in đầu buổi chưa. */
  checkedIn?: boolean;
};

/**
 * Ghi một phiếu, rồi ghi luôn lượt check out nếu khớp được người.
 *
 * Thứ tự có chủ ý: phiếu được lưu TRƯỚC. Nếu ghi lượt quét hỏng thì câu trả lời
 * của người ta vẫn còn, và ban tổ chức đối chiếu tay được; làm ngược lại thì một
 * lỗi ở bước sau làm mất hẳn phần nội dung — thứ không gõ lại được.
 */
export async function submitEventSurvey(input: {
  token: unknown;
  source: SurveySource;
  values: Partial<SurveyInput>;
}): Promise<SurveySubmitResult> {
  const checked = validateSurveyInput(input.values);
  if (!checked.ok) {
    return { ok: false, status: "validation_error", message: checked.message, field: checked.field };
  }

  const data = await getPublicSurveyData(input.token);
  if (!data.ok || !data.event) {
    return { ok: false, status: "link_error", message: data.message };
  }

  const client = serviceClient();
  if (!client) return { ok: false, status: "server_error", message: SAFE_ERROR };

  const eventId = String(data.event.id);
  const { values, emailNorm, phoneNorm } = checked;

  // Cả danh sách đăng ký của buổi, để đối chiếu bằng email rồi tới số điện thoại
  // — đúng phép đối chiếu mà form đăng ký đang dùng, nên hai nơi không thể hiểu
  // "vẫn là người đó" theo hai kiểu khác nhau.
  const { data: registrations, error: registrationsError } = await readAllPages<{
    id: string;
    email: string | null;
    phone: string | null;
    registration_status: string | null;
  }>("event_registrations", "id,email,phone,registration_status", (projection) =>
    client.from("event_registrations").select(projection).eq("event_id", eventId)
  );
  if (registrationsError) {
    log("load registrations for survey match failed", registrationsError);
    return { ok: false, status: "server_error", message: SAFE_ERROR };
  }

  const match = findExistingRegistration(registrations, { email: values.email, phone: values.phone });
  const registrationId = match ? String(match.row.id) : null;

  const row = {
    event_id: eventId,
    registration_id: registrationId,
    matched_by: match?.by ?? null,
    full_name: values.full_name,
    email: values.email,
    email_norm: emailNorm,
    phone: values.phone || null,
    phone_norm: phoneNorm || null,
    student_id: values.student_id || null,
    impression: values.impression,
    question: values.question || null,
    source: input.source
  };

  const { error: insertError } = await client.from("event_survey_responses").insert(row);
  if (insertError) {
    // 23505 = người này đã nộp phiếu cho buổi này. Nộp lại là SỬA, không phải
    // lỗi: người ta nhớ ra ý khác rồi gửi lại, và một câu "bạn đã gửi rồi" chỉ
    // làm mất bản sửa ấy.
    if ((insertError as { code?: string }).code !== "23505") {
      log("insert survey response failed", insertError);
      return { ok: false, status: "server_error", message: SAFE_ERROR };
    }
    const { error: updateError } = await client
      .from("event_survey_responses")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("event_id", eventId)
      .eq("email_norm", emailNorm);
    if (updateError) {
      log("update survey response failed", updateError);
      return { ok: false, status: "server_error", message: SAFE_ERROR };
    }
  }

  if (!registrationId) {
    return {
      ok: true,
      status: "success",
      message: "Đã ghi nhận phiếu.",
      matched: false,
      checkedIn: false
    };
  }

  const steps = buildCheckinSteps(checkinStepsOf(data.event as { checkin_steps?: unknown }));
  const station = checkoutStationFor(steps);

  const { data: scans, error: scansError } = await client
    .from("event_scans")
    .select("station")
    .eq("registration_id", registrationId);
  if (scansError) log("load scans for survey checkout failed", scansError);

  const stations = ((scans ?? []) as Json[]).map((scan) => String(scan.station ?? ""));
  // Không đọc được lịch sử quét thì KHÔNG khẳng định "bạn chưa check in": câu đó
  // sai với người đã quét sẽ đẩy họ đi tìm ban tổ chức giữa lúc tan buổi.
  const checkedIn = scansError ? true : hasEntranceScan(stations, steps);

  const { error: scanError } = await client.from("event_scans").insert({
    event_id: eventId,
    registration_id: registrationId,
    station,
    // Không phải người của ban tổ chức bấm, nên không gắn ai vào lượt quét này.
    scanned_by: null,
    note: "Nộp phiếu khảo sát cuối buổi"
  });
  // 23505 = đã có lượt check out rồi (nộp phiếu lần hai). Không phải lỗi.
  if (scanError && (scanError as { code?: string }).code !== "23505") {
    log("insert checkout scan failed", scanError);
  }

  return {
    ok: true,
    status: "success",
    message: "Đã ghi nhận phiếu.",
    matched: true,
    checkedIn
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Bảng điều khiển của ban tổ chức
// ───────────────────────────────────────────────────────────────────────────

async function loadAuthorizedEvent(
  client: any,
  eventId: string
): Promise<{ ok: true; event: Json } | { ok: false; message: string }> {
  const { data: event, error } = await client.from("events").select("*").eq("id", eventId).maybeSingle();
  if (error) {
    log("load event failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!event) return { ok: false, message: "Không tìm thấy buổi này." };

  const scope = await getAdminScopeContext();
  if (!(await canOperateSeason(scope, clean(event.season_id)))) return { ok: false, message: NO_PERMISSION };
  return { ok: true, event };
}

async function loadSurveyLink(client: any, eventId: string): Promise<{ token: string | null; error: unknown }> {
  const { data, error } = await client
    .from("event_links")
    .select("token,is_active")
    .eq("event_id", eventId)
    .eq("link_type", "survey")
    .maybeSingle();
  if (error) return { token: null, error };
  const row = data as Json | null;
  return { token: row?.token ? String(row.token) : null, error: null };
}

export type SurveyOverview = {
  ok: boolean;
  message?: string;
  /** Link công khai, hoặc null khi ban tổ chức chưa tạo. */
  url: string | null;
  /** Ảnh QR của link, dạng data URL, để in ra hoặc chiếu lên màn hình. */
  qrDataUrl: string | null;
  sendAt: string | null;
  counts: SurveyCounts;
  /** Số người đủ điều kiện nhận thư ngay lúc này, theo từng nhóm người nhận. */
  eligibleCheckedIn: number;
  eligibleAll: number;
  responses: number;
  /** Phiếu khớp được lượt đăng ký. */
  matchedResponses: number;
  /** Người có cả lượt Check in lẫn lượt Check out — căn cứ đề xuất điểm rèn luyện. */
  completed: number;
  checkedIn: number;
  blockReason: string | null;
};

/**
 * Mọi con số của khảo sát trên trang sự kiện, đọc trong một lần.
 *
 * Đọc hỏng ở đâu thì nói hỏng ở đó chứ không trả 0: một màn hình nói "0 người đã
 * check out" trong khi thật ra là không đọc được sẽ khiến ban tổ chức gửi lại thư
 * cho cả buổi.
 */
export async function getEventSurveyOverview(eventId: unknown): Promise<SurveyOverview> {
  const empty: SurveyOverview = {
    ok: false,
    url: null,
    qrDataUrl: null,
    sendAt: null,
    counts: { ...EMPTY_SURVEY_COUNTS },
    eligibleCheckedIn: 0,
    eligibleAll: 0,
    responses: 0,
    matchedResponses: 0,
    completed: 0,
    checkedIn: 0,
    blockReason: null
  };

  const id = clean(eventId);
  if (!id || !isValidUuid(id)) return { ...empty, message: "ID sự kiện không hợp lệ." };

  const client = serviceClient();
  if (!client) return { ...empty, message: SAFE_ERROR };

  const authorized = await loadAuthorizedEvent(client, id);
  if (!authorized.ok) return { ...empty, message: authorized.message };
  const event = authorized.event;

  const { token, error: linkError } = await loadSurveyLink(client, id);
  if (linkError) {
    log("load survey link failed", linkError);
    return { ...empty, message: SAFE_ERROR };
  }

  const origin = resolveEmailBaseUrl(await getPublicOrigin());
  const url = token ? surveyUrl(origin, token) : null;

  const [{ data: registrations, error: registrationsError }, { data: recipients, error: recipientsError }] =
    await Promise.all([
      readAllPages<Json>("event_registrations", "id,email,registration_status,attendance_status", (projection) =>
        client.from("event_registrations").select(projection).eq("event_id", id)
      ),
      readAllPages<Json>("event_survey_recipients", "id,status", (projection) =>
        client.from("event_survey_recipients").select(projection).eq("event_id", id)
      )
    ]);

  if (registrationsError || recipientsError) {
    log("load survey overview failed", registrationsError ?? recipientsError);
    return { ...empty, url, message: SAFE_ERROR };
  }

  const { data: responses, error: responsesError } = await readAllPages<Json>(
    "event_survey_responses",
    "id,registration_id",
    (projection) => client.from("event_survey_responses").select(projection).eq("event_id", id)
  );
  if (responsesError) {
    log("load survey responses failed", responsesError);
    return { ...empty, url, message: SAFE_ERROR };
  }

  const steps = buildCheckinSteps(checkinStepsOf(event as { checkin_steps?: unknown }));
  const checkoutStation = checkoutStationFor(steps);
  const { scans, error: scansError } = await listEventScans([id]);
  if (scansError) {
    log("load scans for survey overview failed", scansError);
    return { ...empty, url, message: SAFE_ERROR };
  }

  const stationsBy = new Map<string, string[]>();
  const checkedOut = new Set<string>();
  for (const scan of scans) {
    const key = scan.registrationId;
    if (!key) continue;
    if (scan.station === checkoutStation) checkedOut.add(key);
    stationsBy.set(key, (stationsBy.get(key) ?? []).concat(scan.station));
  }

  let checkedIn = 0;
  let completed = 0;
  stationsBy.forEach((stations, key) => {
    if (!hasEntranceScan(stations, steps)) return;
    checkedIn += 1;
    if (checkedOut.has(key)) completed += 1;
  });

  const qrDataUrl = url ? await renderSurveyQr(url) : null;

  return {
    ok: true,
    url,
    qrDataUrl,
    sendAt: clean(event.survey_send_at),
    counts: countSurveyStates(recipients),
    eligibleCheckedIn: registrations.filter((row) => isSurveyRecipient(row, "checked_in")).length,
    eligibleAll: registrations.filter((row) => isSurveyRecipient(row, "all_registered")).length,
    responses: responses.length,
    matchedResponses: responses.filter((row) => clean(row.registration_id)).length,
    completed,
    checkedIn,
    blockReason: surveySendBlockReason(event as { status?: unknown; starts_at?: unknown }, Boolean(token))
  };
}

/** Ảnh QR của link khảo sát. Hỏng thì trả null — trang vẫn còn link chữ. */
async function renderSurveyQr(url: string): Promise<string | null> {
  try {
    const QRCode = (await import("qrcode")).default;
    return await QRCode.toDataURL(url, { margin: 2, width: 420, errorCorrectionLevel: "M" });
  } catch (error) {
    log("survey QR render failed", error);
    return null;
  }
}

export type SurveyResponseRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  studentId: string | null;
  impression: string;
  question: string | null;
  source: string;
  submittedAt: string;
  matched: boolean;
  /** Người này có lượt quét Check in đầu buổi không. */
  checkedIn: boolean;
};

/** Danh sách phiếu của một buổi, mới nhất trước. */
export async function listEventSurveyResponses(
  eventId: unknown
): Promise<{ ok: boolean; message?: string; rows: SurveyResponseRow[] }> {
  const id = clean(eventId);
  if (!id || !isValidUuid(id)) return { ok: false, message: "ID sự kiện không hợp lệ.", rows: [] };

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR, rows: [] };

  const authorized = await loadAuthorizedEvent(client, id);
  if (!authorized.ok) return { ok: false, message: authorized.message, rows: [] };

  const { data: responses, error } = await readAllPages<Json>(
    "event_survey_responses",
    "id,registration_id,full_name,email,phone,student_id,impression,question,source,submitted_at",
    (projection) => client.from("event_survey_responses").select(projection).eq("event_id", id)
  );
  if (error) {
    log("list survey responses failed", error);
    return { ok: false, message: SAFE_ERROR, rows: [] };
  }

  const steps = buildCheckinSteps(checkinStepsOf(authorized.event as { checkin_steps?: unknown }));
  const { scans, error: scansError } = await listEventScans([id]);
  if (scansError) log("load scans for survey list failed", scansError);

  const stationsBy = new Map<string, string[]>();
  for (const scan of scans) {
    const key = scan.registrationId;
    if (!key) continue;
    stationsBy.set(key, (stationsBy.get(key) ?? []).concat(scan.station));
  }

  const rows = responses
    .map((row) => {
      const registrationId = clean(row.registration_id);
      return {
        id: String(row.id),
        fullName: String(row.full_name ?? ""),
        email: String(row.email ?? ""),
        phone: clean(row.phone),
        studentId: clean(row.student_id),
        impression: String(row.impression ?? ""),
        question: clean(row.question),
        source: String(row.source ?? "qr"),
        submittedAt: String(row.submitted_at ?? ""),
        matched: Boolean(registrationId),
        checkedIn: registrationId ? hasEntranceScan(stationsBy.get(registrationId) ?? [], steps) : false
      };
    })
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return { ok: true, rows };
}

/** Đặt (hoặc xoá) giờ tự gửi thư khảo sát. `null` là tắt tự gửi. */
export async function setEventSurveySendAt(input: {
  eventId: unknown;
  sendAtIso: string | null;
}): Promise<{ ok: boolean; message: string }> {
  const access = await requireEventAdmin();
  if (!access.ok) return { ok: false, message: access.message };

  const id = clean(input.eventId);
  if (!id || !isValidUuid(id)) return { ok: false, message: "ID sự kiện không hợp lệ." };

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const authorized = await loadAuthorizedEvent(client, id);
  if (!authorized.ok) return { ok: false, message: authorized.message };

  const { error } = await client.from("events").update({ survey_send_at: input.sendAtIso }).eq("id", id);
  if (error) {
    log("set survey send time failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  return {
    ok: true,
    message: input.sendAtIso ? "Đã đặt giờ tự gửi khảo sát." : "Đã tắt tự gửi khảo sát."
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Gửi thư
// ───────────────────────────────────────────────────────────────────────────

async function readSurveyCounts(client: any, eventId: string): Promise<{ counts: SurveyCounts; error: unknown }> {
  const { data, error } = await readAllPages<Json>("event_survey_recipients", "id,status", (projection) =>
    client.from("event_survey_recipients").select(projection).eq("event_id", eventId)
  );
  if (error) return { counts: { ...EMPTY_SURVEY_COUNTS }, error };
  return { counts: countSurveyStates(data), error: null };
}

async function markRecipient(
  client: any,
  recipientId: string,
  status: "sent" | "failed" | "skipped",
  error: string | null
) {
  const { error: markError } = await client
    .from("event_survey_recipients")
    .update({ status, error: error ? error.slice(0, 500) : null })
    .eq("id", recipientId)
    .eq("status", "sending");
  if (markError) log(`mark ${status} failed`, markError);
}

function fail(message: string): SurveySendResult {
  return { ok: false, message };
}

/**
 * Xếp hàng những người đủ điều kiện mà chưa có dòng, rồi gửi một lô.
 *
 * Gọi lại nhiều lần là cách dùng bình thường, không phải đường hồi phục: mỗi lần
 * gọi vừa gửi tiếp phần còn lại, vừa đón thêm người mới check in.
 */
export async function runEventSurveySend(input: {
  eventId: unknown;
  audience: SurveyAudience;
}): Promise<SurveySendResult> {
  const access = await requireEventAdmin();
  if (!access.ok) return fail(access.message);

  const id = clean(input.eventId);
  if (!id || !isValidUuid(id)) return fail("ID sự kiện không hợp lệ.");

  const client = serviceClient();
  if (!client) return fail(SAFE_ERROR);

  const authorized = await loadAuthorizedEvent(client, id);
  if (!authorized.ok) return fail(authorized.message);
  const event = authorized.event;

  const { token, error: linkError } = await loadSurveyLink(client, id);
  if (linkError) {
    log("load survey link failed", linkError);
    return fail(SAFE_ERROR);
  }

  const blocked = surveySendBlockReason(event as { status?: unknown; starts_at?: unknown }, Boolean(token));
  if (blocked) return fail(blocked);

  const startedMs = Date.now();

  // 1. Dòng kẹt ở "đang gửi" của một lần gọi đã chết: chốt thành lỗi, không đưa
  //    lại hàng đợi — không biết thư đã đi hay chưa, nên không tự gửi lại.
  const { error: staleError } = await client
    .from("event_survey_recipients")
    .update({ status: "failed", error: STALE_SENDING_ERROR })
    .eq("event_id", id)
    .eq("status", "sending")
    .lt("attempted_at", new Date(startedMs - SURVEY_STALE_SENDING_MS).toISOString());
  if (staleError) log("expire stale sending failed", staleError);

  // 2. Quét lại danh sách và xếp thêm người mới đủ điều kiện.
  const { data: registrations, error: registrationsError } = await readAllPages<Json>(
    "event_registrations",
    "id,email,registration_status,attendance_status",
    (projection) => client.from("event_registrations").select(projection).eq("event_id", id)
  );
  if (registrationsError) {
    log("load registrations for survey send failed", registrationsError);
    return fail(SAFE_ERROR);
  }

  const { data: existing, error: existingError } = await readAllPages<Json>(
    "event_survey_recipients",
    "id,registration_id,status",
    (projection) => client.from("event_survey_recipients").select(projection).eq("event_id", id)
  );
  if (existingError) {
    log("load survey recipients failed", existingError);
    return fail(SAFE_ERROR);
  }

  const already = new Set(existing.map((row) => String(row.registration_id)));
  const toQueue = registrations
    .filter((row) => isSurveyRecipient(row, input.audience) && !already.has(String(row.id)))
    .map((row) => ({
      event_id: id,
      registration_id: String(row.id),
      email: String(row.email ?? "").trim()
    }));

  if (toQueue.length) {
    // `ignoreDuplicates` vì hai tab bấm cùng lúc sẽ xếp cùng một người: ràng buộc
    // (event_id, registration_id) từ chối dòng thứ hai, và đó là hành vi mong muốn
    // chứ không phải lỗi cần báo.
    const { error: queueError } = await client
      .from("event_survey_recipients")
      .upsert(toQueue, { onConflict: "event_id,registration_id", ignoreDuplicates: true });
    if (queueError) {
      log("queue survey recipients failed", queueError);
      return fail(SAFE_ERROR);
    }
  }

  // 3. Gửi một lô.
  const { data: queued, error: queuedError } = await client
    .from("event_survey_recipients")
    .select("id")
    .eq("event_id", id)
    .eq("status", "queued")
    .order("id", { ascending: true })
    .limit(SURVEY_CHUNK);
  if (queuedError) {
    log("load queued failed", queuedError);
    return fail(SAFE_ERROR);
  }

  const chunk = { sent: 0, failed: 0, skipped: 0, queued: toQueue.length };
  const queuedIds = ((queued ?? []) as Json[]).map((row) => String(row.id));

  if (queuedIds.length) {
    // Một thư chỉ đi sau khi dòng của người đó được CHIẾM. Hai tab chạy cùng lúc
    // chiếm hai phần rời nhau, nên không ai nhận hai thư.
    const { data: claimed, error: claimError } = await client
      .from("event_survey_recipients")
      .update({ status: "sending", attempted_at: new Date(startedMs).toISOString(), error: null })
      .in("id", queuedIds)
      .eq("status", "queued")
      .select("id,registration_id");
    if (claimError) {
      log("claim failed", claimError);
      return fail(SAFE_ERROR);
    }

    const claimedRows = (claimed ?? []) as Json[];
    if (claimedRows.length) {
      const { data: rows, error: rowsError } = await client
        .from("event_registrations")
        .select("id,event_id,full_name,email,registration_status,attendance_status")
        .in(
          "id",
          claimedRows.map((row) => String(row.registration_id))
        );
      if (rowsError) {
        log("load claimed registrations failed", rowsError);
        await client
          .from("event_survey_recipients")
          .update({ status: "queued", attempted_at: null })
          .in(
            "id",
            claimedRows.map((row) => String(row.id))
          )
          .eq("status", "sending");
        return fail(SAFE_ERROR);
      }

      const byId = new Map(((rows ?? []) as Json[]).map((row) => [String(row.id), row]));
      const origin = resolveEmailBaseUrl(await getPublicOrigin());
      const eventName = String(event.event_name ?? "").trim() || "sự kiện";
      const link = surveyUrl(origin, token, "email");
      const notice = trackingNotice(eventName, formatDate(event.starts_at));
      const prompt = impressionQuestion(eventName);

      const release: string[] = [];
      for (const row of claimedRows) {
        const recipientId = String(row.id);
        if (Date.now() - startedMs > SURVEY_TIME_BUDGET_MS) {
          release.push(recipientId);
          continue;
        }

        const registration = byId.get(String(row.registration_id));
        if (
          !registration ||
          String(registration.event_id) !== id ||
          !isSurveyRecipient(registration, input.audience)
        ) {
          await markRecipient(client, recipientId, "skipped", NOT_ELIGIBLE);
          chunk.skipped += 1;
          continue;
        }

        try {
          const result = await sendEventSurvey({
            toEmail: String(registration.email ?? "").trim(),
            recipientName: String(registration.full_name ?? "").trim(),
            eventName,
            impressionQuestion: prompt,
            question: QUESTION_PROMPT,
            trackingNotice: notice,
            surveyUrl: link,
            registrationId: String(registration.id)
          });
          if (!result.ok) {
            await markRecipient(client, recipientId, "failed", result.reason ?? "Nhà cung cấp thư từ chối.");
            chunk.failed += 1;
          } else if (result.skipped) {
            // Cổng thư chặn KHÔNG phải là đã gửi. Tính nó là "đã gửi" là báo cho
            // ban tổ chức rằng mọi người đã nhận trong khi hộp thư ai cũng trống.
            await markRecipient(client, recipientId, "failed", `Không gửi: ${result.reason ?? "cổng thư đang tắt"}.`);
            chunk.failed += 1;
          } else {
            await markRecipient(client, recipientId, "sent", null);
            chunk.sent += 1;
          }
        } catch (error) {
          log("send survey threw", error);
          await markRecipient(client, recipientId, "failed", "Lỗi khi gửi thư.");
          chunk.failed += 1;
        }
      }

      if (release.length) {
        const { error: releaseError } = await client
          .from("event_survey_recipients")
          .update({ status: "queued", attempted_at: null })
          .in("id", release)
          .eq("status", "sending");
        if (releaseError) log("release unsent failed", releaseError);
      }
    }
  }

  const { counts, error: countError } = await readSurveyCounts(client, id);
  if (countError) {
    log("read counts failed", countError);
    return {
      ok: true,
      message: `Đã gửi ${chunk.sent} thư trong lần này nhưng không đọc lại được tiến độ. Tải lại trang rồi bấm gửi tiếp — không ai nhận hai lần.`,
      chunk
    };
  }

  const remaining = surveyRemaining(counts);
  const total = surveyTotal(counts);
  if (!total) {
    return {
      ok: true,
      message:
        input.audience === "checked_in"
          ? "Chưa có ai được check in, nên chưa gửi thư cho ai. Quét mã cho người tham dự rồi bấm lại, hoặc đổi sang gửi cho toàn bộ người đăng ký."
          : "Không có người đăng ký nào đủ điều kiện nhận thư.",
      counts,
      chunk
    };
  }

  return {
    ok: true,
    message: remaining
      ? `Đang gửi. ${describeSurveyCounts(counts, total)}`
      : `Đã gửi xong. ${describeSurveyCounts(counts, total)}`,
    counts,
    chunk
  };
}
