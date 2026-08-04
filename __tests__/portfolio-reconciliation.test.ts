import { describe, expect, it } from "vitest";
import { reconcilePortfolioRows, resolveCurrentSeason } from "@/lib/portfolio-core";

const catalog = {
  programs: [
    { id: "ueh", code: "UEHM", name: "UEH Mentoring", isActive: true },
    { id: "ham", code: "HAM", name: "Hanoi Alumni Mentoring", isActive: true }
  ],
  seasons: [
    { id: "ueh11", code: "UEHM-S11", name: "S11", programId: "ueh" },
    { id: "ueh12", code: "UEHM-S12", name: "S12", programId: "ueh" }
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
    const withHam = { ...catalog, seasons: [...catalog.seasons, { id: "ham6", code: "HAM-S6", name: "S6", programId: "ham" }] };
    const ham = reconcilePortfolioRows(withHam, { ...empty, matches: [{ season_id: "ham6", status: "active", mentor_person_id: "hm", mentee_person_id: "he" }] })[0];
    expect(ham).toMatchObject({ currentSeasonCode: "HAM-S6", mentors: 1, mentees: 1, activeMatches: 1 });
  });

  it("does not leak UEH rows into HAM", () => {
    const withHam = { ...catalog, seasons: [...catalog.seasons, { id: "ham6", code: "HAM-S6", name: "S6", programId: "ham" }] };
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

  it("is independent of viewer/admin role and resolves the latest catalog season deterministically", () => {
    expect(resolveCurrentSeason([...catalog.seasons].reverse())?.code).toBe("UEHM-S12");
    expect(reconcilePortfolioRows(catalog, empty)).toEqual(reconcilePortfolioRows(catalog, empty));
  });

  it("keeps selected S11, selected S12, all-season, and current-season totals distinct", () => {
    const sources = {
      ...empty,
      applications: [
        { season_id: "ueh11", status: "submitted" },
        { season_id: "ueh11", status: "submitted" },
        { season_id: "ueh12", status: "submitted" }
      ]
    };
    const selectedS11 = reconcilePortfolioRows(catalog, sources, "ueh", new Date(), { mode: "selected", seasonId: "ueh11" })[0];
    const selectedS12 = reconcilePortfolioRows(catalog, sources, "ueh", new Date(), { mode: "selected", seasonId: "ueh12" })[0];
    const all = reconcilePortfolioRows(catalog, sources, "ueh", new Date(), { mode: "all" })[0];
    const current = reconcilePortfolioRows(catalog, sources, "ueh")[0];
    expect([selectedS11.applications, selectedS12.applications, all.applications, current.applications]).toEqual([2, 1, 3, 1]);
    expect([selectedS11.currentSeasonCode, selectedS12.currentSeasonCode, all.currentSeasonCode, current.currentSeasonCode])
      .toEqual(["UEHM-S11", "UEHM-S12", null, "UEHM-S12"]);
  });

  it("can show equal S11/S12 totals only when each scoped source supports that equality", () => {
    const sources = { ...empty, applications: [{ season_id: "ueh11", status: "submitted" }, { season_id: "ueh12", status: "submitted" }] };
    const s11 = reconcilePortfolioRows(catalog, sources, "ueh", new Date(), { mode: "selected", seasonId: "ueh11" })[0];
    const s12 = reconcilePortfolioRows(catalog, sources, "ueh", new Date(), { mode: "selected", seasonId: "ueh12" })[0];
    expect([s11.applications, s12.applications]).toEqual([1, 1]);
  });
});
