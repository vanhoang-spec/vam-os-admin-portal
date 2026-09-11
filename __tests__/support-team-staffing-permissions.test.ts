/**
 * Support team mời reviewer và giao hồ sơ — quyết định của chủ chương trình
 * ngày 11/09/2026.
 *
 * Quyết định nói đúng hai việc. Nguy hiểm của một thay đổi phân quyền không nằm
 * ở hai việc được mở, mà ở những việc bên cạnh bị mở theo mà không ai để ý: xem
 * điểm, tải file kết quả, chốt tuyển, cấu hình vòng chấm. File này ghim cả hai
 * phía.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CurrentAdminUser } from "@/lib/auth-constants";
import { allNavHrefs, buildNavGroups } from "@/lib/nav-model";
import {
  canAssignReview,
  canAssignReviewLots,
  canBulkAssignReviews,
  canDecide,
  canManageReviewers,
  canReview
} from "@/lib/permissions";

const ROOT = join(__dirname, "..");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

function makeUser(role: string): CurrentAdminUser {
  return {
    id: `user-${role}`,
    email: `${role}@example.com`,
    full_name: role,
    role,
    status: "active",
    auth_user_id: `auth-${role}`
  } as unknown as CurrentAdminUser;
}

/** The body of one exported function, up to the next export. */
function exportedFunction(code: string, name: string): string {
  const start = code.indexOf(`export async function ${name}`);
  if (start < 0) throw new Error(`không thấy hàm ${name}`);
  const next = code.indexOf("export async function", start + 10);
  return code.slice(start, next < 0 ? undefined : next);
}

describe("hai việc được mở cho support_team", () => {
  for (const role of ["super_admin", "admin", "core_team", "support_team"]) {
    it(`${role} cấp quyền tuyển sinh và giao lô được`, () => {
      expect(canManageReviewers(role)).toBe(true);
      expect(canAssignReviewLots(role)).toBe(true);
    });
  }

  for (const role of ["reviewer", "viewer", "", null, undefined]) {
    it(`${JSON.stringify(role)} không làm được`, () => {
      expect(canManageReviewers(role)).toBe(false);
      expect(canAssignReviewLots(role)).toBe(false);
    });
  }
});

describe("những việc bên cạnh KHÔNG bị mở theo", () => {
  it("support_team vẫn không xem điểm, không tải file kết quả, không đổi người chấm", () => {
    // canAssignReview gác cả hai route tải file điểm và kết quả tuyển sinh.
    expect(canAssignReview("support_team")).toBe(false);
  });

  it("support_team vẫn không chia tự động, không cấu hình số review, không giao phỏng vấn", () => {
    expect(canBulkAssignReviews("support_team")).toBe(false);
  });

  it("support_team vẫn không chốt kết quả tuyển", () => {
    expect(canDecide("support_team")).toBe(false);
  });

  it("support_team vẫn không vào trang Đánh giá", () => {
    expect(canReview("support_team")).toBe(false);
  });
});

describe("nav mở đúng hai màn hình, không hơn", () => {
  const supportHrefs = allNavHrefs(buildNavGroups(makeUser("support_team")));

  it("support_team thấy hai màn hình dưới Ứng tuyển", () => {
    const group = buildNavGroups(makeUser("support_team")).find((g) => g.key === "applications");
    const hrefs = (group?.items ?? []).map((item) => item.href);
    expect(hrefs).toContain("/reviews/assign-bulk");
    expect(hrefs).toContain("/reviews/reviewer-pool");
  });

  it("support_team KHÔNG thấy Đánh giá hay Phỏng vấn — hai trang đó từ chối họ", () => {
    expect(supportHrefs).not.toContain("/reviews");
    expect(supportHrefs).not.toContain("/interviews");
  });

  it("vai trò đã thấy Đánh giá giữ nguyên nav, không có mục trùng", () => {
    for (const role of ["super_admin", "admin", "core_team"]) {
      const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
      expect(hrefs).toContain("/reviews");
      expect(hrefs).not.toContain("/reviews/assign-bulk");
      expect(hrefs).not.toContain("/reviews/reviewer-pool");
    }
  });

  it("reviewer và viewer không được mời hai màn hình này", () => {
    for (const role of ["reviewer", "viewer"]) {
      const hrefs = allNavHrefs(buildNavGroups(makeUser(role)));
      expect(hrefs).not.toContain("/reviews/assign-bulk");
      expect(hrefs).not.toContain("/reviews/reviewer-pool");
    }
  });
});

describe("mỗi cổng kiểm đúng predicate của nó", () => {
  it("trang giao lô kiểm canAssignReviewLots, không còn canBulkAssignReviews", () => {
    const page = source("app/reviews/assign-bulk/page.tsx");
    expect(page).toMatch(/if \(!canAssignReviewLots\(adminUser\.role\)\) redirect\(/);
    expect(page).not.toMatch(/canBulkAssignReviews\(/);
  });

  it("trang cấp quyền kiểm canManageReviewers", () => {
    expect(source("app/reviews/reviewer-pool/page.tsx")).toMatch(
      /if \(!canManageReviewers\(adminUser\.role\)\) redirect\(/
    );
  });

  it("trang cấu hình số review và trang giao phỏng vấn vẫn chỉ cho ban điều hành", () => {
    expect(source("app/reviews/settings/page.tsx")).toMatch(/if \(!canBulkAssignReviews\(actor\.role\)\) redirect\(/);
    expect(source("app/interviews/assign/page.tsx")).toMatch(
      /if \(!canBulkAssignReviews\(adminUser\.role\)\) redirect\(/
    );
  });

  it("hai route tải file điểm và kết quả vẫn kiểm canAssignReview", () => {
    for (const route of ["app/api/exports/review-scores/route.ts", "app/api/exports/recruitment-results/route.ts"]) {
      expect(source(route), route).toMatch(/if \(!canAssignReview\(adminUser\.role\)\)/);
    }
  });

  it("giao một lô mở cho support_team, chia tự động thì không", () => {
    const lib = source("lib/bulk-assignment.ts");
    expect(exportedFunction(lib, "assignSelectedApplicationReviews")).toMatch(/canAssignReviewLots\(actor\.role\)/);
    const automatic = exportedFunction(lib, "bulkAssignApplicationReviews");
    expect(automatic).toMatch(/canBulkAssignReviews\(actor\.role\)/);
    expect(automatic).not.toMatch(/canAssignReviewLots/);
  });

  it("trả hồ sơ dùng quyền hand_back; đổi người chấm và giao từng hồ sơ vẫn là assign", () => {
    const lib = source("lib/application-reviews.ts");
    expect(exportedFunction(lib, "cancelApplicationReview")).toMatch(/requireMutationActor\(input\.adminUserId, "hand_back"\)/);
    expect(exportedFunction(lib, "reassignApplicationReview")).toMatch(/requireMutationActor\(input\.adminUserId, "assign"\)/);
    expect(exportedFunction(lib, "assignApplicationReview")).toMatch(/requireMutationActor\(input\.assignedByAdminUserId, "assign"\)/);
  });

  it("hai trang không đưa support_team tới trang sẽ từ chối họ", () => {
    const assign = source("app/reviews/assign-bulk/page.tsx");
    expect(assign).toMatch(/canOpenGuide \? \(\s*<Link href="\/reviews\/guide"/);
    const pool = source("app/reviews/reviewer-pool/page.tsx");
    expect(pool).toMatch(/canOpenReviews \? \(\s*<div className="mb-4">\s*<Link href="\/reviews"/);
    expect(pool).toMatch(/canOpenReviews \? \(\s*<Link\s+href="\/reviews\/guide"/);
  });
});
