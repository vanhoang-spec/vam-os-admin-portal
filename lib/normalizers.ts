/**
 * lib/normalizers.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dependency-light pure server-side normalization and validation logic.
 * Ensures data entering the database adheres to production constraints.
 */

export const CANONICAL_MEETING_TYPES = [
  "1on1_primary",
  "1on1_cross",
  "group",
  "online",
  "offline",
  "unknown"
] as const;

export type CanonicalMeetingType = typeof CANONICAL_MEETING_TYPES[number];

const VALID_MEETING_TYPES = new Set<string>(CANONICAL_MEETING_TYPES);

/**
 * Normalizes user input for meeting_type into a canonical database enum value.
 *
 * @param input - The raw input string
 * @returns A validated canonical string
 * @throws Error if the input is non-empty and unmappable
 */
export function normalizeMeetingType(input: unknown): CanonicalMeetingType {
  const raw = String(input ?? "").trim().toLowerCase();

  // Blank behavior matches documented default of "1on1_primary"
  if (raw === "") {
    return "1on1_primary";
  }

  // Legacy aliases
  if (raw === "group_training") {
    return "group";
  }
  if (raw === "other") {
    return "unknown";
  }

  if (VALID_MEETING_TYPES.has(raw)) {
    return raw as CanonicalMeetingType;
  }

  throw new Error(`Invalid meeting type: "${raw}"`);
}
