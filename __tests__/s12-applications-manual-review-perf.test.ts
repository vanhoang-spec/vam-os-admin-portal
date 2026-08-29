import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DETAIL_PAGE = "app/applications/[id]/page.tsx";
const DATA_LIB = "lib/data.ts";
const QUEUE_PAGE = "app/applications/mentor-review/page.tsx";

const read = (p: string) => readFileSync(p, "utf8");

describe("S12 Applications Manual Review Performance - Real Source Gates", () => {
  it("application detail source does NOT contain `getPeople(scope`", () => {
    const source = read(DETAIL_PAGE);
    expect(source).not.toContain("getPeople(scope");
  });

  it("application detail source does NOT contain `getMatches(scope`", () => {
    const source = read(DETAIL_PAGE);
    expect(source).not.toContain("getMatches(scope");
  });

  it("detail uses direct authorized-application person/profile helpers", () => {
    const source = read(DETAIL_PAGE);
    expect(source).toContain("getPersonByAuthorizedApplicationPersonId(personId)");
    expect(source).toContain("getMenteeProfileByAuthorizedApplicationPersonId(personId)");
    expect(source).toContain("getMentorProfileByAuthorizedApplicationPersonId(personId)");
  });

  it("mentor detail condition does not invoke mentee profile helper", () => {
    const source = read(DETAIL_PAGE);
    // Mentee fetch condition must be strictly gated to mentee role
    expect(source).toMatch(/personId && roleApplied === "mentee" \? getMenteeProfileByAuthorizedApplicationPersonId\(personId\)/);
  });

  it("targeted detail helpers do not call getScopedPersonIds", () => {
    const source = read(DATA_LIB);
    // Extract the block for the targeted helpers
    const personHelper = source.split("export async function getPersonByAuthorizedApplicationPersonId")[1].split("}")[0];
    const mentorHelper = source.split("export async function getMentorProfileByAuthorizedApplicationPersonId")[1].split("}")[0];
    const menteeHelper = source.split("export async function getMenteeProfileByAuthorizedApplicationPersonId")[1].split("}")[0];

    expect(personHelper).not.toContain("getScopedPersonIds");
    expect(mentorHelper).not.toContain("getScopedPersonIds");
    expect(menteeHelper).not.toContain("getScopedPersonIds");
  });

  it("getMatchesForPerson is DB-filtered by person and exact application season", () => {
    const source = read(DATA_LIB);
    const matchHelper = source.slice(source.indexOf("export async function getMatchesForPerson"));
    
    // Verify it uses seasonId instead of scope
    expect(matchHelper).toContain('seasonId: string');
    expect(matchHelper).toContain('.eq("season_id", seasonId)');
    expect(matchHelper).toContain('.or(`mentor_person_id.eq.${personId},mentee_person_id.eq.${personId}`);');
  });

  it("queue query includes role_applied = mentor and status = submitted", () => {
    const source = read(DATA_LIB);
    const queueHelper = source.slice(source.indexOf("export async function getMentorReviewQueue"));

    expect(queueHelper).toContain('.eq("role_applied", "mentor")');
    expect(queueHelper).toContain('.eq("status", "submitted")');
  });

  it("queue query pins canonical current application season", () => {
    const source = read(DATA_LIB);
    const queueHelper = source.slice(source.indexOf("export async function getMentorReviewQueue"));

    expect(queueHelper).toContain("SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE");
    expect(queueHelper).toContain('.eq("season_id", s12SeasonId)');
  });

  it("queue query uses deterministic submitted_at + id ordering", () => {
    const source = read(DATA_LIB);
    const queueHelper = source.slice(source.indexOf("export async function getMentorReviewQueue"));

    expect(queueHelper).toContain('.order("submitted_at", { ascending: false })');
    expect(queueHelper).toContain('.order("id", { ascending: false })');
  });

  it("queue query uses bounded `.range(...)`", () => {
    const source = read(DATA_LIB);
    const queueHelper = source.slice(source.indexOf("export async function getMentorReviewQueue"));

    expect(queueHelper).toContain(".range(from, to)");
  });

  it("queue UI page does not contain unnecessary relation fetches", () => {
    const source = read(QUEUE_PAGE);
    expect(source).not.toContain("getPeople");
    expect(source).not.toContain("getSeasons");
    expect(source).not.toContain("getIntakeBatches");
  });
});
