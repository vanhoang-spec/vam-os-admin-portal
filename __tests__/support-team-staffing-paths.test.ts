/**
 * support_team trên ba đường ghi thật — cấp quyền tuyển sinh, giao một lô, trả
 * hồ sơ — và ranh giới ngay bên cạnh mỗi đường.
 *
 * Chạy chính các hàm trong lib với database giả, và khẳng định chính lệnh ghi
 * được phát ra: đúng hàm nào, hay không phát ra lệnh nào cả.
 *
 * Mỗi ca "bị chặn" khẳng định ĐÚNG lời báo thiếu quyền. Chỉ khẳng định "không
 * thành công" thì một cổng quyền mở nhầm vẫn xanh, miễn là đường đi dừng lại vì
 * một lý do khác — dựng lại lỗi đã cho thấy đúng như vậy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actor: null as null | { id: string; role: string; status: string },
  canOperate: true,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  invites: 0
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn(async () => state.actor) }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({})),
  canOperateSeason: vi.fn(async () => state.canOperate),
  canReviewSeason: vi.fn(async () => false)
}));
vi.mock("@/lib/public-url", () => ({
  getAuthCallbackUrl: vi.fn(async () => "https://os.example.org/auth/callback"),
  getPublicOrigin: vi.fn(async () => "https://os.example.org")
}));
// Thư đặt mật khẩu đi qua Brevo; ở đây chỉ cần biết lời gọi không làm gãy đường cấp quyền.
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendReviewerInvite: vi.fn(async () => ({ ok: true, skipped: false }))
}));
vi.mock("@/lib/outbound-emails", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasRecentSentEmail: vi.fn(async () => ({ ok: true, found: false }))
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => {
        if (table === "people") {
          return { data: { id: "person-1", full_name: "Mentor A", email_primary: "mentor@example.com" }, error: null };
        }
        // A real batch, so a gate that wrongly opened carries the call on to the
        // database write instead of stopping for an unrelated reason.
        if (table === "intake_batches") {
          return { data: { id: "batch-1", season_id: "season-12" }, error: null };
        }
        return { data: null, error: null };
      };
      return chain;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === "vam094_assign_selected_application_reviews") {
        return { data: [{ batch_id: "batch-1", applications_assigned: 2, reviewer_id: "rev-1" }], error: null };
      }
      return { data: "row-1", error: null };
    },
    auth: {
      admin: {
        listUsers: async () => ({
          data: { users: [{ id: "auth-1", email: "mentor@example.com" }] },
          error: null
        }),
        // Mọi lần tạo tài khoản hay link đặt mật khẩu đều đi qua đây: một cổng
        // quyền mở nhầm sẽ đẩy số này lên.
        generateLink: async ({ email }: { email: string }) => {
          state.invites += 1;
          return { data: { user: { id: "auth-1", email }, properties: { hashed_token: "h" } }, error: null };
        },
        deleteUser: async () => ({ error: null })
      }
    }
  })
}));

import { enableMentorAsReviewer, revokeMentorRecruitmentParticipation } from "@/lib/enable-reviewer";
import { assignSelectedApplicationReviews, bulkAssignApplicationReviews } from "@/lib/bulk-assignment";
import { cancelApplicationReview, reassignApplicationReview } from "@/lib/application-reviews";

const NO_ASSIGN_RIGHT = "Bạn không có quyền thực hiện thao tác giao review.";
const NO_REVIEW_MUTATION_RIGHT = "Bạn không có quyền thực hiện thao tác review này.";

function signInAs(role: string) {
  state.actor = { id: "actor-1", role, status: "active" };
}

const rpcNames = () => state.rpcCalls.map((call) => call.name);

beforeEach(() => {
  state.actor = null;
  state.canOperate = true;
  state.rpcCalls = [];
  state.invites = 0;
});

describe("cấp và thu hồi quyền tuyển sinh", () => {
  const grant = { personId: "person-1", seasonId: "season-12", participationRole: "reviewer" as const };

  it("support_team có quyền vận hành mùa: cấp được, và lệnh ghi mang đúng người thao tác", async () => {
    signInAs("support_team");
    const result = await enableMentorAsReviewer(grant);

    expect(result.ok).toBe(true);
    expect(rpcNames()).toEqual(["vam084_grant_recruitment_participation"]);
    expect(state.rpcCalls[0].args.p_actor).toBe("actor-1");
  });

  it("support_team KHÔNG có quyền vận hành mùa: bị chặn, không ghi gì", async () => {
    signInAs("support_team");
    state.canOperate = false;
    const result = await enableMentorAsReviewer(grant);

    expect(result).toMatchObject({ ok: false, message: "Bạn không có quyền vận hành mùa này." });
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.invites).toBe(0);
  });

  it("viewer bị chặn ở cổng quyền, không ghi gì, không gửi thư mời nào", async () => {
    signInAs("viewer");
    const result = await enableMentorAsReviewer(grant);

    expect(result).toMatchObject({ ok: false, message: "Bạn không có quyền quản lý reviewer/interviewer." });
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.invites).toBe(0);
  });

  it("support_team thu hồi được", async () => {
    signInAs("support_team");
    const result = await revokeMentorRecruitmentParticipation(grant);

    expect(result.ok).toBe(true);
    expect(rpcNames()).toEqual(["vam084_revoke_recruitment_participation"]);
  });
});

describe("giao hồ sơ", () => {
  it("support_team giao một lô cho một người được", async () => {
    signInAs("support_team");
    const result = await assignSelectedApplicationReviews({
      applicationIds: ["app-1", "app-2"],
      reviewerAdminUserId: "rev-1",
      reviewRound: "profile_screening",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "actor-1"
    });

    expect(result.ok).toBe(true);
    expect(rpcNames()).toEqual(["vam094_assign_selected_application_reviews"]);
    expect(state.rpcCalls[0].args.p_actor).toBe("actor-1");
  });

  it("support_team KHÔNG chia tự động cho nhiều người được — bị chặn ở cổng quyền", async () => {
    signInAs("support_team");
    const result = await bulkAssignApplicationReviews({
      intakeBatchId: "batch-1",
      roleApplied: "mentee",
      statuses: ["submitted"],
      reviewerAdminUserIds: ["rev-1", "rev-2"],
      reviewRound: "profile_screening",
      dueAt: null,
      excludeAlreadyAssigned: true,
      assignmentNote: null,
      assignedByAdminUserId: "actor-1"
    });

    expect(result).toEqual({ ok: false, message: NO_ASSIGN_RIGHT });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("reviewer không giao lô được", async () => {
    signInAs("reviewer");
    const result = await assignSelectedApplicationReviews({
      applicationIds: ["app-1"],
      reviewerAdminUserId: "rev-1",
      reviewRound: "profile_screening",
      dueAt: null,
      assignmentNote: null,
      assignedByAdminUserId: "actor-1"
    });

    expect(result).toEqual({ ok: false, message: NO_ASSIGN_RIGHT });
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("trả hồ sơ về hàng chờ", () => {
  it("support_team trả được", async () => {
    signInAs("support_team");
    const result = await cancelApplicationReview({ reviewId: "review-1", adminUserId: "actor-1", reason: "Reviewer bận" });

    expect(result.ok).toBe(true);
    expect(rpcNames()).toEqual(["vam084_change_review_assignment"]);
    expect(state.rpcCalls[0].args.p_new_reviewer).toBeNull();
  });

  it("support_team KHÔNG đổi người chấm được — cùng một hàm database, khác việc", async () => {
    signInAs("support_team");
    const result = await reassignApplicationReview({
      reviewId: "review-1",
      newReviewerAdminUserId: "rev-2",
      adminUserId: "actor-1",
      reason: "Đổi người"
    });

    expect(result).toEqual({ ok: false, message: NO_REVIEW_MUTATION_RIGHT });
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("viewer không trả được", async () => {
    signInAs("viewer");
    const result = await cancelApplicationReview({ reviewId: "review-1", adminUserId: "actor-1", reason: "x x x" });

    expect(result).toEqual({ ok: false, message: NO_REVIEW_MUTATION_RIGHT });
    expect(state.rpcCalls).toHaveLength(0);
  });
});
