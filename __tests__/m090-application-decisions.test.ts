import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));

import { applyApplicationDecisions, recordApplicationDecision } from "@/lib/application-decisions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const rpc = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ rpc } as never);
});

describe("M090 shared decision RPC", () => {
  it("returns a partial-success report for a mixed eligible/ineligible batch", async () => {
    rpc.mockResolvedValue({ data: [
      { application_id: "a", applied: true, reason: "applied" },
      { application_id: "b", applied: false, reason: "profile_review_minimum_not_met" }
    ], error: null });
    const result = await applyApplicationDecisions({
      applicationIds: ["a", "b"], decidedByAdminUserId: "operator", newStatus: "screening_passed",
      decisionNote: "batch", expectedStatuses: { a: "screening_completed", b: "screening_assigned" }
    });
    expect(result).toMatchObject({ ok: true, applied: 1, failed: 1 });
  });

  it("blocks a wholly ineligible decision with a lifecycle-safe message", async () => {
    rpc.mockResolvedValue({ data: [
      { application_id: "a", applied: false, reason: "interview_review_minimum_not_met" }
    ], error: null });
    const result = await applyApplicationDecisions({
      applicationIds: ["a"], decidedByAdminUserId: "operator", newStatus: "interview_passed",
      decisionNote: null, expectedStatuses: { a: "interview_in_progress" }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("phỏng vấn tối thiểu");
  });

  it("routes the individual decision through the same RPC with expected status", async () => {
    rpc.mockResolvedValue({ data: [{ application_id: "a", applied: true, reason: "applied" }], error: null });
    await recordApplicationDecision({
      applicationId: "a", decidedByAdminUserId: "operator", decidedByName: "Operator",
      previousStatus: "screening_completed", newStatus: "screening_passed", decisionNote: null
    });
    expect(rpc).toHaveBeenCalledWith("vam084_apply_application_decisions", expect.objectContaining({
      p_application_ids: ["a"], p_expected_statuses: { a: "screening_completed" }
    }));
  });
});
