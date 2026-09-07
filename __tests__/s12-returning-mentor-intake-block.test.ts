import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("lib/applications-create.ts", "utf8");
const blockStart = SOURCE.indexOf('if (input.role === "mentor") {');
const insertStart = SOURCE.indexOf("// Insert", blockStart);
const block = SOURCE.slice(blockStart, insertStart);

describe("S12 returning Mentor public-intake P0", () => {
  it("checks Mentor history only for canonical existing Mentor applicants before insert", () => {
    expect(blockStart).toBeGreaterThan(-1);
    expect(insertStart).toBeGreaterThan(blockStart);
    expect(block).toContain('.from("mentor_profiles")');
    // Scoped to the ONE canonical person the submission resolved to. The
    // resolved identity is `identityPerson` since the backfill hotfix, which
    // added canonical phone resolution as a fallback to the email lookup; what
    // matters here is that the history lookup is person-scoped, not which
    // signal resolved that person.
    expect(block).toContain('.eq("person_id", identityPerson.id)');
    expect(block).toContain('.limit(1)');
  });

  it("does not treat a people row alone as returning-Mentor proof", () => {
    expect(block).toContain('if ((mentorProfiles ?? []).length > 0 || (mentorMemberships ?? []).length > 0)');
    expect(block).not.toContain('if (existingPerson) {\n      return');
  });

  it("routes an existing Mentor profile to S12 renewal instead of a new application", () => {
    expect(block).toContain('code: "validation"');
    expect(block).toContain("xác nhận/gia hạn Mentor Season 12");
    expect(block).toContain("đường dẫn do BTC gửi");
  });

  it("fails closed when Mentor-history lookup cannot be trusted", () => {
    expect(block).toContain('if (profileErr || membershipErr)');
    expect(block).toContain('log("returning mentor lookup failed", profileErr || membershipErr)');
    expect(block).toContain('code: "db"');
    expect(block).toContain("message: SAFE_ERROR");
  });

  it("preserves same-season duplicate protection before returning-Mentor classification", () => {
    const duplicateCheck = SOURCE.indexOf("duplicateCandidates");
    expect(duplicateCheck).toBeGreaterThan(-1);
    expect(duplicateCheck).toBeLessThan(blockStart);
  });
});
