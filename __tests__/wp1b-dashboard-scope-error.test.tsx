import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRestrictedDashboardSummary: vi.fn(),
  getDashboardData: vi.fn(),
  getOperationsData: vi.fn(),
  getScopeFilter: vi.fn(async () => ({ allowedProgramIds: [], allowedSeasonIds: [] })),
  getAdminScopeContext: vi.fn()
}));

vi.mock("@/lib/data", () => ({
  getRestrictedDashboardSummary: mocks.getRestrictedDashboardSummary,
  getDashboardData: mocks.getDashboardData,
  getOperationsData: mocks.getOperationsData,
  keyById: (rows: Array<{ id: string }>) => new Map(rows.map((row) => [row.id, row]))
}));

vi.mock("@/lib/program-scope", () => ({
  getScopeFilter: mocks.getScopeFilter,
  getAdminScopeContext: mocks.getAdminScopeContext
}));

vi.mock("@/components/charts", () => ({ BarSummary: () => null, DonutSummary: () => null }));
vi.mock("@/components/ui", () => ({
  Card: ({ children }: { children?: React.ReactNode }) => React.createElement("section", null, children),
  ErrorBox: ({ message }: { message?: string | null }) => message ? React.createElement("div", null, message) : null,
  InternalLinkButton: () => null,
  KpiCard: ({ label, value }: { label: string; value: unknown }) => React.createElement("div", null, `${label}:${String(value)}`),
  PageHeader: ({ title, description }: { title: string; description?: string }) => React.createElement("header", null, title, description),
  SimpleTable: () => null
}));

import DashboardPage from "@/app/page";

describe("WP1-B restricted dashboard scope failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminScopeContext.mockResolvedValue({
      adminUser: null,
      authUserId: "viewer-auth",
      globalRole: "viewer",
      isSuperAdmin: false,
      programScopes: [],
      scopeError: "scope infrastructure unavailable"
    });
  });

  it("fails closed instead of rendering legitimate-looking zero KPIs", async () => {
    const html = renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("scope infrastructure unavailable");
    expect(html).not.toContain("Ứng tuyển");
    expect(html).not.toContain("Match active");
    expect(mocks.getRestrictedDashboardSummary).not.toHaveBeenCalled();
    expect(mocks.getDashboardData).not.toHaveBeenCalled();
  });
});
