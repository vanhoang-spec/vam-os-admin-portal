import type { Application, MentorProfile, Person } from "@/lib/types";

function normalizedEmail(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

/**
 * Read-only returning-mentor detection for an application that is not linked
 * yet. Ambiguous people or profile rows deliberately produce no match.
 */
export function findReturningMentorProfile(
  application: Pick<Application, "person_id" | "email_primary" | "role_applied" | "status">,
  people: Person[],
  mentorProfiles: MentorProfile[]
): MentorProfile | null {
  if (
    application.person_id ||
    application.status !== "submitted" ||
    application.role_applied !== "mentor"
  ) {
    return null;
  }
  const email = normalizedEmail(application.email_primary);
  if (!email) return null;

  const peopleMatches = people.filter((person) => normalizedEmail(person.email_primary) === email);
  if (peopleMatches.length !== 1) return null;

  const profileMatches = mentorProfiles.filter(
    (profile) => profile.person_id === peopleMatches[0].id
  );
  return profileMatches.length === 1 ? profileMatches[0] : null;
}
