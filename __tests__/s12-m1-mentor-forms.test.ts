import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { enforceOtherDetails, MENTOR_OTHER_DETAIL_RULES } from "@/lib/application-form-validation";
import { MENTOR_PROGRAM_OPTIONS, MENTOR_SUPPORT_CONTACTS, MENTOR_UNIVERSITY_OPTIONS } from "@/lib/mentor-intake-content";
import { validateRenewalAcceptance } from "@/lib/renewal-runtime";
import { RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD } from "@/lib/renewal-types";
import { ACTIVE_READING_KEYS, CONFIRMATION_PHRASES, requiredCheckboxAcknowledgements } from "@/lib/application-commitments";

function renewalForm(overrides: Record<string, string | null> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    participation_confirmed: "yes",
    consent_data_storage: "yes",
    company_current: "Acme",
    title_current: "Director",
    mentor_total_work_years: "12",
    mentor_people_management_years: "5",
    years_of_experience: "11-15",
    industry_primary: "education",
    function_primary: "strategy_consulting",
    mentoring_capacity_total: "2",
    mentoring_topics: "Career strategy and leadership",
    university: "UEH",
    programs_willing_to_join: "UEHM",
    [RENEWAL_PROFILE_REVIEW_CONFIRMATION_FIELD]: "yes",
    [ACTIVE_READING_KEYS.mentor]: CONFIRMATION_PHRASES.mentor,
    ...overrides
  })) {
    if (value !== null) form.set(key, value);
  }
  for (const entry of requiredCheckboxAcknowledgements("mentor")) form.set(entry.key, "true");
  return form;
}

describe("S12-M1 mentor form content", () => {
  it("keeps university structured and requires the other-school detail", () => {
    expect(MENTOR_UNIVERSITY_OPTIONS.map((option) => option.label)).toEqual([
      "Đại học Kinh tế TP.HCM (UEH)",
      "Các trường đại học khác"
    ]);
    const payload: Record<string, unknown> = { university: "OTHER", university_other: "  " };
    expect(enforceOtherDetails(payload, payload, MENTOR_OTHER_DETAIL_RULES)).toMatchObject({ ok: false, fieldName: "university_other" });
    payload.university_other = "Đại học Bách Khoa";
    expect(enforceOtherDetails(payload, payload, MENTOR_OTHER_DETAIL_RULES)).toEqual({ ok: true });
    expect(payload.university_other).toBe("Đại học Bách Khoa");
  });

  it("contains UEH Alumni, approved mentor portrait, and all support contacts", () => {
    const newForm = fs.readFileSync("app/apply/mentor/apply-mentor-form.tsx", "utf8");
    const intro = fs.readFileSync("app/apply/_components/mentor-profile-intro.tsx", "utf8");
    const renewal = fs.readFileSync("app/renew/[token]/renewal-form.tsx", "utf8");
    expect(newForm).toContain('value: "ueh_alumni", label: "UEH Alumni"');
    expect(intro).toContain("Chân dung Mentor mà UEH Mentoring đang tìm kiếm");
    expect(newForm).toContain("<MentorProfileIntro />");
    expect(renewal).toContain("<MentorProfileIntro includeApplicationProcess={false} />");
    expect(MENTOR_SUPPORT_CONTACTS).toHaveLength(3);
    expect(JSON.stringify(MENTOR_SUPPORT_CONTACTS)).toContain("lieu.nguyen@hoatay.com.vn");
    expect(JSON.stringify(MENTOR_SUPPORT_CONTACTS)).toContain("0905.376.392");
    expect(JSON.stringify(MENTOR_SUPPORT_CONTACTS)).toContain("0979.578.128");
  });

  it("removes public Batch 1 Pilot wording without changing the token gate", () => {
    const page = fs.readFileSync("app/apply/mentor/page.tsx", "utf8");
    const gate = fs.readFileSync("app/apply/_components/gate-views.tsx", "utf8");
    expect(page).not.toMatch(/Batch 1 \(Pilot\)|đăng ký pilot/i);
    expect(gate).not.toContain("Chế độ pilot:");
    expect(page).toContain("gate.state === \"pilot\"");
  });
});

describe("S12-M1 renewal annual confirmation", () => {
  it("accepts a complete, consented annual confirmation", () => {
    const result = validateRenewalAcceptance(renewalForm());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.programs_willing_to_join).toEqual(["UEHM"]);
      expect(result.payload.university).toBe("UEH");
    }
  });

  it.each(["company_current", "title_current", "mentor_total_work_years", "industry_primary", "function_primary"])(
    "requires %s for the Season 12 submission",
    (key) => expect(validateRenewalAcceptance(renewalForm({ [key]: null })).ok).toBe(false)
  );

  it("requires explicit consent, at least one known program, and an other-university name", () => {
    expect(validateRenewalAcceptance(renewalForm({ consent_data_storage: null })).ok).toBe(false);
    expect(validateRenewalAcceptance(renewalForm({ programs_willing_to_join: null })).ok).toBe(false);
    expect(validateRenewalAcceptance(renewalForm({ programs_willing_to_join: "NOT_A_PROGRAM" })).ok).toBe(false);
    expect(validateRenewalAcceptance(renewalForm({ university: "OTHER", university_other: null })).ok).toBe(false);
    expect(validateRenewalAcceptance(renewalForm({ university: "OTHER", university_other: "RMIT" })).ok).toBe(true);
    expect(MENTOR_PROGRAM_OPTIONS.some((option) => option.value === "UEHM")).toBe(true);
  });
});
