import { describe, expect, it } from "vitest";
import { availableMembershipActions, membershipOperationNeedsReason } from "@/lib/membership-lifecycle";

describe("membership lifecycle UI model", () => {
  it("offers only state-applicable actions", () => {
    expect(availableMembershipActions("active")).toEqual(["pause", "withdraw", "opt_out", "cancel", "remove_role"]);
    expect(availableMembershipActions("paused")).toContain("reactivate");
    expect(availableMembershipActions("invited")).not.toContain("reactivate");
    expect(availableMembershipActions("completed")).toEqual([]);
  });
  it("requires reasons exactly for administrative cancel/removal", () => {
    expect(membershipOperationNeedsReason("cancel")).toBe(true);
    expect(membershipOperationNeedsReason("remove_role")).toBe(true);
    expect(membershipOperationNeedsReason("pause")).toBe(false);
  });
});
