"use server";

import { revalidatePath } from "next/cache";

import {
  type AutomationActionState,
  EMPTY_AUTOMATION_STATE
} from "@/lib/email-automation-action-types";
import { revertAutomationContent, saveAutomationContent } from "@/lib/email-automation";

const PATH = "/operations/mail/samples";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function saveAutomationContentAction(
  _prev: AutomationActionState,
  formData: FormData
): Promise<AutomationActionState> {
  const slotId = field(formData, "slot_id");
  const result = await saveAutomationContent({
    slotId,
    subject: field(formData, "subject"),
    body: field(formData, "body")
  });

  if (result.ok) revalidatePath(PATH);
  return { ok: result.ok, message: result.message, slotId: slotId || null };
}

export async function revertAutomationContentAction(
  _prev: AutomationActionState,
  formData: FormData
): Promise<AutomationActionState> {
  const slotId = field(formData, "slot_id");
  if (!slotId) return { ...EMPTY_AUTOMATION_STATE, message: "Không xác định được lá thư." };

  const result = await revertAutomationContent(slotId);
  if (result.ok) revalidatePath(PATH);
  return { ok: result.ok, message: result.message, slotId };
}
