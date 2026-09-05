/** @vitest-environment jsdom */
/**
 * CÔNG VIỆC CỦA TÔI — the personal recruitment work inbox.
 *
 * The design claim under test is that My Work is a VIEW of
 * `application_reviews` and never a copy of it. Every behavioural requirement
 * — cancellation, reassignment, completion — is therefore asserted by changing
 * the CANONICAL row and checking the inbox followed, rather than by calling
 * some My Work mutation. If a parallel task store ever appears, these tests
 * are the ones that should start failing.
 *
 * Where a case can be proved against pure domain code it is, because that is
 * where an off-by-one in a deadline or a missing assignee filter actually
 * lives. The cases that are genuinely about the SCREEN — scope forwarding,
 * and keeping the operator's place when the detail drawer opens — render the
 * real components.
 */
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { describe, expect, test, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const routerMock = { back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  })
}));

vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/data", () => ({
  getMyApplicationReviews: vi.fn(),
  getApplications: vi.fn()
}));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({ scopeError: null, globalRole: "reviewer" })),
  getScopeFilter: vi.fn(async () => SCOPE)
}));

import {
  buildMyWorkItems,
  summarize,
  filterMyWorkItems,
  bucketFor,
  actionLabel,
  isOverdue,
  isDueSoon,
  applicantRoleLabel,
  myWorkKind,
  MY_WORK_DUE_SOON_MS,
  type MyWorkSourceApplication,
  type MyWorkSourceReview
} from "@/lib/my-work";
import { MyWorkClient } from "@/app/my-work/my-work-client";
import { WorkDrawer } from "@/app/my-work/work-drawer";
import MyWorkPage from "@/app/my-work/page";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getMyApplicationReviews, getApplications } from "@/lib/data";
import { getScopeFilter } from "@/lib/program-scope";

const SCOPE = { seasonIds: ["season-s12"], programIds: ["prog-uehm"] } as never;

const USER_A = "admin-user-a";
const USER_B = "admin-user-b";
const NOW = new Date("2026-09-05T00:00:00.000Z");

function review(overrides: Partial<MyWorkSourceReview> = {}): MyWorkSourceReview {
  return {
    id: "rev-1",
    application_id: "app-1",
    review_round: "profile_screening",
    reviewer_admin_user_id: USER_A,
    status: "assigned",
    due_at: "2026-09-30T00:00:00.000Z",
    ...overrides
  };
}

function apps(...entries: MyWorkSourceApplication[]) {
  return new Map(entries.map((entry) => [entry.id, entry]));
}

const APP_MENTEE: MyWorkSourceApplication = { id: "app-1", full_name: "Nguyễn Văn A", role_applied: "mentee" };
const APP_MENTOR: MyWorkSourceApplication = { id: "app-2", full_name: "Trần Thị B", role_applied: "mentor" };

function build(reviews: MyWorkSourceReview[], assignee = USER_A, now = NOW) {
  return buildMyWorkItems({
    reviews,
    applications: apps(APP_MENTEE, APP_MENTOR),
    assigneeAdminUserId: assignee,
    now
  });
}

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

// ── 1. personal scoping ─────────────────────────────────────────────────────
describe("1. a user cannot see another user's assignment", () => {
  test("a row assigned to user B is dropped from user A's inbox", () => {
    const items = build([
      review({ id: "rev-a", reviewer_admin_user_id: USER_A }),
      review({ id: "rev-b", reviewer_admin_user_id: USER_B })
    ]);
    expect(items.map((item) => item.reviewId)).toEqual(["rev-a"]);
  });

  test("the same row set produces DISJOINT inboxes for the two users", () => {
    const rows = [
      review({ id: "rev-a", reviewer_admin_user_id: USER_A }),
      review({ id: "rev-b", reviewer_admin_user_id: USER_B })
    ];
    expect(build(rows, USER_A).map((i) => i.reviewId)).toEqual(["rev-a"]);
    expect(build(rows, USER_B).map((i) => i.reviewId)).toEqual(["rev-b"]);
  });

  test("an unassigned row belongs to nobody's inbox", () => {
    expect(build([review({ reviewer_admin_user_id: null })])).toEqual([]);
  });

  test("a blank assignee id yields an empty inbox rather than everything", () => {
    // The guard that matters if a caller ever loses the current user: failing
    // OPEN here would show one account every assignment in scope.
    //
    // The row with a BLANK assignee is the load-bearing half. Every other row
    // is already rejected by the per-row identity check, so a suite without
    // this row passes even with the empty-id guard deleted — and the one shape
    // that would then slip through is a canonical row whose assignee column is
    // an empty string being matched by an empty current user.
    const items = buildMyWorkItems({
      reviews: [
        review(),
        review({ id: "rev-b", reviewer_admin_user_id: USER_B }),
        review({ id: "rev-blank", reviewer_admin_user_id: "" })
      ],
      applications: apps(APP_MENTEE),
      assigneeAdminUserId: "",
      now: NOW
    });
    expect(items).toEqual([]);
  });

  test("super admin is not special-cased: the page filters by account, not role", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: USER_A, role: "super_admin" } as never);
    vi.mocked(getMyApplicationReviews).mockResolvedValue({ data: [], error: null } as never);
    vi.mocked(getApplications).mockResolvedValue({ data: [], error: null } as never);

    await MyWorkPage();

    // The personal id is what reaches the query — not a role-widened read.
    expect(vi.mocked(getMyApplicationReviews)).toHaveBeenCalledWith(USER_A, SCOPE);
  });
});

