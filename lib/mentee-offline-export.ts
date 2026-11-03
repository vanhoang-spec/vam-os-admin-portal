import "server-only";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { SEASON_CONFIG } from "@/lib/season-config";
import { canExportMenteeOffline } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { readAllPages, readAllPagesIn } from "@/lib/paged-read";
import { vietnamDateKey } from "@/lib/utils";
import { MAX_EXPORT_IDS, type ExportFilters, type ExportSummaryRow } from "@/lib/mentee-offline-export-filter";
import {
  buildExportTable,
  filteredIds,
  summaryRows,
  type ExportApplication,
  type ExportBooking,
  type ExportDataset,
  type ExportOperation,
  type ExportReview,
  type ExportSession
} from "@/lib/mentee-offline-export-core";
import { menteeOfflineXlsx } from "@/lib/mentee-offline-export-xlsx";

/**
 * VAM00023 — đọc dữ liệu và dựng file Excel hồ sơ + phiếu đánh giá của mentee phỏng vấn trực tiếp.
 *
 * Cổng tải HẸP hơn cổng xem màn hình (CLAUDE.md): vai trò (canExportMenteeOffline) VÀ quyền vận hành mùa. Mọi lần đọc
 * dùng khoá service role SAU khi đã qua cổng, và đọc phân trang đến hết (lib/paged-read.ts) — 903 mentee mùa 12 vượt
 * giới hạn 1000 dòng của một lần đọc PostgREST nếu cộng cả phiếu. Không ghi gì vào database.
 */

export type ExportFailure = { ok: false; status: 401 | 403 | 400 | 500; message: string };

const DENIED: ExportFailure = { ok: false, status: 403, message: "Bạn chưa có quyền xuất file này. Chỉ Super admin, Admin và Core team có quyền vận hành mùa mới xuất được." };
const UNAVAILABLE: ExportFailure = { ok: false, status: 500, message: "Chưa đọc được dữ liệu. Vui lòng thử lại sau ít phút." };

type Client = NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>;

async function authorize(): Promise<{ ok: true; client: Client; seasonId: string } | ExportFailure> {
  const actor = await getCurrentAdminUser();
  if (!actor) return { ok: false, status: 401, message: "Bạn chưa đăng nhập." };
  if (!canExportMenteeOffline(actor.role)) return DENIED;
  const client = getSupabaseServiceRoleClient();
  if (!client) return UNAVAILABLE;
  const season = await client.from("seasons").select("id").eq("code", SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE).single();
  if (season.error || !season.data) return UNAVAILABLE;
  const seasonId = String(season.data.id);
  try {
    // Không đọc được phạm vi thì KHÔNG cho tải: lỗi hạ tầng không được biến thành quyền.
    if (!(await canOperateSeason(await getAdminScopeContext(), seasonId))) return DENIED;
  } catch {
    return DENIED;
  }
  return { ok: true, client, seasonId };
}

const REVIEW_COLUMNS =
  "id,application_id,review_round,reviewer_admin_user_id,status,score_motivation,score_goal_clarity,score_commitment,score_fit,score_communication,total_score," +
  "recommendation,reviewer_note,interview_scores,weighted_score,key_development_need,expectation_alignment,alignment_note,take_choice,desired_mentor_profile," +
  "additional_note,submitted_at,created_at,updated_at";

