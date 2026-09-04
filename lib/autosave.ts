/**
 * Browser-local draft storage for the public application forms.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAY BE STORED
 * ---------------------------------------------------------------------------
 * A draft holds applicant-entered answers and NOTHING else. It lives in the
 * `localStorage` of whatever machine the applicant used — frequently a shared
 * university lab or a family computer — for up to seven days, and neither this
 * module nor the applicant can reach into that browser afterwards. So the
 * question is not "is this field convenient to restore" but "would I accept
 * this value sitting unencrypted on a shared machine for a week".
 *
 * Security material never passes that test. The pilot relay field
 * `__apply_token` is the concrete case: it is a hidden input the form renders
 * so the Server Action can re-run the same gate the page ran, and the previous
 * implementation swept it into the draft because it snapshotted the whole
 * `FormData`. A token persisted to a shared browser is a token anyone at that
 * machine can lift and submit with.
 *
 * The primary defence is therefore an ALLOWLIST, not a denylist: the caller
 * enumerates the user-facing fields it wants saved (the form primitives
 * register themselves — see `AutosaveRegistryContext`), and only those are
 * read out of the form. A field nobody registered cannot be stored even if it
 * is sitting in the same `FormData`, which is what makes a future hidden field
 * safe by default instead of safe by remembering to exclude it.
 *
 * `isAutosaveSafeFieldName` below is the SECOND line, not the first. It exists
 * so that a draft hand-written into `localStorage`, or one left behind by an
 * older build, still cannot surface a credential-shaped field on restore.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAY BE READ BACK
 * ---------------------------------------------------------------------------
 * `localStorage` is attacker-writable in exactly the situation this feature is
 * designed for: shared machines. Syntactically valid JSON is not evidence of a
 * trustworthy payload, so `loadDraft` validates the envelope (version,
 * timestamp, plain-object data) and every value's type before returning
 * anything. A payload that fails is removed rather than repaired — a corrupt
 * draft the applicant cannot see is worse than no draft, because it silently
 * re-appears on every visit.
 */

import { SEASON_CONFIG } from "@/lib/season-config";

/**
 * Envelope version. Bumping it invalidates every stored draft, which is the
 * intended behaviour whenever the stored shape or the safety rules change: an
 * old draft written under weaker rules must not be trusted by newer code.
 */
export const AUTOSAVE_VERSION = 1;

export const AUTOSAVE_TTL_DAYS = 7;
export const AUTOSAVE_TTL_MS = AUTOSAVE_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * A `savedAt` slightly ahead of `Date.now()` is ordinary clock skew between
 * the write and the read. Anything further ahead cannot have been written by
 * this browser in good faith, and would otherwise never expire.
 */
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

export type AutosaveValue = string | string[];
export type AutosaveData = Record<string, AutosaveValue>;

export type AutosavePayload = {
  version: number;
  savedAt: number;
  data: AutosaveData;
};

/** Program and form-version halves of the public application autosave key. */
export const APPLY_AUTOSAVE_PROGRAM_CODE = "VAM";
export const APPLY_AUTOSAVE_FORM_VERSION = "v1";

/**
 * Field names that must never be persisted or restored, whatever the caller
 * asks for.
 *
 * `^_` covers the internal-field convention (`__apply_token` and anything else
 * the framework or a future form relays through a hidden input). The rest name
 * the credential vocabulary directly, so a field called `session_id` or
 * `csrf_token` is refused even if some future form registers it by mistake.
 *
 * Checked against every real field name on the mentor and mentee forms: none
 * of them matches. Adding a term here is cheap; removing one is not.
 */
const FORBIDDEN_FIELD_NAME =
  /(^_)|token|csrf|xsrf|password|passwd|secret|session|auth|credential|hash|nonce|signature|bearer|apikey|api_key/i;

export function isAutosaveSafeFieldName(name: unknown): name is string {
  if (typeof name !== "string" || !name.trim()) return false;
  return !FORBIDDEN_FIELD_NAME.test(name);
}

/**
 * Draft keys are isolated by program + season + role + form version, so a
 * mentor draft cannot restore into the mentee form, last season's draft cannot
 * restore into this season's, and a form whose fields changed does not restore
 * answers written against the old shape.
 */
export function getAutosaveKey(programId: string, seasonId: string, roleApplied: string, formVersion: string) {
  return `vam_autosave_${programId}_${seasonId}_${roleApplied}_${formVersion}`;
}

