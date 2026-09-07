import { describe, expect, it } from "vitest";

import {
  describeAttendance,
  summarizeAttendance,
  type AttendanceRow
} from "@/lib/cross-attendance-core";

/**
 * The owner asked for one percentage per mentee. These tests are the four ways
 * that percentage could be quietly wrong.
 */

const PERSON_A = "11111111-1111-4111-8111-111111111111";
const PERSON_B = "22222222-2222-4222-8222-222222222222";

function row(overrides: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    linkedPersonId: PERSON_A,
    registrationStatus: "registered",
    attendanceStatus: "checked_in",
    isWalkIn: false,
    eventId: "event-1",
    ...overrides
  };
}

describe("summarizeAttendance — the plain case", () => {
  it("counts three of four as 75%", () => {
    const summary = summarizeAttendance([
      row(),
      row(),
      row(),
      row({ attendanceStatus: "no_show" })
    ]);

    expect(summary.people).toHaveLength(1);
    expect(summary.people[0].registered).toBe(4);
    expect(summary.people[0].attended).toBe(3);
    expect(summary.people[0].noShow).toBe(1);
    expect(summary.people[0].ratePercent).toBe(75);
  });

  it("keeps people apart", () => {
    const summary = summarizeAttendance([
      row(),
      row({ linkedPersonId: PERSON_B, attendanceStatus: "no_show" })
    ]);

    expect(summary.people).toHaveLength(2);
    expect(summary.people.find((p) => p.personId === PERSON_A)?.ratePercent).toBe(100);
    expect(summary.people.find((p) => p.personId === PERSON_B)?.ratePercent).toBe(0);
  });

  it("returns nothing for nothing", () => {
    const summary = summarizeAttendance([]);
    expect(summary.people).toHaveLength(0);
    expect(summary.unlinkedRegistrations).toBe(0);
  });
});

describe("rule 1 — a cancelled registration is not a no-show", () => {
  it("leaves a cancelled registration out of both halves", () => {
    const summary = summarizeAttendance([
      row(),
      row({ registrationStatus: "cancelled", attendanceStatus: "pending" })
    ]);

    expect(summary.people[0].registered).toBe(1);
    expect(summary.people[0].noShow).toBe(0);
    expect(summary.people[0].ratePercent).toBe(100);
  });

  it("also honours a cancellation recorded on the attendance column", () => {
    const summary = summarizeAttendance([row(), row({ attendanceStatus: "cancelled" })]);
    expect(summary.people[0].registered).toBe(1);
    expect(summary.people[0].ratePercent).toBe(100);
  });
});

describe("rule 2 — a walk-in is not a registration", () => {
  it("counts a walk-in as attended without inflating the rate above 100", () => {
    const summary = summarizeAttendance([
      row({ isWalkIn: true }),
      row({ isWalkIn: true }),
      row({ attendanceStatus: "no_show" })
    ]);

    const person = summary.people[0];
    expect(person.walkIns).toBe(2);
    expect(person.registered).toBe(1);
    expect(person.attended).toBe(2);
    expect(person.noShow).toBe(1);
    // 2 attended out of 3 settled — never above 100.
    expect(person.ratePercent).toBe(67);
    expect(person.ratePercent).toBeLessThanOrEqual(100);
  });

  it("gives a pure walk-in a full rate rather than a division by zero", () => {
    const summary = summarizeAttendance([row({ isWalkIn: true })]);
    expect(summary.people[0].registered).toBe(0);
    expect(summary.people[0].ratePercent).toBe(100);
  });
});

describe("rule 3 — pending is not no_show", () => {
  it("leaves a session that has not happened out of the rate", () => {
    const summary = summarizeAttendance([row(), row({ attendanceStatus: "pending" })]);

    expect(summary.people[0].pending).toBe(1);
    expect(summary.people[0].noShow).toBe(0);
    expect(summary.people[0].ratePercent).toBe(100);
  });

  it("reports no rate at all when nothing has been settled yet", () => {
    const summary = summarizeAttendance([
      row({ attendanceStatus: "pending" }),
      row({ attendanceStatus: "pending" })
    ]);

    expect(summary.people[0].pending).toBe(2);
    expect(summary.people[0].ratePercent).toBeNull();
  });
});

describe("rule 4 — an unlinked registration belongs to nobody", () => {
  it("reports it separately instead of dropping it", () => {
    const summary = summarizeAttendance([
      row(),
      row({ linkedPersonId: null }),
      row({ linkedPersonId: null, attendanceStatus: "no_show" }),
      row({ linkedPersonId: "   " })
    ]);

    expect(summary.people).toHaveLength(1);
    expect(summary.unlinkedRegistrations).toBe(3);
    expect(summary.unlinkedAttended).toBe(2);
  });

  it("never attributes an unlinked row to somebody else", () => {
    const summary = summarizeAttendance([row({ linkedPersonId: null })]);
    expect(summary.people).toHaveLength(0);
  });
});

describe("ordering", () => {
  it("puts the lowest attendance first, because that is who the list is for", () => {
    const summary = summarizeAttendance([
      row({ linkedPersonId: PERSON_A }),
      row({ linkedPersonId: PERSON_B, attendanceStatus: "no_show" }),
      row({ linkedPersonId: PERSON_B, attendanceStatus: "no_show" })
    ]);

    expect(summary.people[0].personId).toBe(PERSON_B);
    expect(summary.people[0].ratePercent).toBe(0);
  });

  it("sorts people with no settled sessions to the end", () => {
    const summary = summarizeAttendance([
      row({ linkedPersonId: PERSON_A, attendanceStatus: "pending" }),
      row({ linkedPersonId: PERSON_B, attendanceStatus: "no_show" })
    ]);

    expect(summary.people[0].personId).toBe(PERSON_B);
    expect(summary.people[1].ratePercent).toBeNull();
  });
});

describe("describeAttendance", () => {
  it("reads as a sentence for a settled record", () => {
    const summary = summarizeAttendance([row(), row(), row({ attendanceStatus: "no_show" })]);
    expect(describeAttendance(summary.people[0])).toContain("2/3 buổi — 67%");
  });

  it("says so when nothing has happened yet", () => {
    const summary = summarizeAttendance([row({ attendanceStatus: "pending" })]);
    expect(describeAttendance(summary.people[0])).toContain("chưa diễn ra");
  });

  it("mentions walk-ins", () => {
    const summary = summarizeAttendance([row(), row({ isWalkIn: true })]);
    expect(describeAttendance(summary.people[0])).toContain("không đăng ký trước");
  });

  it("handles a person with an empty record", () => {
    expect(
      describeAttendance({
        personId: PERSON_A,
        registered: 0,
        attended: 0,
        noShow: 0,
        pending: 0,
        walkIns: 0,
        ratePercent: null
      })
    ).toBe("Chưa đăng ký buổi nào");
  });
});
