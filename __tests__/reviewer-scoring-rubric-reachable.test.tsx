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
  it("renders all five criteria by name, with what separates a low mark from a high one", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("reviewer"));

    const html = renderToStaticMarkup(await ReviewerGuidePage());

    for (const [, label] of CRITERIA) {
      expect(html).toContain(label);
    }
    // A label alone does not tell a first-time scorer what to weigh.
    expect(html).toContain("Lý do ai viết cũng được");
    expect(html).toContain("Khó khăn đúng loại mà một người đi trước gỡ được");
    expect(html).toContain("Hướng dẫn Reviewer");
  });

  it("STORAGE_VOCABULARY_IS_NOT_REVIEWER_VOCABULARY: no field codes reach a reviewer", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("reviewer"));

    const html = renderToStaticMarkup(await ReviewerGuidePage());

    // `score_motivation` is how the column is spelled in storage and in the
    // export. A mentor reading an application has no use for it, and the
    // programme owner asked for exactly this vocabulary split after seeing
    // raw field names on the review screen.
    for (const [field] of CRITERIA) {
      expect(html).not.toContain(field);
    }
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
    // Two more sections were withheld after the owner reviewed the real
    // reviewer screen: account policy and account administration are both
    // instructions for Core Team about reviewers, not for reviewers.
    expect(html).not.toContain("Chính sách tài khoản reviewer");
    expect(html).not.toContain("Bảo mật &amp; quản trị tài khoản");
  });

  it("still serves the rubric AND the field codes to admin tiers", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("core_team"));

    const html = renderToStaticMarkup(await ReviewerGuidePage());
    // The calibration guidance is for everyone; the storage vocabulary is for
    // whoever reconciles the score export.
    expect(html).toContain("Lý do ai viết cũng được");
    for (const [field] of CRITERIA) {
      expect(html).toContain(field);
    }
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

// ─────────────────────────────────────────────────────────────────────────────
/**
 * The rubric quotes the mentee form. It has to quote it correctly.
 *
 * The five score columns are shared by every review in the system — same
 * columns for mentor and mentee, for the profile round and the interview — so
 * their descriptions were generic by necessity. Generic descriptions are what
 * let two reviewers score the same application four points apart, and Season 12
 * puts twenty-two first-time scorers on mentee screening.
 *
 * So each criterion now names the questions it is read from, quoted as the
 * applicant sees them, and these cases keep those quotes true. A question
 * reworded on the form and not here sends a reviewer hunting for text that is
 * no longer on the page in front of them.
 */
describe("the mentee rubric quotes questions that exist on the mentee form", () => {
  const guide = readFileSync(join(ROOT, "app", "reviews", "guide", "page.tsx"), "utf8");
  const menteeForm = readFileSync(
    join(ROOT, "app", "apply", "mentee", "apply-mentee-form.tsx"),
    "utf8"
  );

  /** Curly and straight quotes are the same question to a reader. */
  const normalise = (value: string) =>
    value.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // Everything the guide tells a reviewer to read, except the one entry that is
  // a scope statement rather than a question.
  const QUOTED_QUESTIONS = [
    "Vì sao bạn chọn UEH Mentoring?",
    'Mô tả "phiên bản tốt nhất của bạn sau 1 năm"',
    "Mục tiêu cụ thể bạn muốn đạt được qua mentoring (3-6 tháng)",
    "3 câu hỏi cụ thể bạn muốn hỏi mentor",
    "Kế hoạch của bạn để tận dụng mentoring",
    "Nếu mentoring không hiệu quả như mong đợi, bạn sẽ làm gì?",
    "Bạn sẵn sàng phỏng vấn 30 phút (nếu được mời) trong đợt nào?",
    "Bạn sẵn sàng tham gia kickoff event của chương trình không?",
    "Khó khăn cụ thể bạn đang cần mentor hỗ trợ",
    "Ngành nghề bạn muốn theo đuổi",
    "Chức năng / vị trí công việc bạn quan tâm",
    "Soft skills bạn muốn phát triển (chọn tối đa 3)"
  ];

  it("every question the guide quotes is a real label on the mentee form", () => {
    const form = normalise(menteeForm);
    for (const question of QUOTED_QUESTIONS) {
      expect(form).toContain(normalise(question));
    }
  });

  it("the guide really does quote each of them", () => {
    const source = normalise(guide);
    for (const question of QUOTED_QUESTIONS) {
      expect(source).toContain(normalise(question));
    }
  });

  it("each of the five scores says what separates a low mark from a high one", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("reviewer"));
    const html = renderToStaticMarkup(await ReviewerGuidePage());

    for (const [, label] of CRITERIA) {
      expect(html).toContain(label);
    }
    // Five criteria, each with both ends of the scale described.
    expect(html.match(/1–2 điểm/g)).toHaveLength(5);
    expect(html.match(/4–5 điểm/g)).toHaveLength(5);
  });

  it("calibrates against the programme's own description of who it is for", async () => {
    mocks.getCurrentAdminUser.mockResolvedValue(userForRole("reviewer"));
    const html = renderToStaticMarkup(await ReviewerGuidePage());

    // Straight from the mentee form's opening text. A reviewer calibrating
    // against "the best candidate" rejects exactly the people this programme
    // was built to take.
    expect(html).toContain("không tìm những người");
    expect(html).toContain("Không trừ điểm vì lỗi chính tả");
  });
});
