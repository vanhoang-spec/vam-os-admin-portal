/**
 * Shared types for the email-template server actions.
 *
 * Plain (non-"use server") module so client components can import these without
 * violating the Next.js rule that a "use server" file may only export async
 * functions.
 */

export type EmailTemplateActionState = {
  ok: boolean;
  message: string | null;
  templateId?: string | null;
};

export const initialEmailTemplateActionState: EmailTemplateActionState = {
  ok: false,
  message: null
};
