"use client";

import { useEffect } from "react";
import { clearStoredDraft, type ApplyDraftRole } from "@/lib/apply-draft";

/**
 * R1A req 3. Reaching this page is the only client-observable signal that a
 * submission succeeded — the Server Action redirects here, so the form never
 * sees state.ok === true.
 */
export function ClearApplyDraft({ role }: { role: ApplyDraftRole }) {
  useEffect(() => {
    clearStoredDraft(role);
  }, [role]);
  return null;
}
