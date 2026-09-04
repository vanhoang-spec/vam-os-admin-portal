/** @vitest-environment jsdom */
/**
 * Reviewer Pool and label behaviour for privileged recruitment staff.
 *
 * The Owner decision is that an ACTIVE core_team / admin / super_admin account
 * is intrinsically authorised to screen profiles and to interview. The screen
 * must therefore STATE that right, not offer to grant it: the previous UI
 * showed "Cấp Interviewer" for exactly these accounts, and pressing it failed
 * with a database constraint error every time.
 *
 * The risky half is the inverse — an operator must still be able to grant and
 * revoke participation for EXTERNAL standalone reviewers — so both directions
 * are asserted here.
 */
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { describe, expect, it, afterEach, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ ok: false, message: null }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() })
}));
vi.mock("@/app/actions/enable-reviewer", () => ({
  enableMentorAsReviewerAction: vi.fn()
}));

import { ReviewerPoolClient } from "@/app/reviews/reviewer-pool/reviewer-pool-client";
import {
  adminRoleLabel,
  applicationSourceLabel,
  applicationStatusLabel,
  hasIntrinsicRecruitmentRights,
  staffDisplayLabel,
  staffDisplayName
} from "@/lib/ui-labels";
import type { ReviewerPoolRow } from "@/lib/types";

afterEach(cleanup);

const SEASON = "11111111-1111-1111-1111-111111111111";

function row(over: Partial<ReviewerPoolRow>): ReviewerPoolRow {
  return {
    mentor_profile_id: null,
    person_id: "p-1",
    full_name: "Người Dùng",
    email_primary: "user@example.com",
    mentor_code: null,
    intake_batch_id: null,
    admin_user_id: "au-1",
    admin_user_role: "core_team",
    admin_user_status: "active",
    ...over
  } as ReviewerPoolRow;
}

/**
 * `activeReviewerIds` / `activeInterviewerIds` are what the page loads from
 * vam084_list_recruitment_participants — the SAME canonical source the
 * assignment dropdowns read. Passing them explicitly is what makes these tests
 * about parity rather than about role strings.
 */
function renderPool(
  rows: ReviewerPoolRow[],
  opts: { seasonId?: string | null; reviewerIds?: string[]; interviewerIds?: string[] } = {}
) {
  return render(
    <ReviewerPoolClient
      rows={rows}
      seasonId={opts.seasonId === undefined ? SEASON : opts.seasonId}
      activeReviewerIds={opts.reviewerIds ?? []}
      activeInterviewerIds={opts.interviewerIds ?? []}
    />
  );
}

/** The row whose visible name contains `name`. */
function rowFor(name: string) {
  const cell = screen.getByText(name);
  const tr = cell.closest("tr");
  expect(tr).not.toBeNull();
  return within(tr as HTMLElement);
}

