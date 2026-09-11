import "server-only";

import { sendReviewBatchAssigned } from "@/lib/email";
import { getPublicOrigin } from "@/lib/public-url";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { formatDate } from "@/lib/utils";

/**
 * Thư báo cho người chấm, ngay sau khi một lô hồ sơ được giao.
 *
 * ---------------------------------------------------------------------------
 * VIỆC GIAO ĐÃ XONG TRƯỚC KHI THƯ ĐI
 * ---------------------------------------------------------------------------
 * Hàm này chạy SAU khi lô đã được ghi. Thư không đi được — người chấm thiếu
 * email, gửi thư đang tắt, nhà cung cấp từ chối — thì lô vẫn đã giao, và người
 * vận hành cần biết đúng điều đó: "đã giao, nhưng chưa báo được".
 *
 * Nên hàm KHÔNG BAO GIỜ ném lỗi ra ngoài. Một lỗi gửi thư mà bị hiểu thành
 * "giao thất bại" sẽ khiến người ta bấm giao lại một lô đã nằm trong tay người
 * chấm.
 *
 * ---------------------------------------------------------------------------
 * ĐỌC LẠI TỪ DATABASE, KHÔNG TIN BIỂU MẪU
 * ---------------------------------------------------------------------------
 * Email người nhận, mùa và vai trò đều đọc lại theo đúng hồ sơ vừa giao. Biểu
 * mẫu có ô `role_applied`, nhưng thứ đến từ biểu mẫu là thứ người gửi tự đặt
 * được — và một lá thư gọi đơn mentor là "hồ sơ mentee" sai ngay với người đang
 * cầm lô đó.
 */

export type ReviewerNotice =
  | { status: "sent"; reviewerLabel: string }
  | { status: "not_sent"; reviewerLabel: string; reason: string };

const FALLBACK_LABEL = "người chấm";

export async function notifyReviewerOfAssignment(input: {
  reviewerAdminUserId: string;
  /** Các hồ sơ vừa giao. Hàm giao đã bắt cả lô cùng một mùa và một vai trò. */
  applicationIds: string[];
  applicationsAssigned: number;
  dueAt: string | null;
  assignmentBatchId: string;
}): Promise<ReviewerNotice> {
  try {
    const client = getSupabaseServiceRoleClient();
    if (!client) {
      return { status: "not_sent", reviewerLabel: FALLBACK_LABEL, reason: "Máy chủ chưa kết nối được database." };
    }

    const { data: reviewer, error: reviewerError } = await client
      .from("admin_users")
      .select("id, email, full_name")
      .eq("id", input.reviewerAdminUserId)
      .maybeSingle();
    if (reviewerError || !reviewer) {
      return { status: "not_sent", reviewerLabel: FALLBACK_LABEL, reason: "Không đọc được thông tin người chấm." };
    }

    const fullName = String(reviewer.full_name ?? "").trim();
    const toEmail = String(reviewer.email ?? "").trim();
    const reviewerLabel = fullName || toEmail || FALLBACK_LABEL;
    if (!toEmail) {
      return { status: "not_sent", reviewerLabel, reason: "Người chấm chưa có địa chỉ email." };
    }

    const { data: application, error: applicationError } = await client
      .from("applications")
      .select("id, role_applied, season_id")
      .eq("id", input.applicationIds[0] ?? "")
      .maybeSingle();
    if (applicationError || !application) {
      return { status: "not_sent", reviewerLabel, reason: "Không đọc được hồ sơ vừa giao." };
    }

    // Thiếu mùa thì vẫn gửi: mẫu thư tự nói "mùa mới". Thư báo có việc mà thiếu
    // tên mùa vẫn hơn không có thư.
    let seasonLabel = "";
    if (application.season_id) {
      const { data: season } = await client
        .from("seasons")
        .select("id, name, code")
        .eq("id", application.season_id)
        .maybeSingle();
      seasonLabel = String(season?.name ?? "").trim() || String(season?.code ?? "").trim();
    }

    const result = await sendReviewBatchAssigned({
      toEmail,
      reviewerName: fullName || toEmail,
      seasonLabel,
      assignmentCount: input.applicationsAssigned,
      dueLabel: input.dueAt ? formatDate(input.dueAt) : null,
      roleApplied: application.role_applied ?? null,
      assignmentBatchId: input.assignmentBatchId,
      requestOrigin: await getPublicOrigin()
    });

    // `skipped` là gửi thư đang tắt: không có lá thư nào đi cả, nên không được
    // báo là đã gửi.
    if (result.ok && !result.skipped) return { status: "sent", reviewerLabel };
    return { status: "not_sent", reviewerLabel, reason: result.reason || "Chưa gửi được thư." };
  } catch (error) {
    console.error("[review-assignment-notice] send failed", error);
    return { status: "not_sent", reviewerLabel: FALLBACK_LABEL, reason: "Lỗi hệ thống khi gửi thư." };
  }
}
