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
  for (const [name, rawValue] of Array.from(entries)) {
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
      (item: any): item is string => typeof item === "string" && item !== ""
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
