import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { sendInterviewInvite, sendInterviewSchedule, sendInterviewSlotCancelled, sendInterviewSlotInvite } from "@/lib/email";
import {
  BOOKING_ELIGIBLE_STATUSES,
  BTC_EMAIL,
  BookingPageDayGroup,
  DispatchResult,
  GridDay,
  HOTLINE_ZALO,
  INTERVIEW_SEASON_CODE,
  INTERVIEW_WINDOW,
  INVITE_CHUNK,
  INVITE_INLINE_BUDGET_MS,
  INVITE_STALE_CLAIM_MS,
  INVITE_TIME_BUDGET_MS,
  InterviewerStats,
  MentorBucket,
  WaitingDayGroup,
  bookingBlockedReason,
  buildSlotGrid,
  buildWaitingGrid,
  canMentorCancel,
  classifyMentor,
  computeInterviewerStats,
  countOpenSlotsByHour,
  inviteSendDue,
  isBookingEligibleApplication,
  isValidSlotInstant,
  slotInstant,
  slotRangeLabel
} from "@/lib/interview-schedule-core";
import { isValidApplicationPhone } from "@/lib/application-form-validation";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { canAssignReview, canSelfClaimInterview } from "@/lib/permissions";
import { getPublicOrigin } from "@/lib/public-url";
import { SEASON_CONFIG } from "@/lib/season-config";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { formatDate } from "@/lib/utils";

/**
 * lib/interview-schedule.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tầng máy chủ của bộ lịch phỏng vấn mentor 1:1. Mọi phép kiểm quyền nằm Ở
 * ĐÂY (các action chỉ nhận tham số và làm mới trang); mọi thao tác có tranh
 * chấp — giữ chỗ, huỷ chỗ — đi qua các hàm vam098 trong database chứ không
 * bao giờ là đọc-rồi-ghi ở tầng này.
 *
 * Phần thuần (lưới giờ, luật đối tượng, nhịp nhắc) nằm ở
 * lib/interview-schedule-core.ts để kiểm không cần bản giả database.
 */

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";

type Json = Record<string, any>;

function log(message: string, error?: unknown) {
  console.error(`[interview-schedule] ${message}`, error ?? "");
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

// Chép tại chỗ thay vì import từ lib/events: module đó kéo theo cả chuỗi
// program-scope (React cache), và app/actions/apply.ts import file này — năm
// bài test form nộp đơn từng vỡ ngay lúc nạp chỉ vì một cái regex đi mượn.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function serviceClient() {
  return getSupabaseServiceRoleClient();
}

/** ISO chuẩn hoá — timestamptz từ PostgREST về dạng so sánh được bằng chuỗi. */
function normIso(value: unknown): string {
  const at = new Date(String(value ?? ""));
  return Number.isNaN(at.getTime()) ? "" : at.toISOString();
}

/** Hết đợt = 22:00 giờ Việt Nam ngày cuối (slot cuối 21:00 kết thúc 22:00). */
function windowEndMs(): number {
  return new Date(slotInstant(INTERVIEW_WINDOW.lastDateKey, 21)).getTime() + 60 * 60_000;
}

