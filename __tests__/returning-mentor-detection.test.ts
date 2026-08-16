import { describe, expect, it } from "vitest";
import { findReturningMentorProfile } from "@/lib/returning-mentor";
import type { MentorProfile, Person } from "@/lib/types";

const person = (id: string, email: string): Person => ({
  id,
  email_primary: email,
  full_name: "Mentor",
  phone_primary: null,
  gender: null,
  source_sheets: null,
  data_quality_flags: null
});

const profile = (id: string, personId: string): MentorProfile => ({
  id,
  person_id: personId,
  mentor_code: "UEHRM01017",
  bio_url: null,
  company_current: null,
  title_current: null,
  years_experience_min: null,
  years_experience_text: null,
  industry: null,
  function_area: null
});

describe("findReturningMentorProfile", () => {
  it("finds exactly one existing mentor by normalized email without mutating linkage", () => {
    const mentor = profile("profile-1", "person-1");
    expect(findReturningMentorProfile(
      { person_id: null, email_primary: "  THANG@EXAMPLE.COM ", role_applied: "mentor", status: "submitted" },
      [person("person-1", "thang@example.com")],
      [mentor]
    )).toBe(mentor);
  });

  it("fails closed when more than one person has the normalized email", () => {
    expect(findReturningMentorProfile(
      { person_id: null, email_primary: "thang@example.com", role_applied: "mentor", status: "submitted" },
      [person("person-1", "THANG@example.com"), person("person-2", "thang@example.com")],
      [profile("profile-1", "person-1"), profile("profile-2", "person-2")]
    )).toBeNull();
  });

  it("does not show a pre-approval signal after person_id is already linked", () => {
    expect(findReturningMentorProfile(
      { person_id: "person-1", email_primary: "thang@example.com", role_applied: "mentor", status: "submitted" },
      [person("person-1", "thang@example.com")],
      [profile("profile-1", "person-1")]
    )).toBeNull();
  });

  it("only signals for submitted mentor applications", () => {
    const people = [person("person-1", "thang@example.com")];
    const mentors = [profile("profile-1", "person-1")];

    expect(findReturningMentorProfile(
      { person_id: null, email_primary: "thang@example.com", role_applied: "mentee", status: "submitted" },
      people,
      mentors
    )).toBeNull();
    expect(findReturningMentorProfile(
      { person_id: null, email_primary: "thang@example.com", role_applied: "mentor", status: "withdrawn" },
      people,
      mentors
    )).toBeNull();
  });
});
