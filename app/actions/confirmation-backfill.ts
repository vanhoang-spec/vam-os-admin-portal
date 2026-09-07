"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  countConfirmationBackfillCandidates,
  runConfirmationBackfill
} from "@/lib/confirmation-backfill";
import { backfillResultMessage } from "@/lib/confirmation-backfill-core";
import type { ConfirmationBackfillActionState } from "@/lib/confirmation-backfill-types";
import { canRunConfirmationBackfill } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";

const DENIED = "Bạn không có quyền thực hiện thao tác này.";
const GENERIC = "Lỗi hệ thống. Vui lòng thử lại sau ít phút.";

/**
 * Gửi bù thư xác nhận cho những đơn đã nộp trước khi hệ thống có tầng email.
 *
 * Ba tầng kiểm giống hệt thao tác đóng/mở form: bối cảnh phạm vi phải đọc
 * được, tài khoản phải đang hoạt động, vai trò phải nằm trong danh sách hẹp, và
 * sau cùng phải có quyền trên đúng mùa mà thao tác sẽ chạm vào. Một bảng phân
 * quyền không đọc được cho ra phạm vi rỗng y hệt một người thật sự không có
 * quyền, nên phải từ chối chứ không được suy diễn.
 */
export async function runConfirmationBackfillAction(
  _prev: ConfirmationBackfillActionState,
  formData: FormData
): Promise<ConfirmationBackfillActionState> {
  // Xác nhận tường minh từ giao diện: thao tác này gửi thư thật ra ngoài, nên
  // một lần POST lạc cũng không được phép kích hoạt nó.
  if (String(formData.get("confirm") ?? "") !== "yes") {
    return { ok: false, message: "Yêu cầu không hợp lệ." };
  }

  let ctx;
  try {
    ctx = await getAdminScopeContext();
  } catch (error) {
    console.error("[confirmation-backfill] scope resolution failed", error);
    return { ok: false, message: DENIED };
  }

  if (ctx.scopeError) return { ok: false, message: DENIED };

  const admin = ctx.adminUser ?? (await getCurrentAdminUser());
  if (!admin?.id || admin.status !== "active") return { ok: false, message: DENIED };
  if (!canRunConfirmationBackfill(admin.role)) return { ok: false, message: DENIED };

  const candidates = await countConfirmationBackfillCandidates();
  if (!candidates.ok) return { ok: false, message: candidates.error };

  if (!(await canOperateSeason(ctx, candidates.seasonId))) {
    return { ok: false, message: DENIED };
  }

  const result = await runConfirmationBackfill({ seasonId: candidates.seasonId });
  if (!result.ok) return { ok: false, message: result.error || GENERIC };

  revalidatePath("/operations/emails");

  return {
    ok: true,
    message: backfillResultMessage(result.summary, {
      requested: result.requested,
      remainingAfter: result.remainingAfter,
      gateOpen: result.gateOpen,
      stoppedByBudget: result.stoppedByBudget
    }),
    summary: result.summary
  };
}
