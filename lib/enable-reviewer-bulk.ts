import "server-only";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { enableMentorAsReviewer } from "@/lib/enable-reviewer";
import { countSentInWindow } from "@/lib/mentee-invite-dispatch";
import { canManageReviewers } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import {
  bulkGrantAllowance,
  matchEmailsToPool,
  parseEmailList,
  type BulkGrantCandidatePool
} from "@/lib/reviewer-invite-dispatch-core";
import { getReviewerPool } from "@/lib/data";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

/**
 * lib/enable-reviewer-bulk.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cấp quyền reviewer/interviewer cho MỘT DANH SÁCH mentor dán vào ô nhập, thay
 * vì bấm từng dòng trên /reviews/reviewer-pool.
 *
 * KHÔNG viết lại logic cấp quyền — gọi lại đúng `enableMentorAsReviewer` cho
 * từng người, y hệt một lần bấm tay trên màn hình đó. Phần MỚI duy nhất ở đây
 * là: khớp email với đúng mentor của mùa, và giới hạn một lượt xử lý bao
 * nhiêu người để không vượt hạn mức thư Brevo thật (xem
 * lib/reviewer-invite-dispatch-core.ts).
 *
 * Xử lý TUẦN TỰ, không song song — mỗi người đụng tới Supabase Auth API và
 * một RPC ghi nguyên tử; chạy đồng thời hàng chục lượt gọi đó chỉ để nhanh hơn
 * vài giây là đánh đổi không đáng với rủi ro chạm rate limit của Auth API.
 */

const SAFE_ERROR = "Hệ thống đang bận, thử lại sau ít phút.";

export type BulkGrantOutcome = { email: string; message: string };

export type BulkGrantResult = {
  ok: boolean;
  message: string;
  granted: BulkGrantOutcome[];
  failed: BulkGrantOutcome[];
  notFound: string[];
  skippedDueToQuota: string[];
};

function fail(message: string): BulkGrantResult {
  return { ok: false, message, granted: [], failed: [], notFound: [], skippedDueToQuota: [] };
}

export async function bulkEnableMentorsAsReviewers(input: {
  /** Nguyên văn nội dung ô nhập — có thể là nhiều dòng, dấu phẩy, khoảng trắng. */
  rawEmails: string;
  intakeBatchId: string;
  participationRole: "reviewer" | "interviewer";
}): Promise<BulkGrantResult> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return fail("Bạn chưa đăng nhập.");
  if (!canManageReviewers(actor.role)) return fail("Bạn không có quyền quản lý reviewer/interviewer.");
  if (input.participationRole !== "reviewer" && input.participationRole !== "interviewer") {
    return fail("Vai trò tham gia không hợp lệ.");
  }

  const intakeBatchId = String(input.intakeBatchId ?? "").trim();
  if (!intakeBatchId) return fail("Vui lòng chọn đợt tuyển trước khi dán danh sách.");

  const emails = parseEmailList(input.rawEmails);
  if (emails.length === 0) return fail("Chưa nhận được email nào — dán mỗi dòng một email, hoặc cách nhau bởi dấu phẩy.");

  const client = getSupabaseServiceRoleClient();
  if (!client) return fail(SAFE_ERROR);

  const { data: batchRows, error: batchError } = await client
    .from("intake_batches")
    .select("id,season_id")
    .eq("id", intakeBatchId)
    .limit(1);
  if (batchError) return fail(SAFE_ERROR);
  const seasonId = String((batchRows?.[0] as { season_id?: string } | undefined)?.season_id ?? "").trim();
  if (!seasonId) return fail("Đợt tuyển này chưa gắn mùa.");

  if (!(await canOperateSeason(await getAdminScopeContext(), seasonId))) {
    return fail("Bạn không có quyền vận hành mùa này.");
  }

  const pool = await getReviewerPool({ intakeBatchId });
  if (pool.error) return fail(SAFE_ERROR);

  const candidatePool: BulkGrantCandidatePool = pool.data
    .filter((row): row is typeof row & { person_id: string; email_primary: string } => Boolean(row.person_id) && Boolean(row.email_primary))
    .map((row) => ({ personId: row.person_id, email: row.email_primary }));

  const { matched, notFound } = matchEmailsToPool(emails, candidatePool);
  if (matched.length === 0) {
    return {
      ok: true,
      message: `Không ai trong danh sách khớp mentor của đợt tuyển này. Kiểm lại: email phải đúng email mentor đã dùng để nộp đơn trên VAM OS.`,
      granted: [],
      failed: [],
      notFound,
      skippedDueToQuota: []
    };
  }

  const sentInWindow = await countSentInWindow(client, Date.now());
  if (sentInWindow === null) {
    return fail("Không đếm được số thư đã gửi trong 24 giờ qua, nên chưa xử lý — xử lý mù có thể làm các thư khác của hệ thống bị chặn.");
  }
  const allowance = bulkGrantAllowance(sentInWindow);
  const toProcess = matched.slice(0, allowance);
  const skippedDueToQuota = matched.slice(allowance).map((row) => row.email);

  const granted: BulkGrantOutcome[] = [];
  const failed: BulkGrantOutcome[] = [];

  for (const candidate of toProcess) {
    const result = await enableMentorAsReviewer({
      personId: candidate.personId,
      seasonId,
      participationRole: input.participationRole
    });
    (result.ok ? granted : failed).push({ email: candidate.email, message: result.message });
  }

  const parts = [`Đã xử lý ${granted.length + failed.length}/${matched.length} người khớp được.`];
  if (failed.length > 0) parts.push(`${failed.length} người cấp quyền thất bại — xem chi tiết bên dưới.`);
  if (skippedDueToQuota.length > 0) {
    parts.push(
      `${skippedDueToQuota.length} người CHƯA xử lý vì đã chạm hạn mức thư trong 24 giờ qua (đã gửi ${sentInWindow} thư cả hệ thống) — bấm lại sau để tiếp tục đúng những người còn lại.`
    );
  }
  if (notFound.length > 0) parts.push(`${notFound.length} email không khớp mentor nào của đợt tuyển này.`);

  return { ok: true, message: parts.join(" "), granted, failed, notFound, skippedDueToQuota };
}
