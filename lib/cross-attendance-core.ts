/**
 * lib/cross-attendance-core.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Registered versus actually came.
 *
 * The owner asked for one number per mentee: how many sessions they signed up
 * for, how many they turned up to, as a percentage. Simple to state, and easy
 * to get quietly wrong in four ways — so the counting rules are here, in one
 * pure function, with a test for each of them.
 *
 * 1. A CANCELLED REGISTRATION IS NOT A NO-SHOW. Somebody who signed up and then
 *    told us they could not come behaved well. Counting that against them would
 *    punish the courtesy and teach people to just not show up.
 *
 * 2. A WALK-IN IS NOT A REGISTRATION. They never signed up, so they cannot have
 *    failed to appear. They appear in the attended count and not the
 *    denominator — which is why a walk-in-heavy session can read above 100% if
 *    you compute it the naive way, and why this does not.
 *
 * 3. `pending` IS NOT `no_show`. Before the organisers close the books, a
 *    registration that has not been checked in means "the session has not
 *    happened yet", not "they did not come". Sessions still open are excluded
 *    from the rate rather than counted as failures.
 *
 * 4. AN UNLINKED REGISTRATION BELONGS TO NOBODY. A public form filled in with
 *    an email we cannot match to a person cannot be attributed. It is reported
 *    as its own number instead of being silently dropped — a rate computed over
 *    two thirds of the sheet, presented as if it were the whole, is worse than
 *    no rate at all.
 */

export type AttendanceRow = {
  /** Null when the public form could not be matched to a person. */
  linkedPersonId?: string | null;
  registrationStatus?: string | null;
  attendanceStatus?: string | null;
  isWalkIn?: boolean | null;
  eventId?: string | null;
};

export type PersonAttendance = {
  personId: string;
  /** Registrations that were not cancelled and were not walk-ins. */
  registered: number;
  /** Of those, the ones that were checked in. */
  attended: number;
  /** Registered, the session closed, and they did not appear. */
  noShow: number;
  /** Sessions still open — counted in neither attended nor noShow. */
  pending: number;
  /** Turned up without registering. */
  walkIns: number;
  /**
   * attended ÷ (attended + noShow), as a whole percent, or null when nothing
   * has been settled yet. Deliberately not attended ÷ registered: a session
   * that has not happened is not a failure to attend.
   */
  ratePercent: number | null;
};

export type AttendanceSummary = {
  people: PersonAttendance[];
  /** Registrations that could not be attributed to anybody. */
  unlinkedRegistrations: number;
  /** Of those, the ones that checked in. */
  unlinkedAttended: number;
};

function isCancelled(row: AttendanceRow): boolean {
  return (
    String(row.registrationStatus ?? "") === "cancelled" ||
    String(row.attendanceStatus ?? "") === "cancelled"
  );
}

/**
 * Fold a season's registration rows into one line per person.
 *
 * Takes rows rather than a query so the rules above can be tested without a
 * database, and so the same function serves the season report, one person's
 * profile, and a single session's sheet.
 */
export function summarizeAttendance(rows: AttendanceRow[]): AttendanceSummary {
  const byPerson = new Map<string, PersonAttendance>();
  let unlinkedRegistrations = 0;
  let unlinkedAttended = 0;

  for (const row of rows ?? []) {
    if (isCancelled(row)) continue;

    const attended = String(row.attendanceStatus ?? "") === "checked_in";
    const noShow = String(row.attendanceStatus ?? "") === "no_show";
    const walkIn = row.isWalkIn === true;
    const personId = String(row.linkedPersonId ?? "").trim();

    if (!personId) {
      unlinkedRegistrations++;
      if (attended) unlinkedAttended++;
      continue;
    }

    const entry =
      byPerson.get(personId) ??
      ({
        personId,
        registered: 0,
        attended: 0,
        noShow: 0,
        pending: 0,
        walkIns: 0,
        ratePercent: null
      } satisfies PersonAttendance);

    if (walkIn) {
      entry.walkIns++;
      if (attended) entry.attended++;
    } else {
      entry.registered++;
      if (attended) entry.attended++;
      else if (noShow) entry.noShow++;
      else entry.pending++;
    }

    byPerson.set(personId, entry);
  }

  const people = Array.from(byPerson.values()).map((entry) => {
    const settled = entry.attended + entry.noShow;
    return {
      ...entry,
      ratePercent: settled > 0 ? Math.round((entry.attended / settled) * 100) : null
    };
  });

  // Worst first: the point of the list is spotting who has stopped coming.
  people.sort((a, b) => {
    const rateA = a.ratePercent ?? 101;
    const rateB = b.ratePercent ?? 101;
    if (rateA !== rateB) return rateA - rateB;
    return b.registered - a.registered;
  });

  return { people, unlinkedRegistrations, unlinkedAttended };
}

/** One line for a screen: "3/4 buổi — 75%". */
export function describeAttendance(entry: PersonAttendance): string {
  const settled = entry.attended + entry.noShow;
  if (!settled && !entry.pending && !entry.walkIns) return "Chưa đăng ký buổi nào";
  if (!settled) return `${entry.pending} buổi đã đăng ký, chưa diễn ra`;

  const parts = [`${entry.attended}/${settled} buổi — ${entry.ratePercent}%`];
  if (entry.pending) parts.push(`${entry.pending} buổi chưa diễn ra`);
  if (entry.walkIns) parts.push(`${entry.walkIns} buổi dự không đăng ký trước`);
  return parts.join(", ");
}
