"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AUTOSAVE_TTL_DAYS,
  clearDraft,
  getApplyFormAutosaveKey,
  hasStoredDraft,
  isAutosaveSafeFieldName,
  loadDraft,
  saveDraft,
  type AutosaveData
} from "@/lib/autosave";
import type { ApplyActionState } from "@/lib/apply-types";
import type { AutosaveFieldRegistry } from "./form-primitives";

/**
 * Draft autosave for a public application form.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE HOOK RATHER THAN ONE PER FORM
 * ---------------------------------------------------------------------------
 * The mentee and mentor forms need identical behaviour, and the parts that are
 * easy to get wrong are the parts that are invisible: cancelling a queued
 * snapshot before clearing, clearing BEFORE navigating, staying idempotent
 * across a Strict Mode double-invoke. Two copies of that would drift, and the
 * drift would only show up as a draft surviving a real submission on someone's
 * shared machine. The role is the only difference, so it is the only parameter.
 *
 * ---------------------------------------------------------------------------
 * WHERE DRAFTS LIVE
 * ---------------------------------------------------------------------------
 * `localStorage` on the applicant's own device, and nowhere else. Nothing here
 * is transmitted; no draft ever reaches the server or the database. Clearing
 * the browser's site data removes it, and a draft written on one device is not
 * visible on another. `lib/autosave.ts` documents what may be stored — the
 * short version is applicant answers only, never the pilot token or any other
 * hidden or credential-shaped field.
 */
export type ApplyAutosave = {
  /** The draft being restored into this render, or null when there is none. */
  draftData: AutosaveData | null;
  /** Remounts the field tree when the draft is loaded or explicitly cleared. */
  formKey: string;
  /** Allowlist registry the form primitives register themselves with. */
  registry: AutosaveFieldRegistry;
  /** `onChangeCapture` handler that queues a debounced snapshot. */
  handleFormChange: React.FormEventHandler<HTMLFormElement>;
  /** Explicit "clear draft" for the applicant, with confirmation. */
  handleClearDraft: () => void;
  /** False until the client has had a chance to read storage. */
  isMounted: boolean;
  /** Banner copy: whether a draft was restored on this visit. */
  restored: boolean;
  ttlDays: number;
};

