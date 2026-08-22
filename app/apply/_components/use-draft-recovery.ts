"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearStoredDraft,
  consentFieldNames,
  createDraft,
  readStoredDraft,
  writeStoredDraft,
  type ApplyDraft,
  type ApplyDraftRole
} from "@/lib/apply-draft";
import { APPLY_TOKEN_FIELD } from "@/lib/apply-types";

const AUTOSAVE_DEBOUNCE_MS = 800;

export type DraftRecoveryStatus = "idle" | "prompt" | "restored" | "discarded";

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Write a value the way a user would, not the way a script would.
 *
 * React installs its own `value` descriptor on every managed node and updates
 * its change-dedupe tracker from that setter, so a plain `node.value = x` moves
 * the tracker in lockstep: React then sees "nothing changed" and swallows the
 * event we dispatch next. SelectField and RadioGroupField would never learn the
 * restored value, and their conditional "Khác" inputs would never render.
 * Calling the prototype setter bypasses the instrumented one and leaves the
 * tracker stale — precisely the state a real keystroke produces.
 */
function setNativeValue(node: FormControl, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value");
  if (descriptor?.set) descriptor.set.call(node, value);
  else node.value = value;
  node.dispatchEvent(new Event("input", { bubbles: true }));
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

function controlsNamed(form: HTMLFormElement, name: string): FormControl[] {
  return Array.from(form.querySelectorAll<FormControl>(`[name="${CSS.escape(name)}"]`));
}

function isCheckable(node: FormControl): node is HTMLInputElement {
  return node instanceof HTMLInputElement && (node.type === "checkbox" || node.type === "radio");
}

/**
 * Idempotent: safe to run twice, which is what the two-phase restore relies on.
 */
function applyFields(form: HTMLFormElement, fields: Record<string, string[]>): void {
  for (const [name, values] of Object.entries(fields)) {
    const nodes = controlsNamed(form, name);
    if (!nodes.length) continue; // conditional "Khác" input not mounted yet — phase 2 gets it
    if (isCheckable(nodes[0])) {
      const wanted = new Set(values);
      for (const node of nodes as HTMLInputElement[]) {
        // .click() rather than assigning `checked`: React wires checkbox/radio
        // onChange to the click event, and click is a discrete event so React 18
        // flushes each handler synchronously — meaning CheckboxGroupField's
        // `selected` Set is current for the next box in the loop, and its
        // maxSelections cap still applies to an oversized stored draft.
        if (node.checked !== wanted.has(node.value)) node.click();
      }
      continue;
    }
    setNativeValue(nodes[0], values[0]);
  }
}

/**
 * R1A req 5, stated in the DOM rather than merely implied by the write filter:
 * after a restore every consent control is unticked and every confirmation
 * phrase is blank, so the existing `required` attributes block submission until
 * the applicant re-affirms.
 */
function clearConsentFields(form: HTMLFormElement, role: ApplyDraftRole): void {
  for (const name of Array.from(consentFieldNames(role))) {
    for (const node of controlsNamed(form, name)) {
      if (isCheckable(node)) {
        if (node.checked) node.click();
      } else if (node.value) {
        setNativeValue(node, "");
      }
    }
  }
}

function liveTokenValues(form: HTMLFormElement): string[] {
  return controlsNamed(form, APPLY_TOKEN_FIELD)
    .map((node) => node.value)
    .filter(Boolean);
}

export function useDraftRecovery({
  role,
  formRef,
  submissionOk = false
}: {
  role: ApplyDraftRole;
  formRef: React.RefObject<HTMLFormElement>;
  /**
   * Belt-and-braces only. Both apply actions end in redirect(), so the client
   * never sees ok:true today and the thanks page does the real clearing — but a
   * future non-redirecting success path should not silently regress req 3.
   */
  submissionOk?: boolean;
}) {
  const [draft, setDraft] = useState<ApplyDraft | null>(null);
  const [status, setStatus] = useState<DraftRecoveryStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const statusRef = useRef(status);
  statusRef.current = status;

  // Mount: offer what survived. Never auto-apply — req 1 is a prompt, and a
  // silent restore would also silently carry answers onto a shared machine.
  useEffect(() => {
    const stored = readStoredDraft(role);
    if (!stored) return;
    setDraft(stored);
    setLastSavedAt(stored.savedAt);
    setStatus("prompt");
  }, [role]);

  const save = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    // Never overwrite the stored draft while the applicant is still deciding
    // about it: browser autofill or a stray focus event would otherwise replace
    // the very thing the prompt is offering to restore.
    if (statusRef.current === "prompt") return;
    const entries: Array<[string, string]> = [];
    for (const [name, value] of Array.from(new FormData(form).entries())) {
      if (typeof value === "string") entries.push([name, value]);
    }
    const next = createDraft(entries, role, liveTokenValues(form));
    if (!next) {
      clearStoredDraft(role);
      setLastSavedAt(null);
      return;
    }
    if (writeStoredDraft(next)) setLastSavedAt(next.savedAt);
  }, [formRef, role]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(save, AUTOSAVE_DEBOUNCE_MS);
    };
    const flush = () => {
      clearTimeout(timer);
      save();
    };
    // Submit flushes synchronously: on the error path the action re-renders and
    // req 4 wants the last keystrokes still in the draft, and on the success path
    // the redirect would otherwise cancel a pending debounce mid-flight.
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
    form.addEventListener("submit", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", schedule);
      form.removeEventListener("change", schedule);
      form.removeEventListener("submit", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
    // resetKey remounts <ApplicationForm>, so formRef.current is a different node
    // afterwards and the listeners must be re-bound to it.
  }, [formRef, save, resetKey]);

  const restore = useCallback(() => {
    const form = formRef.current;
    if (!form || !draft) return;
    setStatus("restored");
    applyFields(form, draft.fields);
    clearConsentFields(form, role);
    // Pass 2: SelectField and CheckboxGroupField render their conditional "Khác"
    // input only after the parent's onChange re-renders, so those nodes did not
    // exist during pass 1. applyFields is idempotent, so re-running it once the
    // DOM has caught up costs nothing and fills them in.
    requestAnimationFrame(() => {
      const current = formRef.current;
      if (!current) return;
      applyFields(current, draft.fields);
      clearConsentFields(current, role);
    });
  }, [draft, formRef, role]);

  const discard = useCallback(() => {
    clearStoredDraft(role);
    setDraft(null);
    setLastSavedAt(null);
    setStatus("discarded");
    // form.reset() would clear the DOM but leave SelectField/CheckboxGroupField
    // internal state behind — stale "Khác" inputs would stay mounted and stay
    // `required`. Remounting the subtree resets DOM and component state together.
    setResetKey((key) => key + 1);
  }, [formRef, role]);

  useEffect(() => {
    if (!submissionOk) return;
    clearStoredDraft(role);
    setDraft(null);
    setLastSavedAt(null);
  }, [role, submissionOk]);

  return { status, savedAt: lastSavedAt, hasDraft: Boolean(draft) || Boolean(lastSavedAt), resetKey, restore, discard };
}
