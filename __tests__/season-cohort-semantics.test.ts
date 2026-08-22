import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, fakeClient } from "./support/fake-postgrest";

const clients = vi.hoisted(() => ({ service: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: clients.service }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), cache: (fn: unknown) => fn }));

import {
  getSeasonCohortPersonIds,
  intersectAuthorizedAndCohort,
  isOfficialSeasonMembership
} from "@/lib/season-cohort";
import { getMentorProfiles } from "@/lib/data";

const db = createFakeDb();

describe("official mentor and mentee cohort semantics", () => {
  beforeEach(() => {
    db.reset();
    clients.service.mockReturnValue(fakeClient(db));
  });

  it("accepts active S12 and completed S11 memberships for the requested role", () => {
    expect(isOfficialSeasonMembership({ role: "Mentor", status: "active" }, "mentor")).toBe(true);
    expect(isOfficialSeasonMembership({ role: "mentee", status: "COMPLETED" }, "mentee")).toBe(true);
    expect(isOfficialSeasonMembership({ role: "mentor", status: "inactive" }, "mentor")).toBe(false);
    expect(isOfficialSeasonMembership({ role: "mentee", status: "active" }, "mentor")).toBe(false);
  });

  it("does not let an application or intake batch create cohort membership", () => {
    expect(intersectAuthorizedAndCohort(null, ["membership-person"])).toEqual(["membership-person"]);
    expect(intersectAuthorizedAndCohort(["application-only", "membership-person"], ["membership-person"]))
      .toEqual(["membership-person"]);
  });

  it("queries only selected-season memberships and includes active/completed rows case-insensitively", async () => {
    db.tables.person_season_memberships = [
      { id: "1", season_id: "s12", person_id: "active-mentor", role: "Mentor", status: "ACTIVE" },
      { id: "2", season_id: "s12", person_id: "completed-mentor", role: "mentor", status: "completed" },
      { id: "3", season_id: "s12", person_id: "inactive-mentor", role: "mentor", status: "inactive" },
      { id: "4", season_id: "s11", person_id: "other-season", role: "mentor", status: "completed" },
      { id: "5", season_id: "s12", person_id: "active-mentee", role: "mentee", status: "active" }
    ];
    db.tables.applications = [
      { id: "app", season_id: "s12", person_id: "application-only", role_applied: "mentor" }
    ];

    await expect(getSeasonCohortPersonIds("s12", "mentor")).resolves.toEqual({
      data: ["active-mentor", "completed-mentor"],
      error: null
    });
    expect(new Set(db.requests.map((request) => request.table))).toEqual(new Set(["person_season_memberships"]));
    expect(db.requests.every((request) => request.filters.includes('"column":"season_id","value":"s12"'))).toBe(true);
  });

  it("suppresses the profile intake-batch union when cohort person IDs are explicit", () => {
    const source = readFileSync("lib/data.ts", "utf8");
    expect(source).toContain("explicitPersonIds");
    expect(source).toContain("intersectAuthorizedAndCohort");
  });

  it("does not re-widen an explicit mentor cohort through an in-season intake batch", async () => {
    db.tables.matches = [];
    db.tables.mentoring_recaps = [];
    db.tables.event_participations = [];
    db.tables.applications = [];
    db.tables.person_season_memberships = [
      { id: "membership", season_id: "s12", person_id: "official", role: "mentor", status: "active" }
    ];
    db.tables.intake_batches = [{ id: "batch-s12", season_id: "s12" }];
    db.tables.mentor_profiles = [
      { id: "profile-official", person_id: "official", intake_batch_id: "batch-s12" },
      { id: "profile-batch-only", person_id: "batch-only", intake_batch_id: "batch-s12" }
    ];
    db.tables.mentee_profiles = [];

    const result = await getMentorProfiles({ allowedSeasonIds: ["s12"] }, ["official"]);
    expect(result.error).toBeNull();
    expect(result.data.map((profile) => profile.person_id)).toEqual(["official"]);
  });
});
