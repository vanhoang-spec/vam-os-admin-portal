import { describe, expect, it, vi } from "vitest";
import React from "react";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn((destination: string) => { throw new Error("REDIRECT:" + destination); })
}));
vi.mock("@/lib/admin-auth", () => ({
  getCurrentAdminUser: vi.fn(async () => ({ role: "super_admin" }))
}));
vi.mock("@/lib/portfolio", () => ({
  getSuperAdminPortfolio: vi.fn(async () => ({
    totals: {
      programs: 1, activePrograms: 1, activeSeasons: 1, openApplications: 0,
      activeMentors: 0, activeMentees: 0, activeMatches: 0, upcomingEvents: 0,
      dataIssues: 0, overdueTasks: 0
    },
    programs: [{
      programId: "program-uehm", programCode: "UEHM", programName: "UEH Mentoring", isActive: true,
      currentSeasonId: "season-uehm-s12", currentSeasonCode: "UEHM-S12", applications: 0,
      mentors: 0, mentees: 0, activeMatches: 0, upcomingEvents: 0, dataIssues: 0,
      overdueTasks: 0, participantLinkageIncomplete: false, health: "normal"
    }],
    warnings: []
  }))
}));
vi.mock("@/lib/admin-users", () => ({
  requireSuperAdmin: vi.fn(async () => ({ id: "actor", role: "super_admin" })),
  listManagedAdminUsers: vi.fn(async () => ({ data: [], error: null })),
  listAdminAuditLogs: vi.fn(async () => ({ data: [], error: null }))
}));
vi.mock("@/lib/program-context", () => ({
  resolveAuthorizedPrograms: vi.fn(async () => [{ id: "program-uehm", code: "UEHM" }]),
  loadProgramContextCatalog: vi.fn(async () => ({
    programs: [{ id: "program-uehm", code: "UEHM", name: "UEH Mentoring", isActive: true }],
    seasons: [{ id: "season-uehm-s12", code: "UEHM-S12", name: "UEHM Season 12", programId: "program-uehm" }],
    intakeBatches: [],
    warnings: []
  })),
  resolveAuthorizedProgramContext: vi.fn(async () => ({
    selectedProgramId: "program-uehm",
    selectedProgramCode: "UEHM",
    selectedSeasonId: "season-uehm-s12",
    selectedSeasonCode: "UEHM-S12",
    selectedIntakeBatchId: null,
    accessMode: "global"
  }))
}));
vi.mock("@/app/admin/users/user-management-forms", () => ({
  CreateAdminUserForm: vi.fn(() => null),
  EditAdminUserForm: vi.fn(() => null),
  RemoveAccessForm: vi.fn(() => null),
  StatusToggleForm: vi.fn(() => null),
  SyncAuthForm: vi.fn(() => null)
}));

import PortfolioPage from "@/app/portfolio/page";
import AdminUsersPage from "@/app/admin/users/page";

describe("context routes with staging-shaped catalog data", () => {
  it("/portfolio returns its page tree instead of reaching the runtime boundary", async () => {
    const page = await PortfolioPage({ searchParams: Promise.resolve({ program: "UEHM", season: "UEHM-S12" }) });
    expect(page).toBeTruthy();
    expect(page.type).toBeDefined();
  });

  it("/admin/users returns its page tree with the selected UEHM-S12 context", async () => {
    const page = await AdminUsersPage({ searchParams: Promise.resolve({ program: "UEHM", season: "UEHM-S12" }) });
    expect(page).toBeTruthy();
    expect(page.type).toBeDefined();
  });
});
