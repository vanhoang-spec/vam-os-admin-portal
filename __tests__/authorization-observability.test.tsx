/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: (fn: any) => fn };
});

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
  // Khung "Xoá khỏi hệ thống" trên trang hồ sơ dùng useRouter để quay về danh
  // sách sau khi xoá. Thiếu nó ở bản giả thì cả trang không dựng được.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() })
}));
vi.mock("next/link", () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock("react-dom", () => ({ useFormState: () => [{}, vi.fn()], useFormStatus: () => ({ pending: false }) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: vi.fn() })) }));

import { getAdminScopeContext, resolveCanonicalScope, canOperateAnyScope } from "@/lib/program-scope";
import { getCurrentAdminUser } from "@/lib/admin-auth";

vi.mock("@/lib/program-scope", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getAdminScopeContext: vi.fn(),
    getScopeFilter: vi.fn(async () => undefined),
    canOperateAnyScope: vi.fn(() => true)
  };
});

vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => ({ id: "1", role: "Admin" })) }));

const getPersonSeasonMembershipsMock = vi.fn();

vi.mock("@/lib/data", () => ({
  getPerson: vi.fn(async () => ({ data: { id: "1", full_name: "Test" } })),
  getPeople: vi.fn(async () => ({ data: [] })),
  getMentorProfiles: vi.fn(async () => ({ data: [] })),
  getMenteeProfiles: vi.fn(async () => ({ data: [] })),
  getApplications: vi.fn(async () => ({ data: [] })),
  getMatches: vi.fn(async () => ({ data: [] })),
  getSeasons: vi.fn(async () => ({ data: [
    { id: "season-1", code: "UEHM-S12", program_id: "prog-1", name: "UEHM Season 12" },
    { id: "season-2", code: "UEHM-S11", program_id: "prog-1", name: "UEHM Season 11" },
    { id: "season-3", code: "HAM-S1", program_id: "prog-2", name: "HAM Season 1" }
  ] })),
  getEvents: vi.fn(async () => ({ data: [] })),
  getOperationalTeamAssignmentsByPerson: vi.fn(async () => ({ data: [] })),
  getPrograms: vi.fn(async () => ({ data: [
    { id: "prog-1", code: "UEHM", name: "UEHM" },
    { id: "prog-2", code: "HAM", name: "HAM" }
  ] })),
  getIndustries: vi.fn(async () => ({ data: [] })),
  getFunctionAreas: vi.fn(async () => ({ data: [] })),
  getMentorProgramParticipations: vi.fn(async () => ({ data: [] })),
  getMentorIndustryLinks: vi.fn(async () => ({ data: [] })),
  getMentorFunctionAreaLinks: vi.fn(async () => ({ data: [] })),
  getEventParticipationsByPersonId: vi.fn(async () => ({ data: [] })),
  getMentoringRecapsByMenteePersonId: vi.fn(async () => ({ data: [] })),
  getMentoringRecapsByMentorPersonId: vi.fn(async () => ({ data: [] })),
  keyById: vi.fn((arr) => new Map(arr.map((x: any) => [x.id, x])))
}));

vi.mock("@/lib/lifecycle-crm", () => ({
  getPersonSeasonMemberships: (...args: any[]) => getPersonSeasonMembershipsMock(...args),
  getCrmNotesByPerson: vi.fn(async () => ({ data: [] })),
  createCrmNoteFormAction: vi.fn()
}));

import PersonDetailPage from "@/app/people/[id]/page";

const mockGetAdminScopeContext = vi.mocked(getAdminScopeContext);
const mockCanOperateAnyScope = vi.mocked(canOperateAnyScope);

