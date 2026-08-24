import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  acknowledgementsForRole,
  APPLICATION_ACKNOWLEDGEMENTS as ACK,
  MENTEE_CONFIRMATION_PHRASE,
  MENTOR_CONFIRMATION_PHRASE,
  validateMenteeCommitments,
  validateMentorCommitments
} from "../lib/application-commitments";

const mentorConductKeys = [
  "MENTOR_BOUNDARIES_V1",
  "MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1",
  "MENTOR_CONFLICT_ESCALATION_V1"
];
const menteeConductKeys = [
  "MENTEE_RELATIONSHIP_BOUNDARIES_V1",
  "MENTEE_CONFIDENTIALITY_V1",
  "MENTEE_NO_GHOST_V1"
];
const accepted = (role: "mentor" | "mentee") =>
  new Set(acknowledgementsForRole(role).map((entry) => entry.key));

describe("professional-boundary, safety and confidentiality commitments", () => {
  it("requires all three available Mentor conduct commitments", () => {
    for (const key of mentorConductKeys) {
      const keys = accepted("mentor");
      keys.delete(key);
      expect(validateMentorCommitments({
        totalWorkYears: 8,
        peopleManagementYears: 3,
        largestTeamSize: 1,
        acceptedKeys: keys,
        activeReading: MENTOR_CONFIRMATION_PHRASE
      }).ok).toBe(false);
    }
  });

  it("keeps Mentor CoC acceptance out of the application and documents its onboarding stage", () => {
    const form = readFileSync("app/apply/mentor/apply-mentor-form.tsx", "utf8");
    expect(acknowledgementsForRole("mentor").map((entry) => entry.key)).not.toContain("MENTOR_CONDUCT_V1");
    expect(ACK.MENTOR_CONDUCT_V1.collectionStage).toBe("post_approval_after_orientation");
    expect(form).not.toContain("MENTOR_CONDUCT_V1");
    expect(form).not.toContain("Xem Mentor Code of Conduct");
  });

  it("replaces the old long conduct checkbox with concise distinct semantics", () => {
    const form = readFileSync("app/apply/mentor/apply-mentor-form.tsx", "utf8");
    expect(form).not.toContain("bán hàng, bán khóa học, tuyển dụng đa cấp");
    expect(ACK.MENTOR_BOUNDARIES_V1.wording).toContain("ranh giới nghề nghiệp phù hợp");
    expect(ACK.MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1.wording).toContain("tính bảo mật của Mentee");
    expect(ACK.MENTOR_CONFLICT_ESCALATION_V1.wording).toContain("xung đột lợi ích");
  });

  it("requires relationship boundaries, confidentiality and the reused safety/no-ghost acknowledgement", () => {
    for (const key of menteeConductKeys) {
      const keys = accepted("mentee");
      keys.delete(key);
      expect(validateMenteeCommitments({ acceptedKeys: keys, activeReading: MENTEE_CONFIRMATION_PHRASE }).ok).toBe(false);
    }
    expect(Object.keys(ACK).filter((key) => key.includes("NO_GHOST"))).toEqual([
      "MENTOR_NO_GHOST_V1",
      "MENTEE_NO_GHOST_V1"
    ]);
  });

  it("ignores forged keys and requires registry-derived trusted acknowledgements", () => {
    const forged = new Set(["MENTOR_BOUNDARIES_V2", "FAKE_CONDUCT_V1", ...Array.from(accepted("mentor"))]);
    forged.delete("MENTOR_BOUNDARIES_V1");
    expect(validateMentorCommitments({
      totalWorkYears: 8,
      peopleManagementYears: 3,
      largestTeamSize: 1,
      acceptedKeys: forged,
      activeReading: MENTOR_CONFIRMATION_PHRASE
    }).ok).toBe(false);
  });

  it("keeps standard, exception-review and valid Mentee submissions working", () => {
    expect(validateMentorCommitments({ totalWorkYears: 8, peopleManagementYears: 3, largestTeamSize: 1, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE })).toMatchObject({ ok: true, eligibility: "STANDARD_ELIGIBILITY_MET" });
    expect(validateMentorCommitments({ totalWorkYears: 7, peopleManagementYears: 2, largestTeamSize: 1, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE })).toMatchObject({ ok: true, eligibility: "REQUIRES_CORE_TEAM_EXCEPTION_REVIEW" });
    expect(validateMenteeCommitments({ acceptedKeys: accepted("mentee"), activeReading: MENTEE_CONFIRMATION_PHRASE })).toEqual({ ok: true });
  });

  it("renders registry wording and keeps trusted persistence server-derived", () => {
    const mentorForm = readFileSync("app/apply/mentor/apply-mentor-form.tsx", "utf8");
    const menteeForm = readFileSync("app/apply/mentee/apply-mentee-form.tsx", "utf8");
    const action = readFileSync("app/actions/apply.ts", "utf8");
    const persistence = readFileSync("lib/applications-create.ts", "utf8");
    expect(mentorForm).toContain("label={entry.wording}");
    expect(menteeForm).toContain("label={entry.wording}");
    expect(action).toContain("questionLabel: entry.wording");
    expect(action).toContain('valueText: "true"');
    expect(persistence).toContain("p_answers: input.answers");
  });
});
