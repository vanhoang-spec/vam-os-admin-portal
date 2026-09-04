import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentAdminUser } from "../lib/auth-constants";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  redirect: vi.fn(),
  getAdminCorrectionData: vi.fn(),
  getIntakeBatches: vi.fn(),
  getReviewerPool: vi.fn(),
  getAdminScopeContext: vi.fn(),
  getScopeFilter: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));
vi.mock("@/lib/admin-corrections", () => ({ getAdminCorrectionData: mocks.getAdminCorrectionData }));
vi.mock("@/lib/data", () => ({
  getIntakeBatches: mocks.getIntakeBatches,
  getReviewerPool: mocks.getReviewerPool
}));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: mocks.getAdminScopeContext,
  getScopeFilter: mocks.getScopeFilter
}));
vi.mock("@/lib/season-config", () => ({
  SEASON_CONFIG: { CURRENT_OPERATING_SEASON_CODE: "UEHM_S12" }
}));
vi.mock("@/app/admin/admin-correction-forms", () => ({
  ActionItemUpdateForm: () => null,
  CreateIssueActionForm: () => null,
  EditRecapInlineForm: () => null,
  QuickResolveForm: () => null
}));
vi.mock("@/app/reviews/reviewer-pool/reviewer-pool-client", () => ({
  ReviewerPoolClient: () => React.createElement("div", null, "Reviewer pool client remains available")
}));

import AdminCorrectionPage from "../app/admin/page";
import ReviewerGuidePage from "../app/reviews/guide/page";
import ReviewerPoolPage from "../app/reviews/reviewer-pool/page";
import { allNavHrefs, buildNavGroups } from "../lib/nav-model";

function userForRole(role: CurrentAdminUser["role"]): CurrentAdminUser {
  return {
    id: `${role}-1`,
    email: `${role}@example.test`,
    full_name: role,
    role,
    status: "active",
    auth_user_id: `auth-${role}-1`
  };
}

const entryPointPages = [
  {
    name: "/admin",
    render: () => AdminCorrectionPage({ searchParams: Promise.resolve({}) }),
    unrelatedMarkers: ["Hỗ trợ follow-up", "Rà soát dữ liệu"]
  },
  {
    name: "/reviews/reviewer-pool",
    render: () => ReviewerPoolPage({ searchParams: Promise.resolve({}) }),
    unrelatedMarkers: ["Danh sách nhân sự tuyển sinh", "Reviewer pool client remains available", "Lưu ý Auth:", "Supabase Dashboard"]
  },
  {
    name: "/reviews/guide",
    render: () => ReviewerGuidePage(),
    unrelatedMarkers: ["Chia hồ sơ", "/reviews/assign-bulk", "Hướng dẫn Reviewer"]
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.getAdminCorrectionData.mockResolvedValue({
    issues: [],
    actionItems: [],
    recaps: [],
    error: null
  });
  mocks.getIntakeBatches.mockResolvedValue({ data: [], error: null });
  mocks.getReviewerPool.mockResolvedValue({ data: [], error: null });
  mocks.getAdminScopeContext.mockResolvedValue({});
  mocks.getScopeFilter.mockResolvedValue(null);
});

describe.each(entryPointPages)("$name user-management entry point", ({ render, unrelatedMarkers }) => {
  it("is visible to an active super_admin", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("super_admin"));

    const html = renderToStaticMarkup(await render());

    expect(html).toContain('href="/admin/users"');
    unrelatedMarkers.forEach((marker) => expect(html).toContain(marker));
  });

  it.each(["admin", "core_team"] as const)(
    "is hidden from %s while legitimate workflow, reviewer-management, and guide functions remain",
    async (role) => {
      mocks.getCurrentAdminUser.mockResolvedValue(userForRole(role));

      const html = renderToStaticMarkup(await render());

      expect(html).not.toContain('href="/admin/users"');
      unrelatedMarkers.forEach((marker) => expect(html).toContain(marker));
      expect(mocks.redirect).not.toHaveBeenCalled();
    }
  );
});

describe("guide instruction", () => {
  it.each(["admin", "core_team"] as const)("tells %s to contact Super Admin", async (role) => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole(role));

    const html = renderToStaticMarkup(await ReviewerGuidePage());

    expect(html).toContain("Liên hệ <strong>Super Admin</strong> để tạo tài khoản reviewer mới.");
    expect(html).not.toContain('href="/admin/users"');
  });
});

describe("main navigation entry point", () => {
  it("shows /admin/users only to active super_admin", () => {
    const roles: CurrentAdminUser["role"][] = [
      "super_admin",
      "admin",
      "core_team",
      "support_team",
      "reviewer",
      "viewer"
    ];

    roles.forEach((role) => {
      const hrefs = allNavHrefs(buildNavGroups(userForRole(role)));
      expect(hrefs.includes("/admin/users")).toBe(role === "super_admin");
    });
  });

  it("hides /admin/users from an inactive super_admin", () => {
    const inactive = {
      ...userForRole("super_admin"),
      status: "inactive"
    } as unknown as CurrentAdminUser;

    expect(allNavHrefs(buildNavGroups(inactive))).not.toContain("/admin/users");
  });
});

describe("roles outside the management pages", () => {
  it.each(["support_team", "reviewer", "viewer"] as const)("never renders a user-management link for %s", async (role) => {
    for (const page of entryPointPages) {
      mocks.getCurrentAdminUser.mockResolvedValue(userForRole(role));
      try {
        const html = renderToStaticMarkup(await page.render());
        expect(html).not.toContain('href="/admin/users"');
      } catch (error) {
        expect(String(error)).toMatch(/^Error: redirect:\/(login|reviews)?$/);
      }
    }
  });
});