/**
 * The key for a public application form. Every reader and writer derives it
 * here, so the restore side and the post-success clear side cannot drift onto
 * different keys and leave a draft alive after a successful submission.
 */
export function getApplyFormAutosaveKey(role: "mentee" | "mentor") {
  return getAutosaveKey(
    APPLY_AUTOSAVE_PROGRAM_CODE,
    SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE,
    role,
    APPLY_AUTOSAVE_FORM_VERSION
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `string` or `string[]`, and nothing else. `null`, numbers, booleans, nested
 * objects and sparse/mixed arrays are all rejected: every one of them would
 * reach a form primitive expecting text and produce either a crash or a
 * silently wrong control value.
 */
function isAllowedValue(value: unknown): value is AutosaveValue {
  if (typeof value === "string") return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Drops unsafe names. Used on write; the same filter runs again on read. */
function safeEntries(data: AutosaveData): AutosaveData {
  const out: AutosaveData = {};
  for (const [name, value] of Object.entries(data)) {
    if (!isAutosaveSafeFieldName(name)) continue;
    if (!isAllowedValue(value)) continue;
    out[name] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

export function saveDraft(key: string, data: AutosaveData) {
  if (typeof window === "undefined") return;
  const payload: AutosavePayload = {
    version: AUTOSAVE_VERSION,
    savedAt: Date.now(),
    data: safeEntries(data)
  };
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    // Quota exceeded, or storage disabled (private mode / blocked cookies).
    // Autosave is a convenience; losing it must never break the form.
    console.error("Autosave saveDraft failed:", error);
  }
}

function discard(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing further to do — the caller already treats this draft as absent.
  }
  return null;
}

/**
 * Returns the stored answers, or `null` for anything that is not a draft this
 * build wrote, recently, in the expected shape.
 *
 * Every rejection path also REMOVES the item. A draft that fails validation
 * will fail it again on the next visit, and leaving it in place means the
 * applicant carries an invisible, permanently-ignored payload around on a
 * shared machine.
 */
export function loadDraft(key: string, ttlMs: number = AUTOSAVE_TTL_MS): AutosaveData | null {
  if (typeof window === "undefined") return null;

  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch (error) {
    console.error("Autosave loadDraft failed:", error);
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON: truncated write, or someone typing into devtools.
    return discard(key);
  }

  if (!isPlainObject(parsed)) return discard(key);
  if (parsed.version !== AUTOSAVE_VERSION) return discard(key);

  const savedAt = parsed.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return discard(key);

  const now = Date.now();
  if (savedAt > now + FUTURE_CLOCK_TOLERANCE_MS) return discard(key);
  if (now - savedAt > ttlMs) return discard(key);

  if (!isPlainObject(parsed.data)) return discard(key);

  // A value of the wrong TYPE means the payload was not written by this
  // module, so the whole draft is suspect and none of it is restored. An
  // unsafe NAME is different: it is a field this build would never have
  // written but whose neighbours may be perfectly good applicant answers, so
  // it is dropped and the rest is kept.
  const data: AutosaveData = {};
  for (const [name, value] of Object.entries(parsed.data)) {
    if (!isAllowedValue(value)) return discard(key);
    if (!isAutosaveSafeFieldName(name)) continue;
    data[name] = Array.isArray(value) ? [...value] : value;
  }

  return data;
}

/**
 * Whether anything is still stored under `key`.
 *
 * Used to CONFIRM a removal rather than assume one: `localStorage` can refuse a
 * write (private mode, blocked site data), and the caller that clears a draft
 * after a confirmed submission is about to navigate away from the only place
 * that could retry.
 */
export function hasStoredDraft(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function clearDraft(key: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.error("Autosave clearDraft failed:", error);
  }
}

// ── Restore-side normalisers ────────────────────────────────────────────────
// A checkbox group with exactly ONE box ticked arrives from `FormData` as a
// bare string, not a one-element array. Feeding that string to `new Set(...)`
// spreads it into individual CHARACTERS, which is how single-selection drafts
// came back with the wrong boxes ticked and a nonsense "n/3 selected" counter.
// Every primitive now goes through these instead of indexing the draft raw.

export function draftText(value: AutosaveValue | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

export function draftList(value: AutosaveValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") return value ? [value] : [];
  return [];
}

/** A checkbox submits its `value` only when ticked; absent means unticked. */
export function draftChecked(value: AutosaveValue | undefined, checkedValue = "true"): boolean {
  return draftList(value).includes(checkedValue);
}