/** Mentee đang giữ ca phỏng vấn của mùa (cùng tập với màn hình phỏng vấn) kèm phiếu hiện tại. KHÔNG đọc đơn đăng ký chi tiết. */
async function loadDataset(client: Client, seasonId: string): Promise<ExportDataset | null> {
  const bookings = await readAllPages<ExportBooking>("mentee_interview_bookings", "application_id,session_id,booked_at", (columns) =>
    client.from("mentee_interview_bookings").select(columns).eq("season_id", seasonId).eq("status", "booked")
  );
  const sessions = await readAllPages<ExportSession>("interview_sessions", "id,starts_at,venue", (columns) =>
    client.from("interview_sessions").select(columns).eq("season_id", seasonId)
  );
  if (bookings.error || sessions.error) return null;
  const applicationIds = Array.from(new Set(bookings.data.map((booking) => String(booking.application_id))));

  const [applications, operations, reviews] = await Promise.all([
    readAllPagesIn<ExportApplication>(client, "applications", "id", applicationIds, "id,full_name,email_primary,phone_primary,status"),
    readAllPagesIn<ExportOperation>(client, "mentee_interview_operations", "id", applicationIds, "id,outcome,outcome_reason,checked_in_at,room,desk,is_online"),
    // Phiếu đã huỷ là người đánh giá cũ: không lấy (VAM00023 — chỉ người đánh giá hiện tại).
    readAllPagesIn<ExportReview>(client, "application_reviews", "application_id", applicationIds, REVIEW_COLUMNS, (query) => query.neq("status", "cancelled"))
  ]);
  if (applications.error || operations.error || reviews.error) return null;

  const reviewerIds = Array.from(new Set(reviews.data.map((review) => String(review.reviewer_admin_user_id ?? "")).filter(Boolean)));
  const staff = await readAllPagesIn<{ id: string; full_name: string | null; email: string | null }>(client, "admin_users", "id", reviewerIds, "id,full_name,email");
  if (staff.error) return null;
  return {
    applications: applications.data,
    bookings: bookings.data,
    sessions: sessions.data,
    operations: operations.data,
    reviews: reviews.data,
    staffNames: new Map(staff.data.map((row) => [String(row.id), String(row.full_name || row.email || "")]))
  };
}

export type ExportOptions = { ok: true; rows: ExportSummaryRow[] } | ExportFailure;

/** Danh sách cho trang chọn mentee. Nhẹ: tên, ca, người đánh giá và kết quả từng vòng; không có đơn, SĐT hay nhận xét. */
export async function getMenteeOfflineExportOptions(): Promise<ExportOptions> {
  const access = await authorize();
  if (!access.ok) return access;
  const dataset = await loadDataset(access.client, access.seasonId);
  if (!dataset) return UNAVAILABLE;
  return { ok: true, rows: summaryRows(dataset) };
}

export type ExportFile = { ok: true; bytes: Buffer; filename: string; count: number } | ExportFailure;

/** File Excel cho các mentee khớp bộ lọc (điều kiện nào cũng áp lại ở đây, không tin biểu mẫu). */
export async function exportMenteeOffline(filters: ExportFilters): Promise<ExportFile> {
  const access = await authorize();
  if (!access.ok) return access;
  const dataset = await loadDataset(access.client, access.seasonId);
  if (!dataset) return UNAVAILABLE;
  const ids = filteredIds(dataset, filters);
  if (!ids.length) return { ok: false, status: 400, message: "Không có mentee nào khớp bộ lọc để xuất." };
  if (ids.length > MAX_EXPORT_IDS) return { ok: false, status: 400, message: `Chọn tối đa ${MAX_EXPORT_IDS} mentee mỗi lần xuất.` };

  // Đơn đăng ký (câu trả lời, có thể vài KB mỗi bạn) chỉ đọc cho đúng những bạn được xuất.
  const payloads = await readAllPagesIn<{ id: string; raw_payload: Record<string, unknown> | null }>(access.client, "applications", "id", ids, "id,raw_payload");
  if (payloads.error) return UNAVAILABLE;
  const payloadById = new Map(payloads.data.map((row) => [String(row.id), row.raw_payload]));
  const withPayload: ExportDataset = {
    ...dataset,
    applications: dataset.applications.map((application) => ({ ...application, raw_payload: payloadById.get(application.id) ?? null }))
  };

  const bytes = menteeOfflineXlsx(buildExportTable(withPayload, ids));
  const seasonLabel = /S\d+$/i.exec(SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE)?.[0].toUpperCase() ?? "mua";
  const day = (vietnamDateKey(new Date()) ?? "").replace(/-/g, "");
  return { ok: true, bytes, filename: `mentee-phong-van-truc-tiep-${seasonLabel}-${day}.xlsx`, count: ids.length };
}
