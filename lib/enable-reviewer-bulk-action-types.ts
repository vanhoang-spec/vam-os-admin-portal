/**
 * Shared types for the bulk enable-reviewer server action.
 *
 * Plain (non-"use server") module so client components can import
 * without violating the Next.js "use server" export rule.
 */
import type { BulkGrantOutcome } from "@/lib/enable-reviewer-bulk";

export type BulkGrantActionState = {
  ok: boolean;
  message: string | null;
  granted: BulkGrantOutcome[];
  failed: BulkGrantOutcome[];
  notFound: string[];
  skippedDueToQuota: string[];
};

export const initialBulkGrantActionState: BulkGrantActionState = {
  ok: false,
  message: null,
  granted: [],
  failed: [],
  notFound: [],
  skippedDueToQuota: []
};
