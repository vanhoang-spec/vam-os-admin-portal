/**
 * Forgiving text matching for the renewal mentor picker.
 *
 * Client-safe on purpose: the same functions run in the browser (filtering the
 * rendered list as the operator types) and in tests. Nothing here touches the
 * database or any secret.
 *
 * WHY DIACRITIC FOLDING
 * Roughly 500 mentors carry Vietnamese names. An operator hunting for
 * "Nguyen Duc Thang" spelled with full tone marks will type it without them —
 * no operator types diacritics into a search box under time pressure. Folding
 * both sides means the obvious keystrokes work. NFD decomposition strips the
 * combining tone/vowel marks; d-with-stroke is handled separately because it is
 * a distinct letter rather than a base letter plus a combining mark, so NFD
 * leaves it untouched.
 */

/** Combining diacritical marks (U+0300-U+036F), emitted by NFD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** d-with-stroke, lower and upper case. Not decomposed by NFD. */
const D_WITH_STROKE = /[đĐ]/g;

/**
 * Lowercases, strips Vietnamese diacritics, folds d-with-stroke to "d", and
 * collapses runs of whitespace and punctuation to single spaces.
 *
 * Punctuation folding is what lets "VM-002" match a stored code of "VM002" (and
 * the reverse), and what stops a stray dot or comma in a pasted name from
 * killing an otherwise exact match.
 */
export function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(D_WITH_STROKE, "d")
    .toLowerCase()
    // Anything that is not a letter or digit becomes a separator, so "VM-002",
    // "VM 002" and "vm002" all normalise to comparable text.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The searchable text for one mentor: name, mentor code and email together, so
 * a single query box covers all three without the operator choosing a field.
 */
export function mentorSearchHaystack(mentor: {
  fullName?: string | null;
  mentorCode?: string | null;
  email?: string | null;
}): string {
  // The un-separated forms are appended as extra tokens so a query of "vm002"
  // matches a stored "VM-002" even though normalisation splits the latter into
  // "vm 002", and so "mentor02@" survives losing its punctuation.
  const code = normalizeSearchText(mentor.mentorCode).replace(/ /g, "");
  const email = normalizeSearchText(mentor.email).replace(/ /g, "");
  return [
    normalizeSearchText(mentor.fullName),
    normalizeSearchText(mentor.mentorCode),
    code,
    normalizeSearchText(mentor.email),
    email
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * True when EVERY token in the query appears somewhere in the haystack.
 *
 * All-tokens rather than any-token: with 500 mentors, one common surname alone
 * returns far too much, and an operator who types a second word means it as a
 * refinement. An empty query matches everything, which is what makes the list
 * browsable before the first keystroke.
 */
export function matchesMentorQuery(
  mentor: { fullName?: string | null; mentorCode?: string | null; email?: string | null },
  query: string
): boolean {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!tokens.length) return true;
  const haystack = mentorSearchHaystack(mentor);
  return tokens.every((token) => haystack.includes(token));
}
