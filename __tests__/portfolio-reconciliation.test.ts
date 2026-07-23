import { describe, expect, it } from "vitest";
import { reconcilePortfolioRows, resolveCurrentSeason } from "@/lib/portfolio-core";

const catalog = {
  programs: [
    { id: "ueh", code: "UEHM", name: "UEH Mentoring", isActive: true },
    { id: "ham", code: "HAM", name: "Hanoi Alumni Mentoring", isActive: true }
  ],
  seasons: [
    { id: "ueh11", code: "UEHM-S11", name: "S11", programId: "ueh", status: "closed" },
    { id: "ueh12", code: "UEHM-S12", name: "S12", programId: "ueh", status: "running" }
  ],
  intakeBatches: []
};
const empty = { applications: [], memberships: [], matches: [], events: [], actions: [] };

describe("portfolio KPI reconciliation", () => {
  it("derives non-zero distinct participants from 637 valid matches", () => {
    const matches = Array.from({ length: 637 }, (_, index) => ({
      season_id: "ueh12", status: "active", mentor_person_id: `m-${index % 20}`, mentee_person_id: `e-${index % 400}`
    }));
    const row = reconcilePortfolioRows(catalog, { ...empty, matches })[1];
    expect(row.activeMatches).toBe(637);
    expect(row.mentors).toBe(20);
    expect(row.mentees).toBe(400);
  });

  it("uses the same resolved current season for every KPI", () => {
    const old = { season_id: "ueh11", status: "active", mentor_person_id: "old-m", mentee_person_id: "old-e" };
    const current = { season_id: "ueh12", status: "active", mentor_person_id: "new-m", mentee_person_id: "new-e" };
    const row = reconcilePortfolioRows(catalog, {
      applications: [{ season_id: "ueh11", status: "submitted" }, { season_id: "ueh12", status: "submitted" }],
      memberships: [], matches: [old, current],
      events: [{ season_id: "ueh11", status: "scheduled", starts_at: "2099-01-01" }],
      actions: [{ season_id: "ueh11", status: "open", action_type: "data_issue", due_date: "2020-01-01" }]
    })[1];
    expect(row).toMatchObject({ currentSeasonId: "ueh12", applications: 1, activeMatches: 1, upcomingEvents: 0, dataIssues: 0 });
  });

  it("deduplicates membership and match identities", () => {
    const row = reconcilePortfolioRows(catalog, {
      ...empty,
      memberships: [
        { season_id: "ueh12", role: "mentor", status: "active", person_id: "m1" },
        { season_id: "ueh12", role: "mentor", status: "active", person_id: "m1" }
      ],
      matches: [
        { season_id: "ueh12", status: "active", mentor_person_id: "m1", mentee_person_id: "e1" },
        { season_id: "ueh12", status: "active", mentor_person_id: "m1", mentee_person_id: "e1" }
      ]
    })[1];
    expect([row.mentors, row.mentees]).toEqual([1, 1]);
  });

  it("marks missing participant linkage instead of returning zero", () => {
    const row = reconcilePortfolioRows(catalog, { ...empty, matches: [{ season_id: "ueh12", status: "active", mentor_person_id: null, mentee_person_id: null }] })[1];
    expect(row).toMatchObject({ mentors: null, mentees: null, participantLinkageIncomplete: true });
  });

  it("shows HAM without a linked season as no data", () => {
    const ham = reconcilePortfolioRows(catalog, empty)[0];
    expect(ham).toMatchObject({ programCode: "HAM", currentSeasonCode: null, applications: null, activeMatches: null });
  });

  it("shows scoped HAM data when a linked season exists", () => {
    const withHam = { ...catalog, seasons: [...catalog.seasons, { id: "ham6", code: "HAM-S6", name: "S6", programId: "ham", status: "active" }] };
    const ham = reconcilePortfolioRows(withHam, { ...empty, matches: [{ season_id: "ham6", status: "active", mentor_person_id: "hm", mentee_person_id: "he" }] })[0];
    expect(ham).toMatchObject({ currentSeasonCode: "HAM-S6", mentors: 1, mentees: 1, activeMatches: 1 });
  });

  it("does not leak UEH rows into HAM", () => {
    const withHam = { ...catalog, seasons: [...catalog.seasons, { id: "ham6", code: "HAM-S6", name: "S6", programId: "ham", status: "active" }] };
    const rows = reconcilePortfolioRows(withHam, { ...empty, applications: [{ season_id: "ueh12", status: "submitted" }] });
    expect(rows.find((row) => row.programCode === "HAM")?.applications).toBe(0);
  });

  it("distinguishes a source query error from a true zero", () => {
    expect(reconcilePortfolioRows(catalog, { ...empty, applications: null })[1].applications).toBeNull();
    expect(reconcilePortfolioRows(catalog, empty)[1].applications).toBe(0);
  });

  it("returns all program cards while keeping counts isolated", () => {
    const rows = reconcilePortfolioRows(catalog, { ...empty, applications: [{ season_id: "ueh12", status: "submitted" }] });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => [row.programCode, row.applications])).toEqual([["HAM", null], ["UEHM", 1]]);
  });

  it("is independent of viewer/admin role and resolves running seasons deterministically", () => {
    expect(resolveCurrentSeason([...catalog.seasons].reverse())?.code).toBe("UEHM-S12");
    expect(reconcilePortfolioRows(catalog, empty)).toEqual(reconcilePortfolioRows(catalog, empty));
  });
});
