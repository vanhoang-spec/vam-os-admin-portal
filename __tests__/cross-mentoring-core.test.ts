/**
 * The state machine, and the rule about being passed over.
 *
 * Two properties matter more than the rest and are asserted exhaustively rather
 * than by example: nothing leaves a terminal state, and nothing goes backwards
 * once a session is scheduled — because by then an event exists and mentees may
 * already have registered against it.
 */
import { describe, it, expect } from "vitest";

import {
  availableTransitions,
  canMentorRespond,
  canSelectInvitation,
  canTransition,
  COMMITTED_STATUSES,
  invitationStatusLabel,
  MAX_TIMES_PASSED_OVER,
  nextStatusAfterResponse,
  partitionSweepCandidates,
  REQUEST_STATUSES,
  requestStatusLabel,
  shouldExcludeFromSweep,
  summarizeInvitations,
  TERMINAL_STATUSES,
  type ActorRole,
  type RequestStatus
} from "@/lib/cross-mentoring-core";

const ACTORS: ActorRole[] = ["owner", "reviewer", "publisher", "system"];

function allows(from: RequestStatus, to: RequestStatus, actor: ActorRole) {
  return canTransition(from, to, actor).ok;
}

describe("the happy path", () => {
  it("walks a request from draft to completed", () => {
    expect(allows("draft", "submitted", "owner")).toBe(true);
    expect(allows("submitted", "approved", "reviewer")).toBe(true);
    expect(allows("approved", "inviting", "reviewer")).toBe(true);
    expect(allows("inviting", "selecting", "system")).toBe(true);
    expect(allows("selecting", "scheduled", "publisher")).toBe(true);
    expect(allows("scheduled", "published", "publisher")).toBe(true);
    expect(allows("published", "completed", "publisher")).toBe(true);
  });

  it("lets a request go back out to more mentors when nobody suitable accepted", () => {
    expect(allows("selecting", "inviting", "reviewer")).toBe(true);
  });
});

describe("nothing leaves a terminal state", () => {
  it.each(TERMINAL_STATUSES)("%s is final for every actor", (from) => {
    for (const to of REQUEST_STATUSES) {
      for (const actor of ACTORS) {
        expect(canTransition(from, to, actor).ok, `${from} → ${to} as ${actor}`).toBe(false);
      }
    }
  });

  it("says the request is finished, rather than that the move does not exist", () => {
    const result = canTransition("completed", "published", "publisher");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("đã kết thúc");
  });
});

describe("no way back once a session is scheduled", () => {
  const earlier: RequestStatus[] = ["draft", "submitted", "approved", "inviting", "selecting"];

  it.each(COMMITTED_STATUSES)("%s never returns to an earlier state", (from) => {
    for (const to of earlier) {
      for (const actor of ACTORS) {
        expect(canTransition(from, to, actor).ok, `${from} → ${to} as ${actor}`).toBe(false);
      }
    }
  });

  it("explains why, and points at cancelling instead", () => {
    const result = canTransition("scheduled", "selecting", "publisher");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("mentee có thể đã đăng ký");
    expect(result.message).toContain("huỷ");
  });

  it("still allows cancelling, which is the intended exit", () => {
    for (const from of COMMITTED_STATUSES) {
      if (from === "completed") continue;
      expect(allows(from, "cancelled", "publisher"), from).toBe(true);
    }
  });
});

describe("who may do what", () => {
  it("only the mentee submits their own request", () => {
    expect(allows("draft", "submitted", "owner")).toBe(true);
    for (const actor of ["reviewer", "publisher", "system"] as ActorRole[]) {
      expect(allows("draft", "submitted", actor), actor).toBe(false);
    }
  });

  it("a mentee never approves, schedules or publishes anything", () => {
    expect(allows("submitted", "approved", "owner")).toBe(false);
    expect(allows("selecting", "scheduled", "owner")).toBe(false);
    expect(allows("scheduled", "published", "owner")).toBe(false);
  });

  it("a mentee may withdraw a request nobody has acted on", () => {
    expect(allows("submitted", "cancelled", "owner")).toBe(true);
    // But not once it is out with mentors.
    expect(allows("inviting", "cancelled", "owner")).toBe(false);
  });

  it("support team reviews and invites but does not schedule or publish", () => {
    expect(allows("submitted", "approved", "reviewer")).toBe(true);
    expect(allows("approved", "inviting", "reviewer")).toBe(true);
    // Creating a public event and opening registration is not a coordination task.
    expect(allows("selecting", "scheduled", "reviewer")).toBe(false);
    expect(allows("scheduled", "published", "reviewer")).toBe(false);
  });

  it("refuses with a permission message, not a shape message", () => {
    const result = canTransition("selecting", "scheduled", "reviewer");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("không có quyền");
  });

  it("lets a mentor's reply move the request without an organiser", () => {
    expect(allows("inviting", "selecting", "system")).toBe(true);
    // But the system never decides anything else.
    expect(allows("submitted", "approved", "system")).toBe(false);
    expect(allows("selecting", "scheduled", "system")).toBe(false);
  });
});

