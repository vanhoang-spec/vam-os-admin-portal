import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { emailsEqual, isValidEmail, normalizeEmail } from "@/lib/identity";

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

  it("uses season-aware application duplicate logic and reuses an existing person", () => {
    const source = fs.readFileSync("lib/applications-create.ts", "utf8");
    const duplicateBlock = source.slice(source.indexOf("// Duplicate check"), source.indexOf("// Insert"));
    expect(duplicateBlock).toContain('.eq("season_id", seasonRow.id)');
    expect(duplicateBlock).toContain('.eq("role_applied", input.role)');
    expect(duplicateBlock).toContain('.ilike("email_primary", emailPrimary)');
    expect(duplicateBlock).not.toContain('.eq("intake_batch_id", batchRow.id)');
    expect(duplicateBlock).toContain('.from("people")');
    expect(source).toContain("person_id: existingPerson?.id ?? null");
  });

  it("prepares database uniqueness for person identity and one application per season/role/email", () => {
    const migration = fs.readFileSync("supabase_migrations/072_s12_m1_canonical_email_uniqueness.sql", "utf8");
    expect(migration).toContain("lower(btrim(email_primary))");
    expect(migration).toContain("people_canonical_email_key");
    expect(migration).toContain("applications_season_role_canonical_email_key");
    expect(migration).toContain("M072 ABORTED [PEOPLE_CANONICAL_EMAIL_CONFLICT]");
    expect(migration).toContain("M072 ABORTED [APPLICATION_CANONICAL_EMAIL_CONFLICT]");
  });
});
