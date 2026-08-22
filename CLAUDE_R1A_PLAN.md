I read both forms, the shared primitives, the server actions, and the test setup. One premise in the prompt is wrong and it changes the whole design, so I'll state it up front and design against the real code.

**`react-hook-form` and Zod are not used anywhere in this repo** — `grep` for `react-hook-form|@hookform|zodResolver` matches only `CLAUDE_PROMPT_R1A.md` itself, and neither package is in `package.json`. Both forms are **uncontrolled native `<form action={serverAction}>`** driven by `useFormState` (React 18.3). Two consequences: there is no `watch()`/`reset()` to hook into (persistence has to go through `FormData` + the DOM), and success is a server-side `redirect()`, so the client **never observes `state.ok === true`** — "clear on success" cannot be driven off form state. The plan below handles both.

---

# CLAUDE_R1A_PLAN_FINAL

## 1. Architecture summary

| Layer | File | Role |
|---|---|---|
| Pure model | `lib/apply-draft.ts` **(new)** | Key naming, redaction rules, serialize/parse, guarded storage access. DOM-free ⇒ the security-relevant logic is unit-testable in the default `node` vitest env. |
| Hook | `app/apply/_components/use-draft-recovery.ts` **(new)** | DOM read/write, autosave debounce+flush, prompt/restore/discard state machine. Shared by both forms. |
| UI | `app/apply/_components/draft-recovery-banner.tsx` **(new)** | Restore prompt + persistent "Xoá bản nháp" control. |
| Wiring | `app/apply/_components/form-primitives.tsx` **(modify)** | `ApplicationForm` accepts an optional external `formRef`. |
| Wiring | `app/apply/mentee/apply-mentee-form.tsx`, `app/apply/mentor/apply-mentor-form.tsx` **(modify)** | ~8 lines each; field markup untouched. |
| Success clear | `app/apply/thanks/clear-draft.tsx` **(new)** + `app/apply/thanks/page.tsx` **(modify)** | Clears the draft on the page the successful `redirect()` lands on. |
| Tests | `__tests__/apply-draft-model.test.ts`, `__tests__/apply-draft-recovery.test.tsx` **(new)** | Req 1–6. |

### Three non-obvious problems this design solves

