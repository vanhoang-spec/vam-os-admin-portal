import { describe, it, expect } from "vitest";
import {
  canAccessAdminUser,
  canManageUsers,
  canEditRecap,
  canAssignReview,
  canReview,
  isReviewerOnly,
  canDecide,
  canBulkAssignReviews,
  canManageReviewers,
  canSelfClaimInterview,
  canManageMatches,
  canRecordMentorConfirmation,
  canTriageCrossRequest,
  canPublishCrossSession,
} from "../lib/permissions";

// ── Role sets ─────────────────────────────────────────────────────────────────

const ADMIN_TIER = ["super_admin", "admin", "core_team"] as const;
const REVIEW_ROLES = ["super_admin", "admin", "core_team", "reviewer"] as const;
const LIMITED_ROLES = ["viewer", "support_team"] as const;

// ── canAccessAdminUser (admin tier only) ──────────────────────────────────────

describe("canAccessAdminUser", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants ${role}`, () => expect(canAccessAdminUser(role)).toBe(true));
  });
  it("denies reviewer", () => expect(canAccessAdminUser("reviewer")).toBe(false));
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canAccessAdminUser(role)).toBe(false));
  });
  it("denies null", () => expect(canAccessAdminUser(null)).toBe(false));
  it("denies undefined", () => expect(canAccessAdminUser(undefined)).toBe(false));
});

// ── canManageUsers (super_admin and admin only) ───────────────────────────────

describe("canManageUsers", () => {
  it("grants super_admin", () => expect(canManageUsers("super_admin")).toBe(true));
  it("grants admin", () => expect(canManageUsers("admin")).toBe(true));
  it("denies core_team", () => expect(canManageUsers("core_team")).toBe(false));
  it("denies reviewer", () => expect(canManageUsers("reviewer")).toBe(false));
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canManageUsers(role)).toBe(false));
  });
  it("denies null", () => expect(canManageUsers(null)).toBe(false));
});

// ── canEditRecap (takes AdminLike object) ─────────────────────────────────────

describe("canEditRecap", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants { role: "${role}" }`, () => expect(canEditRecap({ role })).toBe(true));
  });
  it("denies reviewer", () => expect(canEditRecap({ role: "reviewer" })).toBe(false));
  it("denies null admin user", () => expect(canEditRecap(null)).toBe(false));
  it("denies undefined admin user", () => expect(canEditRecap(undefined)).toBe(false));
  it("denies object with null role", () => expect(canEditRecap({ role: null })).toBe(false));
});

// ── canAssignReview (admin tier only) ─────────────────────────────────────────

describe("canAssignReview", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants ${role}`, () => expect(canAssignReview(role)).toBe(true));
  });
  it("denies reviewer (can review, cannot assign)", () => expect(canAssignReview("reviewer")).toBe(false));
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canAssignReview(role)).toBe(false));
  });
});

// ── canReview (admin tier + reviewer) ────────────────────────────────────────

describe("canReview", () => {
  REVIEW_ROLES.forEach((role) => {
    it(`grants ${role}`, () => expect(canReview(role)).toBe(true));
  });
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canReview(role)).toBe(false));
  });
  it("denies null", () => expect(canReview(null)).toBe(false));
});

// ── isReviewerOnly (exactly "reviewer") ──────────────────────────────────────

describe("isReviewerOnly", () => {
  it("true for reviewer", () => expect(isReviewerOnly("reviewer")).toBe(true));
  ADMIN_TIER.forEach((role) => {
    it(`false for ${role}`, () => expect(isReviewerOnly(role)).toBe(false));
  });
  LIMITED_ROLES.forEach((role) => {
    it(`false for ${role}`, () => expect(isReviewerOnly(role)).toBe(false));
  });
  it("false for null", () => expect(isReviewerOnly(null)).toBe(false));
});

// ── canDecide (admin tier only — excludes reviewer) ──────────────────────────

describe("canDecide", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants ${role}`, () => expect(canDecide(role)).toBe(true));
  });
  it("denies reviewer", () => expect(canDecide("reviewer")).toBe(false));
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canDecide(role)).toBe(false));
  });
  it("denies null", () => expect(canDecide(null)).toBe(false));
});

// ── canBulkAssignReviews (admin tier only) ────────────────────────────────────

describe("canBulkAssignReviews", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants ${role}`, () => expect(canBulkAssignReviews(role)).toBe(true));
  });
  it("denies reviewer", () => expect(canBulkAssignReviews("reviewer")).toBe(false));
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canBulkAssignReviews(role)).toBe(false));
  });
});

// ── canManageReviewers (admin tier only) ──────────────────────────────────────

describe("canManageReviewers", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants ${role}`, () => expect(canManageReviewers(role)).toBe(true));
  });
  it("denies reviewer", () => expect(canManageReviewers("reviewer")).toBe(false));
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canManageReviewers(role)).toBe(false));
  });
});

// ── canSelfClaimInterview (admin tier + reviewer) ─────────────────────────────

describe("canSelfClaimInterview", () => {
  REVIEW_ROLES.forEach((role) => {
    it(`grants ${role}`, () => expect(canSelfClaimInterview(role)).toBe(true));
  });
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canSelfClaimInterview(role)).toBe(false));
  });
  it("denies null", () => expect(canSelfClaimInterview(null)).toBe(false));
});

// ── canManageMatches (admin tier only — reviewer excluded) ────────────────────

