/**
 * WP1-A1 — canonical scope hardening.
 *
 * Three behaviours are locked here, each of which was fail-open before:
 *
 *   1. An unrecognised scope level granted `read` authority.
 *   2. A season-scoped holder was offered every season of their program.
 *   3. A grant with no program or season was persisted under invented literals
 *      ("VAM", "UEHM-S11").
 *
 * These are authorization behaviours, so every test asserts the DENY direction
 * as well as the ALLOW direction: proving that a valid grant still works is
 * what stops a future "harden it further" change from silently locking the
 * UEHM Admin out of Season 12.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveAccessiblePrograms,
  resolveAccessibleSeasons,
  requireSeasonAccess,
  ProgramContextError,
  type ProgramAccessPrincipal,
  type ProgramContextCatalog
} from "@/lib/program-context-core";
import { getAdminScopeContext, canOperateAnyScope, canReviewAnyScope, canReadAnyScope, resolveCanonicalScope } from "@/lib/program-scope";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { upsertScope, isCanonicalScopeIdentifier, validateExplicitAdminScope } from "@/lib/admin-users";

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: any) => fn }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({ envName: "SUPABASE_SERVICE_ROLE_KEY" }))
}));

// Canonical UEHM identities, verbatim from the owner-run Production evidence.
const UEHM = "61701ee8-64a6-4673-b261-ba12ce9a3ee3";
const S11 = "710f4ec9-1cf7-461e-98d4-f33799047add";
const S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
const HAM = "11111111-2222-3333-4444-555555555555";
const HAM_S6 = "66666666-7777-8888-9999-000000000000";

// ───────────────────────────────────────────────────────────────────────────
// A. Fail-closed scope level
// ───────────────────────────────────────────────────────────────────────────

function mockGrants(rows: Array<Record<string, unknown>>) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "admin-1",
    email: "uehmentoring@example.test",
    full_name: "UEH Admin",
    role: "admin",
    status: "active",
    auth_user_id: "auth-1"
  } as any);
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: rows, error: null })
        })
      })
    })
  } as any);
}

describe("WP1-A1 · fail-closed scope level", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps every recognised scope level", async () => {
    mockGrants([
      { program_id: UEHM, season_id: S12, role: "full_access", status: "active" },
      { program_id: UEHM, season_id: S11, role: "operations", status: "active" },
      { program_id: HAM, season_id: HAM_S6, role: "review", status: "active" },
      { program_id: HAM, season_id: null, role: "read", status: "active" }
    ]);
    const ctx = await getAdminScopeContext();
    expect(ctx.programScopes.map((scope) => scope.scopeLevel)).toEqual([
      "full_access",
      "operations",
      "review",
      "read"
    ]);
    expect(ctx.scopeError).toBeNull();
  });

  it("a NULL scope level confers no authority", async () => {
    mockGrants([{ program_id: UEHM, season_id: S12, role: null, status: "active" }]);
    const ctx = await getAdminScopeContext();
    expect(ctx.programScopes).toEqual([]);
    expect(canReadAnyScope(ctx)).toBe(false);
    expect(canOperateAnyScope(ctx)).toBe(false);
    expect(resolveCanonicalScope(ctx, UEHM, "UEHM", S12, "UEHM-S12")).toBeNull();
  });

  it("an unknown scope level confers no authority and is NOT downgraded to read", async () => {
    for (const role of ["superuser", "", "  ", "READ", "full-access", 42, {}]) {
      mockGrants([{ program_id: UEHM, season_id: S12, role, status: "active" }]);
      const ctx = await getAdminScopeContext();
      expect(ctx.programScopes, `role=${JSON.stringify(role)}`).toEqual([]);
      expect(canReadAnyScope(ctx)).toBe(false);
    }
  });

  it("a grant naming neither a program nor a season confers no authority", async () => {
    // This is the shape that previously satisfied the scope-blind
    // canOperateAnyScope family, unlocking every mutation entry point on a row
    // that authorizes no program at all.
    mockGrants([{ program_id: null, season_id: "   ", role: "full_access", status: "active" }]);
    const ctx = await getAdminScopeContext();
    expect(ctx.programScopes).toEqual([]);
    expect(canOperateAnyScope(ctx)).toBe(false);
  });

  it("one unusable grant does not poison a valid one", async () => {
    mockGrants([
      { program_id: UEHM, season_id: S12, role: "garbage", status: "active" },
      { program_id: UEHM, season_id: S12, role: "full_access", status: "active" },
      { program_id: null, season_id: null, role: "operations", status: "active" }
    ]);
    const ctx = await getAdminScopeContext();
    expect(ctx.programScopes).toEqual([
      { programId: UEHM, seasonId: S12, scopeLevel: "full_access", status: "active" }
    ]);
    expect(resolveCanonicalScope(ctx, UEHM, "UEHM", S12, "UEHM-S12")).toBe("full_access");
    expect(canOperateAnyScope(ctx)).toBe(true);
    expect(canReviewAnyScope(ctx)).toBe(true);
  });

  it("super_admin bypass is untouched by grant validation", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "owner", email: "owner@example.test", full_name: "Owner",
      role: "super_admin", status: "active", auth_user_id: "auth-owner"
    } as any);
    const ctx = await getAdminScopeContext();
    expect(ctx.isSuperAdmin).toBe(true);
    expect(canOperateAnyScope(ctx)).toBe(true);
    expect(resolveCanonicalScope(ctx, UEHM, "UEHM", S12, "UEHM-S12")).toBe("full_access");
  });

  it("an unreadable grant table is still an error, not an empty scope", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({
      id: "admin-1", email: "a@example.test", full_name: null,
      role: "admin", status: "active", auth_user_id: "auth-1"
    } as any);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) })
      })
    } as any);
    const ctx = await getAdminScopeContext();
    expect(ctx.scopeError).not.toBeNull();
    expect(ctx.programScopes).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// B. Authorized context options
// ───────────────────────────────────────────────────────────────────────────

const catalog: ProgramContextCatalog = {
  programs: [
    { id: UEHM, code: "UEHM", name: "UEH Mentoring", isActive: true },
    { id: HAM, code: "HAM", name: "Hanoi Alumni Mentoring", isActive: true }
  ],
  seasons: [
    { id: S11, code: "UEHM-S11", name: "UEH Mentoring Season 11", programId: UEHM },
    { id: S12, code: "UEHM-S12", name: "UEH Mentoring Season 12", programId: UEHM },
    { id: HAM_S6, code: "HAM-S6", name: "HAM Season 6", programId: HAM }
  ],
  intakeBatches: []
};

function principal(grants: ProgramAccessPrincipal["grants"], isSuperAdmin = false): ProgramAccessPrincipal {
  return { authenticated: true, isSuperAdmin, grants };
}

describe("WP1-A1 · authorized context options", () => {
  it("a program-wide grant offers every season inside that program", () => {
    const uehAdmin = principal([{ programId: UEHM, seasonId: null, scopeLevel: "full_access" }]);
    expect(resolveAccessibleSeasons(uehAdmin, catalog).map((s) => s.code)).toEqual(["UEHM-S11", "UEHM-S12"]);
  });

  it("a season-scoped reviewer is offered only the granted season", () => {
    const reviewer = principal([{ programId: UEHM, seasonId: S12, scopeLevel: "review" }]);
    const codes = resolveAccessibleSeasons(reviewer, catalog).map((s) => s.code);
    expect(codes).toEqual(["UEHM-S12"]);
    // The program is reachable — that is exactly why the season list had to be
    // narrowed independently of program accessibility.
    expect(resolveAccessiblePrograms(reviewer, catalog).map((p) => p.code)).toEqual(["UEHM"]);
  });

  it("a season-scoped grant expressed by CODE resolves to the same single season", () => {
    const viewer = principal([{ programId: null, seasonId: "UEHM-S12", scopeLevel: "read" }]);
    expect(resolveAccessibleSeasons(viewer, catalog).map((s) => s.code)).toEqual(["UEHM-S12"]);
  });

  it("seasons of an unauthorized program are never offered", () => {
    const uehAdmin = principal([{ programId: UEHM, seasonId: null, scopeLevel: "full_access" }]);
    expect(resolveAccessibleSeasons(uehAdmin, catalog).map((s) => s.code)).not.toContain("HAM-S6");
  });

  it("super_admin is offered every season of every active program", () => {
    expect(resolveAccessibleSeasons(principal([], true), catalog).map((s) => s.code)).toEqual([
      "UEHM-S11",
      "UEHM-S12",
      "HAM-S6"
    ]);
  });

  it("the option list agrees with enforcement for every season in the catalog", () => {
    // The listing path and the enforcement path must not drift: anything
    // offered must be enterable, and anything withheld must be refused.
    const holders: Array<[string, ProgramAccessPrincipal]> = [
      ["program-wide admin", principal([{ programId: UEHM, seasonId: null, scopeLevel: "full_access" }])],
      ["season reviewer", principal([{ programId: UEHM, seasonId: S12, scopeLevel: "review" }])],
      ["season viewer by code", principal([{ programId: null, seasonId: "UEHM-S11", scopeLevel: "read" }])],
      ["super admin", principal([], true)]
    ];
    for (const [label, holder] of holders) {
      const offered = new Set(resolveAccessibleSeasons(holder, catalog).map((s) => s.id));
      for (const season of catalog.seasons) {
        const program = catalog.programs.find((p) => p.id === season.programId)!;
        let enterable = true;
        try {
          requireSeasonAccess(holder, season, program, catalog);
        } catch (error) {
          expect(error).toBeInstanceOf(ProgramContextError);
          enterable = false;
        }
        expect(enterable, `${label} → ${season.code}`).toBe(offered.has(season.id));
      }
    }
  });

  it("the selector cannot grant: an ungranted season stays out of the list", () => {
    const reviewer = principal([{ programId: UEHM, seasonId: S12, scopeLevel: "review" }]);
    const s11 = catalog.seasons.find((s) => s.id === S11)!;
    const uehm = catalog.programs.find((p) => p.id === UEHM)!;
    expect(resolveAccessibleSeasons(reviewer, catalog).map((s) => s.id)).not.toContain(S11);
    expect(() => requireSeasonAccess(reviewer, s11, uehm, catalog)).toThrow(ProgramContextError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C. Canonical write boundary
// ───────────────────────────────────────────────────────────────────────────

type StubWrite = { table: string; op: "insert" | "update"; payload: any };

function stubClient(options: {
  programs?: Array<{ id: string; is_active: boolean }>;
  seasons?: Array<{ id: string; program_id: string }>;
  existingActive?: Array<{ id: string }>;
}) {
  const writes: StubWrite[] = [];
  const probes: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return builder;
        },
        order: () => builder,
        limit: () => {
          probes.push({ table, ...filters });
          return Promise.resolve({ data: options.existingActive ?? [], error: null });
        },
        maybeSingle: () => {
          if (table === "programs") {
            const row = (options.programs ?? []).find(
              (p) => p.id === filters.id && (filters.is_active === undefined || p.is_active === filters.is_active)
            );
            return Promise.resolve({ data: row ?? null, error: null });
          }
          const row = (options.seasons ?? []).find((s) => s.id === filters.id);
          return Promise.resolve({ data: row ?? null, error: null });
        },
        insert: (payload: any) => {
          writes.push({ table, op: "insert", payload });
          return Promise.resolve({ error: null });
        },
        update: (payload: any) => {
          writes.push({ table, op: "update", payload });
          return { eq: () => Promise.resolve({ error: null }) };
        }
      };
      return builder;
    }
  };
  return { client, writes, probes };
}

const catalogStub = {
  programs: [{ id: UEHM, is_active: true }],
  seasons: [{ id: S11, program_id: UEHM }, { id: S12, program_id: UEHM }]
};

describe("WP1-A1 · canonical write boundary", () => {
  it("recognises only canonical UUID identifiers", () => {
    expect(isCanonicalScopeIdentifier(UEHM)).toBe(true);
    expect(isCanonicalScopeIdentifier(S12)).toBe(true);
    for (const bad of ["VAM", "UEHM", "UEHM-S11", "UEH Mentoring", "", null, undefined, 7]) {
      expect(isCanonicalScopeIdentifier(bad), String(bad)).toBe(false);
    }
  });

  it('never persists the "VAM" program fallback when no program is supplied', async () => {
    const { client, writes } = stubClient(catalogStub);
    await expect(
      upsertScope(client, { authUserId: "auth-1", seasonId: S12, role: "full_access", status: "active" })
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it('never persists the "UEHM-S11" season fallback when no season is supplied', async () => {
    const { client, writes } = stubClient(catalogStub);
    await expect(
      upsertScope(client, { authUserId: "auth-1", programId: UEHM, role: "full_access", status: "active" })
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it("rejects a program NAME and a season CODE rather than resolving them implicitly", async () => {
    const { client, writes } = stubClient(catalogStub);
    await expect(
      upsertScope(client, { authUserId: "auth-1", programId: "UEH Mentoring", seasonId: "UEHM-S11", role: "full_access" })
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it("rejects a season that belongs to another program", async () => {
    const { client, writes } = stubClient({
      programs: [{ id: UEHM, is_active: true }, { id: HAM, is_active: true }],
      seasons: [{ id: HAM_S6, program_id: HAM }]
    });
    await expect(
      upsertScope(client, { authUserId: "auth-1", programId: UEHM, seasonId: HAM_S6, role: "read" })
    ).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it("persists a canonical grant unchanged", async () => {
    const { client, writes } = stubClient(catalogStub);
    await upsertScope(client, { authUserId: "auth-1", programId: UEHM, seasonId: S12, role: "full_access", status: "active" });
    expect(writes).toEqual([
      {
        table: "admin_scope_access",
        op: "insert",
        payload: { user_id: "auth-1", program_id: UEHM, season_id: S12, role: "full_access", status: "active" }
      }
    ]);
  });

  it("does not revive an inactive historical grant — the probe is active-only", async () => {
    const { client, writes, probes } = stubClient(catalogStub);
    await upsertScope(client, { authUserId: "auth-1", programId: UEHM, seasonId: S11, role: "read", status: "active" });
    expect(probes).toContainEqual(
      expect.objectContaining({ table: "admin_scope_access", user_id: "auth-1", status: "active" })
    );
    // No active grant matched, so a NEW active grant is inserted beside the
    // retired history rather than flipping one of them back on.
    expect(writes).toEqual([expect.objectContaining({ op: "insert" })]);
  });

  it("retiring a scope that has no active grant writes nothing", async () => {
    const { client, writes } = stubClient(catalogStub);
    await upsertScope(client, { authUserId: "auth-1", programId: UEHM, seasonId: S11, role: "read", status: "inactive" });
    expect(writes).toEqual([]);
  });

  it("updates the existing ACTIVE grant in place rather than duplicating it", async () => {
    const { client, writes } = stubClient({ ...catalogStub, existingActive: [{ id: "scope-1" }] });
    await upsertScope(client, { authUserId: "auth-1", programId: UEHM, seasonId: S12, role: "operations", status: "active" });
    expect(writes).toEqual([expect.objectContaining({ op: "update" })]);
  });

  it("the shared validator names each rejection instead of guessing", async () => {
    const { client } = stubClient(catalogStub);
    const missing = await validateExplicitAdminScope(client, "", S12);
    expect(missing.ok).toBe(false);
    expect(missing.ok === false && missing.result.failureClass).toBe("missing_program");

    const nonCanonical = await validateExplicitAdminScope(client, "UEH Mentoring", S12);
    expect(nonCanonical.ok).toBe(false);
    expect(nonCanonical.ok === false && nonCanonical.result.failureClass).toBe("non_canonical_program");

    const good = await validateExplicitAdminScope(client, UEHM, S12);
    expect(good).toEqual({ ok: true, programId: UEHM, seasonId: S12 });
  });
});