**(a) React's value tracker swallows scripted restores.** React installs its own `value`/`checked` property descriptor on every managed node, and that setter updates React's change-dedupe tracker. So `node.value = x; node.dispatchEvent(new Event("change"))` fires nothing — React compares `node.value` against the tracker, sees them equal, and drops the event. `SelectField`, `RadioGroupField` and `CheckboxGroupField` all keep `useState` that gates their conditional "Khác" input (`form-primitives.tsx:355`, `:403`, `:479`), so a swallowed event means the restored "Khác" text never becomes reachable. Restore must call the **prototype** setter to leave the tracker stale, and use `.click()` for checkables (React's `onChange` for checkbox/radio is wired to the `click` event, not `change`).

**(b) Conditional fields don't exist during pass 1.** `university_other`, `gender_other`, `target_soft_skills_other` etc. are only rendered *after* the parent's `onChange` re-renders. Restore therefore runs `applyFields` twice — once now, once in a `requestAnimationFrame` — and `applyFields` is idempotent so the second pass is free.

**(c) React injects `$ACTION_ID_*` hidden inputs.** A `<form action={serverAction}>` gets React-generated `$`-prefixed fields for progressive enhancement. A naïve `new FormData(form)` sweep would persist them alongside `__apply_token`. Both are excluded by prefix, not by enumeration.

---

## 2. `lib/apply-draft.ts` (new)

```ts
/**
 * Local-storage draft model for the /apply/* intake forms (R1A).
 *
 * Deliberately DOM-free: the redaction rules are the security-relevant part of
 * draft recovery, so they live where they can be unit-tested in the default
 * `node` environment rather than behind a jsdom render. The DOM side lives in
 * app/apply/_components/use-draft-recovery.ts.
 */
import { ACTIVE_READING_KEYS, acknowledgementsForRole } from "@/lib/application-commitments";
import { APPLY_TOKEN_FIELD } from "@/lib/apply-types";
import { SEASON_CONFIG } from "@/lib/season-config";

export type ApplyDraftRole = "mentor" | "mentee";

export type ApplyDraft = {
  v: number;
  role: ApplyDraftRole;
  season: string;
  savedAt: string;
  fields: Record<string, string[]>;
};

export const APPLY_DRAFT_VERSION = 1;
export const APPLY_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Well under the ~5MB origin quota, but large enough for every essay field. */
export const APPLY_DRAFT_MAX_CHARS = 256 * 1024;

/**
 * Season is part of the key, not just the payload: an applicant who drafted in
 * a previous intake must get a clean S13 form rather than last season's answers.
 */
export function applyDraftStorageKey(role: ApplyDraftRole): string {
  const season = SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
  return `vam-os:apply-draft:v${APPLY_DRAFT_VERSION}:${season}:${role}`;
}

const SHARED_CONSENT_FIELDS = ["consent_data_storage", "commitment_understanding"];
const ROLE_CONSENT_FIELDS: Record<ApplyDraftRole, string[]> = {
  mentee: ["email_notification_consent"],
  mentor: ["consent_contact_methods"]
};

/**
 * Every field that is an act of consent rather than an answer.
 *
 * Derived from the acknowledgement registry so a new ACK.* entry is excluded
 * automatically — this list going stale is exactly how a restored draft would
 * silently re-affirm something the applicant never re-read. Includes the
 * ACTIVE_READING confirmation phrase: it is an attestation that the applicant
 * just read the principles, so replaying it from storage would defeat its only
 * purpose.
 */
export function consentFieldNames(role: ApplyDraftRole): Set<string> {
  return new Set([
    ...SHARED_CONSENT_FIELDS,
    ...ROLE_CONSENT_FIELDS[role],
    ...acknowledgementsForRole(role).map((entry) => entry.key),
    ACTIVE_READING_KEYS[role]
  ]);
}

export function isPersistableField(name: string, role: ApplyDraftRole): boolean {
  if (!name) return false;
  // "__"-prefixed is our own out-of-band channel (APPLY_TOKEN_FIELD); "$"-prefixed
  // is React DOM's Server Action relay ($ACTION_ID_*, $ACTION_REF_*). Excluded by
  // prefix so a field added to either family later is covered without a code change.
  if (name === APPLY_TOKEN_FIELD || name.startsWith("__") || name.startsWith("$")) return false;
  if (consentFieldNames(role).has(name)) return false;
  return true;
}

export function buildDraftFields(
  entries: Iterable<readonly [string, string]>,
  role: ApplyDraftRole,
  redactValues: readonly string[] = []
): Record<string, string[]> {
  // Second, independent defence for R1A req 6: the token is dropped by key AND
  // by value, so relaying it through a renamed or duplicated input still fails
  // to persist it.
  const forbidden = new Set(redactValues.filter(Boolean));
  const fields: Record<string, string[]> = {};
  for (const [name, rawValue] of entries) {
    if (!isPersistableField(name, role)) continue;
    const value = String(rawValue);
    // Empty means "not filled in", which is already the state of a fresh form.
    if (!value || forbidden.has(value)) continue;
    (fields[name] ||= []).push(value);
  }
  return fields;
}

export function createDraft(
  entries: Iterable<readonly [string, string]>,
  role: ApplyDraftRole,
  redactValues: readonly string[] = []
): ApplyDraft | null {
  const fields = buildDraftFields(entries, role, redactValues);
  if (Object.keys(fields).length === 0) return null;
  return {
    v: APPLY_DRAFT_VERSION,
    role,
    season: SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
    savedAt: new Date().toISOString(),
    fields
  };
}

export function parseDraft(raw: string | null, role: ApplyDraftRole, now = Date.now()): ApplyDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<ApplyDraft>;
  if (candidate.v !== APPLY_DRAFT_VERSION) return null;
  if (candidate.role !== role) return null;
  if (candidate.season !== SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE) return null;
  if (!candidate.fields || typeof candidate.fields !== "object") return null;
  const savedAtMs = Date.parse(String(candidate.savedAt ?? ""));
  if (!Number.isFinite(savedAtMs) || now - savedAtMs > APPLY_DRAFT_TTL_MS) return null;

  // Re-apply the redaction rules on READ, not only on write. A payload written
  // by an older build, or hand-edited in devtools, must not be able to re-tick a
  // consent box or push a token field back into the form.
  const fields: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(candidate.fields)) {
    if (!isPersistableField(name, role)) continue;
    const values = (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === "string" && item !== ""
    );
    if (values.length) fields[name] = values;
  }
  if (Object.keys(fields).length === 0) return null;

  return {
    v: APPLY_DRAFT_VERSION,
    role,
    season: candidate.season,
    savedAt: new Date(savedAtMs).toISOString(),
    fields
  };
}

/**
 * localStorage access throws — not returns null — when cookies are blocked or
 * Safari is in private mode, and it throws on the *property read*, so the whole
 * lookup has to sit inside the try.
 */
export function getDraftStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredDraft(role: ApplyDraftRole, storage = getDraftStorage()): ApplyDraft | null {
  if (!storage) return null;
  try {
    return parseDraft(storage.getItem(applyDraftStorageKey(role)), role);
  } catch {
    return null;
  }
}

export function writeStoredDraft(draft: ApplyDraft, storage = getDraftStorage()): boolean {
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(draft);
    // Dropping an over-cap draft beats throwing QuotaExceededError mid-keystroke;
    // the applicant keeps typing into a form that still works.
    if (serialized.length > APPLY_DRAFT_MAX_CHARS) return false;
    storage.setItem(applyDraftStorageKey(draft.role), serialized);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredDraft(role: ApplyDraftRole, storage = getDraftStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(applyDraftStorageKey(role));
  } catch {
    /* nothing useful to do; the draft simply outlives this attempt */
  }
}
```

---

## 3. `app/apply/_components/use-draft-recovery.ts` (new)

```tsx
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
  for (const name of consentFieldNames(role)) {
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
    for (const [name, value] of new FormData(form).entries()) {
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
```

---

## 4. `app/apply/_components/draft-recovery-banner.tsx` (new)

```tsx
"use client";

import type { DraftRecoveryStatus } from "./use-draft-recovery";

function formatSavedAt(savedAt: string): string {
  const parsed = new Date(savedAt);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export function DraftRecoveryBanner({
  status,
  savedAt,
  hasDraft,
  onRestore,
  onDiscard
}: {
  status: DraftRecoveryStatus;
  savedAt: string | null;
  hasDraft: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (status === "prompt") {
    return (
      <div
        role="alertdialog"
        aria-labelledby="draft-recovery-title"
        className="mb-6 rounded-lg border border-vam-line bg-vam-mint/40 p-4 text-sm text-vam-ink"
      >
        <p id="draft-recovery-title" className="font-semibold">Chúng tôi tìm thấy một bản nháp chưa gửi.</p>
        <p className="mt-1 text-slate-700">
          {savedAt ? `Lưu lần cuối lúc ${formatSavedAt(savedAt)}. ` : ""}
          Bạn có muốn khôi phục các câu trả lời đã điền không? Vì lý do minh bạch, các mục đồng ý và cam kết
          sẽ để trống và cần bạn xác nhận lại.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRestore}
            className="rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Khôi phục bản nháp
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Bắt đầu mới (xoá bản nháp)
          </button>
        </div>
      </div>
    );
  }

  if (!hasDraft) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-md border border-vam-line bg-slate-50 px-4 py-2 text-xs text-slate-600">
      <span aria-live="polite">
        {savedAt ? `Đã lưu nháp trên thiết bị này lúc ${formatSavedAt(savedAt)}.` : "Bản nháp được lưu trên thiết bị này."}
      </span>
      <button type="button" onClick={onDiscard} className="font-medium text-red-700 underline underline-offset-2">
        Xoá bản nháp
      </button>
    </div>
  );
}
```

---

## 5. `app/apply/_components/form-primitives.tsx` (modify — 4 lines)

Only `ApplicationForm` changes; every field component is untouched.

```diff
 export function ApplicationForm({
   action,
   state,
   submitLabel,
+  formRef: externalFormRef,
   children
 }: {
   action: (formData: FormData) => void;
   state: ApplyActionState;
   submitLabel: string;
+  formRef?: React.RefObject<HTMLFormElement>;
   children: React.ReactNode;
 }) {
-  const formRef = useRef<HTMLFormElement>(null);
+  // Draft recovery needs the same node revealInvalid() already walks, so the
+  // caller may supply the ref instead of us owning it.
+  const internalFormRef = useRef<HTMLFormElement>(null);
+  const formRef = externalFormRef ?? internalFormRef;
   const [missing, setMissing] = useState<MissingField[]>([]);
```

Everything below (`revealInvalid`, the `useEffect` on `state`, `<form ref={formRef}>`) keeps working unchanged.

---

## 6. `app/apply/mentee/apply-mentee-form.tsx` (modify)

```diff
 "use client";

+import { useRef } from "react";
 import { useFormState } from "react-dom";
 import { submitMenteeApplicationAction } from "@/app/actions/apply";
 import { APPLY_TOKEN_FIELD, initialApplyActionState, type ApplyActionState } from "@/lib/apply-types";
+import { DraftRecoveryBanner } from "../_components/draft-recovery-banner";
+import { useDraftRecovery } from "../_components/use-draft-recovery";
```

```diff
 export function ApplyMenteeForm({ applyToken }: { applyToken?: string | null }) {
   const [state, formAction] = useFormState<ApplyActionState, FormData>(
     submitMenteeApplicationAction,
     initialApplyActionState
   );
+  const formRef = useRef<HTMLFormElement>(null);
+  const draft = useDraftRecovery({ role: "mentee", formRef, submissionOk: state.ok });

   return (
-    <ApplicationForm action={formAction} state={state} submitLabel="Gửi đơn đăng ký mentee">
+    <>
+      <DraftRecoveryBanner
+        status={draft.status}
+        savedAt={draft.savedAt}
+        hasDraft={draft.hasDraft}
+        onRestore={draft.restore}
+        onDiscard={draft.discard}
+      />
+      {/* key: discarding remounts the subtree so field-level state resets with the DOM */}
+      <ApplicationForm
+        key={draft.resetKey}
+        formRef={formRef}
+        action={formAction}
+        state={state}
+        submitLabel="Gửi đơn đăng ký mentee"
+      >
```

…field markup unchanged (lines 154–404)…

```diff
-    </ApplicationForm>
+      </ApplicationForm>
+    </>
   );
 }
```

`app/apply/mentor/apply-mentor-form.tsx` takes the identical change with `role: "mentor"` and `submitLabel="Gửi đơn đăng ký mentor"`. Its existing `workYears`/`managementYears` state lives on the outer component, so it survives the `resetKey` remount — note that discarding leaves the eligibility hint showing until the numbers are re-entered; add `setWorkYears(null); setManagementYears(null);` to a discard wrapper there if that matters for UAT.

---

## 7. Clear-on-success

Because both actions end in `redirect("/apply/thanks?role=…")`, success is observable only on the thanks page.

`app/apply/thanks/clear-draft.tsx` (new):

```tsx
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
```

`app/apply/thanks/page.tsx` (modify) — `role` is already narrowed at line 10:

```diff
+import { ClearApplyDraft } from "./clear-draft";
...
     <section className="rounded-lg border border-vam-line bg-white p-6 shadow-soft sm:p-10">
+      <ClearApplyDraft role={role} />
```

**Deliberately not** clearing at submit time: req 4 requires the draft to survive a validation error, and every server-side rejection path returns state to the same mounted form.

---

## 8. Requirement → mechanism map

| # | Requirement | Mechanism |
|---|---|---|
| 1 | Restore prompt on mount | `useDraftRecovery` mount effect → `status: "prompt"`; accept ⇒ two-phase `applyFields`; decline ⇒ `discard()` (clears storage + remounts). *Assumption: "restores sections 1-4" is the UAT spot-check, not a scope limit — the design restores every non-consent, non-token field.* |
| 2 | Discard draft | Persistent "Xoá bản nháp" control in the banner's saved state; `clearStoredDraft` + `resetKey` remount. |
| 3 | Clear on success | `ClearApplyDraft` on `/apply/thanks`; `submissionOk` in the hook as a second guard. |
| 4 | Preserve on error | Nothing clears on submit; `submit` flushes the debounce so the last keystrokes are in storage before the round-trip. |
| 5 | Consent re-affirmation | `consentFieldNames(role)` (derived from `acknowledgementsForRole`) excluded on write **and** on read, plus `clearConsentFields` after restore. Existing `required` attributes + `revealInvalid` block submission. |
| 6 | Token security | `isPersistableField` drops `__apply_token`, all `__*`, all `$ACTION_*`; `buildDraftFields` additionally drops any value equal to the live token; both enforced on read as well. |

---

## 9. Tests

**`__tests__/apply-draft-model.test.ts`** (node env, no jsdom):
- `__apply_token`, a renamed `__foo` field, and `$ACTION_ID_abc` are absent from `createDraft(...).fields`.
- Token passed via `redactValues` is dropped even when submitted under a benign key (`additional_notes`) — asserts on `JSON.stringify(draft)` not containing the token substring.
- Every key in `consentFieldNames("mentee")` / `("mentor")` is absent after `createDraft`, and is stripped by `parseDraft` from a hand-crafted payload that contains them.
- `parseDraft` returns `null` for: bad JSON, `v: 0`, wrong `role`, prior season code, `savedAt` older than `APPLY_DRAFT_TTL_MS`, and an all-consent payload that reduces to zero fields.
- `writeStoredDraft` returns `false` (and writes nothing) past `APPLY_DRAFT_MAX_CHARS`, and `getDraftStorage()` returns `null` when the `localStorage` getter throws.

**`__tests__/apply-draft-recovery.test.tsx`** (`// @vitest-environment jsdom`, following the mock pattern in `__tests__/uat-s12-error-ux-and-phone.test.tsx:14` — mock `../app/apply/_components/submit-button` and `@/app/actions/apply`):
- Seed `localStorage`, render `ApplyMenteeForm`, assert the prompt appears and **no** field is populated before accepting.
- Accept ⇒ `full_name`/`email_primary` populated (req 1) **and** `university: "OTHER"` makes `university_other` appear populated — the regression guard for the value-tracker and two-phase problems.
- Accept ⇒ `consent_data_storage` and every `ACK.*` checkbox are unchecked, `MENTEE_ACTIVE_READING_V1` is empty, and `form.checkValidity()` is `false` (req 5).
- Decline / "Xoá bản nháp" ⇒ key removed from `localStorage` and fields empty (reqs 1, 2).
- Fire `submit`, assert the key is still present (req 4); render `ApplyThanksPage`'s `ClearApplyDraft` and assert it is gone (req 3).
- Type into a field with a token hidden input rendered, run the debounce timer, and assert the stored string contains neither the token value nor `__apply_token` (req 6).

---

## 10. Things worth your call before I build this

1. **PII at rest.** The mentee essays (`one_year_vision_text`, `current_difficulty_text`) are personal, and localStorage on a shared university lab machine survives the tab. The requirement mandates localStorage, so I've implemented it with a 7-day TTL, a season-scoped key, an always-visible discard control, and clearing on success. Switching to `sessionStorage` would remove most of that exposure but also removes the "browser crashed / accidental tab close" recovery that R1A exists for. Flagging, not blocking.
2. **`ACTIVE_READING` classified as consent.** I treat the typed confirmation phrase as an attestation and do not restore it, so the applicant retypes it. If UAT expects it restored, it moves out of `consentFieldNames` — one line.
3. **Direct navigation to `/apply/thanks`** clears the draft for that role. Acceptable for a success page; say the word if you'd rather gate it on a one-shot flag written at submit time.

**Estimated diff:** 4 new source files (~330 lines), 4 modified (~30 lines), 2 new test files. No new dependencies.

---

Want me to implement this, or save the plan to the empty `CLAUDE_R1A_PLAN.md` first?
