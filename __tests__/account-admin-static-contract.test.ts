import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
describe("account administration static safety contracts", () => {
  it("preview is mutation-free and confirmation re-parses", () => {
    const server = read("lib/account-import-server.ts");
    const previewBody = server.slice(server.indexOf("export async function previewAccountImport"), server.indexOf("async function persistOutcome"));
    expect(previewBody).not.toMatch(/\.insert\(|inviteUserByEmail|createManagedAdminUser/);
    expect(server.match(/parseAccountImportCsv\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("never creates participant Auth and requires audits", () => {
    const server = read("lib/account-import-server.ts");
    expect(server).toContain("membership_created_no_auth"); expect(server).toContain("person_season_membership_log"); expect(server).toContain("admin_audit_log");
  });
  it("has responsive cards, visible actions and destructive confirmation", () => {
    const page = read("app/admin/users/page.tsx"); const forms = read("app/admin/users/user-management-forms.tsx"); const importer = read("app/admin/users/import/import-client.tsx");
    expect(page).toContain("md:hidden"); expect(page).toContain("Participant membership"); expect(importer).toContain("sticky bottom-3"); expect(importer).toContain("min-h-11"); expect(forms).toContain("window.confirm");
  });
  it("RLS package is transactional, fail-closed and review-only", () => {
    const sql = read("supabase_migrations/062_review_only_account_admin_rls_foundation.sql");
    expect(sql).toMatch(/^-- REVIEW ONLY/); expect(sql).toContain("begin;"); expect(sql).toContain("commit;"); expect(sql).toContain("prerequisites missing"); expect(sql).toContain("service_role"); expect(sql).not.toContain("to anon;");
  });
});