// ── 2 & 3. both assignment kinds appear automatically ───────────────────────
describe("2/3. assignments appear automatically from canonical rows", () => {
  test("2. a profile-screening assignment appears with no My Work write", () => {
    const items = build([review({ id: "rev-p", review_round: "profile_screening" })]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("profile");
    expect(items[0].kindLabel).toBe("Đánh giá hồ sơ");
  });

  test("3. an interview assignment appears with no My Work write", () => {
    const items = build([review({ id: "rev-i", review_round: "interview" })]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("interview");
    expect(items[0].kindLabel).toBe("Phỏng vấn");
  });

  test("a self-claimed interview row is indistinguishable from an assigned one", () => {
    // lib/interview-claim.ts inserts status "in_progress" with claim_source
    // "self_claim". My Work must surface it the same way — it is work this
    // account owes either way.
    const items = build([
      review({ id: "rev-claim", review_round: "interview", status: "in_progress" })
    ]);
    expect(items[0].kind).toBe("interview");
    expect(items[0].bucket).toBe("doing");
    expect(items[0].actionLabel).toBe("Tiếp tục");
  });

  test("both kinds carry applicant name and Mentor/Mentee role", () => {
    const items = build([
      review({ id: "rev-p", application_id: "app-1", review_round: "profile_screening" }),
      review({ id: "rev-i", application_id: "app-2", review_round: "interview" })
    ]);
    const byId = new Map(items.map((item) => [item.reviewId, item]));
    expect(byId.get("rev-p")!.applicantName).toBe("Nguyễn Văn A");
    expect(byId.get("rev-p")!.applicantRole).toBe("Mentee");
    expect(byId.get("rev-i")!.applicantName).toBe("Trần Thị B");
    expect(byId.get("rev-i")!.applicantRole).toBe("Mentor");
  });

  test("a round that is not recruitment work is ignored", () => {
    expect(build([review({ review_round: "some_future_round" })])).toEqual([]);
    expect(myWorkKind("some_future_round")).toBeNull();
  });

  test("an unknown applicant role is left blank rather than guessed", () => {
    expect(applicantRoleLabel("")).toBeNull();
    expect(applicantRoleLabel("staff")).toBeNull();
    expect(applicantRoleLabel(null)).toBeNull();
  });
});

// ── 4. cancellation ─────────────────────────────────────────────────────────
describe("4. a cancelled assignment is not actionable", () => {
  test("a cancelled row disappears from the inbox entirely", () => {
    const items = build([
      review({ id: "rev-live", status: "assigned" }),
      review({ id: "rev-dead", status: "cancelled" })
    ]);
    expect(items.map((item) => item.reviewId)).toEqual(["rev-live"]);
  });

  test("cancelling the canonical row is what removes it — nothing else changes", () => {
    const before = build([review({ id: "rev-x", status: "in_progress" })]);
    expect(before).toHaveLength(1);
    const after = build([review({ id: "rev-x", status: "cancelled" })]);
    expect(after).toHaveLength(0);
  });

  test("a cancelled row is never late, so it cannot leak in through Quá hạn", () => {
    expect(isOverdue("2020-01-01T00:00:00.000Z", "cancelled", NOW)).toBe(false);
    expect(summarize(build([review({ status: "cancelled", due_at: "2020-01-01T00:00:00.000Z" })]))).toEqual({
      todo: 0,
      doing: 0,
      overdue: 0,
      done: 0
    });
  });
});

// ── 5. reassignment ─────────────────────────────────────────────────────────
describe("5. reassignment moves the item to the new assignee", () => {
  test("changing reviewer_admin_user_id moves the item between inboxes", () => {
    const assignedToA = [review({ id: "rev-move", reviewer_admin_user_id: USER_A })];
    expect(build(assignedToA, USER_A)).toHaveLength(1);
    expect(build(assignedToA, USER_B)).toHaveLength(0);

    // The ONLY change is the canonical assignee column.
    const assignedToB = [review({ id: "rev-move", reviewer_admin_user_id: USER_B })];
    expect(build(assignedToB, USER_A)).toHaveLength(0);
    expect(build(assignedToB, USER_B)).toHaveLength(1);
  });
});

// ── 6. completion ───────────────────────────────────────────────────────────
describe("6. submitted work changes status correctly", () => {
  test("assigned → Cần làm / Mở", () => {
    const item = build([review({ status: "assigned" })])[0];
    expect(item.bucket).toBe("todo");
    expect(item.statusLabel).toBe("Chưa bắt đầu");
    expect(item.actionLabel).toBe("Mở");
  });

  test("in_progress → Đang làm / Tiếp tục", () => {
    const item = build([review({ status: "in_progress" })])[0];
    expect(item.bucket).toBe("doing");
    expect(item.actionLabel).toBe("Tiếp tục");
  });

  test("submitted → Hoàn tất / Xem lại", () => {
    const item = build([review({ status: "submitted" })])[0];
    expect(item.bucket).toBe("done");
    expect(item.statusLabel).toBe("Đã nộp");
    expect(item.actionLabel).toBe("Xem lại");
  });

  test("returned_for_clarification counts as unfinished, not done", () => {
    // Work handed BACK to the assignee is still owed. Filing it under Hoàn tất
    // would hide it from the person who has to redo it.
    expect(bucketFor("returned_for_clarification")).toBe("doing");
    expect(actionLabel("returned_for_clarification")).toBe("Tiếp tục");
  });

  test("the summary follows the canonical status across a full lifecycle", () => {
    expect(summarize(build([review({ status: "assigned" })]))).toMatchObject({ todo: 1, doing: 0, done: 0 });
    expect(summarize(build([review({ status: "in_progress" })]))).toMatchObject({ todo: 0, doing: 1, done: 0 });
    expect(summarize(build([review({ status: "submitted" })]))).toMatchObject({ todo: 0, doing: 0, done: 1 });
  });
});

// ── 7. deadlines ────────────────────────────────────────────────────────────
describe("7. due_at drives overdue state", () => {
  const past = "2026-09-04T23:59:59.000Z";
  const future = "2026-09-30T00:00:00.000Z";

  test("a past deadline on live work is overdue", () => {
    const item = build([review({ due_at: past })])[0];
    expect(item.overdue).toBe(true);
    expect(item.dueSoon).toBe(false);
  });

  test("a future deadline is not overdue", () => {
    expect(build([review({ due_at: future })])[0].overdue).toBe(false);
  });

  test("no deadline is never overdue", () => {
    const item = build([review({ due_at: null })])[0];
    expect(item.overdue).toBe(false);
    expect(item.dueAt).toBeNull();
  });

  test("a submitted item is never overdue however old its deadline", () => {
    expect(build([review({ status: "submitted", due_at: past })])[0].overdue).toBe(false);
  });

  test("the boundary is strict: exactly now is not yet overdue", () => {
    expect(isOverdue(NOW.toISOString(), "assigned", NOW)).toBe(false);
    expect(isOverdue(new Date(NOW.getTime() - 1).toISOString(), "assigned", NOW)).toBe(true);
  });

  test("due-soon covers the window up to and including its edge, and no further", () => {
    const edge = new Date(NOW.getTime() + MY_WORK_DUE_SOON_MS).toISOString();
    const past_edge = new Date(NOW.getTime() + MY_WORK_DUE_SOON_MS + 1000).toISOString();
    expect(isDueSoon(edge, "assigned", NOW)).toBe(true);
    expect(isDueSoon(past_edge, "assigned", NOW)).toBe(false);
  });

  test("overdue and due-soon are mutually exclusive", () => {
    expect(isDueSoon(past, "assigned", NOW)).toBe(false);
    expect(isOverdue(past, "assigned", NOW)).toBe(true);
  });

  test("Quá hạn cross-cuts rather than emptying Cần làm", () => {
    const summary = summarize(build([review({ status: "assigned", due_at: past })]));
    expect(summary.todo).toBe(1);
    expect(summary.overdue).toBe(1);
  });

  test("overdue work sorts above work that is merely due later", () => {
    const items = build([
      review({ id: "rev-later", due_at: future }),
      review({ id: "rev-late", due_at: past })
    ]);
    expect(items.map((item) => item.reviewId)).toEqual(["rev-late", "rev-later"]);
  });

  test("undated work sorts last rather than first", () => {
    const items = build([
      review({ id: "rev-none", due_at: null }),
      review({ id: "rev-dated", due_at: future })
    ]);
    expect(items.map((item) => item.reviewId)).toEqual(["rev-dated", "rev-none"]);
  });
});

// ── 8. program/season scoping ───────────────────────────────────────────────
describe("8. program/season scoping is preserved", () => {
  beforeEach(() => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: USER_A, role: "reviewer" } as never);
    vi.mocked(getApplications).mockResolvedValue({ data: [], error: null } as never);
  });

  test("the canonical scope filter is forwarded to the assignment read", async () => {
    vi.mocked(getMyApplicationReviews).mockResolvedValue({ data: [], error: null } as never);
    await MyWorkPage();
    expect(vi.mocked(getScopeFilter)).toHaveBeenCalled();
    expect(vi.mocked(getMyApplicationReviews)).toHaveBeenCalledWith(USER_A, SCOPE);
  });

  test("the scoped application read is what supplies applicant context", async () => {
    vi.mocked(getMyApplicationReviews).mockResolvedValue({
      data: [review({ id: "rev-s", application_id: "app-1" })],
      error: null
    } as never);
    vi.mocked(getApplications).mockResolvedValue({
      data: [{ id: "app-1", full_name: "Nguyễn Văn A", role_applied: "mentee" }],
      error: null
    } as never);

    await MyWorkPage();
    expect(vi.mocked(getApplications)).toHaveBeenCalledWith(SCOPE);
  });

  test("an assignment whose application is out of scope shows no borrowed identity", () => {
    // The scoped application read returned nothing for this row, so the item
    // must render without a name rather than inventing or leaking one.
    const items = buildMyWorkItems({
      reviews: [review({ application_id: "app-out-of-scope" })],
      applications: apps(APP_MENTEE),
      assigneeAdminUserId: USER_A,
      now: NOW
    });
    expect(items).toHaveLength(1);
    expect(items[0].applicantName).toBeNull();
    expect(items[0].applicantRole).toBeNull();
  });

  test("a scope resolution failure does not fall back to an unscoped read", async () => {
    const { getAdminScopeContext } = await import("@/lib/program-scope");
    vi.mocked(getAdminScopeContext).mockResolvedValueOnce({ scopeError: "scope down" } as never);
    vi.mocked(getMyApplicationReviews).mockResolvedValue({ data: [], error: null } as never);

    await MyWorkPage();
    expect(vi.mocked(getMyApplicationReviews)).not.toHaveBeenCalled();
  });
});