describe("A. the intrinsic badge follows CANONICAL eligibility, not role alone", () => {
  const privileged: Array<[string, string]> = [
    ["core_team", "Ban Điều hành"],
    ["admin", "Quản trị viên"],
    ["super_admin", "Quản trị viên cấp cao"]
  ];

  for (const [role, label] of privileged) {
    it(`${role} WITH target-season eligibility shows both rights and no grant controls`, () => {
      renderPool([row({ admin_user_role: role, full_name: `Staff ${role}` })], {
        reviewerIds: ["au-1"],
        interviewerIds: ["au-1"]
      });
      const r = rowFor(`Staff ${role}`);

      const rights = within(r.getByTestId("intrinsic-rights"));
      expect(rights.getByText("Đánh giá hồ sơ: Có quyền theo vai trò")).toBeDefined();
      expect(rights.getByText("Phỏng vấn: Có quyền theo vai trò")).toBeDefined();
      expect(rights.getByText(new RegExp(label))).toBeDefined();
      expect(r.getByTestId("intrinsic-rights").textContent ?? "").not.toContain(role);

      // Nothing can grant or revoke what the role already confers.
      expect(r.queryByRole("button")).toBeNull();
      for (const forbidden of [/Cấp\s+Reviewer/i, /Thu hồi\s+Reviewer/i, /Cấp\s+Interviewer/i, /Thu hồi\s+Interviewer/i]) {
        expect(r.queryByText(forbidden)).toBeNull();
      }
    });
  }

  it("B. a privileged account WITHOUT target-season eligibility is never shown as eligible", () => {
    // The Lê Thu Vân case: HAM Core Team, visible to a Super Admin because
    // visibility spans programmes, and correctly NOT a UEHM-S12 participant.
    // The canonical source omits her, so the pool must not claim otherwise.
    renderPool([row({ admin_user_role: "core_team", full_name: "HAM Core Team" })], {
      reviewerIds: [],
      interviewerIds: []
    });
    const r = rowFor("HAM Core Team");

    expect(r.queryByTestId("intrinsic-rights")).toBeNull();
    expect(r.queryByText(/Có quyền theo vai trò/)).toBeNull();
    expect(r.getByTestId("intrinsic-rights-none")).toBeDefined();
    expect(r.getByText("Không thuộc phạm vi đợt tuyển này")).toBeDefined();
    // Out of scope is not a participation gap: offer nothing to grant.
    expect(r.queryByRole("button")).toBeNull();
  });

  it("B. visibility scope is never reused as recruitment eligibility", () => {
    // Two accounts identical in role and status; only canonical membership
    // differs. Were the badge derived from role/status the two would render
    // identically, which is precisely the defect this asserts against.
    renderPool(
      [
        row({ admin_user_id: "au-in", person_id: "p-in", full_name: "UEHM Core Team" }),
        row({ admin_user_id: "au-out", person_id: "p-out", full_name: "HAM Core Team" })
      ],
      { reviewerIds: ["au-in"], interviewerIds: ["au-in"] }
    );

    expect(rowFor("UEHM Core Team").getByTestId("intrinsic-rights")).toBeDefined();
    expect(rowFor("HAM Core Team").queryByTestId("intrinsic-rights")).toBeNull();
    expect(rowFor("HAM Core Team").getByTestId("intrinsic-rights-none")).toBeDefined();
  });

  it("C. the pool's intrinsic-eligible IDs match the dropdown's IDs exactly", () => {
    // The dropdown is built from these same arrays, so agreeing with them IS
    // agreeing with the Interview selector.
    const eligible = ["au-a", "au-c"];
    renderPool(
      [
        row({ admin_user_id: "au-a", person_id: "p-a", full_name: "Eligible A" }),
        row({ admin_user_id: "au-b", person_id: "p-b", full_name: "Ineligible B" }),
        row({ admin_user_id: "au-c", person_id: "p-c", full_name: "Eligible C" })
      ],
      { reviewerIds: eligible, interviewerIds: eligible }
    );

    const shown = ["Eligible A", "Ineligible B", "Eligible C"].filter(
      (name) => rowFor(name).queryByTestId("intrinsic-rights") !== null
    );
    expect(shown).toEqual(["Eligible A", "Eligible C"]);
  });

  it("no batch selected: eligibility is unknown, so nothing is claimed", () => {
    renderPool([row({ admin_user_role: "core_team", full_name: "Chưa Chọn Đợt" })], {
      seasonId: null
    });
    const r = rowFor("Chưa Chọn Đợt");
    expect(r.queryByTestId("intrinsic-rights")).toBeNull();
    expect(r.queryByText(/Có quyền theo vai trò/)).toBeNull();
    expect(r.getByTestId("intrinsic-rights-unknown")).toBeDefined();
  });

  it("an INACTIVE privileged account is not treated as role-eligible", () => {
    renderPool(
      [row({ admin_user_role: "core_team", admin_user_status: "inactive", full_name: "Tạm Khóa" })],
      { reviewerIds: ["au-1"], interviewerIds: ["au-1"] }
    );
    const r = rowFor("Tạm Khóa");
    expect(r.queryByTestId("intrinsic-rights")).toBeNull();
  });

  it("an EXTERNAL standalone reviewer keeps its grant/revoke controls", () => {
    renderPool([row({ admin_user_role: "reviewer", full_name: "Reviewer Ngoài", person_id: "p-ext" })]);
    const r = rowFor("Reviewer Ngoài");

    expect(r.queryByTestId("intrinsic-rights")).toBeNull();
    expect(r.getAllByRole("button").length).toBeGreaterThanOrEqual(2);
  });

  it("an account with no admin_users row keeps its grant controls", () => {
    renderPool([
      row({ admin_user_id: null, admin_user_role: null, admin_user_status: null, full_name: "Chưa Có Tài Khoản" })
    ]);
    const r = rowFor("Chưa Có Tài Khoản");
    expect(r.queryByTestId("intrinsic-rights")).toBeNull();
    expect(r.getAllByRole("button").length).toBeGreaterThanOrEqual(2);
  });
});

