import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { emailsEqual, escapeIlikePattern, isValidEmail, normalizeEmail } from "@/lib/identity";

describe("S12-M1 canonical email identity", () => {
  it.each([
    ["mentor@example.com", "mentor@example.com"],
    ["Mentor@Example.COM", "mentor@example.com"],
    ["  mentor@example.com  ", "mentor@example.com"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
    expect(emailsEqual(input, expected)).toBe(true);
  });

  it.each(["mentor", "mentor@", "@example.com", "mentor example@example.com", "mentor@example"])(
    "rejects malformed email %s",
    (email) => expect(isValidEmail(email)).toBe(false)
  );

  it("keeps provider-significant addresses distinct", () => {
    expect(normalizeEmail("mentor+season12@gmail.com")).not.toBe(normalizeEmail("mentor@gmail.com"));
    expect(normalizeEmail("first.last@gmail.com")).not.toBe(normalizeEmail("firstlast@gmail.com"));
    expect(isValidEmail("mentor!ops@example.com")).toBe(true);
  });

  it("escapes every PostgreSQL ILIKE metacharacter in applicant input", () => {
    expect(escapeIlikePattern("_victim%@%.%\\tail")).toBe("\\_victim\\%@\\%.\\%\\\\tail");
  });

  it("prepares database uniqueness for person identity and one application per season/role/email", () => {
    const apply = fs.readFileSync("VAM_OS_M083_S12_M1_IDENTITY_PREVIEW_REMEDIATION_20260827/apply.sql", "utf8");
    expect(apply).toContain("lower(btrim(email_primary))");
    expect(apply).toContain("people_canonical_email_key");
    expect(apply).toContain("applications_season_role_canonical_email_key");
    expect(apply).toContain("applications_s12_role_person_key");
    expect(apply).toContain("M083 DOMAIN A ABORTED [PEOPLE_CANONICAL_EMAIL_CONFLICT]");
    expect(apply).toContain("M083 DOMAIN A ABORTED [APPLICATION_PERSON_CONFLICT]");
  });
});
