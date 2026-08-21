import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentAdminUser } from "../lib/auth-constants";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(),
  loadProgramContextCatalog: vi.fn(),
  resolveAuthorizedProgramContext: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: mocks.getCurrentAdminUser
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: mocks.getSupabaseServiceRoleClient,
  getSupabaseServiceRoleEnvStatus: mocks.getSupabaseServiceRoleEnvStatus
}));
vi.mock("@/lib/program-context", () => ({
  loadProgramContextCatalog: mocks.loadProgramContextCatalog,
  resolveAuthorizedProgramContext: mocks.resolveAuthorizedProgramContext
}));
vi.mock("@/app/admin/users/user-management-forms", () => ({
  CreateAdminUserForm: () => null,
  EditAdminUserForm: () => null,
  RemoveAccessForm: () => null,
  StatusToggleForm: () => null,
  SyncAuthForm: () => null
}));

import AdminUsersPage from "../app/admin/users/page";
import { listAdminAuditLogs, listManagedAdminUsers } from "../lib/admin-users";

const SUPER_ADMIN: CurrentAdminUser = {
  id: "super-1",
  email: "super.admin@example.test",
  full_name: "Super Admin",
  role: "super_admin",
  status: "active",
  auth_user_id: "auth-super-1"
};

const MANAGED_USER = {
  id: "managed-1",
  auth_user_id: null,
  email: "private.user@example.test",
  full_name: "Private User",
  role: "admin" as const,
  status: "active" as const,
  created_at: "2026-08-21T00:00:00.000Z",
  updated_at: "2026-08-21T00:00:00.000Z",
  scopes: []
};

function userForRole(role: CurrentAdminUser["role"]): CurrentAdminUser {
  return {
    ...SUPER_ADMIN,
    id: `${role}-1`,
    email: `${role}@example.test`,
    role
  };
}

function authorizedServiceClient() {
  return {
    from: vi.fn((table: string) => {
      if (table === "admin_users") {
        return {
          select: vi.fn(() => ({
            order: vi.fn().mockResolvedValue({ data: [MANAGED_USER], error: null })
          }))
        };
      }
      if (table === "admin_audit_log") {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            }))
          }))
        };
      }
      throw new Error(`Unexpected table query: ${table}`);
    })
  };
}

async function renderPage() {
  return renderToStaticMarkup(await AdminUsersPage({ searchParams: Promise.resolve({}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseServiceRoleEnvStatus.mockReturnValue({
    envName: "SUPABASE_SERVICE_ROLE_KEY",
    loaded: true,
    usesPublicPrefix: false,
    sameAsAnonKey: false
  });
  mocks.loadProgramContextCatalog.mockResolvedValue({
    programs: [],
    seasons: [],
    warnings: []
  });
});

describe("/admin/users access boundary", () => {
  it("allows an active super_admin and preserves all independently guarded loaders", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(SUPER_ADMIN);
    mocks.getSupabaseServiceRoleClient.mockReturnValue(authorizedServiceClient());

    const html = await renderPage();

    expect(html).toContain("Quản lý người dùng");
    expect(html).toContain(MANAGED_USER.email);
    expect(html).not.toContain("Bạn không có quyền truy cập chức năng này");
    expect(mocks.getSupabaseServiceRoleClient).toHaveBeenCalledTimes(2);
    expect(mocks.loadProgramContextCatalog).toHaveBeenCalledTimes(1);
    // Page guard plus the independent guards in both managed-data loaders.
    expect(mocks.getCurrentAdminUser).toHaveBeenCalledTimes(3);
  });

  it.each(["admin", "core_team", "support_team", "reviewer", "viewer"] as const)(
    "shows friendly denial to %s before any managed-user, audit, or program-context load",
    async (role) => {
      mocks.getCurrentAdminUser.mockResolvedValue(userForRole(role));

      const html = await renderPage();

      expect(html).toContain("Bạn không có quyền truy cập chức năng này");
      expect(html).toContain("Chức năng Quản lý người dùng chỉ dành cho Super Admin.");
      expect(html).toContain("Nếu bạn cần được cấp quyền, vui lòng liên hệ Super Admin.");
      expect(html).toContain("Quay về Tổng quan");
      expect(html).not.toContain(MANAGED_USER.email);
      expect(mocks.getSupabaseServiceRoleClient).not.toHaveBeenCalled();
      expect(mocks.loadProgramContextCatalog).not.toHaveBeenCalled();
      expect(mocks.resolveAuthorizedProgramContext).not.toHaveBeenCalled();
      expect(mocks.getCurrentAdminUser).toHaveBeenCalledTimes(1);
    }
  );

  it("fails closed for an inactive super_admin without loading or rendering PII", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue({
      ...SUPER_ADMIN,
      status: "inactive"
    } as unknown as CurrentAdminUser);

    const html = await renderPage();

    expect(html).toContain("Bạn không có quyền truy cập chức năng này");
    expect(html).not.toContain(MANAGED_USER.email);
    expect(mocks.getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(mocks.loadProgramContextCatalog).not.toHaveBeenCalled();
  });

  it("keeps an unauthenticated request protected without loading managed data", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(null);

    const html = await renderPage();

    expect(html).toContain("Bạn không có quyền truy cập chức năng này");
    expect(html).not.toContain(MANAGED_USER.email);
    expect(mocks.getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(mocks.loadProgramContextCatalog).not.toHaveBeenCalled();
  });

  it("completes the page guard before starting any of the three data loaders", async () => {
    let releaseGuard: ((user: CurrentAdminUser) => void) | undefined;
    const pendingGuard = new Promise<CurrentAdminUser>((resolve) => {
      releaseGuard = resolve;
    });
    mocks.getCurrentAdminUser
      .mockReturnValueOnce(pendingGuard)
      .mockResolvedValue(SUPER_ADMIN);
    mocks.getSupabaseServiceRoleClient.mockReturnValue(authorizedServiceClient());

    const pagePromise = AdminUsersPage({ searchParams: Promise.resolve({}) });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.getCurrentAdminUser).toHaveBeenCalledTimes(1);
    expect(mocks.getSupabaseServiceRoleClient).not.toHaveBeenCalled();
    expect(mocks.loadProgramContextCatalog).not.toHaveBeenCalled();

    releaseGuard?.(SUPER_ADMIN);
    await pagePromise;

    expect(mocks.getSupabaseServiceRoleClient).toHaveBeenCalledTimes(2);
    expect(mocks.loadProgramContextCatalog).toHaveBeenCalledTimes(1);
  });

  it("keeps both managed-data loaders independently fail-closed", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("admin"));

    const [users, audit] = await Promise.all([
      listManagedAdminUsers(),
      listAdminAuditLogs()
    ]);

    expect(users.data).toEqual([]);
    expect(users.error).toContain("không có quyền");
    expect(audit.data).toEqual([]);
    expect(audit.error).toContain("không có quyền");
    expect(mocks.getSupabaseServiceRoleClient).not.toHaveBeenCalled();
  });
});
