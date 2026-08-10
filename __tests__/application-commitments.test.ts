import { describe, expect, it } from "vitest";
import {
  acknowledgementRegistry,
  acknowledgementsForRole,
  APPLICATION_ACKNOWLEDGEMENTS,
  classifyMentorEligibility,
  confirmationMatches,
  MENTEE_CONFIRMATION_PHRASE,
  MENTOR_CONFIRMATION_PHRASE,
  mentorExperienceFromAnswers,
  normalizeConfirmation,
  summarizeAcknowledgements,
  validateMenteeCommitments,
  validateMentorCommitments
} from "../lib/application-commitments";

const accepted = (role: "mentor" | "mentee") =>
  new Set(acknowledgementsForRole(role).map((entry) => entry.key));

describe("Season 12 application commitment contract", () => {
  it("publishes all 15 deterministic immutable V1 semantic keys", () => {
    expect(acknowledgementRegistry).toHaveLength(15);
    expect(Object.isFrozen(APPLICATION_ACKNOWLEDGEMENTS)).toBe(true);
    expect(acknowledgementRegistry.every((entry) => entry.version === 1 && entry.key.endsWith("_V1"))).toBe(true);
  });

  it("normalizes case, Unicode/repeated whitespace and benign punctuation", () => {
    const variant = "  TÔI\u00a0HIỂU,  CAM KẾT CỦA MENTOR — VÀ SẴN SÀNG ĐỒNG HÀNH CÙNG MENTEE TRONG SUỐT MÙA MENTORING!!! ";
    expect(confirmationMatches(variant, MENTOR_CONFIRMATION_PHRASE)).toBe(true);
    expect(normalizeConfirmation("a\t\n b")).toBe("a b");
  });

  it("does not remove Vietnamese diacritics or accept materially different wording", () => {
    expect(confirmationMatches("Toi hieu cam ket cua Mentor va san sang dong hanh cung Mentee trong suot mua mentoring", MENTOR_CONFIRMATION_PHRASE)).toBe(false);
    expect(confirmationMatches("Tôi không đồng ý", MENTOR_CONFIRMATION_PHRASE)).toBe(false);
  });

  it("requires every Mentor acknowledgement", () => {
    const keys = accepted("mentor");
    keys.delete("MENTOR_TIME_COMMITMENT_V1");
    expect(validateMentorCommitments({ totalWorkYears: 10, peopleManagementYears: 4, largestTeamSize: 2, acceptedKeys: keys, activeReading: MENTOR_CONFIRMATION_PHRASE }).ok).toBe(false);
  });

  it("uses truthful experience-data attestation for standard and exception applicants", () => {
    expect(APPLICATION_ACKNOWLEDGEMENTS.MENTOR_ELIGIBILITY_V1.wording).toBe(
      "Tôi xác nhận các thông tin về kinh nghiệm làm việc và kinh nghiệm quản lý con người/đội ngũ mà tôi cung cấp ở trên là chính xác."
    );
    expect(APPLICATION_ACKNOWLEDGEMENTS.MENTOR_ELIGIBILITY_V1.wording).not.toContain("tối thiểu 8 năm");
  });

  it("classifies work experience below 8 for exception review without rejection", () => {
    expect(validateMentorCommitments({ totalWorkYears: 7, peopleManagementYears: 4, largestTeamSize: 2, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE })).toEqual({ ok: true, eligibility: "REQUIRES_CORE_TEAM_EXCEPTION_REVIEW" });
  });

  it("classifies management experience below 3 for exception review", () => {
    expect(classifyMentorEligibility(12, 2)).toBe("REQUIRES_CORE_TEAM_EXCEPTION_REVIEW");
  });

  it("requires team size when management experience is positive", () => {
    expect(validateMentorCommitments({ totalWorkYears: 10, peopleManagementYears: 3, largestTeamSize: Number.NaN, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE }).ok).toBe(false);
  });

  it("does not require team size when management experience is zero", () => {
    expect(validateMentorCommitments({ totalWorkYears: 10, peopleManagementYears: 0, largestTeamSize: Number.NaN, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE }).ok).toBe(true);
  });

  it("accepts a standard-eligible Mentor", () => {
    expect(validateMentorCommitments({ totalWorkYears: 8, peopleManagementYears: 3, largestTeamSize: 1, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE })).toEqual({ ok: true, eligibility: "STANDARD_ELIGIBILITY_MET" });
  });

  it("rejects negative and non-numeric experience", () => {
    expect(validateMentorCommitments({ totalWorkYears: -1, peopleManagementYears: 3, largestTeamSize: 1, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE }).ok).toBe(false);
    expect(validateMentorCommitments({ totalWorkYears: Number.NaN, peopleManagementYears: 3, largestTeamSize: 1, acceptedKeys: accepted("mentor"), activeReading: MENTOR_CONFIRMATION_PHRASE }).ok).toBe(false);
  });

  it("rejects an incorrect Mentor active-reading phrase", () => {
    expect(validateMentorCommitments({ totalWorkYears: 8, peopleManagementYears: 3, largestTeamSize: 1, acceptedKeys: accepted("mentor"), activeReading: "khác" }).ok).toBe(false);
  });

  it("requires every Mentee acknowledgement", () => {
    const keys = accepted("mentee");
    keys.delete("MENTEE_OWNERSHIP_V1");
    expect(validateMenteeCommitments({ acceptedKeys: keys, activeReading: MENTEE_CONFIRMATION_PHRASE }).ok).toBe(false);
  });

  it("requires monthly meeting, recap within 48 hours, and proactive communication", () => {
    expect(APPLICATION_ACKNOWLEDGEMENTS.MENTEE_PROACTIVE_SCHEDULING_V1.wording).toBe(
      "Tôi cam kết chủ động liên hệ và sắp xếp gặp Mentor tối thiểu 1 lần mỗi tháng trong suốt mùa mentoring."
    );
    expect(APPLICATION_ACKNOWLEDGEMENTS.MENTEE_RECAP_48H_V1.wording).toBe(
      "Tôi cam kết hoàn thành recap trong vòng 48 giờ sau mỗi buổi gặp Mentor."
    );
    expect(APPLICATION_ACKNOWLEDGEMENTS.MENTEE_NO_GHOST_V1.wording).toBe(
      "Tôi cam kết chủ động trao đổi với Mentor và Ban Tổ chức khi có khó khăn, thay đổi hoặc vấn đề ảnh hưởng đến quá trình mentoring."
    );
    for (const key of ["MENTEE_PROACTIVE_SCHEDULING_V1", "MENTEE_RECAP_48H_V1", "MENTEE_NO_GHOST_V1"]) {
      const keys = accepted("mentee");
      keys.delete(key);
      expect(validateMenteeCommitments({ acceptedKeys: keys, activeReading: MENTEE_CONFIRMATION_PHRASE }).ok).toBe(false);
    }
  });

  it("uses the final Mentee active-reading operational phrase", () => {
    expect(MENTEE_CONFIRMATION_PHRASE).toBe(
      "Tôi cam kết gặp Mentor tối thiểu một lần mỗi tháng, viết recap trong vòng 48 giờ và chủ động trao đổi với Mentor và Ban Tổ chức."
    );
  });

  it("accepts a normalized Mentee phrase and rejects an incorrect phrase", () => {
    expect(validateMenteeCommitments({ acceptedKeys: accepted("mentee"), activeReading: `  ${MENTEE_CONFIRMATION_PHRASE.toUpperCase()}!! ` }).ok).toBe(true);
    expect(validateMenteeCommitments({ acceptedKeys: accepted("mentee"), activeReading: "Tôi sẽ chờ Mentor chủ động" }).ok).toBe(false);
  });

  it("treats historical Mentor applications as not collected, not failed", () => {
    expect(summarizeAcknowledgements("mentor", [])).toMatchObject({ completed: false, isHistorical: true });
  });

  it("reports completed acknowledgements with versioned answer rows", () => {
    const rows = acknowledgementsForRole("mentee").map((entry) => ({ question_key: entry.key, value_text: "true", created_at: "2026-08-09T00:00:00Z" }));
    expect(summarizeAcknowledgements("mentee", rows)).toMatchObject({ completed: true, isHistorical: false });
  });

  it("derives admin Mentor eligibility from persisted numeric answers", () => {
    expect(mentorExperienceFromAnswers([
      { question_key: "mentor_total_work_years", value_text: "15" },
      { question_key: "mentor_people_management_years", value_text: "5" },
      { question_key: "mentor_largest_team_size", value_text: "8" },
      { question_key: "mentor_reference", value_text: "Nguyễn A — Core Team" }
    ])).toMatchObject({ eligibility: "STANDARD_ELIGIBILITY_MET", largestTeamSize: "8" });
  });
});
