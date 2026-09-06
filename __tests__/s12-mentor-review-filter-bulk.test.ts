import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync("app/applications/mentor-review/page.tsx", "utf8");
const ACTION = readFileSync("app/actions/s12-screening-bulk.ts", "utf8");
const CONTROLS = readFileSync("app/applications/_components/bulk-screening-controls.tsx", "utf8");
const LIMITS = readFileSync("lib/bulk-screening.ts", "utf8");

/**
 * Slice 2B replaced the Mentor-only action and controls with one generic
 * Mentor/Mentee implementation. The Mentor filter/queue assertions below are
 * unchanged. The bulk-safety assertions now point at the generic action; the
 * behavioural proofs of those same properties (25 cap, expected-status
 * recheck, cross-role rejection, atomic path) live in
 * s12-bulk-screening.test.ts, which exercises the action rather than reading
 * its source.
 */
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

  it("limits bulk writes to the current page and the remaining recruitment actions", () => {
    expect(ACTION).toContain("applicationIds.length > BULK_SCREENING_MAX");
    expect(LIMITS).toContain("BULK_SCREENING_MAX = 25");
    expect(ACTION).toContain('"needs_more_review"');
    expect(ACTION).toContain('"rejected_or_not_fit"');
    expect(ACTION).not.toContain('"withdrawn"');
    // S12 closes the profile round with one decision; the interview invite now
    // lives at /applications/bulk-invite-interview and `screening_passed` is no
    // longer a Core Team forward action anywhere.
    const allowlist = ACTION.slice(
      ACTION.indexOf("const ALLOWED_BULK_STATUSES"),
      ACTION.indexOf(";", ACTION.indexOf("const ALLOWED_BULK_STATUSES"))
    );
    expect(allowlist).not.toContain('"screening_passed"');
  });

  it("re-checks permission, scoped object, applied role, and expected status before each write", () => {
    expect(ACTION).toContain("canDecide(actor.role)");
    expect(ACTION).toContain("getScopeFilter(await getAdminScopeContext())");
    expect(ACTION).toContain("getApplication(applicationId, scope)");
    expect(ACTION).toContain("current.data.role_applied !== role");
    expect(ACTION).toContain("current.data.status !== expectedStatus");
    expect(ACTION).toContain('expectedStatus !== "submitted"');
  });

  it("uses the existing audited decision path rather than a new direct update", () => {
    expect(ACTION).toContain("recordApplicationDecision");
    expect(ACTION).not.toContain('.from("applications").update');
  });

  it("requires confirmation for destructive bulk rejection and supports select-all-page", () => {
    expect(CONTROLS).toContain("window.confirm");
    expect(CONTROLS).toContain('data-bulk-role={role}');
    expect(CONTROLS).toContain("Chọn tất cả hồ sơ trên trang này");
  });

  it("drives the Mentor queue through the shared generic bulk layer", () => {
    expect(PAGE).toContain("bulkS12ScreeningAction");
    expect(PAGE).toContain('name="queue_role" value="mentor"');
    expect(PAGE).toContain("BulkScreeningToolbar");
    expect(PAGE).toContain("BulkScreeningRowCheckbox");
  });
});
