import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * M2.1 originally exercised direct multi-write mutations with an in-memory
 * PostgREST fake. M090 deliberately replaced those writes with database RPC
 * transactions. These compatibility assertions keep the recovered interview
 * surface present while the RPC behavior is covered by the M090 suites.
 */
describe("M2.1 interview workflow compatibility after M090", () => {
  it("retains both assignment stages in the generic engine", () => {
    const source = readFileSync("lib/bulk-assignment.ts", "utf8");
    expect(source).toContain('"profile_screening" | "interview"');
    expect(source).toContain("INTERVIEW_ELIGIBLE_STATUSES");
  });

  it("retains cancel/reassign entry points while delegating writes to one RPC", () => {
    const source = readFileSync("lib/application-reviews.ts", "utf8");
    expect(source).toContain("export async function cancelApplicationReview");
    expect(source).toContain("export async function reassignApplicationReview");
    expect(source.match(/vam084_change_review_assignment/g)?.length).toBe(2);
  });

  it("does not restore the unsafe self-claim insert path", () => {
    const source = readFileSync("lib/interview-claim.ts", "utf8");
    expect(source).toContain("Bạn chưa được phân công phỏng vấn ứng viên này");
    expect(source).not.toContain("claim_source: \"self_claim\"");
  });
});
