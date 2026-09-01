import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync("app/applications/mentor-review/page.tsx", "utf8");
const ACTION = readFileSync("app/actions/mentor-review-bulk.ts", "utf8");
const CONTROLS = readFileSync("app/applications/mentor-review/bulk-controls.tsx", "utf8");

describe("S12 mentor review filter + bounded bulk operations", () => {
  it("offers explicit mentor type filters", () => {
    expect(PAGE).toContain('name="mentor_type"');
    expect(PAGE).toContain('value="new">Mentor mới');
    expect(PAGE).toContain('value="returning">Mentor cũ quay lại');
    expect(PAGE).toContain('value="unknown">Chưa xác định');
  });

  it("keeps the default queue on the existing bounded 25-row fast path", () => {
    expect(PAGE).toContain('if (mentorType === "all")');
    expect(PAGE).toContain("pageSize = 25");
  });

  it("fails loud instead of silently truncating classification filtering", () => {
    expect(PAGE).toContain("pageSize: 501");
    expect(PAGE).toContain("queue.count > 500");
    expect(PAGE).toContain("Vui lòng nhập thêm từ khóa tìm kiếm");
  });

  it("limits bulk writes to the current page and three recruitment actions", () => {
    expect(ACTION).toContain("applicationIds.length > 25");
    expect(ACTION).toContain('"screening_passed"');
    expect(ACTION).toContain('"needs_more_review"');
    expect(ACTION).toContain('"rejected_or_not_fit"');
    expect(ACTION).not.toContain('"withdrawn"');
  });

  it("re-checks permission, scoped object, mentor role, and expected status before each write", () => {
    expect(ACTION).toContain("canDecide(actor.role)");
    expect(ACTION).toContain("getScopeFilter(await getAdminScopeContext())");
    expect(ACTION).toContain("getApplication(applicationId, scope)");
    expect(ACTION).toContain('current.data.role_applied !== "mentor"');
    expect(ACTION).toContain("current.data.status !== expectedStatus");
    expect(ACTION).toContain('expectedStatus !== "submitted"');
  });

  it("uses the existing audited decision path rather than a new direct update", () => {
    expect(ACTION).toContain("recordApplicationDecision");
    expect(ACTION).not.toContain('.from("applications").update');
  });

  it("requires confirmation for destructive bulk rejection and supports select-all-page", () => {
    expect(CONTROLS).toContain("window.confirm");
    expect(CONTROLS).toContain('data-mentor-bulk="1"');
    expect(CONTROLS).toContain("Chọn tất cả trang");
  });
});
