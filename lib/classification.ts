import type { Application, Person, MentorProfile } from "@/lib/types";

export function evaluateMentorClassifications(
  applications: Pick<Application, "id" | "person_id" | "email_primary">[],
  people: Pick<Person, "id" | "email_primary">[],
  profiles: Pick<MentorProfile, "person_id" | "source_application_id">[],
  peopleQueryFailed: boolean,
  profilesQueryFailed: boolean
): Map<string, "Mentor cũ quay lại" | "Mentor mới" | "Chưa xác định"> {
  const result = new Map<string, "Mentor cũ quay lại" | "Mentor mới" | "Chưa xác định">();
  if (!applications || applications.length === 0) return result;

  for (const app of applications) {
    let resolvedPersonIds: string[] = [];
    let isAmbiguous = false;

    if (app.person_id) {
      resolvedPersonIds.push(app.person_id);
    } else if (app.email_primary) {
      if (peopleQueryFailed) {
        // Fail closed if we needed to look up this unlinked app but the query failed
        isAmbiguous = true;
      } else {
        const email = String(app.email_primary).trim().toLowerCase();
        const matchedPeople = people.filter((p) => String(p.email_primary).trim().toLowerCase() === email);
        if (matchedPeople.length > 1) {
          isAmbiguous = true;
        } else if (matchedPeople.length === 1) {
          resolvedPersonIds.push(matchedPeople[0].id);
        }
      }
    }

    if (isAmbiguous) {
      result.set(app.id, "Chưa xác định");
      continue;
    }

    if (resolvedPersonIds.length === 0) {
      result.set(app.id, "Mentor mới");
      continue;
    }

    if (profilesQueryFailed) {
      // Fail closed if we have a person ID but failed to load profiles
      result.set(app.id, "Chưa xác định");
      continue;
    }

    const personId = resolvedPersonIds[0];
    const personProfiles = profiles.filter((p) => p.person_id === personId);
    
    // Check if there is any profile NOT created by this exact application
    const priorProfiles = personProfiles.filter((p) => p.source_application_id !== app.id);
    
    if (priorProfiles.length > 0) {
      result.set(app.id, "Mentor cũ quay lại");
    } else {
      result.set(app.id, "Mentor mới");
    }
  }

  return result;
}
