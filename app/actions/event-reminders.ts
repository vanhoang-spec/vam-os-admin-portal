"use server";

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import type { ReminderProgress } from "@/lib/event-reminder-core";
import {
  cancelEventReminder,
  continueEventReminder,
  retryFailedEventReminder,
  startEventReminder
} from "@/lib/event-reminders";

/**
 * Server action của "Gửi remind".
 *
 * Mỏng có chủ ý: cổng vai trò ở đây, còn phạm vi mùa, ngày nhập lại và mọi quyết
 * định gửi nằm ở lib/event-reminders.ts — nơi có test gọi thẳng. Không gọi
 * revalidatePath ở từng lần gửi tiếp: màn hình tự làm mới khi cả lượt xong, và vẽ
 * lại cả trang sự kiện sau mỗi mười thư chỉ làm vòng gửi chậm đi.
 */
async function denied(): Promise<ReminderProgress | null> {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) return { ok: false, message: "Bạn không có quyền quản lý sự kiện." };
  return null;
}

export async function startEventReminderAction(input: {
  eventId: string;
  typedDate: string;
}): Promise<ReminderProgress> {
  const blocked = await denied();
  if (blocked) return blocked;
  return startEventReminder({ eventId: input?.eventId, typedDate: input?.typedDate });
}

export async function continueEventReminderAction(input: { runId: string }): Promise<ReminderProgress> {
  const blocked = await denied();
  if (blocked) return blocked;
  return continueEventReminder({ runId: input?.runId });
}

export async function retryFailedEventReminderAction(input: { runId: string }): Promise<ReminderProgress> {
  const blocked = await denied();
  if (blocked) return blocked;
  return retryFailedEventReminder({ runId: input?.runId });
}

export async function cancelEventReminderAction(input: { runId: string }): Promise<ReminderProgress> {
  const blocked = await denied();
  if (blocked) return blocked;
  return cancelEventReminder({ runId: input?.runId });
}
