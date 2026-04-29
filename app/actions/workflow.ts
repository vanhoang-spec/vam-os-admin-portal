"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageWorkflow } from "@/lib/auth-constants";
import {
  addWorkflowActionItemComment,
  createWorkflowActionItem,
  generateMonthlyFollowupActions,
  updateWorkflowActionItem
} from "@/lib/data";

export type WorkflowActionState = {
  ok: boolean;
  message: string | null;
  result?: unknown;
};

const emptyState: WorkflowActionState = { ok: false, message: null };

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value || null;
}

function requireWorkflowManager() {
  return getCurrentAdminUser().then((adminUser) => {
    if (!canManageWorkflow(adminUser)) return null;
    return adminUser;
  });
}

export async function createActionItemAction(_previousState: WorkflowActionState = emptyState, formData: FormData): Promise<WorkflowActionState> {
  const adminUser = await requireWorkflowManager();
  if (!adminUser) return { ok: false, message: "Bạn không có quyền tạo hoặc cập nhật công việc." };

  const result = await createWorkflowActionItem({
    action_type: text(formData, "action_type") || "manual_task",
    entity_type: nullableText(formData, "entity_type"),
    entity_id: nullableText(formData, "entity_id"),
    title: text(formData, "title"),
    description: nullableText(formData, "description"),
    priority: text(formData, "priority") || "medium",
    owner_admin_user_id: nullableText(formData, "owner_admin_user_id"),
    due_date: nullableText(formData, "due_date"),
    source: "manual",
    metadata: { created_from: "operations_tasks" }
  });

  if (result.error) return { ok: false, message: result.error };
  revalidatePath("/operations");
  revalidatePath("/operations/tasks");
  return { ok: true, message: "Đã tạo công việc mới.", result: result.data };
}

export async function updateActionItemAction(_previousState: WorkflowActionState = emptyState, formData: FormData): Promise<WorkflowActionState> {
  const adminUser = await requireWorkflowManager();
  if (!adminUser) return { ok: false, message: "Bạn không có quyền cập nhật công việc." };

  const result = await updateWorkflowActionItem({
    id: text(formData, "id"),
    status: nullableText(formData, "status"),
    owner_admin_user_id: nullableText(formData, "owner_admin_user_id"),
    priority: nullableText(formData, "priority"),
    due_date: nullableText(formData, "due_date"),
    description: nullableText(formData, "description")
  });

  if (result.error) return { ok: false, message: result.error };
  revalidatePath("/operations");
  revalidatePath("/operations/tasks");
  return { ok: true, message: "Đã cập nhật công việc.", result: result.data };
}

export async function addActionItemCommentAction(_previousState: WorkflowActionState = emptyState, formData: FormData): Promise<WorkflowActionState> {
  const adminUser = await requireWorkflowManager();
  if (!adminUser) return { ok: false, message: "Bạn không có quyền thêm ghi chú." };

  const result = await addWorkflowActionItemComment({
    id: text(formData, "id"),
    comment_text: text(formData, "comment_text")
  });

  if (result.error) return { ok: false, message: result.error };
  revalidatePath("/operations/tasks");
  return { ok: true, message: "Đã thêm ghi chú nội bộ.", result: result.data };
}

export async function generateMonthlyFollowupAction(_previousState: WorkflowActionState = emptyState, formData: FormData): Promise<WorkflowActionState> {
  const adminUser = await requireWorkflowManager();
  if (!adminUser) return { ok: false, message: "Bạn không có quyền tạo danh sách follow-up." };

  const selectedMonth = text(formData, "selected_month") || "2026-04";
  const result = await generateMonthlyFollowupActions({ selected_month: selectedMonth });

  if (result.error) return { ok: false, message: result.error };
  revalidatePath("/operations");
  revalidatePath("/operations/tasks");
  const created = Number(result.data?.createdCount ?? 0);
  const skipped = Number(result.data?.skippedDuplicateCount ?? 0);
  return {
    ok: true,
    message: `Đã tạo ${created} follow-up, bỏ qua ${skipped} mục đã có.`,
    result: result.data
  };
}

