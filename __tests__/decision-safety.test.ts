/**
 * Tests for application-decision safety: confirms which statuses require
 * a confirmation step before the core team can submit.
 *
 * Classification: UNIT TESTS (pure logic, no DB or server dependencies).
 */
import { describe, it, expect } from "vitest";
import { DESTRUCTIVE_DECISION_STATUSES } from "@/lib/decision-action-types";

describe("DESTRUCTIVE_DECISION_STATUSES — confirmation gate", () => {
  it("marks rejected_or_not_fit as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("rejected_or_not_fit")).toBe(true);
  });

  it("marks withdrawn as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("withdrawn")).toBe(true);
  });

  it("does not mark screening_passed as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("screening_passed")).toBe(false);
  });

  it("does not mark invited_to_interview as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("invited_to_interview")).toBe(false);
  });

  it("does not mark waitlisted as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("waitlisted")).toBe(false);
  });

  it("does not mark needs_more_review as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("needs_more_review")).toBe(false);
  });

  it("does not treat empty string as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("")).toBe(false);
  });

  it("does not treat unknown status as destructive", () => {
    expect(DESTRUCTIVE_DECISION_STATUSES.has("approved")).toBe(false);
  });
});