describe("canManageMatches", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants ${role}`, () => expect(canManageMatches(role)).toBe(true));
  });
  it("denies reviewer (cannot manage matches)", () => expect(canManageMatches("reviewer")).toBe(false));
  LIMITED_ROLES.forEach((role) => {
    it(`denies ${role}`, () => expect(canManageMatches(role)).toBe(false));
  });
  it("denies null", () => expect(canManageMatches(null)).toBe(false));
});

// ── canRecordMentorConfirmation (admin tier + support_team) ───────────────────

describe("canRecordMentorConfirmation", () => {
  ADMIN_TIER.forEach((role) => {
    it(`grants ${role}`, () => expect(canRecordMentorConfirmation(role)).toBe(true));
  });
  it("grants support_team (phone follow-up is their job)", () =>
    expect(canRecordMentorConfirmation("support_team")).toBe(true));
  it("denies reviewer (a mentor must not set another mentor's capacity)", () =>
    expect(canRecordMentorConfirmation("reviewer")).toBe(false));
  it("denies viewer", () => expect(canRecordMentorConfirmation("viewer")).toBe(false));
  it("denies null", () => expect(canRecordMentorConfirmation(null)).toBe(false));
  it("denies undefined", () => expect(canRecordMentorConfirmation(undefined)).toBe(false));
  it("denies an unknown role", () => expect(canRecordMentorConfirmation("ghost_role")).toBe(false));
});

// ── Role set consistency ───────────────────────────────────────────────────────

describe("role set consistency", () => {
  it("canRecordMentorConfirmation is canDecide plus support_team, and nothing else", () => {
    const roles = ["super_admin", "admin", "core_team", "reviewer", "support_team", "viewer"];
    roles.forEach((r) => {
      const expected = canDecide(r) || r === "support_team";
      expect(canRecordMentorConfirmation(r), r).toBe(expected);
    });
  });

  it("support_team gains no other write capability from this change", () => {
    expect(canManageMatches("support_team")).toBe(false);
    expect(canDecide("support_team")).toBe(false);
    expect(canReview("support_team")).toBe(false);
    expect(canAssignReview("support_team")).toBe(false);
    expect(canBulkAssignReviews("support_team")).toBe(false);
    expect(canManageReviewers("support_team")).toBe(false);
    expect(canSelfClaimInterview("support_team")).toBe(false);
    expect(canEditRecap({ role: "support_team" })).toBe(false);
    expect(canManageUsers("support_team")).toBe(false);
    expect(canAccessAdminUser("support_team")).toBe(false);
  });

  it("canManageMatches and canDecide have the same allowed set (admin tier)", () => {
    const roles = ["super_admin", "admin", "core_team", "reviewer", "support_team", "viewer"];
    roles.forEach((r) => {
      expect(canManageMatches(r)).toBe(canDecide(r));
    });
  });

  it("canReview is a strict superset of canAssignReview (reviewer can review but not assign)", () => {
    const roles = ["super_admin", "admin", "core_team", "reviewer", "support_team", "viewer"];
    roles.forEach((r) => {
      if (canAssignReview(r)) expect(canReview(r)).toBe(true);
    });
    expect(canReview("reviewer")).toBe(true);
    expect(canAssignReview("reviewer")).toBe(false);
  });
});

// ── Cross-mentoring (migration 072) ───────────────────────────────────────────
//
// Two predicates, not one, and the split is the point.
//
// The owner asked for support team to handle cross-mentoring requests. Taken as
// a single permission that would have handed them the button that creates a
// public event and sends two irreversible letters — well past the line this
// codebase draws for that role elsewhere (canManageProgramDocuments excludes
// them for exactly this reason). So: triage yes, publish no.

describe("cross-mentoring permissions", () => {
  const ALL_ROLES = [
    "super_admin",
    "admin",
    "core_team",
    "reviewer",
    "support_team",
    "viewer",
    "vam_admin",
  ] as const;

  it("lets support team triage — the owner's explicit instruction", () => {
    expect(canTriageCrossRequest("support_team")).toBe(true);
  });

  it("does NOT let support team publish a session", () => {
    expect(canPublishCrossSession("support_team")).toBe(false);
  });

  it("lets the admin tier do both", () => {
    ADMIN_TIER.forEach((role) => {
      expect(canTriageCrossRequest(role)).toBe(true);
      expect(canPublishCrossSession(role)).toBe(true);
    });
  });

  it("refuses reviewer, viewer and the reporting account outright", () => {
    ["reviewer", "viewer", "vam_admin"].forEach((role) => {
      expect(canTriageCrossRequest(role)).toBe(false);
      expect(canPublishCrossSession(role)).toBe(false);
    });
  });

  it("refuses an unknown role, an empty string and undefined", () => {
    [undefined, "", "  ", "root", "administrator", "mentor"].forEach((role) => {
      expect(canTriageCrossRequest(role as never)).toBe(false);
      expect(canPublishCrossSession(role as never)).toBe(false);
    });
  });

  it("makes publish a strict subset of triage — nobody may publish who may not triage", () => {
    ALL_ROLES.forEach((role) => {
      if (canPublishCrossSession(role)) expect(canTriageCrossRequest(role)).toBe(true);
    });
  });

  it("differs on exactly one role, so the split stays deliberate", () => {
    const differing = ALL_ROLES.filter(
      (role) => canTriageCrossRequest(role) !== canPublishCrossSession(role)
    );
    expect(differing).toEqual(["support_team"]);
  });
});
