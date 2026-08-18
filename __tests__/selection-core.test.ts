/**
 * lib/selection-core.ts — the ranking that decides who is invited to interview.
 *
 * This is the most consequential pure function in the season: it turns scores
 * into invitations. The cases below pin the two properties the organisers have
 * to be able to defend — an equal score is never split at the boundary, and the
 * order is reproducible — plus the arithmetic of the reserve group.
 */
import { describe, it, expect } from "vitest";
import {
  buildSelectionPlan,
  compareCandidates,
  DEFAULT_RESERVE_PCT,
  partitionScored,
  reserveSize,
  statusForGroup,
  summarizePlan,
  type SelectionCandidate
} from "@/lib/selection-core";

function candidate(
  id: string,
  totalScore: number | null,
  overrides: Partial<SelectionCandidate> = {}
): SelectionCandidate {
  return {
    applicationId: id,
    totalScore,
    reviewCount: totalScore === null ? 0 : 1,
    submittedAt: "2026-08-01",
    ...overrides
  };
}

/** n candidates with distinct, descending scores: app-1 highest. */
function descending(n: number): SelectionCandidate[] {
  return Array.from({ length: n }, (_, i) => candidate(`app-${i + 1}`, 100 - i));
}

describe("partitionScored", () => {
  it("separates applications that have no usable score", () => {
    const { scored, unscored } = partitionScored([
      candidate("a", 20),
      candidate("b", null),
      candidate("c", 15, { reviewCount: 0 })
    ]);
    expect(scored.map((c) => c.applicationId)).toEqual(["a"]);
    expect(unscored.map((c) => c.applicationId)).toEqual(["b", "c"]);
  });

  it("treats a zero score with a real review as scored", () => {
    const { scored } = partitionScored([candidate("a", 0, { reviewCount: 2 })]);
    expect(scored).toHaveLength(1);
  });
});

describe("compareCandidates", () => {
  it("puts the higher score first", () => {
    expect(compareCandidates(candidate("a", 90), candidate("b", 80))).toBeLessThan(0);
  });

  it("prefers the score backed by more reviews when scores are equal", () => {
    const one = candidate("a", 80, { reviewCount: 1 });
    const three = candidate("b", 80, { reviewCount: 3 });
    expect(compareCandidates(three, one)).toBeLessThan(0);
  });

  it("prefers the earlier submission when score and review count match", () => {
    const early = candidate("a", 80, { submittedAt: "2026-08-01" });
    const late = candidate("b", 80, { submittedAt: "2026-08-09" });
    expect(compareCandidates(early, late)).toBeLessThan(0);
  });

  it("falls back to the id so the same run twice gives the same order", () => {
    const a = candidate("app-1", 80, { submittedAt: null });
    const b = candidate("app-2", 80, { submittedAt: null });
    expect(compareCandidates(a, b)).toBeLessThan(0);
    expect(compareCandidates(b, a)).toBeGreaterThan(0);
  });

  it("does not crash on an unparseable date", () => {
    const bad = candidate("a", 80, { submittedAt: "not-a-date" });
    const good = candidate("b", 80, { submittedAt: "2026-08-01" });
    expect(compareCandidates(good, bad)).toBeLessThan(0);
  });
});

describe("reserveSize", () => {
  it("is ten percent of capacity, rounded up", () => {
    expect(reserveSize(100)).toBe(10);
    expect(reserveSize(45)).toBe(5); // 4.5 → 5
    expect(reserveSize(11)).toBe(2); // 1.1 → 2
  });

  it("always keeps at least one standby place when there is any capacity", () => {
    expect(reserveSize(1)).toBe(1);
    expect(reserveSize(5)).toBe(1);
  });

  it("is zero when there is no capacity or no reserve policy", () => {
    expect(reserveSize(0)).toBe(0);
    expect(reserveSize(100, 0)).toBe(0);
  });

  it("uses ten percent by default", () => {
    expect(DEFAULT_RESERVE_PCT).toBe(10);
    expect(reserveSize(50)).toBe(reserveSize(50, DEFAULT_RESERVE_PCT));
  });
});

