import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("manual create integration safety", () => {
  const source = readFileSync("lib/admin-users.ts", "utf8");
  it("uses the migration-062 journal and atomic application RPC", () => {
    expect(source).toContain('"vam062_begin_auth_operation"');
    expect(source).toContain('"vam062_record_auth_operation_stage"');
    expect(source).toContain('"vam062_admin_mutation_atomic"');
  });
  it("derives the actor from active super-admin auth and exposes a safe reference", () => {
    expect(source).toContain("const actor = await requireSuperAdmin()");
    expect(source).toContain('adminUser?.role !== "super_admin" || adminUser.status !== "active"');
    expect(source).toContain("Mã tham chiếu:");
    expect(source).toContain("Không tự động thử lại");
  });
  it("does not accept a client actor and keeps create distinct from edit/sync", () => {
    const createAction = readFileSync("app/admin/users/actions.ts", "utf8");
    const orchestrator = readFileSync("lib/manual-staff-provisioning.ts", "utf8");
    const createBody = createAction.slice(createAction.indexOf("export async function createAdminUserAction"), createAction.indexOf("export async function updateAdminUserAction"));
    expect(createBody).not.toMatch(/actor|admin_user_id|auth_user_id/i);
    expect(orchestrator).toContain('status: "rejected"');
    expect(orchestrator).toContain("review_existing_identity");
  });
  it("logs only safe operation metadata and never logs identity values", () => {
    const logger = source.slice(source.indexOf("const logSafe"), source.indexOf("const result = await executeManualStaffProvisioning"));
    expect(logger).toContain("operationId"); expect(logger).toContain("failureClass"); expect(logger).not.toMatch(/\bemail\b|authUserId|password|token|request/i);
  });
  it("leaves migrations and lifecycle controls under existing regression coverage", () => {
    expect(readFileSync("app/actions/membership-lifecycle.ts", "utf8")).toContain("vam063_add_membership_role");
  });
});
