"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import {
  isApplicantRole,
  isApplicationFormState,
  readApplicationFormControls,
  S12_BINDING
} from "@/lib/application-form-controls";
import type { FormControlActionState } from "@/lib/application-form-control-types";
import { canToggleApplicationForm } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const DENIED =
  "Bạn không có quyền thay đổi trạng thái form đăng ký của mùa này.";
const GENERIC =
  "Không thể cập nhật trạng thái form. Vui lòng tải lại trang và thử lại.";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Translate an RPC failure into something an admin can act on, without
 * echoing raw SQLSTATE text or table names back into the UI.
 */
function safeRpcMessage(message: string): string {
  if (message.includes("state changed since page load")) {
    return "Trạng thái đã được thay đổi bởi người khác. Vui lòng tải lại trang để xem trạng thái mới nhất.";
  }
  if (message.includes("not authorized")) return DENIED;
  if (message.includes("no control row") || message.includes("intake batch")) {
    return "Chưa có bản ghi điều khiển cho đợt tuyển này. Migration 069 chưa được áp dụng.";
  }
  if (message.includes("unsupported target state") || message.includes("unsupported applicant role")) {
    return "Yêu cầu không hợp lệ.";
  }
  return GENERIC;
}

/**
 * Change the public state of one application form.
 *
 * Authorization is three independent checks, all of which must pass:
 *   1. an ACTIVE admin_users row exists for the session
 *   2. the global role may control public recruitment (super_admin | admin)
 *   3. the actor holds operations-or-better scope on THIS season
 *
 * The RPC re-checks (1) and (2) itself inside the transaction, so a caller
 * reaching the database by any other route is still refused.
 */
export async function setApplicationFormStateAction(
  _previous: FormControlActionState,
  formData: FormData
): Promise<FormControlActionState> {
  const roleText = value(formData, "applicant_role");
  const nextText = value(formData, "next_state");
  const expectedText = value(formData, "expected_state");

  if (!isApplicantRole(roleText) || !isApplicationFormState(nextText)) {
    return { ok: false, message: "Yêu cầu không hợp lệ." };
  }
  // The expected state is what the admin's page was showing. It is required:
  // without it a stale tab could overwrite a change made seconds earlier.
  if (!isApplicationFormState(expectedText)) {
    return { ok: false, message: "Yêu cầu không hợp lệ." };
  }

  let ctx;
  try {
    ctx = await getAdminScopeContext();
  } catch (error) {
    console.error("[application-form-controls] scope resolution failed", error);
    return { ok: false, message: DENIED };
  }

  // An unreadable grant table produces the same empty scope as a genuinely
  // ungranted user. Refuse rather than evaluate against it.
  if (ctx.scopeError) return { ok: false, message: DENIED };

  const admin = ctx.adminUser ?? (await getCurrentAdminUser());
  if (!admin?.id || admin.status !== "active") return { ok: false, message: DENIED };
  if (!canToggleApplicationForm(admin.role)) return { ok: false, message: DENIED };

  const client = getSupabaseServiceRoleClient();
  if (!client) {
    console.error("[application-form-controls] service-role client unavailable");
    return { ok: false, message: GENERIC };
  }

  // Resolve the season from the control rows themselves so the scope check is
  // made against the same season the RPC will mutate.
  const lookup = await readApplicationFormControls();
  if (!lookup.ok) {
    return {
      ok: false,
      message: "Chưa đọc được trạng thái form đăng ký. Migration 069 có thể chưa được áp dụng."
    };
  }
  const control = lookup.controls[roleText];

  if (!(await canOperateSeason(ctx, control.seasonId))) {
    return { ok: false, message: DENIED };
  }

  const { data, error } = await client.rpc("vam069_set_application_form_state", {
    p_actor_admin_user_id: admin.id,
    p_intake_batch_code: S12_BINDING.intakeBatchCode,
    p_applicant_role: roleText,
    p_expected_state: expectedText,
    p_new_state: nextText
  });

  if (error) {
    console.error("[application-form-controls] rpc failed", {
      code: (error as { code?: string }).code,
      message: error.message
    });
    return { ok: false, message: safeRpcMessage(String(error.message ?? "")) };
  }

  const result = Array.isArray(data) ? data[0] : data;
  const outcome = String(result?.outcome_status ?? "");
  if (outcome !== "changed" && outcome !== "noop") {
    return { ok: false, message: GENERIC };
  }

  // Success is only claimed after the database has confirmed the write.
  // Revalidate so the card re-reads state, actor and timestamp from the
  // server rather than rendering an optimistic guess.
  revalidatePath("/admin/seasons-forms");
  revalidatePath("/apply/mentor");
  revalidatePath("/apply/mentee");

  const label =
    nextText === "open" ? "MỞ CÔNG KHAI" : nextText === "pilot" ? "PILOT" : "ĐÓNG";

  return {
    ok: true,
    role: roleText,
    newState: nextText,
    outcome: outcome as "changed" | "noop",
    message:
      outcome === "noop"
        ? `Form ${roleText} đã ở trạng thái ${label}; không có thay đổi nào được ghi.`
        : `Đã chuyển form ${roleText} sang ${label} và ghi log kiểm toán.`
  };
}
