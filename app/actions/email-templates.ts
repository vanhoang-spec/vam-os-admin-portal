"use server";

import { revalidatePath } from "next/cache";
import { normalizeActionError } from "@/lib/action-feedback";
import {
  approveEmailTemplate,
  draftEmailTemplateWithAi,
  ensureSeasonTemplates,
  saveEmailTemplate
} from "@/lib/email-templates";
import type { EmailTemplateActionState } from "@/lib/email-template-action-types";

/**
 * Server actions for the post-matching email templates.
 *
 * Thin by design: validation, the approval rule and the "no personal data in a
 * draft request" rule all live in lib/email-templates.ts and its core module.
 */

function revalidateTemplates() {
  revalidatePath("/operations/email-templates");
  revalidatePath("/operations/communications");
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function ensureSeasonTemplatesAction(
  _prev: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const result = await ensureSeasonTemplates({ seasonIdOrCode: text(formData, "season_id").trim() });
    if (result.ok) revalidateTemplates();
    return { ok: result.ok, message: result.message };
  } catch (err) {
    console.error("[email templates action] ensure", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function saveEmailTemplateAction(
  _prev: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const result = await saveEmailTemplate({
      templateId: text(formData, "template_id").trim(),
      subject: text(formData, "subject"),
      body: text(formData, "body")
    });
    if (result.ok) revalidateTemplates();
    return { ok: result.ok, message: result.message, templateId: result.templateId };
  } catch (err) {
    console.error("[email templates action] save", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function approveEmailTemplateAction(
  _prev: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const result = await approveEmailTemplate({ templateId: text(formData, "template_id").trim() });
    if (result.ok) revalidateTemplates();
    return { ok: result.ok, message: result.message, templateId: result.templateId };
  } catch (err) {
    console.error("[email templates action] approve", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}

export async function draftEmailTemplateAction(
  _prev: EmailTemplateActionState,
  formData: FormData
): Promise<EmailTemplateActionState> {
  try {
    const result = await draftEmailTemplateWithAi({
      templateId: text(formData, "template_id").trim()
    });
    if (result.ok) revalidateTemplates();
    return { ok: result.ok, message: result.message, templateId: result.templateId };
  } catch (err) {
    console.error("[email templates action] draft", err);
    return { ok: false, message: normalizeActionError(err) };
  }
}
