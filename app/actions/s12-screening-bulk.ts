"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { recordApplicationDecision } from "@/lib/application-decisions";
import { getApplication } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import {
  BULK_SCREENING_MAX,
  BULK_SCREENING_QUEUE_PATH,
  BULK_SCREENING_ROLES,
  BULK_SCREENING_ROLE_LABEL,
  type BulkScreeningRole
} from "@/lib/bulk-screening";

/**
 * Bounded, current-page bulk screening for the S12 Mentor and Mentee queues.
 *
 * This is the ONE screening mutation implementation. It replaces the
 * Mentor-only action rather than being copied alongside it: two parallel
 * implementations would drift, and the safety properties below are exactly the
 * ones that must not drift.
 *
 * The mutation contract is unchanged from the Owner-UAT-approved Mentor path:
 *   * current page only, 1..25 applications per submission;
 *   * per-application expected-status recheck against a freshly read canonical
 *     record, so a row that moved since the page rendered is skipped, not
 *     overwritten;
 *   * role/scope authorization re-checked server-side on every submission;
 *   * only the three screening transitions; no interview or final-approval
 *     action is reachable from here;
 *   * every write goes through recordApplicationDecision, i.e. the atomic
 *     vam084_apply_application_decisions RPC, never a direct table update;
 *   * partial failures are reported, never hidden.
 */

const ALLOWED_BULK_STATUSES = new Set(["screening_passed", "needs_more_review", "rejected_or_not_fit"]);

// A "use server" module may export only async functions, so the role list,
// the batch cap and the queue paths live in lib/bulk-screening.ts.

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

/**
 * The role the form claims. Never trusted on its own — it only decides which
 * queue to return to and which role each application is then REQUIRED to
 * match. An unrecognised value falls back to the Mentor queue purely so the
 * failure redirect has somewhere to land; no mutation happens on that path.
 */
function parseRole(formData: FormData): BulkScreeningRole | null {
  const raw = clean(formData.get("queue_role")).toLowerCase();
  return (BULK_SCREENING_ROLES as readonly string[]).includes(raw) ? (raw as BulkScreeningRole) : null;
}

function queueUrl(role: BulkScreeningRole | null, formData: FormData, result: string, ok: boolean) {
  const params = new URLSearchParams();
  const q = clean(formData.get("return_q"));
  const mentorType = clean(formData.get("return_mentor_type"));
  const page = clean(formData.get("return_page"));
  if (q) params.set("q", q);
  // Mentor-only filter; it is never emitted on the Mentee queue.
  if (role === "mentor" && mentorType && mentorType !== "all") params.set("mentor_type", mentorType);
  if (page) params.set("page", page);
  params.set("bulk_ok", ok ? "1" : "0");
  params.set("bulk_result", result.slice(0, 500));
  return `${BULK_SCREENING_QUEUE_PATH[role ?? "mentor"]}?${params.toString()}`;
}

export async function bulkS12ScreeningAction(formData: FormData): Promise<void> {
  const role = parseRole(formData);
  if (!role) {
    redirect(queueUrl(null, formData, "Hàng đợi duyệt không hợp lệ.", false));
  }

  const actor = await getCurrentAdminUser();
  if (!actor?.id || !canDecide(actor.role)) {
    redirect(queueUrl(role, formData, "Bạn không có quyền duyệt hàng loạt.", false));
  }

  const applicationIds = Array.from(
    new Set(formData.getAll("application_id").map((value) => String(value).trim()).filter(Boolean))
  );
  const newStatus = clean(formData.get("new_status"));
  const decisionNote = clean(formData.get("decision_note")) || null;

  if (!applicationIds.length || applicationIds.length > BULK_SCREENING_MAX) {
    redirect(
      queueUrl(role, formData, `Chọn từ 1 đến ${BULK_SCREENING_MAX} hồ sơ trên trang hiện tại.`, false)
    );
  }
  if (!ALLOWED_BULK_STATUSES.has(newStatus)) {
    redirect(queueUrl(role, formData, "Quyết định hàng loạt không hợp lệ.", false));
  }

  const scope = await getScopeFilter(await getAdminScopeContext());
  const decidedByName = actor.full_name?.trim() || actor.email || null;
  let applied = 0;
  const failures: string[] = [];

  for (const applicationId of applicationIds) {
    const expectedStatus = clean(formData.get(`expected_status_${applicationId}`));
    const current = await getApplication(applicationId, scope);

    if (current.error || !current.data) {
      failures.push(`${applicationId.slice(0, 8)}: không tải được hoặc ngoài phạm vi`);
      continue;
    }
    // The decisive cross-role guard: the freshly read canonical record must
    // match the queue that submitted it. A Mentor form can therefore never
    // move a Mentee application, whatever the posted ids or hidden fields say.
    if (current.data.role_applied !== role) {
      failures.push(`${applicationId.slice(0, 8)}: không phải hồ sơ ${BULK_SCREENING_ROLE_LABEL[role]}`);
      continue;
    }
    if (!expectedStatus || current.data.status !== expectedStatus) {
      failures.push(`${applicationId.slice(0, 8)}: trạng thái đã thay đổi`);
      continue;
    }
    if (expectedStatus !== "submitted") {
      failures.push(`${applicationId.slice(0, 8)}: không còn ở hàng đợi chờ xử lý`);
      continue;
    }

    const result = await recordApplicationDecision({
      applicationId,
      decidedByAdminUserId: actor.id,
      decidedByName,
      previousStatus: expectedStatus,
      newStatus,
      decisionNote
    });

    if (result.ok) applied += 1;
    else failures.push(`${applicationId.slice(0, 8)}: ${result.message}`);
  }

  revalidatePath(BULK_SCREENING_QUEUE_PATH[role]);
  revalidatePath("/applications");

  const summary = failures.length
    ? `Đã cập nhật ${applied} hồ sơ; ${failures.length} hồ sơ bị chặn. ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "; …" : ""}`
    : `Đã cập nhật ${applied} hồ sơ ${BULK_SCREENING_ROLE_LABEL[role]}.`;

  redirect(queueUrl(role, formData, summary, applied > 0 && failures.length === 0));
}
