import { describe, expect, it } from "vitest";
import { authorizeAccountTarget, canTransitionAccountStatus, PROGRAM_ADMIN_ACCOUNT_MANAGEMENT_ENABLED } from "@/lib/account-authorization";

const admin = { role: "admin" as const, status: "active", scopes: [{ programId: "ueh", seasonId: "s12", level: "full_access", status: "active" }] };
describe("account target authorization", () => {
  it("keeps Program Admin management feature-disabled", () => expect(PROGRAM_ADMIN_ACCOUNT_MANAGEMENT_ENABLED).toBe(false));
  it("allows Super Admin cross-program", () => expect(authorizeAccountTarget({ role: "super_admin", status: "active", scopes: [] }, { role: "viewer", programId: "ham", seasonId: "s6" }).allowed).toBe(true));
  it("denies Program Admin until isolation feature is enabled", () => expect(authorizeAccountTarget(admin, { role: "viewer", programId: "ueh", seasonId: "s12" }).reason).toBe("program_admin_feature_disabled"));
  it("denies cross-program, cross-season and admin-role assignment when enabled", () => {
    expect(authorizeAccountTarget(admin, { role: "viewer", programId: "ham", seasonId: "s6" }, true).allowed).toBe(false);
    expect(authorizeAccountTarget(admin, { role: "viewer", programId: "ueh", seasonId: "s11" }, true).allowed).toBe(false);
    expect(authorizeAccountTarget(admin, { role: "admin", programId: "ueh", seasonId: "s12" }, true).allowed).toBe(false);
  });
  it("limits reviewer/interviewer-equivalent actors", () => expect(authorizeAccountTarget({ role: "reviewer", status: "active", scopes: [] }, { role: "viewer", programId: "ueh", seasonId: "s12" }, true).allowed).toBe(false));
  it("models deactivate and restore lifecycle", () => { expect(canTransitionAccountStatus("active", "suspended")).toBe(true); expect(canTransitionAccountStatus("suspended", "active")).toBe(true); expect(canTransitionAccountStatus("active", "invited")).toBe(false); });
});
