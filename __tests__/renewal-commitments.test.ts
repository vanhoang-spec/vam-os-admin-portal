import { describe, it, expect } from "vitest";
import { renewalPayloadFromFormData } from "../lib/renewal-runtime";
import { buildRenewalProfileDiff, buildRenewalProfileRefresh } from "../lib/renewal-profile-safety";
import { APPLICATION_ACKNOWLEDGEMENTS as ACK, MENTOR_CONFIRMATION_PHRASE } from "../lib/application-commitments";

describe("Renewal Commitments & Mentee Capacity", () => {
  it("defaults Mentee capacity correctly and accepts 1, 2, 3; rejects others implicitly by form typing, but here validates payload extraction", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    fd.append("mentoring_capacity_total", "1");
    
    const mentorCommitments = [
      ACK.MENTOR_TIME_COMMITMENT_V1,
      ACK.MENTOR_ELIGIBILITY_V1,
      ACK.MENTOR_MATCH_EXPECTATION_V1,
      ACK.MENTOR_MENTORING_PRINCIPLE_V1,
      ACK.MENTOR_NO_GHOST_V1,
      ACK.MENTOR_BOUNDARIES_V1,
      ACK.MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1,
      ACK.MENTOR_CONFLICT_ESCALATION_V1
    ];
    mentorCommitments.forEach(c => fd.append(c.key, "true"));
    fd.append("MENTOR_ACTIVE_READING_V1", MENTOR_CONFIRMATION_PHRASE);

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.mentoring_capacity_total).toBe(1);
    expect((payload.commitments as any).MENTOR_ACTIVE_READING_V1_matched).toBe(true);
  });

  it("fails if any of the 8 commitments are missing", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    
    const mentorCommitments = [
      ACK.MENTOR_TIME_COMMITMENT_V1,
      ACK.MENTOR_ELIGIBILITY_V1,
      ACK.MENTOR_MATCH_EXPECTATION_V1,
      ACK.MENTOR_MENTORING_PRINCIPLE_V1,
      ACK.MENTOR_NO_GHOST_V1,
      ACK.MENTOR_BOUNDARIES_V1,
      ACK.MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1,
      ACK.MENTOR_CONFLICT_ESCALATION_V1
    ];
    mentorCommitments.slice(0, 7).forEach(c => fd.append(c.key, "true"));
    fd.append("MENTOR_ACTIVE_READING_V1", MENTOR_CONFIRMATION_PHRASE);

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.commitments_completed).toBe(false);
  });

  it("acknowledgement exact phrase passes with whitespace trimmed", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    const mentorCommitments = [
      ACK.MENTOR_TIME_COMMITMENT_V1,
      ACK.MENTOR_ELIGIBILITY_V1,
      ACK.MENTOR_MATCH_EXPECTATION_V1,
      ACK.MENTOR_MENTORING_PRINCIPLE_V1,
      ACK.MENTOR_NO_GHOST_V1,
      ACK.MENTOR_BOUNDARIES_V1,
      ACK.MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1,
      ACK.MENTOR_CONFLICT_ESCALATION_V1
    ];
    mentorCommitments.forEach(c => fd.append(c.key, "true"));
    fd.append("MENTOR_ACTIVE_READING_V1", `   ${MENTOR_CONFIRMATION_PHRASE}   `);

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.commitments_completed).toBe(true);
    expect((payload.commitments as any).MENTOR_ACTIVE_READING_V1_matched).toBe(true);
  });

  it("altered acknowledgement phrase fails", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    const mentorCommitments = [
      ACK.MENTOR_TIME_COMMITMENT_V1,
      ACK.MENTOR_ELIGIBILITY_V1,
      ACK.MENTOR_MATCH_EXPECTATION_V1,
      ACK.MENTOR_MENTORING_PRINCIPLE_V1,
      ACK.MENTOR_NO_GHOST_V1,
      ACK.MENTOR_BOUNDARIES_V1,
      ACK.MENTOR_RESPECT_SAFETY_CONFIDENTIALITY_V1,
      ACK.MENTOR_CONFLICT_ESCALATION_V1
    ];
    mentorCommitments.forEach(c => fd.append(c.key, "true"));
    fd.append("MENTOR_ACTIVE_READING_V1", "Tôi đồng ý.");

    const payload = renewalPayloadFromFormData(fd);
    expect(payload.commitments_completed).toBe(false);
    expect((payload.commitments as any).MENTOR_ACTIVE_READING_V1_matched).toBe(false);
  });

  it("Core team note optional and persists in payload but not in profile diff", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");
    fd.append("core_team_note", "I want the same mentee");
    
    const payload = renewalPayloadFromFormData(fd);
    expect(payload.core_team_note).toBe("I want the same mentee");

    const refresh = buildRenewalProfileRefresh(payload);
    const oldProfile = { id: "p1", person_id: "x" } as any;
    const diff = buildRenewalProfileDiff(oldProfile, refresh);
    
    expect(diff.find(d => d.field === "core_team_note")).toBeUndefined();
    expect((refresh as any).core_team_note).toBeUndefined();
  });

  it("removal of old free-text availability_commitment does not overwrite historical data", () => {
    const fd = new FormData();
    fd.append("participation_confirmed", "yes");

    const payload = renewalPayloadFromFormData(fd);
    expect(payload).not.toHaveProperty("availability_commitment");
    
    const refresh = buildRenewalProfileRefresh(payload);
    expect(refresh).not.toHaveProperty("availability_commitment");
  });
});