describe("Authorization Observability Instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPersonSeasonMembershipsMock.mockResolvedValue({
      data: [{
        id: "membership-1",
        role: "mentor",
        status: "active",
        intake_batch_code: "BATCH-1",
        program_id: "prog-1",
        season_id: "season-1"
      }]
    });
  });

  it("1. One UEHM-S12 membership with full_access renders scope full_access, program UEHM, season UEHM-S12", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [{ scopeLevel: "full_access", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    
    const wrapper = container.querySelector("[data-vam-program-scope]");
    expect(wrapper?.getAttribute("data-vam-program-scope")).toBe("full_access");
    expect(wrapper?.getAttribute("data-vam-program-code")).toBe("UEHM");
    expect(wrapper?.getAttribute("data-vam-season-code")).toBe("UEHM-S12");
  });

  it("2. operations renders operations for the exact membership", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [{ scopeLevel: "operations", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope")).toBe("operations");
  });

  it("3. review renders review for the exact membership", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [{ scopeLevel: "review", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope")).toBe("review");
  });

  it("4. read renders read for the exact membership", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [{ scopeLevel: "read", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope")).toBe("read");
  });

  it("5. Admin role with only operations scope does not render full_access", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [{ scopeLevel: "operations", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope")).toBe("operations");
  });

  it("6. Scope is derived from canonical authorization context, not role label", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "super_admin" } as any, // Should be ignored if isSuperAdmin=false
      programScopes: [{ scopeLevel: "read", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);
    
    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope")).toBe("read");
  });

  it("7. Exact program and season come from the membership", async () => {
    getPersonSeasonMembershipsMock.mockResolvedValue({
      data: [{
        id: "membership-2",
        role: "mentor",
        status: "active",
        intake_batch_code: "BATCH-2",
        program_id: "prog-2",
        season_id: "season-3"
      }]
    });

    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [{ scopeLevel: "operations", programId: "prog-2", seasonId: "season-3", status: "active" } as any]
    } as any);
    
    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    const wrapper = container.querySelector("[data-vam-program-scope]");
    expect(wrapper?.getAttribute("data-vam-program-code")).toBe("HAM");
    expect(wrapper?.getAttribute("data-vam-season-code")).toBe("HAM-S1");
  });

  it("8. Cross-program isolation: HAM full_access, UEHM read. UEHM membership renders read, never full_access", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [
        { scopeLevel: "full_access", programId: "prog-2", seasonId: null, status: "active" } as any,
        { scopeLevel: "read", programId: "prog-1", seasonId: null, status: "active" } as any
      ]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope")).toBe("read");
  });

  it("9. Cross-season isolation: UEHM-S11 operations, UEHM-S12 read. S11 membership renders operations; S12 membership renders read.", async () => {
    getPersonSeasonMembershipsMock.mockResolvedValue({
      data: [
        { id: "m-s11", role: "mentor", status: "active", intake_batch_code: "B1", program_id: "prog-1", season_id: "season-2" },
        { id: "m-s12", role: "mentor", status: "active", intake_batch_code: "B2", program_id: "prog-1", season_id: "season-1" }
      ]
    });

    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [
        { scopeLevel: "operations", programId: "prog-1", seasonId: "season-2", status: "active" } as any,
        { scopeLevel: "read", programId: "prog-1", seasonId: "season-1", status: "active" } as any
      ]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    
    const s11 = container.querySelector("[data-vam-membership-id='m-s11']");
    const s12 = container.querySelector("[data-vam-membership-id='m-s12']");
    
    expect(s11?.getAttribute("data-vam-program-scope")).toBe("operations");
    expect(s12?.getAttribute("data-vam-program-scope")).toBe("read");
  });

  it("10. Multiple memberships render independent wrappers and independent marker values", async () => {
    getPersonSeasonMembershipsMock.mockResolvedValue({
      data: [
        { id: "m-1", role: "mentor", status: "active", intake_batch_code: "B1", program_id: "prog-1", season_id: "season-2" },
        { id: "m-2", role: "mentor", status: "active", intake_batch_code: "B2", program_id: "prog-2", season_id: "season-3" }
      ]
    });

    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [
        { scopeLevel: "operations", programId: "prog-1", seasonId: "season-2", status: "active" } as any,
        { scopeLevel: "full_access", programId: "prog-2", seasonId: "season-3", status: "active" } as any
      ]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    
    const m1 = container.querySelector("[data-vam-membership-id='m-1']");
    const m2 = container.querySelector("[data-vam-membership-id='m-2']");
    
    expect(m1?.getAttribute("data-vam-program-code")).toBe("UEHM");
    expect(m1?.getAttribute("data-vam-season-code")).toBe("UEHM-S11");
    expect(m2?.getAttribute("data-vam-program-code")).toBe("HAM");
    expect(m2?.getAttribute("data-vam-season-code")).toBe("HAM-S1");
    
    expect(m1?.getAttribute("data-vam-program-scope")).toBe("operations");
    expect(m2?.getAttribute("data-vam-program-scope")).toBe("full_access");
  });

  it("11. Program-wide grant behavior matches existing canonical authorization semantics", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      // A program-level scope
      programScopes: [{ scopeLevel: "full_access", programId: "prog-1", seasonId: null, status: "active" } as any]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope")).toBe("full_access");
  });

  it("12. Super Admin renders full_access separately on each membership while preserving exact program and season", async () => {
    getPersonSeasonMembershipsMock.mockResolvedValue({
      data: [
        { id: "m-1", role: "mentor", status: "active", intake_batch_code: "B1", program_id: "prog-1", season_id: "season-2" },
        { id: "m-2", role: "mentor", status: "active", intake_batch_code: "B2", program_id: "prog-2", season_id: "season-3" }
      ]
    });

    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: true,
      adminUser: { id: "1", role: "super_admin" } as any,
      programScopes: []
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    
    const m1 = container.querySelector("[data-vam-membership-id='m-1']");
    const m2 = container.querySelector("[data-vam-membership-id='m-2']");
    
    expect(m1?.getAttribute("data-vam-program-scope")).toBe("full_access");
    expect(m1?.getAttribute("data-vam-program-code")).toBe("UEHM");
    expect(m1?.getAttribute("data-vam-season-code")).toBe("UEHM-S11");

    expect(m2?.getAttribute("data-vam-program-scope")).toBe("full_access");
    expect(m2?.getAttribute("data-vam-program-code")).toBe("HAM");
    expect(m2?.getAttribute("data-vam-season-code")).toBe("HAM-S1");
  });

  it("13. Unknown or unauthorized context does not fabricate full_access", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: null as any,
      programScopes: [] as any[]
    } as any);
    
    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    expect(container.querySelector("[data-vam-program-scope]")).toBeNull();
  });
  
  it("14. No secret, token, cookie, credential or full session/scope object is serialized", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: true,
      authUserId: "AUTH_SECRET_SENTINEL_7F31",
      adminUser: { id: "ADMIN_INTERNAL_SENTINEL_8A42", role: "super_admin", email: "private-sentinel@example.invalid" } as any,
      programScopes: [{ programId: "SECRET_PROGRAM_ID_9B43", seasonId: "SECRET_SEASON_ID_2A11", scopeLevel: "full_access", status: "active" } as any]
    } as any);
    
    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    
    expect(container.innerHTML).not.toContain("AUTH_SECRET_SENTINEL_7F31");
    expect(container.innerHTML).not.toContain("ADMIN_INTERNAL_SENTINEL_8A42");
    expect(container.innerHTML).not.toContain("private-sentinel@example.invalid");
    expect(container.innerHTML).not.toContain("SECRET_PROGRAM_ID_9B43");
    expect(container.innerHTML).not.toContain("SECRET_SEASON_ID_2A11");
    
    const membershipSection = container.querySelector("[data-vam-membership-id='membership-1']");
    expect(membershipSection?.getAttribute("data-vam-program-scope")).toBe("full_access");
    expect(membershipSection?.getAttribute("data-vam-program-code")).toBe("UEHM");
    expect(membershipSection?.getAttribute("data-vam-season-code")).toBe("UEHM-S12");
    expect(membershipSection?.getAttribute("data-vam-membership-id")).toBe("membership-1");
    expect(membershipSection?.getAttribute("data-vam-intake-batch")).toBe("BATCH-1");
  });
  
  it("15. Existing lifecycle visibility and permission behavior remains unchanged", async () => {
    // Authorized operations/full_access context
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: true,
      adminUser: { id: "1", role: "super_admin" } as any,
      programScopes: [] as any[]
    } as any);
    mockCanOperateAnyScope.mockReturnValueOnce(true);
    // Nút đổi membership còn cần nửa vai trò (mentor: Core Team trở lên), nên người
    // xem phải mang một vai trò có thật — mock mặc định "Admin" viết hoa không phải.
    vi.mocked(getCurrentAdminUser).mockResolvedValueOnce({ id: "1", role: "super_admin" } as any);
    
    const pageAuthorized = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container: containerAuthorized } = render(pageAuthorized);
    expect(containerAuthorized.querySelector("[data-vam-membership-id='membership-1'] form")).not.toBeNull();
    
    // read/review or unauthorized context
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "admin" } as any,
      programScopes: [{ scopeLevel: "read", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);
    mockCanOperateAnyScope.mockReturnValueOnce(false);
    
    const pageUnauthorized = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container: containerUnauthorized } = render(pageUnauthorized);
    expect(containerUnauthorized.querySelector("form")).toBeNull();
    expect(containerUnauthorized.innerHTML).toContain("Cần quyền operations hoặc full_access");
  });

  it("16. Existing membership ID and intake-batch attributes remain on the same exact wrapper", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: true,
      adminUser: { id: "1", role: "super_admin" } as any,
      programScopes: [] as any[]
    } as any);
    
    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);
    
    const membershipSection = container.querySelector("[data-vam-membership-id='membership-1']");
    expect(membershipSection).not.toBeNull();
    expect(membershipSection?.getAttribute("data-vam-intake-batch")).toBe("BATCH-1");
    expect(membershipSection?.getAttribute("data-vam-program-scope")).toBe("full_access");
  });

  it("17. A test must fail when scope is replaced with role label", async () => {
    mockGetAdminScopeContext.mockResolvedValueOnce({
      isSuperAdmin: false,
      adminUser: { id: "1", role: "super_admin" } as any,
      globalRole: "super_admin",
      programScopes: [{ scopeLevel: "read", programId: "prog-1", seasonId: "season-1", status: "active" } as any]
    } as any);

    const page = await PersonDetailPage({ params: Promise.resolve({ id: "1" }) });
    const { container } = render(page);

    const scope = container.querySelector("[data-vam-program-scope]")?.getAttribute("data-vam-program-scope");
    expect(scope).toBe("read");
    expect(scope).not.toBe("super_admin");
    expect(scope).not.toBe("full_access");
  });

  it("18. resolver semantic regression protection", () => {
    const defaultCtx = { isSuperAdmin: false, adminUser: null, authUserId: null, globalRole: null, programScopes: [], scopeError: null };

    // 1. Super Admin → full_access
    expect(resolveCanonicalScope({ ...defaultCtx, isSuperAdmin: true }, null, null, null, null)).toBe("full_access");

    // 2. Exact program + exact season grant
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" }] } as any, "p1", null, "s1", null)).toBe("read");

    // 3. Program-wide grant
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "p1", seasonId: null, scopeLevel: "operations", status: "active" }] } as any, "p1", null, "s1", null)).toBe("operations");

    // 4. Multiple grants same program
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [
      { programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" },
      { programId: "p1", seasonId: "s2", scopeLevel: "operations", status: "active" }
    ] } as any, "p1", null, "s1", null)).toBe("read");

    // 5. Grants across different seasons
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [
      { programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" },
      { programId: "p1", seasonId: "s2", scopeLevel: "operations", status: "active" }
    ] } as any, "p1", null, "s2", null)).toBe("operations");

    // 6. Grants across different programs
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [
      { programId: "p1", seasonId: null, scopeLevel: "read", status: "active" },
      { programId: "p2", seasonId: null, scopeLevel: "operations", status: "active" }
    ] } as any, "p2", null, "s2", null)).toBe("operations");

    // 7. Program ID matching
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "p1", seasonId: null, scopeLevel: "read", status: "active" }] } as any, "p1", null, null, null)).toBe("read");

    // 8. Program code matching
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "code1", seasonId: null, scopeLevel: "review", status: "active" }] } as any, null, "code1", null, null)).toBe("review");

    // 9. Season ID matching
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: null, seasonId: "s1", scopeLevel: "read", status: "active" }] } as any, null, null, "s1", null)).toBe("read");

    // 10. Season code matching
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: null, seasonId: "scode1", scopeLevel: "review", status: "active" }] } as any, null, null, null, "scode1")).toBe("review");

    // 11. Missing IDs with valid codes
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "pcode1", seasonId: "scode1", scopeLevel: "read", status: "active" }] } as any, null, "pcode1", null, "scode1")).toBe("read");

    // 12. Missing codes with valid IDs
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" }] } as any, "p1", null, "s1", null)).toBe("read");

    // 13. Unknown program → null
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "p1", seasonId: null, scopeLevel: "read", status: "active" }] } as any, "unknown", null, null, null)).toBeNull();

    // 14. Unknown season → null
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" }] } as any, "p1", null, "unknown", null)).toBeNull();

    // 15. Empty scopes → null
    expect(resolveCanonicalScope(defaultCtx as any, "p1", null, "s1", null)).toBeNull();

    // 16. Duplicate grants
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [
      { programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" },
      { programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" }
    ] } as any, "p1", null, "s1", null)).toBe("read");

    // 17. Conflicting applicable grants where full_access > operations > review > read
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [
      { programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" },
      { programId: "p1", seasonId: "s1", scopeLevel: "operations", status: "active" },
      { programId: "p1", seasonId: "s1", scopeLevel: "review", status: "active" },
      { programId: "p1", seasonId: "s1", scopeLevel: "full_access", status: "active" }
    ] } as any, "p1", null, "s1", null)).toBe("full_access");
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [
      { programId: "p1", seasonId: "s1", scopeLevel: "read", status: "active" },
      { programId: "p1", seasonId: "s1", scopeLevel: "operations", status: "active" },
      { programId: "p1", seasonId: "s1", scopeLevel: "review", status: "active" }
    ] } as any, "p1", null, "s1", null)).toBe("operations");

    // Explicitly prove HAM full_access does not apply to UEHM
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "HAM", seasonId: null, scopeLevel: "full_access", status: "active" }] } as any, "UEHM", null, null, null)).toBeNull();

    // Explicitly prove UEHM-S11 operations does not apply to UEHM-S12
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "UEHM", seasonId: "UEHM-S11", scopeLevel: "operations", status: "active" }] } as any, "UEHM", null, "UEHM-S12", null)).toBeNull();

    // Explicitly prove a season-specific grant does not widen to the whole program
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "UEHM", seasonId: "UEHM-S11", scopeLevel: "operations", status: "active" }] } as any, "UEHM", null, null, null)).toBeNull();

    // Explicitly prove a program-wide grant follows existing canonical semantics
    expect(resolveCanonicalScope({ ...defaultCtx, programScopes: [{ programId: "UEHM", seasonId: null, scopeLevel: "operations", status: "active" }] } as any, "UEHM", null, "UEHM-S12", null)).toBe("operations");
  });
});
