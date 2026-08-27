import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { invitationSourceFromProvenance } from "@/lib/legacy-mentor-import";

describe("S12-M1 admin search and filters", () => {
  it("includes mentor_code in the main mentor table search", () => {
    const source = fs.readFileSync("app/mentors/page.tsx", "utf8");
    expect(source).toContain('searchKeys={["full_name", "mentor_code", "email_primary"');
  });

  it("supports invite name/code/email search plus actual status and origin filters", () => {
    const page = fs.readFileSync("app/admin/renewals/page.tsx", "utf8");
    expect(page).toContain("matchesMentorQuery");
    expect(page).toContain("mentorCode: row.mentorCode");
    for (const value of ["live", "awaiting_confirmation", "accepted", "declined", "revoked", "expired"]) {
      expect(page).toContain(`value=\"${value}\"`);
    }
    for (const value of ["s11_renewal", "legacy_coreteam_import", "legacy_manual_entry"]) {
      expect(page).toContain(`value=\"${value}\"`);
    }
  });

  it("derives operational origin without exposing or changing token data", () => {
    expect(invitationSourceFromProvenance(null)).toBe("s11_renewal");
    expect(invitationSourceFromProvenance('legacy_candidate:{"source":"legacy_coreteam_import"}')).toBe("legacy_coreteam_import");
    expect(invitationSourceFromProvenance('legacy_candidate:{"source":"legacy_manual_entry"}')).toBe("legacy_manual_entry");
  });
});
