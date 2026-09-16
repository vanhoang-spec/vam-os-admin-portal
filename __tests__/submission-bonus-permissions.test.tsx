/** @vitest-environment jsdom */
/**
 * Điểm cộng theo ngày nộp — ai thấy gì, và các màn hình có thật sự nối vào không.
 *
 * Canh: bốn vai trò đặt được mốc (support_team có mặt theo quyết định 16/09/2026),
 * menu khớp đúng predicate trang tự kiểm, reviewer KHÔNG thấy điểm cộng lúc chấm,
 * và form nhập mốc gửi chữ ngày người dùng gõ (không phải một ISO rỗng khi gõ dở).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/actions/submission-bonus", () => ({
  addApplicationBonusRuleAction: vi.fn(),
  deleteApplicationBonusRuleAction: vi.fn()
}));

const formState = { current: { ok: false, message: "" } as { ok: boolean; message: string } };
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: () => [formState.current, vi.fn()],
    useFormStatus: () => ({ pending: false })
  };
});

import { AddBonusRuleForm, DeleteBonusRuleButton } from "@/app/admin/seasons-forms/bonus-points/bonus-rules-editor";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import { allNavHrefs, buildNavGroups } from "@/lib/nav-model";
import { canManageSubmissionBonus } from "@/lib/permissions";
import { SUBMISSION_BONUS_PATH } from "@/lib/submission-bonus-core";

const CARRIAGE_RETURN = String.fromCharCode(13);
const read = (path: string) => readFileSync(path, "utf8").split(CARRIAGE_RETURN).join("");

const ROLES: CurrentAdminUser["role"][] = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"];
const makeUser = (role: CurrentAdminUser["role"]): CurrentAdminUser => ({
  id: "u1",
  email: "t@vam.org",
  full_name: null,
  role,
  status: "active",
  auth_user_id: null
});

beforeEach(() => {
  formState.current = { ok: false, message: "" };
});

afterEach(() => cleanup());

describe("1. vai trò", () => {
  it("super_admin, admin, core_team, support_team: được; reviewer, viewer, rỗng: không", () => {
    expect(ROLES.filter((role) => canManageSubmissionBonus(role))).toEqual([
      "super_admin",
      "admin",
      "core_team",
      "support_team"
    ]);
    expect(canManageSubmissionBonus(null)).toBe(false);
    expect(canManageSubmissionBonus(undefined)).toBe(false);
  });

  it.each(ROLES)("menu của %s khớp đúng predicate", (role) => {
    const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
    expect(hrefs.includes(SUBMISSION_BONUS_PATH)).toBe(canManageSubmissionBonus(role));
  });

  it("support_team thấy mục trong nhóm Ứng tuyển — nhóm nó vào được, không phải Quản trị", () => {
    const groups = buildNavGroups(makeUser("support_team"));
    const applications = groups.find((group) => group.key === "applications");
    expect(applications?.items?.map((item) => item.href)).toContain(SUBMISSION_BONUS_PATH);
    expect(groups.find((group) => group.key === "admin")).toBeUndefined();
  });
});

describe("2. trang cài đặt tự kiểm quyền", () => {
  const page = read("app/admin/seasons-forms/bonus-points/page.tsx");

  it("kiểm vai trò, lỗi phạm vi, rồi quyền vận hành đúng mùa — trước khi đọc mốc", () => {
    const role = page.indexOf("canManageSubmissionBonus(admin.role)");
    const scope = page.indexOf("if (ctx.scopeError)");
    const season = page.indexOf("await canManageBonusForSeason(seasonId)");
    const rules = page.indexOf("readApplicationBonusRules([intakeBatchId])");
    expect(role).toBeGreaterThan(-1);
    expect(scope).toBeGreaterThan(role);
    expect(season).toBeGreaterThan(scope);
    expect(rules).toBeGreaterThan(season);
  });

  it("đếm đơn chỉ đọc giờ nộp và vai trò, không đọc tên hay email", () => {
    expect(page).toContain('"id,role_applied,created_at"');
    expect(page).not.toMatch(/full_name|email_primary/);
  });

  it("form dùng useFormState của react-dom, không useActionState", () => {
    const editor = read("app/admin/seasons-forms/bonus-points/bonus-rules-editor.tsx");
    expect(editor).toContain('import { useFormState } from "react-dom";');
    expect(editor).not.toContain("useActionState");
  });
});

describe("3. các màn hình chấm có nối vào", () => {
  it("hai danh sách duyệt đọc mốc và in ô điểm cộng; hàng đợi đọc created_at", () => {
    for (const role of ["mentee", "mentor"]) {
      const source = read(`app/applications/${role}-review/page.tsx`);
      expect(source).toContain("readApplicationBonusRules(");
      expect(source).toContain("bonus: bonusForApplication(bonusLookup, application)");
      expect(source).toContain("<SubmissionBonusBadge bonus={row.bonus} />");
    }
    const data = read("lib/data.ts");
    const queue = data.slice(data.indexOf("export async function getS12ApplicationReviewQueue"));
    expect(queue.slice(0, queue.indexOf("let query"))).toMatch(/const projection = "[^"]*created_at[^"]*"/);
  });

  it("trang chi tiết: bảng lịch sử, khung Core Team và ô review mới nhất đều gồm điểm cộng", () => {
    const detail = read("app/applications/[id]/page.tsx");
    expect(detail).toContain("scoreWithBonusText(review.total_score, submissionBonus)");
    expect(detail).toContain("submissionBonus={submissionBonus}");
    expect(detail).toContain("latestScoreText={scoreWithBonusText(latestSubmittedReview?.total_score, submissionBonus)}");
  });

  it("reviewer KHÔNG thấy điểm cộng khi đang chấm", () => {
    for (const path of ["app/reviews/[id]/page.tsx", "app/reviews/[id]/review-form.tsx"]) {
      expect(read(path)).not.toMatch(/submission-bonus|SubmissionBonus/);
    }
  });
});

describe("4. form nhập mốc", () => {
  it("gửi vai trò, chữ ngày đúng như gõ (có dấu /), điểm và tên", () => {
    const { container } = render(<AddBonusRuleForm role="mentee" roleLabel="mentee" />);
    const form = container.querySelector("form")!;
    fireEvent.change(screen.getByLabelText("Nộp từ ngày"), { target: { value: "01092026" } });
    fireEvent.change(screen.getByLabelText("Đến hết ngày"), { target: { value: "10092026" } });
    const data = new FormData(form);
    expect(data.get("role")).toBe("mentee");
    expect(data.get("starts_on")).toBe("01/09/2026");
    expect(data.get("ends_on")).toBe("10/09/2026");
    expect(data.get("points")).toBe("3");
    expect(data.has("label")).toBe(true);
  });

  it("gõ dở thì báo ngay, và vẫn gửi chữ gõ dở (máy chủ từ chối) chứ không gửi rỗng", () => {
    const { container } = render(<AddBonusRuleForm role="mentee" roleLabel="mentee" />);
    fireEvent.change(screen.getByLabelText("Đến hết ngày"), { target: { value: "100920" } });
    expect(container.textContent).toContain("Chưa gõ đủ ngày/tháng/năm.");
    expect(new FormData(container.querySelector("form")!).get("ends_on")).toBe("10/09/20");
  });

  it("ngày không có thật thì báo", () => {
    const { container } = render(<AddBonusRuleForm role="mentee" roleLabel="mentee" />);
    fireEvent.change(screen.getByLabelText("Nộp từ ngày"), { target: { value: "31022026" } });
    expect(container.textContent).toContain("Ngày không có thật.");
  });

  it("xoá: bấm Huỷ ở hộp hỏi lại thì không gửi", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = render(
      <DeleteBonusRuleButton role="mentee" ruleId="aaaaaaaa-0000-4000-8000-000000000001" description="Nộp đến hết 10/09/2026 → +3" />
    );
    const button = container.querySelector("button")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Nộp đến hết 10/09/2026 → +3"));
    expect(event.defaultPrevented).toBe(true);
  });

  it("xoá: bấm Đồng ý thì không chặn", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(
      <DeleteBonusRuleButton role="mentee" ruleId="aaaaaaaa-0000-4000-8000-000000000001" description="x" />
    );
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    container.querySelector("button")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
