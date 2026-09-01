"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { recordApplicationDecision } from "@/lib/application-decisions";
import { getApplication } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";

const ALLOWED_BULK_STATUSES = new Set([
  "screening_passed",
  "needs_more_review",
  "rejected_or_not_fit"
]);

function clean(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function queueUrl(formData: FormData, result: string, ok: boolean) {
  const params = new URLSearchParams();
  const q = clean(formData.get("return_q"));
  const mentorType = clean(formData.get("return_mentor_type"));
  const page = clean(formData.get("return_page"));
  if (q) params.set("q", q);
  if (mentorType && mentorType !== "all") params.set("mentor_type", mentorType);
  if (page) params.set("page", page);
  params.set("bulk_ok", ok ? "1" : "0");
  params.set("bulk_result", result.slice(0, 500));
  return `/applications/mentor-review?${params.toString()}`;
}

export async function bulkMentorReviewDecisionAction(formData: FormData): Promise<void> {
  const actor = await getCurrentAdminUser();
  if (!actor?.id || !canDecide(actor.role)) {
    redirect(queueUrl(formData, "Bạn không có quyền duyệt hàng loạt.", false));
  }

  const applicationIds = Array.from(
    new Set(formData.getAll("application_id").map((value) => String(value).trim()).filter(Boolean))
  );
  const newStatus = clean(formData.get("new_status"));
  const decisionNote = clean(formData.get("decision_note")) || null;

  if (!applicationIds.length || applicationIds.length > 25) {
    redirect(queueUrl(formData, "Chọn từ 1 đến 25 hồ sơ trên trang hiện tại.", false));
  }
  if (!ALLOWED_BULK_STATUSES.has(newStatus)) {
    redirect(queueUrl(formData, "Quyết định hàng loạt không hợp lệ.", false));
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
    if (current.data.role_applied !== "mentor") {
      failures.push(`${applicationId.slice(0, 8)}: không phải hồ sơ Mentor`);
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

  revalidatePath("/applications/mentor-review");
  revalidatePath("/applications");

  const summary = failures.length
    ? `Đã cập nhật ${applied} hồ sơ; ${failures.length} hồ sơ bị chặn. ${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "; …" : ""}`
    : `Đã cập nhật ${applied} hồ sơ Mentor.`;

  redirect(queueUrl(formData, summary, applied > 0 && failures.length === 0));
}