describe("buildSelectionPlan — the cut", () => {
  it("invites exactly as many as there are mentee places", () => {
    const plan = buildSelectionPlan({ candidates: descending(50), capacityTotal: 20 });
    expect(plan.mainCount).toBe(20);
    expect(plan.ranked.slice(0, 20).every((row) => row.group === "main")).toBe(true);
  });

  it("puts ten percent more behind them as the reserve group", () => {
    const plan = buildSelectionPlan({ candidates: descending(50), capacityTotal: 20 });
    expect(plan.reserveCount).toBe(2);
    expect(plan.ranked.slice(20, 22).every((row) => row.group === "reserve")).toBe(true);
    expect(plan.ranked[22]?.group).toBe("below");
  });

  it("ranks from 1 in score order", () => {
    const plan = buildSelectionPlan({ candidates: descending(5), capacityTotal: 2 });
    expect(plan.ranked.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(plan.ranked.map((row) => row.applicationId)).toEqual([
      "app-1",
      "app-2",
      "app-3",
      "app-4",
      "app-5"
    ]);
  });

  it("takes everyone when there are fewer applications than places", () => {
    const plan = buildSelectionPlan({ candidates: descending(5), capacityTotal: 20 });
    expect(plan.mainCount).toBe(5);
    expect(plan.reserveCount).toBe(0);
    expect(plan.underSubscribed).toBe(true);
  });

  it("invites nobody when no mentor has confirmed a place", () => {
    const plan = buildSelectionPlan({ candidates: descending(10), capacityTotal: 0 });
    expect(plan.mainCount).toBe(0);
    expect(plan.reserveCount).toBe(0);
    expect(plan.ranked.every((row) => row.group === "below")).toBe(true);
  });

  it("leaves unscored applications out of the ranking and counts them", () => {
    const plan = buildSelectionPlan({
      candidates: [...descending(3), candidate("app-x", null), candidate("app-y", null)],
      capacityTotal: 2
    });
    expect(plan.ranked).toHaveLength(3);
    expect(plan.scoredCount).toBe(3);
    expect(plan.unscoredCount).toBe(2);
    expect(plan.ranked.map((row) => row.applicationId)).not.toContain("app-x");
  });
});

describe("buildSelectionPlan — equal scores at the boundary", () => {
  it("never separates applicants who scored the same", () => {
    // Places for 2, but ranks 2, 3 and 4 all scored 80.
    const candidates = [
      candidate("a", 90),
      candidate("b", 80),
      candidate("c", 80),
      candidate("d", 80),
      candidate("e", 70)
    ];
    const plan = buildSelectionPlan({ candidates, capacityTotal: 2 });

    const groups = Object.fromEntries(plan.ranked.map((row) => [row.applicationId, row.group]));
    // The whole 80-point group moves down rather than one of them being invited.
    expect(groups.a).toBe("main");
    expect(groups.b).toBe("main");
    expect(groups.c).toBe("main");
    expect(groups.d).toBe("main");
    expect(plan.mainCount).toBe(4);
  });

  it("explains the boundary tie on the rows involved", () => {
    const candidates = [candidate("a", 90), candidate("b", 80), candidate("c", 80)];
    const plan = buildSelectionPlan({ candidates, capacityTotal: 2 });
    // Extending past the tie means the boundary no longer splits equal scores,
    // so nobody is left with an unexplained rejection.
    expect(plan.ranked.filter((row) => row.group === "main")).toHaveLength(3);
  });

  it("does not extend the group when the boundary falls on a clean break", () => {
    const candidates = [candidate("a", 90), candidate("b", 80), candidate("c", 70)];
    const plan = buildSelectionPlan({ candidates, capacityTotal: 2 });
    expect(plan.mainCount).toBe(2);
    expect(plan.ranked[2]?.group).not.toBe("main");
    expect(plan.ranked[0]?.tieBreakNote).toBeNull();
  });

  it("applies the same rule to the reserve boundary", () => {
    // capacity 1 → reserve 1, but ranks 2 and 3 tie.
    const candidates = [candidate("a", 90), candidate("b", 80), candidate("c", 80), candidate("d", 10)];
    const plan = buildSelectionPlan({ candidates, capacityTotal: 1 });
    expect(plan.mainCount).toBe(1);
    expect(plan.reserveCount).toBe(2);
    expect(plan.ranked[3]?.group).toBe("below");
  });
});

describe("statusForGroup", () => {
  it("invites the main group and waitlists the reserve", () => {
    expect(statusForGroup("main")).toBe("invited_to_interview");
    expect(statusForGroup("reserve")).toBe("waitlisted");
  });

  it("leaves everyone else untouched — rejection is an explicit decision", () => {
    expect(statusForGroup("below")).toBeNull();
  });
});

describe("summarizePlan", () => {
  it("blocks applying while any application is unscored", () => {
    const plan = buildSelectionPlan({
      candidates: [...descending(4), candidate("app-x", null)],
      capacityTotal: 2
    });
    const summary = summarizePlan(plan);
    expect(summary.canApply).toBe(false);
    expect(summary.blockReason).toContain("chưa có điểm chấm");
  });

  it("blocks applying when nothing has been scored at all", () => {
    const plan = buildSelectionPlan({ candidates: [], capacityTotal: 10 });
    expect(summarizePlan(plan).canApply).toBe(false);
  });

  it("blocks applying when no mentor has confirmed a place", () => {
    const plan = buildSelectionPlan({ candidates: descending(5), capacityTotal: 0 });
    const summary = summarizePlan(plan);
    expect(summary.canApply).toBe(false);
    expect(summary.blockReason).toContain("chưa xác định được số suất");
  });

  it("allows applying once every application is scored and places exist", () => {
    const plan = buildSelectionPlan({ candidates: descending(30), capacityTotal: 10 });
    const summary = summarizePlan(plan);
    expect(summary.canApply).toBe(true);
    expect(summary.blockReason).toBeNull();
    expect(summary.mainCount).toBe(10);
    expect(summary.reserveCount).toBe(1);
    expect(summary.belowCount).toBe(19);
  });

  it("adds up to the ranked total", () => {
    const plan = buildSelectionPlan({ candidates: descending(37), capacityTotal: 12 });
    const summary = summarizePlan(plan);
    expect(summary.mainCount + summary.reserveCount + summary.belowCount).toBe(plan.ranked.length);
  });
});

describe("buildSelectionPlan — a realistic Season 12 round", () => {
  it("sizes the invitation list to the confirmed mentor capacity", () => {
    // 300 mentors confirmed 1 mentee each; 420 applications were scored.
    const candidates = Array.from({ length: 420 }, (_, i) =>
      candidate(`app-${String(i + 1).padStart(3, "0")}`, 500 - i, { reviewCount: 2 })
    );
    const plan = buildSelectionPlan({ candidates, capacityTotal: 300 });
    const summary = summarizePlan(plan);

    expect(summary.mainCount).toBe(300);
    expect(summary.reserveCount).toBe(30);
    expect(summary.belowCount).toBe(90);
    expect(summary.canApply).toBe(true);
  });
});

describe("buildSelectionPlan — explaining an extended boundary", () => {
  it("marks the rows kept only because the cut would have split a tie", () => {
    // Two places, but ranks 2 and 3 both scored 80.
    const plan = buildSelectionPlan({
      candidates: [candidate("a", 90), candidate("b", 80), candidate("c", 80), candidate("d", 70)],
      capacityTotal: 2
    });

    const byId = Object.fromEntries(plan.ranked.map((row) => [row.applicationId, row]));
    expect(byId.a.tieBreakNote).toBeNull();
    expect(byId.b.tieBreakNote).toBeNull();
    // "c" is in the main list only because splitting the 80-point pair was refused.
    expect(byId.c.group).toBe("main");
    expect(byId.c.tieBreakNote).toContain("Đồng điểm");
  });

  it("says nothing when no boundary had to move", () => {
    const plan = buildSelectionPlan({
      candidates: [candidate("a", 90), candidate("b", 80), candidate("c", 70), candidate("d", 60)],
      capacityTotal: 2
    });
    expect(plan.ranked.every((row) => row.tieBreakNote === null)).toBe(true);
  });
});
