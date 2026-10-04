/** @vitest-environment jsdom */
/**
 * Bốn nhóm quyền tuyển sinh trên trang "Danh sách nhân sự tuyển sinh" (BTC 04/10/2026):
 * chấm hồ sơ mentee · phỏng vấn mentee (BTC + Support cấp) · chấm hồ sơ mentor ·
 * phỏng vấn mentor (chỉ Ban điều hành cấp). Mỗi nhóm một nút, cấp / thu độc lập.
 */
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: vi.fn(() => [{ ok: false, message: null }, vi.fn()]),
    useFormStatus: vi.fn(() => ({ pending: false }))
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/enable-reviewer", () => ({ enableMentorAsReviewerAction: vi.fn() }));

import { ReviewerPoolClient } from "@/app/reviews/reviewer-pool/reviewer-pool-client";
import {
  PARTICIPATION_GROUPS,
  canGrantParticipation,
  isParticipationRole,
  normalizeAppliedRole,
  participationRoleFor
} from "@/lib/recruitment-permissions-core";
import type { ReviewerPoolRow } from "@/lib/types";

afterEach(cleanup);

const SEASON = "11111111-1111-1111-1111-111111111111";
const mentor = (over: Partial<ReviewerPoolRow> = {}): ReviewerPoolRow => ({
  mentor_profile_id: null,
  person_id: "p-1",
  full_name: "Mentor Một",
  email_primary: "m1@example.com",
  mentor_code: null,
  intake_batch_id: null,
  admin_user_id: "au-1",
  admin_user_role: "reviewer",
  admin_user_status: "active",
  ...over
} as ReviewerPoolRow);

function renderPool(activeIds: Partial<Record<string, string[]>>, canGrantMentor: boolean) {
  return render(
    <ReviewerPoolClient
      rows={[mentor()]}
      seasonId={SEASON}
      activeIds={{ reviewer: [], interviewer: [], mentor_reviewer: [], mentor_interviewer: [], ...activeIds }}
      canGrantMentor={canGrantMentor}
    />
  );
}
/** Các form cấp / thu trong dòng: [nhóm quyền, thao tác, chữ trên nút]. */
function forms() {
  return Array.from(document.querySelectorAll("form")).map((f) => [
    (f.querySelector('input[name="participation_role"]') as HTMLInputElement).value,
    (f.querySelector('input[name="operation"]') as HTMLInputElement).value,
    f.querySelector("button")?.textContent
  ]);
}

describe("phần thuần", () => {
  it("bốn nhóm, đúng (vòng, hồ sơ) và đúng người được cấp", () => {
    expect(PARTICIPATION_GROUPS.map((g) => [g.role, g.stage, g.applied, g.coreOnly])).toEqual([
      ["reviewer", "profile_screening", "mentee", false],
      ["interviewer", "interview", "mentee", false],
      ["mentor_reviewer", "profile_screening", "mentor", true],
      ["mentor_interviewer", "interview", "mentor", true]
    ]);
    expect(participationRoleFor("profile_screening", "mentor")).toBe("mentor_reviewer");
    expect(participationRoleFor("interview", "mentee")).toBe("interviewer");
  });

  it("support cấp được hai nhóm mentee, không cấp được hai nhóm mentor; core team cấp được cả bốn", () => {
    expect(canGrantParticipation("support_team", "reviewer")).toBe(true);
    expect(canGrantParticipation("support_team", "interviewer")).toBe(true);
    expect(canGrantParticipation("support_team", "mentor_reviewer")).toBe(false);
    expect(canGrantParticipation("support_team", "mentor_interviewer")).toBe(false);
    for (const g of PARTICIPATION_GROUPS) expect(canGrantParticipation("core_team", g.role)).toBe(true);
    for (const g of PARTICIPATION_GROUPS) expect(canGrantParticipation("reviewer", g.role)).toBe(false);
  });

  it("chỉ nhận đúng 4 giá trị; hồ sơ không rõ mentor/mentee thì trả null (nơi gọi từ chối)", () => {
    expect(["reviewer", "interviewer", "mentor_reviewer", "mentor_interviewer"].every(isParticipationRole)).toBe(true);
    expect(isParticipationRole("mentor")).toBe(false);
    expect(isParticipationRole("admin")).toBe(false);
    expect(normalizeAppliedRole(" Mentee ")).toBe("mentee");
    expect(normalizeAppliedRole("supporter")).toBeNull();
    expect(normalizeAppliedRole(null)).toBeNull();
  });
});

describe("bảng cấp quyền", () => {
  it("Ban điều hành: 4 nút, mỗi nút gửi đúng nhóm; có nhóm này không làm nút nhóm khác thành Thu hồi", () => {
    renderPool({ interviewer: ["au-1"], mentor_reviewer: ["au-1"] }, true);
    expect(forms()).toEqual([
      ["reviewer", "grant", "Cấp quyền chấm hồ sơ mentee"],
      ["interviewer", "revoke", "Thu hồi quyền phỏng vấn mentee"],
      ["mentor_reviewer", "revoke", "Thu hồi quyền chấm hồ sơ mentor"],
      ["mentor_interviewer", "grant", "Cấp quyền phỏng vấn mentor"]
    ]);
    const mentee = within(screen.getByTestId("participation-mentee"));
    expect(mentee.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Cấp quyền chấm hồ sơ mentee",
      "Thu hồi quyền phỏng vấn mentee"
    ]);
  });

  it("Support: chỉ có nút hai nhóm mentee; hai nhóm mentor chỉ hiện trạng thái, không có form", () => {
    renderPool({ mentor_interviewer: ["au-1"] }, false);
    expect(forms().map(([role]) => role)).toEqual(["reviewer", "interviewer"]);
    expect(screen.getByTestId("state-mentor_reviewer").textContent).toBe("Chấm hồ sơ mentor: Chưa · Ban điều hành cấp");
    expect(screen.getByTestId("state-mentor_interviewer").textContent).toBe("Phỏng vấn mentor: Có · Ban điều hành cấp");
    expect(within(screen.getByTestId("participation-mentor")).queryAllByRole("button")).toHaveLength(0);
  });
});
