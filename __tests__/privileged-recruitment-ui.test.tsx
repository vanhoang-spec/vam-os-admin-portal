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

function renderPool(rows: ReviewerPoolRow[]) {
  return render(
    <ReviewerPoolClient
      rows={rows}
      seasonId={SEASON}
      activeReviewerIds={[]}
      activeInterviewerIds={[]}
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

describe("I. privileged staff have no participation grant controls", () => {
  const privileged: Array<[string, string]> = [
    ["core_team", "Ban Điều hành"],
    ["admin", "Quản trị viên"],
    ["super_admin", "Quản trị viên cấp cao"]
  ];

  for (const [role, label] of privileged) {
    it(`${role}: shows intrinsic-rights badges and no Cấp/Thu hồi buttons`, () => {
      renderPool([row({ admin_user_role: role, full_name: `Staff ${role}` })]);
      const r = rowFor(`Staff ${role}`);

      const rights = within(r.getByTestId("intrinsic-rights"));
      expect(rights.getByText("Đánh giá hồ sơ: Có quyền theo vai trò")).toBeDefined();
      expect(rights.getByText("Phỏng vấn: Có quyền theo vai trò")).toBeDefined();
      // The role is named in Vietnamese, and the raw enum never surfaces.
      expect(rights.getByText(new RegExp(label))).toBeDefined();
      expect(r.getByTestId("intrinsic-rights").textContent ?? "").not.toContain(role);

      // No control can grant or revoke what the role already confers.
      expect(r.queryByRole("button")).toBeNull();
      for (const forbidden of [/Cấp\s+Reviewer/i, /Thu hồi\s+Reviewer/i, /Cấp\s+Interviewer/i, /Thu hồi\s+Interviewer/i, /Cấp quyền/i, /Thu hồi quyền/i]) {
        expect(r.queryByText(forbidden)).toBeNull();
      }
    });
  }

  it("an INACTIVE privileged account is not treated as intrinsically eligible", () => {
    renderPool([
      row({ admin_user_role: "core_team", admin_user_status: "inactive", full_name: "Tạm Khóa" })
    ]);
    const r = rowFor("Tạm Khóa");
    expect(r.queryByTestId("intrinsic-rights")).toBeNull();
  });

  it("an EXTERNAL standalone reviewer keeps its grant/revoke controls", () => {
    renderPool([
      row({ admin_user_role: "reviewer", full_name: "Reviewer Ngoài", person_id: "p-ext" })
    ]);
    const r = rowFor("Reviewer Ngoài");

    expect(r.queryByTestId("intrinsic-rights")).toBeNull();
    // Two independent participation controls remain reachable.
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