describe("F. no English recruitment vocabulary survives in the pool", () => {
  it("grant controls and status chips read in Vietnamese", () => {
    // Both control models must be on screen at once: the grant buttons come
    // from the standalone reviewer, the "Quản trị / Ban Điều hành" chip from a
    // privileged row.
    const { container } = renderPool([
      row({ admin_user_id: "au-ext", person_id: "p-ext", admin_user_role: "reviewer", full_name: "Reviewer Ngoài" }),
      row({ admin_user_id: "au-priv", person_id: "p-priv", admin_user_role: "core_team", full_name: "Ban Điều Hành" })
    ]);
    const text = container.textContent ?? "";

    for (const forbidden of [
      "Reviewer active",
      "Reviewer inactive",
      "Cấp Reviewer",
      "Thu hồi Reviewer",
      "Cấp Interviewer",
      "Thu hồi Interviewer",
      "Mentor code",
      "Profile Screening",
      "(Interview)"
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }

    expect(text).toContain("Cấp quyền đánh giá");
    expect(text).toContain("Cấp quyền phỏng vấn");
    expect(text).toContain("Mã Mentor");
    expect(text).toContain("Đang có quyền đánh giá");
    expect(text).toContain("Đã thu hồi quyền đánh giá");
    expect(text).toContain("Quản trị / Ban Điều hành");
  });

  it("E. no raw platform role suffix is rendered anywhere in the pool", () => {
    const { container } = renderPool(
      [
        row({ admin_user_id: "au-a", person_id: "p-a", admin_user_role: "core_team", full_name: "A" }),
        row({ admin_user_id: "au-b", person_id: "p-b", admin_user_role: "admin", full_name: "B" }),
        row({ admin_user_id: "au-c", person_id: "p-c", admin_user_role: "super_admin", full_name: "C" })
      ],
      { reviewerIds: ["au-a", "au-b", "au-c"], interviewerIds: ["au-a", "au-b", "au-c"] }
    );
    const text = container.textContent ?? "";
    for (const raw of ["(super_admin)", "(admin)", "(core_team)", "super_admin", "core_team"]) {
      expect(text, raw).not.toContain(raw);
    }
    expect(text).toContain("Ban Điều hành");
    expect(text).toContain("Quản trị viên cấp cao");
  });
});

describe("hasIntrinsicRecruitmentRights", () => {
  it("is true only for an ACTIVE privileged role", () => {
    for (const role of ["core_team", "admin", "super_admin"]) {
      expect(hasIntrinsicRecruitmentRights({ role, status: "active" })).toBe(true);
      expect(hasIntrinsicRecruitmentRights({ role, status: "inactive" })).toBe(false);
    }
    for (const role of ["reviewer", "viewer", "support_team", "", null]) {
      expect(hasIntrinsicRecruitmentRights({ role, status: "active" })).toBe(false);
    }
  });
});

describe("J. human name display precedence", () => {
  it("people.full_name wins over admin full_name and email", () => {
    expect(
      staffDisplayName({
        peopleFullName: "Đặng Phạm Minh Loan",
        adminFullName: "Loan D",
        email: "dangminhloan@yahoo.com"
      })
    ).toBe("Đặng Phạm Minh Loan");
  });

  it("admin full_name is used when there is no people row", () => {
    expect(
      staffDisplayName({ peopleFullName: null, adminFullName: "Loan D", email: "x@y.com" })
    ).toBe("Loan D");
  });

  it("email is the LAST resort, never preferred over a real name", () => {
    expect(staffDisplayName({ peopleFullName: "  ", adminFullName: "", email: "x@y.com" })).toBe(
      "x@y.com"
    );
  });

  it("whitespace-only names do not win", () => {
    expect(
      staffDisplayName({ peopleFullName: "   ", adminFullName: "  Real Name ", email: "x@y.com" })
    ).toBe("Real Name");
  });

  it("the composed label reads as a name and a Vietnamese role", () => {
    expect(
      staffDisplayLabel({
        peopleFullName: "Đặng Phạm Minh Loan",
        email: "dangminhloan@yahoo.com",
        role: "core_team"
      })
    ).toBe("Đặng Phạm Minh Loan — Ban Điều hành");
    // The failing example from the Owner report must not reappear.
    expect(
      staffDisplayLabel({ peopleFullName: "Đặng Phạm Minh Loan", email: "dangminhloan@yahoo.com", role: "core_team" })
    ).not.toContain("core_team");
  });
});

describe("Vietnamese role vocabulary", () => {
  it("maps every staff role", () => {
    expect(adminRoleLabel("core_team")).toBe("Ban Điều hành");
    expect(adminRoleLabel("admin")).toBe("Quản trị viên");
    expect(adminRoleLabel("super_admin")).toBe("Quản trị viên cấp cao");
    expect(adminRoleLabel("reviewer")).toBe("Người đánh giá hồ sơ");
  });
});

describe("K. status and source labels are display-only; DB values unchanged", () => {
  const cases: Array<[string, string]> = [
    ["submitted", "Đã nộp / Chờ xử lý"],
    ["invited_to_interview", "Mời phỏng vấn"],
    ["interview_completed", "Hoàn tất phỏng vấn"],
    ["approved_as_mentor", "Đã duyệt — Mentor"],
    ["approved_as_mentee", "Đã duyệt — Mentee"],
    ["rejected_or_not_fit", "Không phù hợp"]
  ];

  for (const [raw, label] of cases) {
    it(`${raw} displays as "${label}" while the value stays "${raw}"`, () => {
      expect(applicationStatusLabel(raw)).toBe(label);
      // The label is a rendering, not a rename: it must never be mistaken for
      // the value, or a filter built from it would stop matching the column.
      expect(applicationStatusLabel(raw)).not.toBe(raw);
    });
  }

  it("known sources are labelled without changing their DB values", () => {
    expect(applicationSourceLabel("vam_os_form")).toBe("Form VAM OS");
    expect(applicationSourceLabel("s12_mentor_renewal")).toBe("Gia hạn Mentor Mùa 12");
  });

  it("an unmapped value degrades to something readable rather than blank", () => {
    expect(applicationStatusLabel("some_future_status")).toBeTruthy();
    expect(applicationSourceLabel("unknown_source")).toBeTruthy();
  });

  it("the applications filter keeps RAW enum values as its option values", () => {
    // Guards the contract the page relies on: display is localized, `value` is
    // the raw enum the column holds.
    const rawStatuses = cases.map(([raw]) => raw);
    const options = rawStatuses.map((value) => ({ value, label: applicationStatusLabel(value) }));
    for (const option of options) {
      expect(rawStatuses).toContain(option.value);
      expect(option.value).toMatch(/^[a-z_]+$/);
      expect(option.label).not.toMatch(/^[a-z_]+$/);
    }
  });
});
