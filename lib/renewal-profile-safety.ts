import "server-only";

import {
  buildMentorProfileRefresh,
  type MentorProfileRefresh
} from "@/lib/application-approvals";

// ---------------------------------------------------------------------------
// M070 — Renewal payload safety.
//
// A renewal is a light touch-up of a mentor who already exists. It must be
// able to correct what changed since Season 11 — employer, title, capacity —
// and it must be structurally incapable of rewriting the mentor's LINEAGE:
// which season they first joined, and what they did in prior seasons. Those
// are history, not profile fields, and a renewal form is the last place they
// should be editable from.
//
// WHY THIS IS A STRIP AND NOT A SECOND ALLOWLIST
// The obvious implementation is a fresh allowlist for renewal. It is the wrong
// one: two allowlists drift, and the renewal copy is the one nobody looks at
// when a field is added to the S12 payload. So this module DERIVES from
// `buildMentorProfileRefresh` — the reviewed approval allowlist, which is left
// exactly as it is — and then removes the lineage fields. The renewal
// allowlist can therefore never be WIDER than the approval allowlist; the only
// direction it can move is narrower, which is the safe direction.
//
// `buildMentorProfileRefresh` emits `first_vam_season`, and that is correct for
// its own path: a NEW mentor's first season is established at approval. It is
// exactly what must never survive into a RENEWAL, and this file is the reason
// the two paths can share one allowlist without sharing that field.
// ---------------------------------------------------------------------------

/**
 * Fields that are historical lineage and are never writable through renewal,
 * whatever the payload contains and whatever the allowlist upstream grows to.
 *
 * `first_vam_season` — the season this person first joined VAM. A returning
 *   mentor renewing for S12 who typed "S12" into a form field would otherwise
 *   overwrite "S11" and erase the very fact that makes them a returning mentor.
 * `prior_vam_involvement` — the narrative record of earlier seasons. Not in the
 *   approval allowlist today; listed here so that adding it there later cannot
 *   silently open it to renewal.
 *
 * The renewal form MAY DISPLAY both as read-only context. Displaying is not
 * editing, and nothing in this module is involved in rendering.
 */
export const RENEWAL_STRIPPED_PROFILE_FIELDS = Object.freeze([
  "first_vam_season",
  "prior_vam_involvement"
] as const);

export type RenewalStrippedField = (typeof RENEWAL_STRIPPED_PROFILE_FIELDS)[number];

/** The approval refresh shape minus the lineage fields. */
export type RenewalProfileRefresh = Omit<Partial<MentorProfileRefresh>, RenewalStrippedField>;

/**
 * The renewal canonical-refresh payload.
 *
 * DELTA SEMANTICS, inherited unchanged from `buildMentorProfileRefresh` and
 * re-stated here because they are the contract, not an implementation detail:
 *
 *   omitted          the key is absent from the payload    → key absent here
 *                                                            → column preserved
 *   blank            "", "   ", or a non-numeric for a
 *                    numeric field                         → key absent here
 *                                                            → column preserved
 *   valid, changed   a non-blank value                     → key present
 *                                                            → candidate update
 *   explicit clear   "set this column back to NULL"        → UNSUPPORTED IN P0
 *
 * The last row is a property of the shape, not a rule someone has to remember:
 * every value in the returned object is non-blank, so there is no
 * representation of "clear it". A mentor who wants a field emptied asks an
 * admin, who edits the profile directly. Supporting explicit clears through an
 * unauthenticated token-bearing form would mean a single mis-sent link could
 * blank a canonical profile, and P0 deliberately does not offer it.
 *
 * "Candidate" is literal: nothing here is written by this function or by the
 * renewal submission. It is what the admin confirmation step diffs and
 * approves — see `buildRenewalProfileDiff`.
 */
export function buildRenewalProfileRefresh(
  rawPayload: Record<string, unknown> | null | undefined
): RenewalProfileRefresh {
  const patch: Record<string, unknown> = {
    ...buildMentorProfileRefresh(rawPayload)
  };
  for (const field of RENEWAL_STRIPPED_PROFILE_FIELDS) {
    delete patch[field];
  }
  return patch as RenewalProfileRefresh;
}

// ---------------------------------------------------------------------------
// Field-level BEFORE / AFTER diff
// ---------------------------------------------------------------------------

export type RenewalProfileDiffEntry = {
  field: string;
  before: string | number | null;
  after: string | number | null;
};

function normalizeForComparison(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * The field-level BEFORE / AFTER diff the admin sees before any canonical
 * profile column is written. P0, not P1.
 *
 * The reason it is P0 is that a renewal is submitted by someone holding a
 * bearer token, with no reviewer screening in front of it, and it lands on a
 * mentor_profiles row that is already canonical and already referenced by
 * matching, search and export. "Approve" without a diff is an admin agreeing
 * to a change they were never shown. With the diff, the admin is agreeing to a
 * specific list of specific column changes.
 *
 * Only genuinely CHANGED fields are returned, compared after normalisation, so
 * a payload that re-submits the same employer with different whitespace does
 * not present the admin with a change to approve. An empty array is the honest
 * answer to "this renewal changes nothing about the profile" and the
 * confirmation UI should say exactly that rather than showing an empty table.
 *
 * The returned array is also the payload the `confirm_renewal` audit row
 * carries — it is the only durable record of what the admin was shown.
 */
export function buildRenewalProfileDiff(
  current: Record<string, unknown> | null | undefined,
  candidate: RenewalProfileRefresh
): RenewalProfileDiffEntry[] {
  const existing = current ?? {};
  const entries: RenewalProfileDiffEntry[] = [];

  for (const field of Object.keys(candidate).sort()) {
    // Defence in depth. A stripped field cannot be in `candidate` — it is
    // deleted above — so reaching this branch means the strip was bypassed,
    // and the diff refuses to carry it rather than presenting the admin with a
    // lineage change dressed up as an ordinary field.
    if ((RENEWAL_STRIPPED_PROFILE_FIELDS as readonly string[]).includes(field)) {
      continue;
    }
    const after = normalizeForComparison((candidate as Record<string, unknown>)[field]);
    if (after === null) continue; // blank/omitted never reaches here, but never emit a clear
    const before = normalizeForComparison(existing[field]);
    if (before === after) continue;
    entries.push({ field, before, after });
  }

  return entries;
}

/**
 * The subset of the candidate that the admin's confirmation actually writes:
 * exactly the changed fields, and only those. Passing the full candidate to an
 * UPDATE would also rewrite unchanged columns with equal values — harmless for
 * the data, but it makes `updated_at` and any future column-level audit claim
 * a change that the admin was never shown and did not approve.
 */
export function renewalProfileUpdateFromDiff(
  diff: readonly RenewalProfileDiffEntry[]
): Record<string, string | number> {
  const update: Record<string, string | number> = {};
  for (const entry of diff) {
    if (entry.after === null) continue;
    update[entry.field] = entry.after;
  }
  return update;
}