// ── 9. detail opens and closes without losing the list ──────────────────────
describe("9. opening and closing the detail preserves My Work context", () => {
  const items = build([
    review({ id: "rev-p", application_id: "app-1", review_round: "profile_screening", due_at: "2026-09-30T00:00:00.000Z" }),
    review({ id: "rev-i", application_id: "app-2", review_round: "interview", due_at: "2026-10-30T00:00:00.000Z" })
  ]);

  test("the filter narrows the list by work type", () => {
    render(<MyWorkClient items={items} />);
    expect(screen.getAllByTestId("my-work-item")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("my-work-filter-interview"));
    const shown = screen.getAllByTestId("my-work-item");
    expect(shown).toHaveLength(1);
    expect(shown[0].getAttribute("data-kind")).toBe("interview");
  });

  test("the chosen filter survives the rerender that opening the drawer causes", () => {
    // The drawer is a PARALLEL slot: the list is not unmounted when it opens,
    // it is re-rendered alongside it. Filter state must therefore live in the
    // component and survive that, which is exactly what a search param would
    // not do once interception replaced the URL with the review's.
    const view = render(<MyWorkClient items={items} />);
    fireEvent.click(screen.getByTestId("my-work-filter-interview"));
    expect(screen.getAllByTestId("my-work-item")).toHaveLength(1);

    view.rerender(<MyWorkClient items={items} />);
    view.rerender(<MyWorkClient items={items} />);

    expect(screen.getByTestId("my-work-filter-interview").getAttribute("aria-pressed")).toBe("true");
    const stillShown = screen.getAllByTestId("my-work-item");
    expect(stillShown).toHaveLength(1);
    expect(stillShown[0].getAttribute("data-kind")).toBe("interview");
  });

  test("summary counts describe the whole inbox, not the active filter", () => {
    render(<MyWorkClient items={items} />);
    fireEvent.click(screen.getByTestId("my-work-filter-interview"));
    // Narrowing the view must not make the operator's backlog appear to shrink.
    expect(screen.getByTestId("my-work-summary-todo").getAttribute("data-count")).toBe("2");
  });

  test("the item action links to the canonical review route", () => {
    render(<MyWorkClient items={filterMyWorkItems(items, "profile")} />);
    const link = screen.getByTestId("my-work-item-action");
    expect(link.getAttribute("href")).toBe("/reviews/rev-p");
    expect(link.textContent).toBe("Mở");
  });

  test("closing the drawer pops the entry instead of re-navigating to the list", () => {
    render(<WorkDrawer><p>chi tiết</p></WorkDrawer>);
    fireEvent.click(screen.getByTestId("my-work-drawer-close"));

    // back() leaves the list instance mounted; push("/my-work") would remount
    // it and reset both the filter and the scroll position.
    expect(routerMock.back).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  test("the backdrop and Escape also close via back()", () => {
    render(<WorkDrawer><p>chi tiết</p></WorkDrawer>);
    fireEvent.click(screen.getByTestId("my-work-drawer-backdrop"));
    expect(routerMock.back).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(routerMock.back).toHaveBeenCalledTimes(2);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  test("the drawer restores page scrolling when it unmounts", () => {
    const view = render(<WorkDrawer><p>chi tiết</p></WorkDrawer>);
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    // Leaving the body locked would strand the list the drawer closed back to.
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  test("the drawer is a real dialog layer over the list", () => {
    render(<WorkDrawer><p>chi tiết</p></WorkDrawer>);
    const drawer = screen.getByTestId("my-work-drawer");
    expect(drawer.getAttribute("role")).toBe("dialog");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(within(drawer).getByText("chi tiết")).toBeTruthy();
  });
});

// ── 10. no parallel task persistence ────────────────────────────────────────
describe("10. My Work adds no persistence of its own", () => {
  const root = path.resolve(__dirname, "..");
  const sources = [
    "lib/my-work.ts",
    "app/my-work/page.tsx",
    "app/my-work/my-work-client.tsx",
    "app/my-work/work-drawer.tsx",
    "app/my-work/layout.tsx",
    "components/my-work-card.tsx"
  ];

  test("no My Work source performs a write of any kind", () => {
    for (const file of sources) {
      const body = fs.readFileSync(path.join(root, file), "utf8");
      // A view has no reason to reach any of these. If one appears, the "never
      // a copy" claim in the module header has stopped being true.
      expect(body).not.toMatch(/\.(insert|upsert|update|delete)\s*\(/);
      expect(body).not.toMatch(/\buse server\b/);
    }
  });

  test("no table other than the canonical recruitment reads is referenced", () => {
    const body = fs.readFileSync(path.join(root, "lib/my-work.ts"), "utf8");
    expect(body).not.toMatch(/\.from\s*\(/);
    expect(body).not.toMatch(/my_work|work_items|tasks_inbox/);
  });

  test("the feature ships no database migration", () => {
    const dir = path.join(root, "supabase", "migrations");
    const migrations = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(migrations.filter((name) => /my[_-]?work/i.test(name))).toEqual([]);
  });

  test("the inbox is derived purely from the rows it is handed", () => {
    // Same input, same output, no hidden store: two independent builds of the
    // same canonical rows must be identical.
    const rows = [review({ id: "rev-1" }), review({ id: "rev-2", review_round: "interview" })];
    expect(build(rows)).toEqual(build(rows));
  });
});