describe("bad input", () => {
  it("refuses an unknown state on either side", () => {
    expect(canTransition("khong_co_that", "approved", "reviewer").ok).toBe(false);
    expect(canTransition("submitted", "khong_co_that", "reviewer").ok).toBe(false);
    expect(canTransition(null, undefined, "reviewer").ok).toBe(false);
  });

  it("treats a move to the same state as nothing to do", () => {
    const result = canTransition("submitted", "submitted", "reviewer");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("Không có gì thay đổi.");
  });
});

describe("availableTransitions — what the screen should offer", () => {
  it("offers a reviewer approve, reject and cancel on a submitted request", () => {
    expect(availableTransitions("submitted", "reviewer").sort()).toEqual([
      "approved",
      "cancelled",
      "rejected"
    ]);
  });

  it("offers a mentee nothing once mentors are being invited", () => {
    expect(availableTransitions("inviting", "owner")).toEqual([]);
  });

  it("offers nothing at all from a terminal state", () => {
    for (const status of TERMINAL_STATUSES) {
      for (const actor of ACTORS) {
        expect(availableTransitions(status, actor), `${status}/${actor}`).toEqual([]);
      }
    }
  });
});

describe("invitations", () => {
  it("counts the replies", () => {
    const summary = summarizeInvitations([
      { status: "invited" },
      { status: "accepted" },
      { status: "accepted" },
      { status: "declined" },
      { status: "selected" },
      { status: "not_selected" }
    ]);

    expect(summary).toMatchObject({
      invited: 1,
      accepted: 2,
      declined: 1,
      selected: 1,
      notSelected: 1,
      hasAcceptance: true,
      hasSelection: true
    });
  });

  it("knows nobody has accepted yet", () => {
    const summary = summarizeInvitations([{ status: "invited" }, { status: "declined" }]);
    expect(summary.hasAcceptance).toBe(false);
    expect(summary.hasSelection).toBe(false);
  });

  it("survives an empty list", () => {
    expect(summarizeInvitations([]).hasAcceptance).toBe(false);
  });

  it("only lets a mentor who accepted be chosen", () => {
    expect(canSelectInvitation("accepted")).toBe(true);
    for (const status of ["invited", "declined", "selected", "not_selected", "withdrawn"]) {
      expect(canSelectInvitation(status), status).toBe(false);
    }
  });

  it("lets a mentor change their mind until a decision is made", () => {
    expect(canMentorRespond("invited")).toBe(true);
    expect(canMentorRespond("accepted")).toBe(true);
    expect(canMentorRespond("declined")).toBe(true);
    // Once the organisers have decided, the mentor's link is spent.
    expect(canMentorRespond("selected")).toBe(false);
    expect(canMentorRespond("not_selected")).toBe(false);
  });

  it("labels every status in Vietnamese", () => {
    expect(invitationStatusLabel("not_selected")).toBe("Chưa xếp được lịch");
    expect(requestStatusLabel("inviting")).toBe("Đang mời mentor");
    // An unrecognised value shows as itself rather than blank.
    expect(requestStatusLabel("rac")).toBe("rac");
  });
});

describe("nextStatusAfterResponse", () => {
  it("moves to selecting as soon as one mentor accepts", () => {
    const summary = summarizeInvitations([{ status: "accepted" }]);
    expect(nextStatusAfterResponse("inviting", summary)).toBe("selecting");
  });

  it("leaves the request alone while everybody has declined", () => {
    const summary = summarizeInvitations([{ status: "declined" }, { status: "declined" }]);
    expect(nextStatusAfterResponse("inviting", summary)).toBeNull();
  });

  it("never moves a request that is not out for invitations", () => {
    const summary = summarizeInvitations([{ status: "accepted" }]);
    for (const status of ["submitted", "approved", "selecting", "scheduled", "completed"]) {
      expect(nextStatusAfterResponse(status, summary), status).toBeNull();
    }
  });
});

describe("being passed over twice", () => {
  it("rests a mentor at two, not before", () => {
    expect(MAX_TIMES_PASSED_OVER).toBe(2);
    expect(shouldExcludeFromSweep(0)).toBe(false);
    expect(shouldExcludeFromSweep(1)).toBe(false);
    expect(shouldExcludeFromSweep(2)).toBe(true);
    expect(shouldExcludeFromSweep(5)).toBe(true);
  });

  it("treats nonsense as no history rather than as a reason to exclude", () => {
    for (const value of [null, undefined, "", "hai", Number.NaN, -1]) {
      expect(shouldExcludeFromSweep(value), String(value)).toBe(false);
    }
  });

  it("splits a candidate pool and hands back both halves", () => {
    const candidates = [
      { personId: "p1" },
      { personId: "p2" },
      { personId: "p3" }
    ];
    const counts = new Map([
      ["p1", 0],
      ["p2", 2],
      ["p3", 1]
    ]);

    const { invite, rested } = partitionSweepCandidates(candidates, counts);

    // Both halves are returned so the screen can say how many were rested,
    // rather than silently mailing fewer people than expected.
    expect(invite.map((row) => row.personId)).toEqual(["p1", "p3"]);
    expect(rested.map((row) => row.personId)).toEqual(["p2"]);
  });

  it("invites a mentor with no history at all", () => {
    const { invite } = partitionSweepCandidates([{ personId: "new" }], new Map());
    expect(invite).toHaveLength(1);
  });
});
