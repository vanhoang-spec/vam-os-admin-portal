/**
 * An invited reviewer must be able to reach the scoring rubric.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG
 * ---------------------------------------------------------------------------
 * `/reviews/guide` holds the ONLY description of what the five scores mean —
 * the form itself labels them ("Động lực (1–5)") but never says what a 1 or a
 * 5 is supposed to represent. The page was written for reviewers as much as
 * for admins: it renumbers its own sections for a non-admin reader, and its
 * section 4 is titled "Hướng dẫn Reviewer".
 *
 * And yet its single link on `/reviews` sat inside the `canBulkAssign` admin
 * bar, and it appears nowhere in `lib/nav-model.ts`. A mentor invited to score
 * mentee applications logged in and had no route at all to the rubric they
 * were being asked to apply — the page existed, adapted itself for them, and
 * was unreachable.
 *
 * Season 12 was about to invite 22 volunteer mentors into exactly that.
 *
 * Classification: DIRECT PRODUCTION TESTS (render) + STRUCTURAL ASSERTION.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentAdminUser } from "../lib/auth-constants";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const mocks = vi.hoisted(() => ({
  getCurrentAdminUser: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: mocks.getCurrentAdminUser }));

import ReviewerGuidePage from "../app/reviews/guide/page";

const ROOT = join(__dirname, "..");

function userForRole(role: CurrentAdminUser["role"]): CurrentAdminUser {
  return {
    id: `${role}-1`,
    email: `${role}@example.com`,
    full_name: `${role} user`,
    role,
    status: "active"
  } as CurrentAdminUser;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

/** Every criterion the submit RPC stores, with the wording reviewers calibrate on. */
const CRITERIA = [
  ["score_motivation", "Động lực"],
  ["score_goal_clarity", "Rõ ràng mục tiêu"],
  ["score_commitment", "Cam kết"],
  ["score_fit", "Phù hợp chương trình"],
  ["score_communication", "Giao tiếp"]
] as const;

describe("the rubric is served to a standalone reviewer", () => {
  it("renders all five criteria, their field names and their descriptions", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("reviewer"));

    const html = renderToStaticMarkup(await ReviewerGuidePage());

    for (const [field, label] of CRITERIA) {
      expect(html).toContain(field);
      expect(html).toContain(label);
    }
    // A label alone does not tell a first-time scorer what to weigh; the
    // description is the part that makes two reviewers agree.
    expect(html).toContain("Mức độ chủ động, nhiệt huyết");
    expect(html).toContain("Khả năng duy trì tham gia xuyên suốt mùa");
    expect(html).toContain("Hướng dẫn Reviewer");
  });

  it("does not offer a standalone reviewer the admin-only workflows", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("reviewer"));

    const html = renderToStaticMarkup(await ReviewerGuidePage());

    // Reachable does not mean unfiltered: the page still withholds the
    // assignment and account-provisioning SECTIONS from a reviewer.
    //
    // Asserted on section titles and on the admin quick-links, not on the
    // string "/reviews/assign-bulk" — that path also appears as prose inside a
    // paragraph a reviewer legitimately sees, so matching it would have failed
    // the code for saying the right thing.
    expect(html).not.toContain("Danh sách công việc — Tạo tài khoản reviewer");
    expect(html).not.toContain("Danh sách công việc — Chia hồ sơ");
    expect(html).not.toContain('href="/reviews/progress"');
  });

  it("still serves the rubric to admin tiers", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("core_team"));

    const html = renderToStaticMarkup(await ReviewerGuidePage());
    expect(html).toContain("score_motivation");
    expect(html).toContain("/reviews/assign-bulk");
  });
});

describe("a reviewer can find the rubric without being told the URL", () => {
  const reviewsPage = readFileSync(join(ROOT, "app", "reviews", "page.tsx"), "utf8");
  const reviewDetail = readFileSync(join(ROOT, "app", "reviews", "[id]", "page.tsx"), "utf8");

  it("the queue links to the guide OUTSIDE the admin-only bar", () => {
    const adminBarStart = reviewsPage.indexOf("{canBulkAssign && (");
    expect(adminBarStart).toBeGreaterThan(-1);

    const guideLink = reviewsPage.indexOf('href="/reviews/guide"');
    expect(guideLink).toBeGreaterThan(-1);
    // The whole defect in one assertion: the only link used to live after this
    // marker, so it rendered for admins and for nobody else.
    expect(guideLink).toBeLessThan(adminBarStart);
  });

  it("the scoring screen itself points at the criteria descriptions", () => {
    // This is where a reviewer actually is when the question "what does a 4
    // mean here?" arises.
    expect(reviewDetail).toContain('href="/reviews/guide"');
  });
});
