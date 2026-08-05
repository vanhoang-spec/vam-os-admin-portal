import { describe, it, expect, vi, beforeEach } from "vitest";
// @ts-ignore
import { runFixtures, email, FIXTURE_TAG } from "../scripts/create-uat-fixtures.mjs";
import { execSync } from "child_process";
import { resolve } from "path";

const scriptPath = resolve(__dirname, "../scripts/create-uat-fixtures.mjs");

function createMockDb() {
  const db = {
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth_new" } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ error: null })
      }
    },
    from: vi.fn((table: string) => {
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis()
      };

      // Mock specific responses
      if (table === "seasons") {
        builder.maybeSingle.mockResolvedValue({ data: { id: "season_id", program_id: "program_id" }, error: null });
      } else if (table === "programs") {
        builder.maybeSingle.mockResolvedValue({ data: { id: "program_id", code: "VAM", is_active: true }, error: null });
      } else if (table === "intake_batches") {
        builder.maybeSingle.mockResolvedValue({ data: { id: "batch_id", season_id: "season_id" }, error: null });
      } else if (table === "admin_users" || table === "admin_scope_access" || table === "people" || table === "person_season_memberships") {
        builder.insert = vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: `new_${table}` }, error: null })
        });
      }
      return builder;
    })
  };
  return db;
}

const mockLogger = { log: vi.fn(), error: vi.fn() };

describe("create-uat-fixtures", () => {
  let db: any;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("1. Existing email với UUID khác -> abort, zero write tiếp theo", async () => {
    db.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: "auth_old", email: email("admin"), user_metadata: { vam_uat_fixture: "wrong_tag" } }] },
      error: null
    });
    
    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/exists but lacks correct UAT fixture metadata/);
    expect(db.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("2. Existing admin row role khác -> abort, không update", async () => {
    db.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: "auth_id", email: email("admin"), user_metadata: { vam_uat_fixture: "20260805" } }] },
      error: null
    });
    const mockFrom = db.from as any;
    mockFrom.mockImplementation((table: string) => {
      const b = createMockDb().from(table);
      if (table === "admin_users") {
        b.maybeSingle = vi.fn().mockResolvedValue({
          data: { id: "admin_id", role: "wrong_role", status: "active", auth_user_id: "auth_id" },
          error: null
        });
      }
      return b;
    });

    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/does not exact-match expected/);
  });

  it("3. Existing scope khác -> abort", async () => {
    db.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: "auth_id", email: email("admin"), user_metadata: { vam_uat_fixture: "20260805" } }] },
      error: null
    });
    const mockFrom = db.from as any;
    mockFrom.mockImplementation((table: string) => {
      const b = createMockDb().from(table);
      if (table === "admin_users") {
        b.maybeSingle = vi.fn().mockResolvedValue({
          data: { id: "admin_id", role: "admin", status: "active", auth_user_id: "auth_id" },
          error: null
        });
      }
      if (table === "admin_scope_access") {
        b.maybeSingle = vi.fn().mockResolvedValue({
          data: { id: "scope_id", role: "wrong_scope", status: "active" },
          error: null
        });
      }
      return b;
    });

    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow(/admin_scope_access exists/);
  });

  it("4. Failure sau Auth creation -> Auth user vừa tạo được rollback", async () => {
    db.auth.admin.createUser.mockResolvedValueOnce({ data: { user: { id: "new_auth" } }, error: null });
    
    const mockFrom = db.from as any;
    mockFrom.mockImplementation((table: string) => {
      const b = createMockDb().from(table);
      if (table === "admin_users") {
        b.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error("Insert fail") }) });
      }
      return b;
    });

    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow();
    
    expect(db.auth.admin.deleteUser).toHaveBeenCalledWith("new_auth");
  });

  it("6. Existing pre-run object không bao giờ bị rollback", async () => {
    db.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ id: "pre_auth", email: email("admin"), user_metadata: { vam_uat_fixture: "20260805" } }] },
      error: null
    });
    const mockFrom = db.from as any;
    mockFrom.mockImplementation((table: string) => {
      const b = createMockDb().from(table);
      if (table === "admin_users") {
        b.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "pre_admin", role: "admin", status: "active", auth_user_id: "pre_auth" }, error: null });
      }
      if (table === "admin_scope_access") {
        // Force fail here to trigger rollback
        b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: new Error("Scope fail") });
      }
      return b;
    });

    await expect(runFixtures(db, true, "pass", mockLogger)).rejects.toThrow();
    
    // Auth and Admin were pre-existing, so they shouldn't be deleted
    expect(db.auth.admin.deleteUser).not.toHaveBeenCalled();
    const deleteCalls = mockLogger.log.mock.calls.filter(c => String(c[0]).includes("[rollback-ok]"));
    expect(deleteCalls.length).toBe(0);
  });

  it("8. Dry-run không gọi bất kỳ mutate method nào", async () => {
    await expect(runFixtures(db, false, "pass", mockLogger)).resolves.not.toThrow();
    expect(db.auth.admin.createUser).not.toHaveBeenCalled();
  });
});

describe("create-uat-fixtures CLI Tests", () => {
  it("9. Wrong project ref abort before network write", () => {
    try {
      execSync(`node "${scriptPath}"`, {
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://wrong.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret", VAM_UAT_FIXTURE_PASSWORD: "longpassword123" },
        stdio: "pipe"
      });
      expect.fail("Should have thrown");
    } catch (error: any) {
      const errStr = error.stderr?.toString() || error.stdout?.toString() || error.message;
      expect(errStr).toContain("Environment does not point at VAM OS staging");
    }
  });

  it("10. Typo flag không kích hoạt apply", () => {
    try {
      const out = execSync(`node "${scriptPath}" --aply`, {
        env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://ljfneyuvpxrmejpxsmpz.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "secret", VAM_UAT_FIXTURE_PASSWORD: "longpassword123" },
        stdio: "pipe"
      });
      expect(out.toString()).toContain("MODE: DRY RUN");
    } catch (error: any) {
      const errStr = error.stdout?.toString() || error.stderr?.toString() || error.message;
      expect(errStr).toContain("MODE: DRY RUN");
    }
  });
});