export function useApplyAutosave({
  role,
  state,
  successPath
}: {
  role: "mentee" | "mentor";
  state: ApplyActionState;
  successPath: string;
}): ApplyAutosave {
  const [isMounted, setIsMounted] = useState(false);
  const [draftData, setDraftData] = useState<AutosaveData | null>(null);
  const [formKey, setFormKey] = useState("initial");
  const router = useRouter();

  // One helper derives the key for every reader and writer, so the write side
  // and the clear side cannot drift onto different keys and leave a draft
  // alive after a confirmed submission. The key carries program, season, role
  // and form version, so a mentor draft cannot restore into the mentee form,
  // and a draft written against an older field set is not restored at all.
  const autosaveKey = getApplyFormAutosaveKey(role);

  /**
   * The autosave ALLOWLIST. Every user-editable primitive registers its own
   * name while mounted; the snapshot reads ONLY these names out of the form.
   *
   * This is what keeps `__apply_token` — and any hidden field added later —
   * out of the applicant's browser. Iterating the `FormData` instead would
   * persist whatever the form happened to render, making safety depend on
   * remembering to exclude each new field.
   */
  const registryRef = useRef(new Map<string, { multiple: boolean; mounted: number }>());
  const registry = useMemo<AutosaveFieldRegistry>(
    () => ({
      register: (name, options) => {
        const fields = registryRef.current;
        const existing = fields.get(name);
        if (existing) {
          existing.mounted += 1;
          existing.multiple = existing.multiple || Boolean(options?.multiple);
        } else {
          fields.set(name, { multiple: Boolean(options?.multiple), mounted: 1 });
        }
        return () => {
          const current = fields.get(name);
          if (!current) return;
          current.mounted -= 1;
          // A conditional companion ("Khác" free text) unregisters when the
          // applicant selects something else, which stops its value being
          // carried forward under a parent answer that no longer wants it.
          if (current.mounted <= 0) fields.delete(name);
        };
      }
    }),
    []
  );

  useEffect(() => {
    const draft = loadDraft(autosaveKey);
    if (draft) {
      setDraftData(draft);
      setFormKey("draft-loaded");
    }
    setIsMounted(true);
  }, [autosaveKey]);

  const formElementRef = useRef<HTMLFormElement | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSnapshot = useCallback(() => {
    if (snapshotTimerRef.current === null) return;
    clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = null;
  }, []);

  /**
   * Once a submission is confirmed, no further snapshot may ever be written.
   *
   * Cancelling the queued timer is not sufficient on its own: a keystroke
   * landing between the confirmation and the unmount would schedule a NEW
   * snapshot and write the submitted answers straight back. This latch closes
   * the writer permanently for the life of the component.
   */
  const submittedRef = useRef(false);

  const handleClearDraft = useCallback(() => {
    if (
      !window.confirm(
        "Bạn có chắc muốn xóa bản nháp hiện tại? Toàn bộ nội dung đang nhập sẽ bị xóa và không thể khôi phục."
      )
    ) {
      return;
    }
    // Drop any snapshot still queued from the last keystroke, or it would land
    // after the delete and write the deleted answers straight back.
    cancelPendingSnapshot();
    clearDraft(autosaveKey);
    setDraftData(null);
    setFormKey(Date.now().toString());
  }, [autosaveKey, cancelPendingSnapshot]);

  /**
   * Snapshot the answers into the draft.
   *
   * Deferred to a task rather than run inside the change event, because a
   * change can REMOVE a field: selecting something other than "Khác" unmounts
   * the free-text companion. `onChangeCapture` runs before React has processed
   * the event, so a snapshot taken there still sees the companion in the
   * `FormData` and writes its now-orphaned text back. Letting React commit
   * first means the snapshot reflects the form the applicant can actually see.
   * It also coalesces a burst of keystrokes into one write.
   */
  const handleFormChange = useCallback<React.FormEventHandler<HTMLFormElement>>(
    (event) => {
      if (submittedRef.current) return;
      formElementRef.current = event.currentTarget;
      cancelPendingSnapshot();
      snapshotTimerRef.current = setTimeout(() => {
        snapshotTimerRef.current = null;
        if (submittedRef.current) return;
        const form = formElementRef.current;
        if (!form || !form.isConnected) return;

        const formData = new FormData(form);
        const data: AutosaveData = {};
        // Iterate the ALLOWLIST, never the FormData. A field nobody registered
        // is structurally unreachable from here, so a hidden input cannot be
        // stored even though it sits in the same FormData.
        for (const [name, field] of Array.from(registryRef.current.entries())) {
          if (!isAutosaveSafeFieldName(name)) continue;
          const values = formData
            .getAll(name)
            .filter((value): value is string => typeof value === "string" && value !== "");
          // An untouched text input and an unselected <select> both appear in
          // FormData as "". Storing those would put a key in the draft for
          // every control on the page — noise on a shared machine, and
          // indistinguishable from an answer deliberately cleared.
          if (!values.length) continue;
          // A checkbox group keeps its array shape even at one selection;
          // anything else keeps the single value the control actually holds.
          data[name] = field.multiple ? values : values[values.length - 1];
        }
        saveDraft(autosaveKey, data);
      }, 0);
    },
    [autosaveKey, cancelPendingSnapshot]
  );

  // A snapshot that fires after the form is gone would resurrect a draft the
  // applicant just deleted, or one a successful submission just cleared.
  useEffect(() => cancelPendingSnapshot, [cancelPendingSnapshot]);

  /**
   * Confirmed-success cleanup, then navigation.
   *
   * The action does not redirect on success; it returns a state carrying
   * `applicationId`, which only exists once the row has actually been written.
   * That is the signal this effect waits for — not a submit, not a click, not
   * a validation attempt, and not a query parameter someone could type into
   * the address bar. Every failure shape (gate refusal, missing field,
   * returning mentor, duplicate email, DB or config fault, thrown error)
   * returns `ok: false` and lands here as a no-op, so a rejected submission
   * keeps every answer.
   *
   * ORDER MATTERS. The draft is cleared BEFORE the navigation is issued: once
   * `router.replace` runs, this component is on its way out, and anything
   * queued behind the navigation is not guaranteed to run.
   *
   * `handledApplicationIdRef` makes it idempotent. React may re-run an effect
   * (Strict Mode double-invokes in development, and any re-render carrying the
   * same state re-evaluates it), and navigating twice or racing a second
   * cleanup against a fresh draft would both be visible to the applicant.
   */
  const handledApplicationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!state.ok || !state.applicationId) return;
    if (handledApplicationIdRef.current === state.applicationId) return;
    handledApplicationIdRef.current = state.applicationId;

    // Close the writer first: cancel what is queued, and refuse anything a
    // late keystroke might try to queue afterwards.
    submittedRef.current = true;
    cancelPendingSnapshot();
    clearDraft(autosaveKey);
    // Storage can refuse a write (private mode, blocked site data). Confirm the
    // removal rather than assume it, and try once more before navigating away
    // from the only place that can still fix it.
    if (hasStoredDraft(autosaveKey)) clearDraft(autosaveKey);
    setDraftData(null);

    router.replace(successPath);
  }, [state.ok, state.applicationId, autosaveKey, cancelPendingSnapshot, router, successPath]);

  return {
    draftData,
    formKey,
    registry,
    handleFormChange,
    handleClearDraft,
    isMounted,
    restored: draftData !== null,
    ttlDays: AUTOSAVE_TTL_DAYS
  };
}
