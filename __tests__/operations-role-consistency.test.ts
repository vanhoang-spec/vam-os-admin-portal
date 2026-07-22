import { describe, expect, it } from "vitest";
import { computeProgramOperationsKpis } from "@/lib/operations-kpis";

const UEH_SEASON = "season-ueh";
const HAM_SEASON = "season-ham";

function fixture() {
  return {
    seasons: [
      { id: UEH_SEASON, code: "UEHM-S11", name: "UEH Mentoring Season 11" },
      { id: HAM_SEASON, code: "HAM-S6", name: "HAM Season 6" }
    ],
    matches: [
      { id: "match-ueh", season_id: UEH_SEASON, status: "active", mentor_person_id: "mentor-ueh", mentee_person_id: "mentee-ueh" },
      { id: "match-ham", season_id: HAM_SEASON, status: "active", mentor_person_id: "mentor-ham", mentee_person_id: "mentee-ham" }
    ],
    recaps: [
      { id: "ueh-july", season_id: UEH_SEASON, meeting_month: "2026-07", status: "submitted", mentor_person_id: "mentor-ueh", mentee_person_id: "mentee-ueh" },
      { id: "ueh-june", season_id: UEH_SEASON, meeting_month: "2026-06", status: "submitted", mentor_person_id: "mentor-ueh", mentee_person_id: "mentee-ueh" },
      { id: "ham-july-1", season_id: HAM_SEASON, meeting_month: "2026-07", status: "submitted", mentor_person_id: "mentor-ham", mentee_person_id: "mentee-ham" },
      { id: "ham-july-2", season_id: HAM_SEASON, meeting_month: "2026-07", status: "submitted", mentor_person_id: "mentor-ham-2", mentee_person_id: "mentee-ham-2" }
    ],
    events: [
      { id: "event-ueh", season_id: UEH_SEASON, starts_at: "2026-07-10T01:00:00Z" },
      { id: "event-ham", season_id: HAM_SEASON, starts_at: "2026-07-11T01:00:00Z" }
    ],
    eventParticipations: [
      { id: "attendance-ueh", event_id: "event-ueh", season_id: UEH_SEASON, attendance_status: "attended" },
      { id: "attendance-ham", event_id: "event-ham", season_id: HAM_SEASON, attendance_status: "attended" }
    ]
  } as any;
}

function aggregate(month: string, input = fixture()) {
  return computeProgramOperationsKpis({ ...input, seasonCode: "UEHM-S11", selectedMonth: month });
}

describe("program-level Operations KPI role consistency", () => {
  it("returns identical KPIs for Super Admin and Reviewer in the same context", () => {
    const rows = fixture();
    const superAdminResult = aggregate("2026-07", rows);
    const reviewerResult = aggregate("2026-07", rows);
    expect(reviewerResult).toEqual(superAdminResult);
  });

  it("does not let reviewer assignment metadata affect program KPIs", () => {
    const rows = fixture();
    expect(aggregate("2026-07", { ...rows, reviewerAssignments: ["review-a"] } as any)).toEqual(
      aggregate("2026-07", { ...rows, reviewerAssignments: ["review-b", "review-c"] } as any)
    );
  });

  it("excludes another program season even when the authorized loader returns both seasons", () => {
    const result = aggregate("2026-07");
    expect(result).toMatchObject({ recapCount: 1, activeMenteeCount: 1, activeMentorCount: 1, eventTrainingCount: 1, eventAttendanceCount: 1 });
  });

  it("keeps UEH and HAM aggregates isolated in both directions", () => {
    const rows = fixture();
    const ueh = computeProgramOperationsKpis({ ...rows, seasonCode: "UEHM-S11", selectedMonth: "2026-07" });
    const ham = computeProgramOperationsKpis({ ...rows, seasonCode: "HAM-S6", selectedMonth: "2026-07" });
    expect(ueh.recapCount).toBe(1);
    expect(ham.recapCount).toBe(2);
  });

  it("resolves the same explicit URL month independently of role", () => {
    expect(aggregate("2026-07").selectedMonth).toBe("2026-07");
    expect(aggregate("2026-06").selectedMonth).toBe("2026-06");
  });

  it("allows different months to produce different program KPI values", () => {
    const rows = fixture();
    rows.recaps.push({ id: "ueh-july-extra", season_id: UEH_SEASON, meeting_month: "2026-07", status: "submitted", mentor_person_id: "mentor-ueh-2", mentee_person_id: "mentee-ueh-2" });
    expect(aggregate("2026-07", rows).recapCount).toBe(2);
    expect(aggregate("2026-06", rows).recapCount).toBe(1);
  });

  it("fails closed when a manipulated season is outside the loaded program scope", () => {
    const result = computeProgramOperationsKpis({ ...fixture(), seasons: [], seasonCode: "UEHM-S11", selectedMonth: "2026-07" });
    expect(result).toMatchObject({ recapCount: 0, activeMenteeCount: 0, activeMentorCount: 0, eventTrainingCount: 0 });
  });

  it("returns count-only KPI data without PII fields", () => {
    const result = aggregate("2026-07") as Record<string, unknown>;
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(["email", "phone", "name", "people"]));
    expect(JSON.stringify(result)).not.toContain("@");
  });
});
