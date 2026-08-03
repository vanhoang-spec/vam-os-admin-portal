import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { resolveCanonicalContext, resetDependentContext } from "@/lib/program-context-core";

const root = join(__dirname, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");
const catalog = {
  programs: [
    { id: "program-uehm", code: "UEHM", name: "UEHM", isActive: true },
    { id: "program-ham", code: "HAM", name: "HAM", isActive: true }
  ],
  seasons: [
    { id: "uehm-s11", code: "UEHM-S11", name: "S11", programId: "program-uehm" },
    { id: "uehm-s12", code: "UEHM-S12", name: "S12", programId: "program-uehm" },
    { id: "ham-s6", code: "HAM-S6", name: "S6", programId: "program-ham" }
  ],
  intakeBatches: []
};
const superAdmin = { authenticated: true, isSuperAdmin: true, grants: [] };

describe("final portfolio context hardening", () => {
  it("resolves UEHM-S12 and rejects cross-program seasons", () => {
    const context = resolveCanonicalContext(superAdmin, catalog, { programCode: "UEHM", seasonCode: "UEHM-S12" });
    expect(context).toMatchObject({ selectedProgramId: "program-uehm", selectedSeasonId: "uehm-s12" });
    expect(() => resolveCanonicalContext(superAdmin, catalog, { programCode: "HAM", seasonCode: "UEHM-S12" })).toThrow();
  });

  it("resets season when switching programs", () => {
    expect(resetDependentContext(catalog, "HAM", "UEHM-S12")).toEqual({ seasonCode: null, intakeBatchId: null });
  });

  it("uses authoritative selectors and carries context to admin users", () => {
    const forms = source("app/admin/users/user-management-forms.tsx");
    const portfolio = source("app/portfolio/page.tsx");
    expect(forms).toContain('select name="program_id"');
    expect(forms).toContain('select name="season_id"');
    expect(forms).not.toContain('defaultValue="VAM"');
    expect(portfolio).toContain("/admin/users?");
  });
});

describe("single-step application authentication", () => {
  const middleware = source("middleware.ts");

  it("redirects unauthenticated protected requests directly to login", () => {
    expect(middleware).toContain("return redirectToLogin(request)");
    expect(middleware).not.toContain("redirectToUnlock");
    expect(middleware).not.toContain("VAM_OS_ADMIN_PASSWORD");
    expect(middleware).not.toContain("ADMIN_UNLOCK_COOKIE");
  });

  it("keeps public forms, callbacks, reset, and assets outside the protected matcher", () => {
    expect(middleware).toContain("login|apply|reset-password|_next/static|_next/image");
    expect(middleware).toContain('request.nextUrl.pathname.startsWith("/register/")');
    expect(middleware).toContain('request.nextUrl.pathname.startsWith("/checkin/")');
  });

  it("does not expose an unlock secret in middleware or client components", () => {
    expect(middleware).not.toMatch(/ADMIN_UNLOCK_SALT|unlockToken|VAM_OS_ADMIN_PASSWORD/);
    expect(source("components/app-shell.tsx")).not.toContain("VAM_OS_ADMIN_PASSWORD");
  });
});

describe("release immutability", () => {
  it("keeps lifecycle migrations and protection tests tracked by the suite", () => {
    expect(source("supabase_migrations/062_review_only_account_admin_rls_foundation.sql").length).toBeGreaterThan(0);
    expect(source("supabase_migrations/063_review_only_membership_lifecycle_operations.sql").length).toBeGreaterThan(0);
    expect(source("__tests__/manual-staff-provisioning.test.ts")).toContain("journal");
    expect(source("__tests__/membership-lifecycle-actions.test.ts").length).toBeGreaterThan(0);
  });
});
