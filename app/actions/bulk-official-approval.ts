"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { bulkOfficialApproveApplications } from "@/lib/bulk-official-approval";
import {
  MAX_BULK_APPROVAL_IDS,
  type BulkApprovalActionState
} from "@/lib/bulk-official-approval-types";
import { canDecide } from "@/lib/permissions";

function fail(message: string): BulkApprovalActionState {
  return { ok: false, message };
}

export async function bulkOfficialApprovalAction(
  _previous: BulkApprovalActionState,
  formData: FormData
): Promise<BulkApprovalActionState> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id) return fail("Bạn chưa đăng nhập.");
  // Same authority gate as the single official-approval path and the
  // generic bulk-decision path: super_admin / admin / core_team only.
  // reviewer, support_team and viewer are intentionally excluded — see
  // lib/permissions.ts canDecide().
  if (!canDecide(actor.role)) {
    return fail("Chỉ admin / core team mới có thể duyệt chính thức đơn ứng tuyển.");
  }

  const ids = Array.from(new Set(formData.getAll("application_id").map(String).filter(Boolean)));
  if (!ids.length || ids.length > MAX_BULK_APPROVAL_IDS) {
    return fail(`Chọn từ 1 đến ${MAX_BULK_APPROVAL_IDS} đơn.`);
  }

  // Season/program scope, role derivation, eligibility, identity resolution
  // and every mutation happen server-side inside the trusted RPC — this
  // action never trusts any client-submitted role/status/identity field,
  // only the selected application IDs.
  const result = await bulkOfficialApproveApplications({
    applicationIds: ids,
    actorAdminUserId: actor.id as string
  });
  if (!result.ok) return result;

  revalidatePath("/applications");
  revalidatePath("/applications/bulk-approval");

  const message =
    `Đã duyệt ${result.approved}/${result.rows.length} đơn.` +
    (result.skipped ? ` Bỏ qua: ${result.skipped}.` : "") +
    (result.manualRequired ? ` Cần xử lý thủ công: ${result.manualRequired}.` : "") +
    (result.failed ? ` Lỗi (có thể thử lại): ${result.failed}.` : "");

  return { ok: true, message, rows: result.rows };
}