async function resolveSeasonId(client: any): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const { data, error } = await client
    .from("seasons")
    .select("id,code")
    .eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE)
    .maybeSingle();
  if (error) {
    log("seasons lookup failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!data?.id) {
    return { ok: false, message: `Không tìm thấy mùa ${SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE}.` };
  }
  return { ok: true, id: String(data.id) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cổng quyền
// ─────────────────────────────────────────────────────────────────────────────

type InterviewerActor = {
  adminUserId: string;
  fullName: string;
  email: string;
  role: string;
  isBtc: boolean;
  seasonId: string;
};

/**
 * Ai được đứng vào lưới giờ: đúng tập vai trò của trang /interviews, và với
 * tài khoản `reviewer` phải thêm phép "interviewer của mùa" do database trả
 * lời (vam084_participant_for_stage) — một reviewer chấm hồ sơ KHÔNG tự nhiên
 * thành người phỏng vấn.
 */
async function requireInterviewer(): Promise<
  { ok: true; actor: InterviewerActor; client: any } | { ok: false; message: string }
> {
  const admin = await getCurrentAdminUser();
  if (!admin) return { ok: false, message: "Cần đăng nhập." };
  if (!canSelfClaimInterview(admin.role)) {
    return { ok: false, message: "Bạn không có quyền vào lịch phỏng vấn." };
  }
  if (!admin.id) return { ok: false, message: "Tài khoản thiếu định danh quản trị." };

  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const season = await resolveSeasonId(client);
  if (!season.ok) return { ok: false, message: season.message };

  if (admin.role === "reviewer") {
    const { data, error } = await client.rpc("vam084_participant_for_stage", {
      p_admin_user_id: admin.id,
      p_season_id: season.id,
      p_review_stage: "interview"
    });
    if (error || data !== true) {
      return { ok: false, message: "Bạn chưa được cấp vai trò người phỏng vấn cho mùa này." };
    }
  }

  return {
    ok: true,
    client,
    actor: {
      adminUserId: String(admin.id),
      fullName: String(admin.full_name ?? ""),
      email: String(admin.email ?? ""),
      role: String(admin.role),
      isBtc: canAssignReview(admin.role),
      seasonId: season.id
    }
  };
}

async function requireBtc(): Promise<
  { ok: true; adminUserId: string; client: any; seasonId: string } | { ok: false; message: string }
> {
  const admin = await getCurrentAdminUser();
  if (!admin) return { ok: false, message: "Cần đăng nhập." };
  if (!canAssignReview(admin.role)) {
    return { ok: false, message: "Bạn không có quyền thao tác lịch phỏng vấn." };
  }
  if (!admin.id) return { ok: false, message: "Tài khoản thiếu định danh quản trị." };
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };
  const season = await resolveSeasonId(client);
  if (!season.ok) return { ok: false, message: season.message };
  return { ok: true, adminUserId: String(admin.id), client, seasonId: season.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trang của interviewer
// ─────────────────────────────────────────────────────────────────────────────

export type MySlotState = "open" | "removed" | "booked";

export type MyScheduleDay = GridDay & {
  slots: Array<
    GridDay["slots"][number] & {
      mine: MySlotState | null;
      candidateName: string | null;
      /** Phiếu phỏng vấn của buổi đã đặt — mở thẳng `/reviews/<id>` từ khung giờ. */
      reviewId: string | null;
    }
  >;
};

export type MyInterviewerSchedule =
  | {
      ok: true;
      isBtc: boolean;
      needsPhone: boolean;
      phone: string;
      days: MyScheduleDay[];
      stats: InterviewerStats;
      /** Chiều ngược: khung giờ nào đang có mentor tự khai rảnh mà chưa ai ghép. */
      waiting: WaitingDayGroup[];
      /** Số MENTOR đang chờ, không phải số lượt giờ — một người khai năm giờ vẫn là một người. */
      waitingTotal: number;
    }
  | { ok: false; message: string };

export async function getMyInterviewerSchedule(): Promise<MyInterviewerSchedule> {
  const access = await requireInterviewer();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, actor } = access;

  const { data: profile, error: profileError } = await client
    .from("interviewer_profiles")
    .select("phone")
    .eq("admin_user_id", actor.adminUserId)
    .maybeSingle();
  if (profileError) {
    log("profile read failed", profileError);
    return { ok: false, message: SAFE_ERROR };
  }

  const slots = await readAllPages<Json>("interview_slots", "id,slot_starts_at,status", (columns) =>
    client.from("interview_slots").select(columns).eq("admin_user_id", actor.adminUserId).eq("season_id", actor.seasonId)
  );
  if (slots.error) {
    log("slots read failed", slots.error);
    return { ok: false, message: SAFE_ERROR };
  }

  // Tên mentor và phiếu phỏng vấn cho các ô đã được đặt — đọc qua sổ giữ chỗ
  // đang hiệu lực. `review_id` đã nằm sẵn trên chính dòng booking (vam098 ghi
  // nó lúc tạo), nên không cần đọc thêm bảng nào để có nó.
  const bookings = await readAllPages<Json>(
    "interview_bookings",
    "id,slot_id,application_id,slot_starts_at,review_id",
    (columns) =>
      client
        .from("interview_bookings")
        .select(columns)
        .eq("interviewer_admin_user_id", actor.adminUserId)
        .eq("status", "booked")
  );
  if (bookings.error) {
    log("bookings read failed", bookings.error);
    return { ok: false, message: SAFE_ERROR };
  }
  const candidateNames = new Map<string, string>();
  const reviewIds = new Map<string, string | null>();
  if (bookings.data.length > 0) {
    const apps = await readAllPagesIn<Json>(
      client,
      "applications",
      "id",
      bookings.data.map((row) => String(row.application_id)),
      "id,full_name"
    );
    if (apps.error) {
      log("booked applications read failed", apps.error);
      return { ok: false, message: SAFE_ERROR };
    }
    const nameById = new Map(apps.data.map((row) => [String(row.id), String(row.full_name ?? "")]));
    for (const booking of bookings.data) {
      const iso = normIso(booking.slot_starts_at);
      candidateNames.set(iso, nameById.get(String(booking.application_id)) ?? "");
      reviewIds.set(iso, clean(booking.review_id) || null);
    }
  }

  const mineByIso = new Map<string, MySlotState>();
  for (const slot of slots.data) {
    mineByIso.set(normIso(slot.slot_starts_at), String(slot.status) as MySlotState);
  }

  const nowIso = new Date().toISOString();
  const days: MyScheduleDay[] = buildSlotGrid(nowIso).map((day) => ({
    ...day,
    slots: day.slots.map((slot) => ({
      ...slot,
      mine: mineByIso.get(slot.startsAtIso) ?? null,
      candidateName: candidateNames.get(slot.startsAtIso) ?? null,
      reviewId: reviewIds.get(slot.startsAtIso) ?? null
    }))
  }));

  // Chiều ngược: mentor tự khai giờ rảnh và chờ được ghép. Đọc ở đây để
  // interviewer mở trang là thấy ngay khung giờ nào đang tắc, thay vì đoán.
  const waitingRows = await readAllPages<Json>(
    "interview_mentor_availability",
    "application_id,slot_starts_at",
    (columns) =>
      client
        .from("interview_mentor_availability")
        .select(columns)
        .eq("season_id", actor.seasonId)
        .eq("status", "open")
        .gt("slot_starts_at", nowIso)
  );
  if (waitingRows.error) {
    log("mentor availability read failed", waitingRows.error);
    return { ok: false, message: SAFE_ERROR };
  }

  // Mentor đã tự giữ chỗ qua link riêng thì giờ họ khai không còn là nhu cầu —
  // lọc ở lúc đọc chứ không dọn bảng, để huỷ lịch là họ chờ lại được ngay.
  //
  // Cùng lẽ đó với hồ sơ chưa qua vòng chấm hoặc đã bị từ chối: hàm ghép
  // vam099 sẽ không nhận họ, nên đếm họ vào "N người đang chờ" là mời
  // interviewer bấm vào một ô rồi nhận câu "không còn ai chờ". Lưới phải nói
  // đúng thứ mà cú bấm làm được.
  const alreadyBooked = new Set<string>();
  const notEligible = new Set<string>();
  const waitingAppIds = Array.from(new Set(waitingRows.data.map((row) => String(row.application_id))));
  if (waitingAppIds.length > 0) {
    const live = await readAllPagesIn<Json>(
      client,
      "interview_bookings",
      "application_id",
      waitingAppIds,
      "application_id,status"
    );
    if (live.error) {
      log("waiting bookings read failed", live.error);
      return { ok: false, message: SAFE_ERROR };
    }
    for (const row of live.data) {
      if (String(row.status) === "booked") alreadyBooked.add(String(row.application_id));
    }

    const waitingApps = await readAllPagesIn<Json>(
      client,
      "applications",
      "id",
      waitingAppIds,
      "id,status,role_applied,source"
    );
    if (waitingApps.error) {
      log("waiting applications read failed", waitingApps.error);
      return { ok: false, message: SAFE_ERROR };
    }
    const waitingReviews = await readAllPagesIn<Json>(
      client,
      "application_reviews",
      "application_id",
      waitingAppIds,
      "id,application_id,status,review_round",
      (query: any) => query.eq("review_round", "interview").neq("status", "cancelled")
    );
    if (waitingReviews.error) {
      log("waiting reviews read failed", waitingReviews.error);
      return { ok: false, message: SAFE_ERROR };
    }
    const reviewIdsByApp = new Map<string, string[]>();
    for (const row of waitingReviews.data) {
      const key = String(row.application_id);
      reviewIdsByApp.set(key, [...(reviewIdsByApp.get(key) ?? []), String(row.id)]);
    }
    const eligibleAppIds = new Set(
      waitingApps.data
        .filter((row) =>
          isBookingEligibleApplication(
            { status: row.status, role_applied: row.role_applied, source: row.source },
            reviewIdsByApp.get(String(row.id)) ?? [],
            null
          )
        )
        .map((row) => String(row.id))
    );
    for (const id of waitingAppIds) {
      if (!eligibleAppIds.has(id)) notEligible.add(id);
    }
  }

  const stillWaiting = waitingRows.data.filter(
    (row) =>
      !alreadyBooked.has(String(row.application_id)) && !notEligible.has(String(row.application_id))
  );

  return {
    ok: true,
    isBtc: actor.isBtc,
    needsPhone: !clean(profile?.phone),
    phone: clean(profile?.phone),
    days,
    stats: computeInterviewerStats(
      slots.data.map((slot) => ({ slot_starts_at: normIso(slot.slot_starts_at), status: String(slot.status) })),
      nowIso
    ),
    waiting: buildWaitingGrid(
      countOpenSlotsByHour(stillWaiting.map((row) => ({ slot_starts_at: normIso(row.slot_starts_at) }))),
      nowIso
    ),
    waitingTotal: new Set(stillWaiting.map((row) => String(row.application_id))).size
  };
}

export type SaveSlotsResult = {
  ok: boolean;
  message: string;
  /** Giờ xin gỡ nhưng vừa có mentor đặt mất — không gỡ, và phải nói rõ. */
  blockedRemovals: string[];
};

export async function saveInterviewerSlots(input: {
  phone: string;
  add: string[];
  remove: string[];
}): Promise<SaveSlotsResult> {
  const access = await requireInterviewer();
  if (!access.ok) return { ok: false, message: access.message, blockedRemovals: [] };
  const { client, actor } = access;
  const nowIso = new Date().toISOString();

  // Số điện thoại là điều kiện tiên quyết: thư xác nhận lịch phải ghi đủ SĐT
  // hai bên, nên thiếu nó thì mọi giờ rảnh đăng lên đều là lời hứa thiếu.
  const phone = clean(input.phone);
  const { data: profile, error: profileError } = await client
    .from("interviewer_profiles")
    .select("id,phone")
    .eq("admin_user_id", actor.adminUserId)
    .maybeSingle();
  if (profileError) {
    log("profile read failed", profileError);
    return { ok: false, message: SAFE_ERROR, blockedRemovals: [] };
  }
  if (phone) {
    if (!isValidApplicationPhone(phone)) {
      return { ok: false, message: "Số điện thoại phải gồm đúng 10 chữ số.", blockedRemovals: [] };
    }
    const { error: upsertError } = await client
      .from("interviewer_profiles")
      .upsert(
        { admin_user_id: actor.adminUserId, phone, updated_at: nowIso },
        { onConflict: "admin_user_id" }
      );
    if (upsertError) {
      log("profile upsert failed", upsertError);
      return { ok: false, message: SAFE_ERROR, blockedRemovals: [] };
    }
  } else if (!clean(profile?.phone)) {
    return {
      ok: false,
      message: "Anh/chị điền số điện thoại trước — thư xác nhận lịch gửi cho mentor cần số này.",
      blockedRemovals: []
    };
  }

  // Mọi mốc giờ phải là ô lưới hợp lệ còn ở tương lai. Một mốc lạ trong danh
  // sách là dấu hiệu form bị sửa tay — từ chối cả gói thay vì lọc im lặng.
  const adds: string[] = [];
  for (const raw of input.add) {
    const checked = isValidSlotInstant(clean(raw), nowIso);
    if (!checked.ok) {
      return { ok: false, message: "Có khung giờ không hợp lệ hoặc đã qua — tải lại trang rồi chọn lại.", blockedRemovals: [] };
    }
    adds.push(checked.startsAtIso);
  }
  const removes: string[] = [];
  for (const raw of input.remove) {
    const checked = isValidSlotInstant(clean(raw), nowIso);
    if (!checked.ok) {
      return { ok: false, message: "Có khung giờ không hợp lệ hoặc đã qua — tải lại trang rồi chọn lại.", blockedRemovals: [] };
    }
    removes.push(checked.startsAtIso);
  }

  if (adds.length > 0) {
    // Dòng mới chèn thẳng; dòng từng gỡ thì UPDATE trở lại 'open' (reset
    // available_since — đã rút lời thì xếp lại cuối hàng FIFO). Upsert với
    // ignoreDuplicates không bao giờ đè được một ô đang 'booked'.
    const { error: insertError } = await client.from("interview_slots").upsert(
      adds.map((startsAt) => ({
        season_id: actor.seasonId,
        admin_user_id: actor.adminUserId,
        slot_starts_at: startsAt,
        status: "open"
      })),
      { onConflict: "admin_user_id,slot_starts_at", ignoreDuplicates: true }
    );
    if (insertError) {
      log("slots upsert failed", insertError);
      return { ok: false, message: SAFE_ERROR, blockedRemovals: [] };
    }
    const { error: reopenError } = await client
      .from("interview_slots")
      .update({ status: "open", available_since: nowIso, removed_at: null })
      .eq("admin_user_id", actor.adminUserId)
      .in("slot_starts_at", adds)
      .eq("status", "removed");
    if (reopenError) {
      log("slots reopen failed", reopenError);
      return { ok: false, message: SAFE_ERROR, blockedRemovals: [] };
    }
  }

  const blockedRemovals: string[] = [];
  if (removes.length > 0) {
    // Gỡ bằng update CÓ ĐIỀU KIỆN status='open': ô vừa được mentor giữ giữa
    // lúc trang render và lúc bấm lưu sẽ không khớp — buổi hẹn không bị xoá
    // ngầm, và interviewer được nói thẳng thay vì tưởng đã gỡ xong.
    const { data: removed, error: removeError } = await client
      .from("interview_slots")
      .update({ status: "removed", removed_at: nowIso })
      .eq("admin_user_id", actor.adminUserId)
      .in("slot_starts_at", removes)
      .eq("status", "open")
      .select("slot_starts_at");
    if (removeError) {
      log("slots remove failed", removeError);
      return { ok: false, message: SAFE_ERROR, blockedRemovals: [] };
    }
    const done = new Set((removed ?? []).map((row: Json) => normIso(row.slot_starts_at)));
    for (const iso of removes) {
      if (!done.has(iso)) blockedRemovals.push(iso);
    }
  }

  // Có giờ rảnh mới → thư mời tới các mentor chưa đặt lịch. Chạy ké với ngân
  // sách ngắn và không bao giờ làm hỏng lần lưu: gửi thiếu thì lượt sau
  // (tick trên trang ban tổ chức, nút bấm tay, hoặc cron sáng) gửi nốt.
  let dispatchNote = "";
  if (adds.length > 0) {
    try {
      const dispatched = await runDispatchCore(client, actor.seasonId, INVITE_INLINE_BUDGET_MS);
      if (dispatched.sent > 0) dispatchNote = ` Đã gửi ${dispatched.sent} thư mời đặt lịch.`;
    } catch (error) {
      log("inline dispatch crashed", error);
    }
  }

  const blockedNote =
    blockedRemovals.length > 0
      ? ` ${blockedRemovals.length} khung giờ vừa được mentor đặt nên không gỡ được — cần huỷ thì dùng phần Lịch đã đặt.`
      : "";
  return {
    ok: true,
    message: `Đã lưu giờ rảnh.${blockedNote}${dispatchNote}`,
    blockedRemovals
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Trang công khai /dat-lich/[token]
// ─────────────────────────────────────────────────────────────────────────────

export type BookingPageData =
  | { ok: false; state: "invalid"; message: string }
  | {
      ok: true;
      state: "booked";
      mentorName: string;
      booking: {
        slotStartsAtIso: string;
        slotLabel: string;
        interviewerName: string;
        interviewerPhone: string | null;
        canCancel: boolean;
      };
      hotlineZalo: string;
    }
  | { ok: true; state: "ineligible"; mentorName: string; message: string; hotlineZalo: string }
  | {
      ok: true;
      state: "eligible";
      mentorName: string;
      days: BookingPageDayGroup[];
      totalOpen: number;
      windowEndLabel: string;
      hotlineZalo: string;
      /**
       * Chiều ngược: lưới để mentor chọn MỘT giờ mình rảnh. Luôn hiện song song
       * với phần giữ chỗ (chủ dự án chốt 23/09/2026) — người bận đúng những giờ
       * đang mở vẫn nói ra được thay vì đóng trang rồi thôi.
       *
       * `chosen` là một giá trị chứ không phải một danh sách: mỗi mentor chỉ giữ
       * một lời ngỏ tại một thời điểm, và database canh điều đó bằng chỉ số bộ
       * phận chứ không tin vào tầng này.
       */
      availability: { days: GridDay[]; chosen: string | null };
    };

const INVALID_LINK: BookingPageData = {
  ok: false,
  state: "invalid",
  message: "Không tìm thấy trang đặt lịch. Đường dẫn có thể đã bị chép thiếu — anh/chị mở lại từ email của ban tổ chức."
};

/**
 * Hai lý do rất khác nhau cùng dẫn tới "chưa đặt lịch được", và nói nhầm câu
 * là nói sai với người thật: 9 mentor đã nhận thư mời trước khi luật siết lại
 * ngày 23/09/2026, nên người mở link mà hồ sơ còn đang được chấm KHÔNG phải
 * người đã có kết quả. Câu cho họ phải là "sẽ tới", không phải "đã xong".
 */
const INELIGIBLE_MESSAGES: Record<ReturnType<typeof bookingBlockedReason>, string> = {
  pending_screening:
    "Hồ sơ của anh/chị đang được ban tổ chức xem. Khi hồ sơ qua vòng này, anh/chị sẽ nhận thư mời chọn giờ trao đổi với core team — chưa cần làm gì thêm lúc này.",
  closed:
    "Hồ sơ của anh/chị hiện không ở bước đặt lịch (đã có lịch được ban tổ chức thu xếp riêng, hoặc hồ sơ đã có kết quả). Cần hỗ trợ, anh/chị liên hệ Zalo ban tổ chức."
};

export async function getBookingPageData(token: unknown): Promise<BookingPageData> {
  const client = serviceClient();
  if (!client) return { ok: false, state: "invalid", message: SAFE_ERROR };

  const cleanToken = clean(token);
  if (!cleanToken || !isValidUuid(cleanToken)) return INVALID_LINK;

  const { data: invite, error: inviteError } = await client
    .from("interview_slot_invites")
    .select("id,application_id,token")
    .eq("token", cleanToken)
    .maybeSingle();
  if (inviteError) {
    log("invite lookup failed", inviteError);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }
  if (!invite) return INVALID_LINK;

  const { data: app, error: appError } = await client
    .from("applications")
    .select("id,status,full_name,role_applied,source,season_id")
    .eq("id", invite.application_id)
    .maybeSingle();
  if (appError || !app) {
    if (appError) log("application lookup failed", appError);
    return INVALID_LINK;
  }
  const mentorName = clean(app.full_name) || "anh/chị";
  const nowIso = new Date().toISOString();

  // Đã có lịch đang hiệu lực → trang trở thành thẻ xác nhận + đường tự huỷ.
  const { data: booking, error: bookingError } = await client
    .from("interview_bookings")
    .select("id,slot_starts_at,interviewer_admin_user_id")
    .eq("application_id", String(app.id))
    .eq("status", "booked")
    .maybeSingle();
  if (bookingError) {
    log("booking lookup failed", bookingError);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }
  if (booking) {
    const { data: interviewer } = await client
      .from("admin_users")
      .select("full_name,email")
      .eq("id", booking.interviewer_admin_user_id)
      .maybeSingle();
    const { data: profile } = await client
      .from("interviewer_profiles")
      .select("phone")
      .eq("admin_user_id", booking.interviewer_admin_user_id)
      .maybeSingle();
    const slotIso = normIso(booking.slot_starts_at);
    return {
      ok: true,
      state: "booked",
      mentorName,
      booking: {
        slotStartsAtIso: slotIso,
        slotLabel: slotRangeLabel(slotIso),
        interviewerName: clean(interviewer?.full_name) || clean(interviewer?.email) || "Ban tổ chức",
        interviewerPhone: clean(profile?.phone) || null,
        canCancel: canMentorCancel(slotIso, nowIso)
      },
      hotlineZalo: HOTLINE_ZALO
    };
  }

  const reviews = await readAllPages<Json>("application_reviews", "id,status,review_round", (columns) =>
    client
      .from("application_reviews")
      .select(columns)
      .eq("application_id", String(app.id))
      .eq("review_round", "interview")
      .neq("status", "cancelled")
  );
  if (reviews.error) {
    log("reviews read failed", reviews.error);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }

  if (
    !isBookingEligibleApplication(
      app,
      reviews.data.map((row) => String(row.id)),
      null
    )
  ) {
    return {
      ok: true,
      state: "ineligible",
      mentorName,
      message: INELIGIBLE_MESSAGES[bookingBlockedReason(app.status)],
      hotlineZalo: HOTLINE_ZALO
    };
  }

  const openSlots = await readAllPages<Json>("interview_slots", "slot_starts_at", (columns) =>
    client
      .from("interview_slots")
      .select(columns)
      .eq("season_id", String(app.season_id))
      .eq("status", "open")
      .gt("slot_starts_at", nowIso)
  );
  if (openSlots.error) {
    log("open slots read failed", openSlots.error);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }

  const counts = countOpenSlotsByHour(
    openSlots.data.map((row) => ({ slot_starts_at: normIso(row.slot_starts_at) }))
  );
  let totalOpen = 0;
  counts.forEach((count) => {
    totalOpen += count;
  });

  const days: BookingPageDayGroup[] = buildSlotGrid(nowIso)
    .map((day) => ({
      dateKey: day.dateKey,
      label: day.label,
      hours: day.slots
        .filter((slot) => !slot.isPast && (counts.get(slot.startsAtIso) ?? 0) > 0)
        .map((slot) => ({
          startsAtIso: slot.startsAtIso,
          hour: slot.hour,
          openCount: counts.get(slot.startsAtIso) ?? 0
        }))
    }))
    .filter((day) => day.hours.length > 0);

  // Giờ mentor này đang chờ — nhiều nhất một dòng, database canh bằng chỉ số.
  const mine = await readAllPages<Json>("interview_mentor_availability", "slot_starts_at", (columns) =>
    client
      .from("interview_mentor_availability")
      .select(columns)
      .eq("application_id", String(app.id))
      .eq("status", "open")
  );
  if (mine.error) {
    log("mentor availability self read failed", mine.error);
    return { ok: false, state: "invalid", message: SAFE_ERROR };
  }

  return {
    ok: true,
    state: "eligible",
    mentorName,
    days,
    totalOpen,
    windowEndLabel: formatDate(slotInstant(INTERVIEW_WINDOW.lastDateKey, 7)),
    hotlineZalo: HOTLINE_ZALO,
    availability: {
      days: buildSlotGrid(nowIso),
      chosen: mine.data.length > 0 ? normIso(mine.data[0].slot_starts_at) : null
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Giữ chỗ và huỷ chỗ — qua RPC nguyên tử
// ─────────────────────────────────────────────────────────────────────────────

export type BookingActionResult = { ok: boolean; message: string; slotLabel?: string };

const BOOK_ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "Đường dẫn không còn hiệu lực — anh/chị mở lại từ email của ban tổ chức.",
  already_booked: "Anh/chị đã có một lịch trao đổi đang hiệu lực. Muốn đổi giờ, huỷ lịch cũ trước.",
  application_not_eligible: `Hồ sơ hiện không ở bước đặt lịch. Cần hỗ trợ, liên hệ Zalo ban tổ chức ${HOTLINE_ZALO}.`,
  slot_in_past: "Khung giờ này đã qua — anh/chị tải lại trang và chọn giờ khác.",
  slot_full: "Khung giờ này vừa có người giữ trước — anh/chị chọn giờ khác nhé."
};

const CANCEL_ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "Đường dẫn không còn hiệu lực — anh/chị mở lại từ email của ban tổ chức.",
  no_active_booking: "Không có lịch hẹn nào đang hiệu lực để huỷ.",
  inside_24h: `Buổi hẹn còn dưới 24 giờ nên không tự huỷ được nữa — anh/chị liên hệ Zalo ban tổ chức ${HOTLINE_ZALO} để được thu xếp.`,
  already_completed: "Buổi trao đổi này đã có kết quả nên không huỷ được."
};

/** Bóc payload jsonb hai bên (interviewer/candidate) mà ba hàm vam098 trả về. */
function parties(payload: Json) {
  const interviewer = (payload?.interviewer ?? {}) as Json;
  const candidate = (payload?.candidate ?? {}) as Json;
  return {
    slotIso: normIso(payload?.slot_starts_at),
    interviewer: {
      name: clean(interviewer.full_name) || clean(interviewer.email) || "Ban tổ chức",
      email: clean(interviewer.email),
      phone: clean(interviewer.phone) || null
    },
    candidate: {
      applicationId: clean(candidate.application_id),
      name: clean(candidate.full_name) || "anh/chị",
      email: clean(candidate.email),
      phone: clean(candidate.phone) || null
    }
  };
}

export async function bookInterviewSlot(input: {
  token: unknown;
  slotStartsAt: unknown;
}): Promise<BookingActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const token = clean(input.token);
  if (!token || !isValidUuid(token)) return { ok: false, message: BOOK_ERROR_MESSAGES.invalid_token };

  const nowIso = new Date().toISOString();
  const checked = isValidSlotInstant(clean(input.slotStartsAt), nowIso);
  if (!checked.ok) {
    return {
      ok: false,
      message: checked.code === "in_past" ? BOOK_ERROR_MESSAGES.slot_in_past : "Khung giờ không hợp lệ — tải lại trang rồi chọn lại."
    };
  }

  const { data, error } = await client.rpc("vam098_book_interview_slot", {
    p_token: token,
    p_slot_starts_at: checked.startsAtIso
  });
  if (error) {
    log("book rpc failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const payload = (data ?? {}) as Json;
  if (payload.ok !== true) {
    const code = clean(payload.code);
    return { ok: false, message: BOOK_ERROR_MESSAGES[code] ?? SAFE_ERROR };
  }

  const slotLabel = await sendBookingConfirmationEmails(payload, token);

  return {
    ok: true,
    message: `Đã giữ chỗ ${slotLabel}. Thư xác nhận đang được gửi tới email của anh/chị.`,
    slotLabel
  };
}

/**
 * Ba lá thư xác nhận một buổi hẹn vừa chốt: interviewer, mentor, ban tổ chức.
 *
 * Dùng chung cho CẢ HAI CHIỀU ghép — mentor tự giữ chỗ, và interviewer ghép
 * vào giờ mentor tự khai. Hai chiều sinh ra cùng một buổi hẹn, nên chúng không
 * được phép gửi hai bộ thư khác nhau; gom vào một cửa để sửa một chỗ là cả hai
 * cùng đúng.
 *
 * Chỗ đã giữ xong rồi khi hàm này chạy, nên mọi lỗi gửi chỉ ghi log: một lá
 * thư hỏng không được phép làm mentor tưởng mình chưa có lịch.
 */
async function sendBookingConfirmationEmails(payload: Json, bookingToken: string | null): Promise<string> {
  const info = parties(payload);
  const slotLabel = slotRangeLabel(info.slotIso);
  const requestOrigin = await getPublicOrigin();
  const seasonLabel = INTERVIEW_SEASON_CODE;
  try {
    if (info.interviewer.email) {
      await sendInterviewSchedule({
        toEmail: info.interviewer.email,
        interviewerName: info.interviewer.name,
        seasonLabel,
        slotLabel,
        candidateName: info.candidate.name,
        candidateEmail: info.candidate.email,
        candidatePhone: info.candidate.phone,
        reviewId: clean(payload.review_id) || null,
        requestOrigin
      });
    }
    if (info.candidate.email && bookingToken) {
      await sendInterviewInvite({
        toEmail: info.candidate.email,
        candidateName: info.candidate.name,
        seasonLabel,
        slotLabel,
        interviewerName: info.interviewer.name,
        interviewerEmail: info.interviewer.email,
        interviewerPhone: info.interviewer.phone,
        bookingToken,
        applicationId: info.candidate.applicationId,
        requestOrigin
      });
    } else if (info.candidate.email) {
      // Không có mã link riêng thì thư sẽ không mang được đường tự đổi lịch —
      // thà báo to ở log còn hơn gửi một lá thư cụt cho ứng viên.
      log("mentor confirmation email skipped: thiếu mã link riêng", info.candidate.applicationId);
    }
    await sendInterviewSchedule({
      toEmail: BTC_EMAIL,
      interviewerName: "Ban tổ chức",
      seasonLabel,
      slotLabel,
      candidateName: `${info.candidate.name} × ${info.interviewer.name}`,
      candidateEmail: info.candidate.email,
      candidatePhone: info.candidate.phone,
      applicationId: info.candidate.applicationId || null,
      requestOrigin
    });
  } catch (error) {
    log("booking confirmation emails crashed", error);
  }
  return slotLabel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chiều ngược: mentor khai giờ mình rảnh, interviewer mở lưới ra ghép
// ─────────────────────────────────────────────────────────────────────────────

export type SaveMentorAvailabilityResult = { ok: boolean; message: string };

/**
 * Mentor chọn MỘT giờ mình rảnh, rồi chờ interviewer khớp vào đúng giờ đó.
 *
 * Không phải là giữ chỗ: không ai bị hẹn ở đây. Và chỉ một giờ tại một thời
 * điểm (chủ dự án chốt 23/09/2026) — chọn giờ khác nghĩa là bỏ giờ cũ, chuỗi
 * rỗng nghĩa là thôi không chờ nữa.
 *
 * Thứ tự ghi là phần đáng chú ý: bỏ lời ngỏ cũ TRƯỚC rồi mới mở lời ngỏ mới.
 * Chỉ số bộ phận chỉ cho một dòng 'open' mỗi người, nên làm ngược lại sẽ vấp
 * 23505 — và đó chính là tấm lưới đỡ khi hai tab của cùng một người bấm hai giờ
 * khác nhau trong cùng một giây.
 */
export async function saveMentorAvailability(input: {
  token: unknown;
  slotStartsAt: unknown;
}): Promise<SaveMentorAvailabilityResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const token = clean(input.token);
  if (!token || !isValidUuid(token)) {
    return { ok: false, message: BOOK_ERROR_MESSAGES.invalid_token };
  }

  const { data: invite, error: inviteError } = await client
    .from("interview_slot_invites")
    .select("application_id")
    .eq("token", token)
    .maybeSingle();
  if (inviteError) {
    log("invite lookup failed", inviteError);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!invite?.application_id) {
    return { ok: false, message: BOOK_ERROR_MESSAGES.invalid_token };
  }
  const applicationId = String(invite.application_id);

  const { data: app, error: appError } = await client
    .from("applications")
    .select("id,status,role_applied,source,season_id")
    .eq("id", applicationId)
    .maybeSingle();
  if (appError || !app) {
    log("application read failed", appError);
    return { ok: false, message: SAFE_ERROR };
  }

  // Đã có lịch rồi thì lời ngỏ không còn nghĩa gì. Kiểm lại ở máy chủ chứ
  // không tin vào trang đã render — trang có thể mở từ nửa tiếng trước.
  const { data: booked, error: bookedError } = await client
    .from("interview_bookings")
    .select("id")
    .eq("application_id", applicationId)
    .eq("status", "booked")
    .limit(1);
  if (bookedError) {
    log("booking check failed", bookedError);
    return { ok: false, message: SAFE_ERROR };
  }
  if ((booked ?? []).length > 0) {
    return { ok: false, message: BOOK_ERROR_MESSAGES.already_booked };
  }

  const reviews = await readAllPages<Json>("application_reviews", "id,status,review_round", (columns) =>
    client
      .from("application_reviews")
      .select(columns)
      .eq("application_id", applicationId)
      .eq("review_round", "interview")
      .neq("status", "cancelled")
  );
  if (reviews.error) {
    log("reviews read failed", reviews.error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (!isBookingEligibleApplication(app, reviews.data.map((row) => String(row.id)), null)) {
    // Trang có thể đã mở từ trước khi hồ sơ đổi trạng thái — nói đúng lý do,
    // đừng đẩy người đang chờ chấm sang câu dành cho người đã có kết quả.
    return { ok: false, message: INELIGIBLE_MESSAGES[bookingBlockedReason(app.status)] };
  }

  const nowIso = new Date().toISOString();
  const wanted = clean(input.slotStartsAt);

  /**
   * Gỡ mọi lời ngỏ đang mở, trừ giờ vừa chọn. Điều kiện status='open' giữ
   * nguyên dòng đã ghép — dòng đó là bằng chứng của một buổi hẹn, không phải
   * một lựa chọn đang chờ.
   */
  async function clearOpenExcept(except: string | null) {
    let query = client!
      .from("interview_mentor_availability")
      .update({ status: "removed", removed_at: nowIso })
      .eq("application_id", applicationId)
      .eq("status", "open");
    if (except) query = query.neq("slot_starts_at", except);
    return query;
  }

  if (!wanted) {
    const { error } = await clearOpenExcept(null);
    if (error) {
      log("mentor availability clear failed", error);
      return { ok: false, message: SAFE_ERROR };
    }
    return { ok: true, message: "Đã bỏ giờ anh/chị khai. Lúc nào rảnh lại, anh/chị chọn giờ khác." };
  }

  const checked = isValidSlotInstant(wanted, nowIso);
  if (!checked.ok) {
    return { ok: false, message: "Khung giờ không hợp lệ hoặc đã qua — tải lại trang rồi chọn lại." };
  }

  const { error: clearError } = await clearOpenExcept(checked.startsAtIso);
  if (clearError) {
    log("mentor availability clear failed", clearError);
    return { ok: false, message: SAFE_ERROR };
  }

  const { error: insertError } = await client.from("interview_mentor_availability").upsert(
    [
      {
        application_id: applicationId,
        season_id: String(app.season_id),
        slot_starts_at: checked.startsAtIso,
        status: "open"
      }
    ],
    { onConflict: "application_id,slot_starts_at", ignoreDuplicates: true }
  );
  if (insertError) {
    log("mentor availability upsert failed", insertError);
    return { ok: false, message: SAFE_ERROR };
  }

  // Dòng cũ của đúng giờ này có thể đang 'removed' (từng bỏ rồi chọn lại) hoặc
  // 'matched' (từng được ghép rồi huỷ lịch). Cả hai đều mở lại được — đến đây
  // thì đã chắc người này không còn buổi hẹn nào đang hiệu lực. available_since
  // reset: đã rút lời thì xếp lại cuối hàng FIFO.
  const { error: reopenError } = await client
    .from("interview_mentor_availability")
    .update({ status: "open", available_since: nowIso, removed_at: null, matched_booking_id: null, matched_at: null })
    .eq("application_id", applicationId)
    .eq("slot_starts_at", checked.startsAtIso)
    .in("status", ["removed", "matched"]);
  if (reopenError) {
    log("mentor availability reopen failed", reopenError);
    return { ok: false, message: SAFE_ERROR };
  }

  return {
    ok: true,
    message: `Đã ghi nhận anh/chị rảnh ${slotRangeLabel(checked.startsAtIso)}. Ban tổ chức sẽ ghép và gửi thư xác nhận.`
  };
}

export type MatchResult = { ok: boolean; message: string; slotLabel?: string };

const MATCH_ERROR_MESSAGES: Record<string, string> = {
  missing_phone: "Anh/chị điền số điện thoại ở lưới giờ rảnh và bấm Lưu một lần trước đã — thư xác nhận gửi mentor cần số này.",
  slot_in_past: "Khung giờ này đã qua — tải lại trang rồi chọn giờ khác.",
  no_mentor_waiting: "Khung giờ này vừa hết người chờ — tải lại trang để xem danh sách mới nhất.",
  mentor_already_booked: "Người đứng đầu hàng vừa có lịch khác — tải lại trang rồi ghép lại.",
  interviewer_busy: "Anh/chị đã có một buổi hẹn đúng khung giờ này rồi."
};

/**
 * Interviewer bấm ghép một khung giờ đang có mentor chờ.
 *
 * Toàn bộ phần tranh chấp nằm trong vam099_match_mentor_at_hour: chọn người
 * khai sớm nhất, khoá đơn, mở giờ cho interviewer, tạo phiếu, đổi trạng thái —
 * một transaction. Ở đây chỉ còn gác quyền, dịch mã lỗi, và gửi thư.
 */
export async function matchMentorAtHour(input: { slotStartsAt: unknown }): Promise<MatchResult> {
  const access = await requireInterviewer();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, actor } = access;

  const nowIso = new Date().toISOString();
  const checked = isValidSlotInstant(clean(input.slotStartsAt), nowIso);
  if (!checked.ok) {
    return {
      ok: false,
      message:
        checked.code === "in_past"
          ? MATCH_ERROR_MESSAGES.slot_in_past
          : "Khung giờ không hợp lệ — tải lại trang rồi chọn lại."
    };
  }

  const { data, error } = await client.rpc("vam099_match_mentor_at_hour", {
    p_actor: actor.adminUserId,
    p_slot_starts_at: checked.startsAtIso
  });
  if (error) {
    log("match rpc failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const payload = (data ?? {}) as Json;
  if (payload.ok !== true) {
    return { ok: false, message: MATCH_ERROR_MESSAGES[clean(payload.code)] ?? SAFE_ERROR };
  }

  // Thư gửi mentor mang đường tự đổi lịch, nên phải có mã link riêng. Người
  // được ghép gần như luôn đã có mã (họ nhận thư mời mới khai được giờ), nhưng
  // ban tổ chức cũng khai hộ được nên vẫn tạo nếu thiếu.
  const applicationId = clean((payload.candidate as Json)?.application_id);
  const bookingToken = applicationId ? await ensureInterviewInviteToken(applicationId) : null;
  const slotLabel = await sendBookingConfirmationEmails(payload, bookingToken);
  const candidateName = clean((payload.candidate as Json)?.full_name) || "mentor";

  return {
    ok: true,
    message: `Đã ghép ${candidateName} vào ${slotLabel}. Thư xác nhận đang gửi cho cả hai bên.`,
    slotLabel
  };
}

async function sendCancellationEmails(
  client: any,
  payload: Json,
  cancelledByLabel: string
): Promise<void> {
  const info = parties(payload);
  const slotLabel = slotRangeLabel(info.slotIso);
  const requestOrigin = await getPublicOrigin();

  let rebookToken: string | null = null;
  if (info.candidate.applicationId) {
    rebookToken = await ensureInviteTokenRow(client, info.candidate.applicationId);
  }

  try {
    if (info.candidate.email) {
      await sendInterviewSlotCancelled({
        toEmail: info.candidate.email,
        audience: "candidate",
        recipientName: info.candidate.name,
        otherPartyName: info.interviewer.name,
        slotLabel,
        cancelledByLabel,
        bookingToken: rebookToken,
        applicationId: info.candidate.applicationId,
        requestOrigin
      });
    }
    if (info.interviewer.email) {
      await sendInterviewSlotCancelled({
        toEmail: info.interviewer.email,
        audience: "interviewer",
        recipientName: info.interviewer.name,
        otherPartyName: info.candidate.name,
        slotLabel,
        cancelledByLabel,
        applicationId: info.candidate.applicationId,
        requestOrigin
      });
    }
  } catch (error) {
    log("cancellation emails crashed", error);
  }
}

export async function cancelInterviewBookingByMentor(input: { token: unknown }): Promise<BookingActionResult> {
  const client = serviceClient();
  if (!client) return { ok: false, message: SAFE_ERROR };

  const token = clean(input.token);
  if (!token || !isValidUuid(token)) return { ok: false, message: CANCEL_ERROR_MESSAGES.invalid_token };

  const { data, error } = await client.rpc("vam098_cancel_interview_booking_mentor", { p_token: token });
  if (error) {
    log("mentor cancel rpc failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const payload = (data ?? {}) as Json;
  if (payload.ok !== true) {
    const code = clean(payload.code);
    return { ok: false, message: CANCEL_ERROR_MESSAGES[code] ?? SAFE_ERROR };
  }

  await sendCancellationEmails(client, payload, "anh/chị tự huỷ qua link");
  return { ok: true, message: "Đã huỷ lịch hẹn. Anh/chị chọn lại giờ khác ngay trên trang này." };
}

export async function cancelInterviewBookingByBtc(input: {
  bookingId: unknown;
  note?: unknown;
}): Promise<BookingActionResult> {
  const access = await requireBtc();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, adminUserId } = access;

  const bookingId = clean(input.bookingId);
  if (!bookingId || !isValidUuid(bookingId)) {
    return { ok: false, message: "Mã lịch hẹn không hợp lệ." };
  }

  const { data, error } = await client.rpc("vam098_cancel_interview_booking_btc", {
    p_booking_id: bookingId,
    p_actor: adminUserId,
    p_note: clean(input.note) || null
  });
  if (error) {
    log("btc cancel rpc failed", error);
    return { ok: false, message: SAFE_ERROR };
  }
  const payload = (data ?? {}) as Json;
  if (payload.ok !== true) {
    const code = clean(payload.code);
    return { ok: false, message: CANCEL_ERROR_MESSAGES[code] ?? SAFE_ERROR };
  }

  await sendCancellationEmails(client, payload, "ban tổ chức huỷ");
  return { ok: true, message: "Đã huỷ lịch hẹn và mở lại khung giờ. Hai bên đều nhận được thư báo." };
}

// ─────────────────────────────────────────────────────────────────────────────
// Danh sách mentor đủ điều kiện + trang tổng quan ban tổ chức
// ─────────────────────────────────────────────────────────────────────────────

type EligibleMentor = {
  applicationId: string;
  fullName: string;
  email: string;
  bucket: MentorBucket;
  activeBooking: { bookingId: string; slotStartsAtIso: string; interviewerAdminUserId: string } | null;
};

/**
 * Vũ trụ mentor của bộ lịch: đơn mentor qua form, hồ sơ còn mở, và phiếu
 * phỏng vấn sống duy nhất (nếu có) là phiếu do chính lịch đã đặt tạo ra.
 * `interview_in_progress` được đọc THÊM ở tầng truy vấn vì máy trạng thái có
 * thể đẩy đơn đã đặt lịch sang đó — nhưng nhóm "chưa đặt" thì vẫn xét đúng
 * chín trạng thái của luật đối tượng.
 */
async function listEligibleMentors(
  client: any,
  seasonId: string
): Promise<{ ok: true; mentors: EligibleMentor[] } | { ok: false; message: string }> {
  const statuses = [...Array.from(BOOKING_ELIGIBLE_STATUSES), "interview_in_progress"];
  const apps = await readAllPages<Json>(
    "applications",
    "id,status,full_name,email_primary,role_applied,source",
    (columns) =>
      client
        .from("applications")
        .select(columns)
        .eq("season_id", seasonId)
        .eq("role_applied", "mentor")
        .eq("source", "vam_os_form")
        .in("status", statuses)
  );
  if (apps.error) {
    log("eligible applications read failed", apps.error);
    return { ok: false, message: SAFE_ERROR };
  }
  if (apps.data.length === 0) return { ok: true, mentors: [] };

  const ids = apps.data.map((row) => String(row.id));
  const reviews = await readAllPagesIn<Json>(
    client,
    "application_reviews",
    "application_id",
    ids,
    "id,application_id,status,review_round",
    (query: any) => query.eq("review_round", "interview").neq("status", "cancelled")
  );
  if (reviews.error) {
    log("eligible reviews read failed", reviews.error);
    return { ok: false, message: SAFE_ERROR };
  }
  const bookings = await readAllPagesIn<Json>(
    client,
    "interview_bookings",
    "application_id",
    ids,
    "id,application_id,review_id,slot_starts_at,interviewer_admin_user_id,status",
    (query: any) => query.eq("status", "booked")
  );
  if (bookings.error) {
    log("eligible bookings read failed", bookings.error);
    return { ok: false, message: SAFE_ERROR };
  }

  const reviewsByApp = new Map<string, string[]>();
  for (const row of reviews.data) {
    const key = String(row.application_id);
    const list = reviewsByApp.get(key) ?? [];
    list.push(String(row.id));
    reviewsByApp.set(key, list);
  }
  const bookingByApp = new Map<string, Json>();
  for (const row of bookings.data) {
    bookingByApp.set(String(row.application_id), row);
  }

  const nowIso = new Date().toISOString();
  const mentors: EligibleMentor[] = [];
  for (const app of apps.data) {
    const id = String(app.id);
    const booking = bookingByApp.get(id) ?? null;
    const activeReviews = reviewsByApp.get(id) ?? [];
    const ownReviewId = booking ? clean(booking.review_id) || null : null;

    if (booking) {
      // Đơn đã đặt lịch: phiếu sống duy nhất phải là phiếu của buổi hẹn.
      const foreign = activeReviews.filter((reviewId) => reviewId !== ownReviewId);
      if (foreign.length > 0) continue;
    } else if (
      !isBookingEligibleApplication(
        { status: app.status, role_applied: app.role_applied, source: app.source },
        activeReviews,
        null
      )
    ) {
      continue;
    }

    mentors.push({
      applicationId: id,
      fullName: clean(app.full_name),
      email: clean(app.email_primary),
      bucket: classifyMentor(booking ? { slot_starts_at: normIso(booking.slot_starts_at) } : null, nowIso),
      activeBooking: booking
        ? {
            bookingId: String(booking.id),
            slotStartsAtIso: normIso(booking.slot_starts_at),
            interviewerAdminUserId: String(booking.interviewer_admin_user_id)
          }
        : null
    });
  }
  return { ok: true, mentors };
}

export type BtcOverview =
  | {
      ok: true;
      openFutureHours: number;
      mentors: { eligibleTotal: number; notBooked: number; bookedUpcoming: number; bookedPast: number };
      invitesDueNow: number;
      perInterviewer: Array<{ adminUserId: string; name: string; phone: string | null; stats: InterviewerStats }>;
      upcomingBookings: Array<{
        bookingId: string;
        slotStartsAtIso: string;
        slotLabel: string;
        candidateName: string;
        candidateEmail: string;
        interviewerName: string;
      }>;
    }
  | { ok: false; message: string };

export async function getBtcOverview(): Promise<BtcOverview> {
  const access = await requireBtc();
  if (!access.ok) return { ok: false, message: access.message };
  const { client, seasonId } = access;
  const nowIso = new Date().toISOString();
  const nowMs = new Date(nowIso).getTime();

  const slots = await readAllPages<Json>("interview_slots", "id,admin_user_id,slot_starts_at,status", (columns) =>
    client.from("interview_slots").select(columns).eq("season_id", seasonId)
  );
  if (slots.error) {
    log("overview slots read failed", slots.error);
    return { ok: false, message: SAFE_ERROR };
  }

  const eligible = await listEligibleMentors(client, seasonId);
  if (!eligible.ok) return { ok: false, message: eligible.message };
  const mentors = eligible.mentors;

  // Số thư mời/nhắc đang đến hạn — con số cạnh nút "Gửi ngay".
  const notBooked = mentors.filter((mentor) => mentor.bucket === "not_booked");
  let invitesDueNow = 0;
  if (notBooked.length > 0) {
    const invites = await readAllPagesIn<Json>(
      client,
      "interview_slot_invites",
      "application_id",
      notBooked.map((mentor) => mentor.applicationId),
      "id,application_id,send_count,last_sent_at"
    );
    if (invites.error) {
      log("overview invites read failed", invites.error);
      return { ok: false, message: SAFE_ERROR };
    }
    const inviteByApp = new Map(invites.data.map((row) => [String(row.application_id), row]));
    for (const mentor of notBooked) {
      const invite = inviteByApp.get(mentor.applicationId);
      const state = invite
        ? { send_count: Number(invite.send_count) || 0, last_sent_at: invite.last_sent_at ? String(invite.last_sent_at) : null }
        : { send_count: 0, last_sent_at: null };
      if (inviteSendDue(state, nowMs).due) invitesDueNow += 1;
    }
  }

  // Bảng theo interviewer.
  const slotsByInterviewer = new Map<string, Json[]>();
  for (const slot of slots.data) {
    const key = String(slot.admin_user_id);
    const list = slotsByInterviewer.get(key) ?? [];
    list.push(slot);
    slotsByInterviewer.set(key, list);
  }
  const interviewerIds = Array.from(slotsByInterviewer.keys());
  const nameById = new Map<string, string>();
  const phoneById = new Map<string, string>();
  if (interviewerIds.length > 0) {
    const admins = await readAllPagesIn<Json>(client, "admin_users", "id", interviewerIds, "id,full_name,email");
    if (admins.error) {
      log("overview admins read failed", admins.error);
      return { ok: false, message: SAFE_ERROR };
    }
    for (const row of admins.data) {
      nameById.set(String(row.id), clean(row.full_name) || clean(row.email));
    }
    const profiles = await readAllPagesIn<Json>(
      client,
      "interviewer_profiles",
      "admin_user_id",
      interviewerIds,
      "admin_user_id,phone"
    );
    if (!profiles.error) {
      for (const row of profiles.data) phoneById.set(String(row.admin_user_id), clean(row.phone));
    }
  }
  const perInterviewer = interviewerIds
    .map((adminUserId) => ({
      adminUserId,
      name: nameById.get(adminUserId) || "(không rõ)",
      phone: phoneById.get(adminUserId) || null,
      stats: computeInterviewerStats(
        (slotsByInterviewer.get(adminUserId) ?? []).map((slot) => ({
          slot_starts_at: normIso(slot.slot_starts_at),
          status: String(slot.status)
        })),
        nowIso
      )
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));

  const openFutureHours = slots.data.filter(
    (slot) => String(slot.status) === "open" && new Date(normIso(slot.slot_starts_at)).getTime() > nowMs
  ).length;

  const upcomingBookings = mentors
    .filter((mentor) => mentor.bucket === "booked_upcoming" && mentor.activeBooking)
    .map((mentor) => ({
      bookingId: mentor.activeBooking!.bookingId,
      slotStartsAtIso: mentor.activeBooking!.slotStartsAtIso,
      slotLabel: slotRangeLabel(mentor.activeBooking!.slotStartsAtIso),
      candidateName: mentor.fullName,
      candidateEmail: mentor.email,
      interviewerName: nameById.get(mentor.activeBooking!.interviewerAdminUserId) || "(không rõ)"
    }))
    .sort((a, b) => a.slotStartsAtIso.localeCompare(b.slotStartsAtIso));

  return {
    ok: true,
    openFutureHours,
    mentors: {
      eligibleTotal: mentors.length,
      notBooked: notBooked.length,
      bookedUpcoming: mentors.filter((mentor) => mentor.bucket === "booked_upcoming").length,
      bookedPast: mentors.filter((mentor) => mentor.bucket === "booked_past").length
    },
    invitesDueNow,
    perInterviewer,
    upcomingBookings
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mã link riêng + bộ gửi thư mời/nhắc
// ─────────────────────────────────────────────────────────────────────────────

async function ensureInviteTokenRow(client: any, applicationId: string): Promise<string | null> {
  const { error: upsertError } = await client
    .from("interview_slot_invites")
    .upsert({ application_id: applicationId }, { onConflict: "application_id", ignoreDuplicates: true });
  if (upsertError) {
    log("invite upsert failed", upsertError);
    return null;
  }
  const { data, error } = await client
    .from("interview_slot_invites")
    .select("token")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error || !data?.token) {
    if (error) log("invite token read failed", error);
    return null;
  }
  return String(data.token);
}

/**
 * Mã link đặt lịch cho một đơn mentor vừa nộp — gọi từ luồng xác nhận đơn.
 * Trả null khi đợt phỏng vấn đã hết hoặc hạ tầng trục trặc: thư xác nhận vẫn
 * đi, chỉ vắng nút chọn giờ.
 */
export async function ensureInterviewInviteToken(applicationId: unknown): Promise<string | null> {
  const id = clean(applicationId);
  if (!id || !isValidUuid(id)) return null;
  if (Date.now() > windowEndMs()) return null;
  const client = serviceClient();
  if (!client) return null;
  return ensureInviteTokenRow(client, id);
}

function dispatchFail(message: string): DispatchResult {
  return { ok: false, message, sent: 0, failed: 0, remaining: 0, stopped429: false };
}

/**
 * Một lượt gửi thư mời/nhắc — mỗi lượt tối đa INVITE_CHUNK thư trong ngân
 * sách thời gian. Idempotent và an toàn khi hai nơi cùng bấm: dòng nào UPDATE
 * được claimed_at từ NULL thì nơi đó gửi, nơi kia nhận tập rời — đúng khuôn
 * đã dùng cho thư khảo sát.
 */
async function runDispatchCore(client: any, seasonId: string, budgetMs: number): Promise<DispatchResult> {
  const startedMs = Date.now();
  const nowIso = new Date(startedMs).toISOString();

  // Không có giờ trống ở tương lai thì không mời ai cả — một thư mời trỏ vào
  // lịch rỗng chỉ dạy người nhận bỏ qua các thư sau.
  const { data: anyOpen, error: openError } = await client
    .from("interview_slots")
    .select("id")
    .eq("season_id", seasonId)
    .eq("status", "open")
    .gt("slot_starts_at", nowIso)
    .limit(1);
  if (openError) {
    log("dispatch open-slot check failed", openError);
    return dispatchFail(SAFE_ERROR);
  }
  if (!anyOpen || anyOpen.length === 0) {
    return { ok: true, message: "Chưa có giờ trống nào ở tương lai — không gửi thư.", sent: 0, failed: 0, remaining: 0, stopped429: false };
  }
  if (Date.now() > windowEndMs()) {
    return { ok: true, message: "Đợt phỏng vấn đã kết thúc — không gửi thư.", sent: 0, failed: 0, remaining: 0, stopped429: false };
  }

  const eligible = await listEligibleMentors(client, seasonId);
  if (!eligible.ok) return dispatchFail(eligible.message);
  const recipients = eligible.mentors.filter((mentor) => mentor.bucket === "not_booked" && mentor.email);
  if (recipients.length === 0) {
    return { ok: true, message: "Mọi mentor đủ điều kiện đều đã đặt lịch.", sent: 0, failed: 0, remaining: 0, stopped429: false };
  }
  const recipientById = new Map(recipients.map((mentor) => [mentor.applicationId, mentor]));

  // Ai chưa có mã link thì cấp — ignoreDuplicates nên chạy lại vô hại.
  const { error: ensureError } = await client
    .from("interview_slot_invites")
    .upsert(
      recipients.map((mentor) => ({ application_id: mentor.applicationId })),
      { onConflict: "application_id", ignoreDuplicates: true }
    );
  if (ensureError) {
    log("dispatch ensure invites failed", ensureError);
    return dispatchFail(SAFE_ERROR);
  }

  // Claim mồ côi quá 10 phút (tab đóng giữa chừng, request chết) thu hồi được.
  const staleIso = new Date(startedMs - INVITE_STALE_CLAIM_MS).toISOString();
  const { error: staleError } = await client
    .from("interview_slot_invites")
    .update({ claimed_at: null })
    .lt("claimed_at", staleIso);
  if (staleError) log("dispatch stale release failed", staleError);

  const invites = await readAllPagesIn<Json>(
    client,
    "interview_slot_invites",
    "application_id",
    recipients.map((mentor) => mentor.applicationId),
    "id,application_id,token,send_count,first_sent_at,last_sent_at,claimed_at"
  );
  if (invites.error) {
    log("dispatch invites read failed", invites.error);
    return dispatchFail(SAFE_ERROR);
  }

  const due = invites.data
    .filter((row) => !row.claimed_at)
    .map((row) => ({
      id: String(row.id),
      applicationId: String(row.application_id),
      token: String(row.token ?? ""),
      sendCount: Number(row.send_count) || 0,
      firstSentAt: row.first_sent_at ? String(row.first_sent_at) : null,
      lastSentAt: row.last_sent_at ? String(row.last_sent_at) : null
    }))
    .filter((row) => inviteSendDue({ send_count: row.sendCount, last_sent_at: row.lastSentAt }, startedMs).due)
    .sort((a, b) => {
      if (a.lastSentAt === b.lastSentAt) return a.id.localeCompare(b.id);
      if (a.lastSentAt === null) return -1;
      if (b.lastSentAt === null) return 1;
      return a.lastSentAt.localeCompare(b.lastSentAt);
    });

  if (due.length === 0) {
    return { ok: true, message: "Chưa tới lượt gửi cho ai (nhịp nhắc 3 ngày).", sent: 0, failed: 0, remaining: 0, stopped429: false };
  }

  const chunk = due.slice(0, INVITE_CHUNK);
  const claimStamp = nowIso;
  const { data: claimedRows, error: claimError } = await client
    .from("interview_slot_invites")
    .update({ claimed_at: claimStamp })
    .in(
      "id",
      chunk.map((row) => row.id)
    )
    .is("claimed_at", null)
    .select("id");
  if (claimError) {
    log("dispatch claim failed", claimError);
    return dispatchFail(SAFE_ERROR);
  }
  const claimedIds = new Set((claimedRows ?? []).map((row: Json) => String(row.id)));
  const claimed = chunk.filter((row) => claimedIds.has(row.id));

  const requestOrigin = await getPublicOrigin();
  const windowEndLabel = formatDate(slotInstant(INTERVIEW_WINDOW.lastDateKey, 7));

  let sent = 0;
  let failed = 0;
  let stopped429 = false;
  const release: string[] = [];

  for (const row of claimed) {
    if (stopped429 || Date.now() - startedMs > budgetMs) {
      release.push(row.id);
      continue;
    }
    const mentor = recipientById.get(row.applicationId);
    if (!mentor || !row.token) {
      release.push(row.id);
      continue;
    }

    const sendNumber = row.sendCount + 1;
    let outcome: { ok: boolean; skipped: boolean; reason?: string; providerStatus?: number | null };
    try {
      outcome = await sendInterviewSlotInvite({
        toEmail: mentor.email,
        candidateName: mentor.fullName || "anh/chị",
        seasonLabel: INTERVIEW_SEASON_CODE,
        bookingToken: row.token,
        reminderNumber: row.sendCount,
        windowEndLabel,
        ccBtc: sendNumber === 4,
        applicationId: mentor.applicationId,
        requestOrigin
      });
    } catch (error) {
      log("dispatch send crashed", error);
      outcome = { ok: false, skipped: false, reason: String(error) };
    }

    if (outcome.ok && !outcome.skipped) {
      sent += 1;
      const { error: doneError } = await client
        .from("interview_slot_invites")
        .update({
          send_count: sendNumber,
          first_sent_at: row.firstSentAt ?? nowIso,
          last_sent_at: nowIso,
          last_error: null,
          claimed_at: null,
          updated_at: nowIso
        })
        .eq("id", row.id)
        .eq("claimed_at", claimStamp);
      if (doneError) log("dispatch finalize failed", doneError);
    } else if (outcome.skipped) {
      // Cổng gửi thư chặn (môi trường thử): KHÔNG đốt lượt — send_count giữ
      // nguyên để bản production thật vẫn gửi đủ chuỗi mời + 3 nhắc.
      const { error: skipError } = await client
        .from("interview_slot_invites")
        .update({ claimed_at: null, last_error: outcome.reason ?? "Bị chặn bởi cấu hình gửi thư", updated_at: nowIso })
        .eq("id", row.id)
        .eq("claimed_at", claimStamp);
      if (skipError) log("dispatch skip release failed", skipError);
    } else {
      failed += 1;
      if (outcome.providerStatus === 429) stopped429 = true;
      const { error: failError } = await client
        .from("interview_slot_invites")
        .update({ claimed_at: null, last_error: (outcome.reason ?? "Gửi thất bại").slice(0, 500), updated_at: nowIso })
        .eq("id", row.id)
        .eq("claimed_at", claimStamp);
      if (failError) log("dispatch fail release failed", failError);
    }
  }

  if (release.length > 0) {
    const { error: releaseError } = await client
      .from("interview_slot_invites")
      .update({ claimed_at: null })
      .in("id", release)
      .eq("claimed_at", claimStamp);
    if (releaseError) log("dispatch release failed", releaseError);
  }

  const remaining = stopped429 ? 0 : Math.max(0, due.length - sent - failed);
  const note = stopped429
    ? `Đã gửi ${sent} thư rồi chạm trần thư trong ngày của Brevo — phần còn lại tự gửi ở lượt sau.`
    : `Đã gửi ${sent} thư${failed > 0 ? `, ${failed} thư lỗi` : ""}${remaining > 0 ? `, còn ${remaining} người trong hàng đợi` : ""}.`;
  return { ok: true, message: note, sent, failed, remaining, stopped429 };
}

/**
 * Cửa công khai của bộ gửi: `manual`/`tick` đòi quyền ban tổ chức; `cron`
 * không đọc phiên (route đã kiểm CRON_SECRET trước khi gọi).
 */
export async function runInterviewInviteDispatch(input: {
  source: "manual" | "tick" | "cron";
  budgetMs?: number;
}): Promise<DispatchResult> {
  if (input.source === "cron") {
    const client = serviceClient();
    if (!client) return dispatchFail(SAFE_ERROR);
    const season = await resolveSeasonId(client);
    if (!season.ok) return dispatchFail(season.message);
    return runDispatchCore(client, season.id, input.budgetMs ?? INVITE_TIME_BUDGET_MS);
  }

  const access = await requireBtc();
  if (!access.ok) return dispatchFail(access.message);
  return runDispatchCore(access.client, access.seasonId, input.budgetMs ?? INVITE_TIME_BUDGET_MS);
}
