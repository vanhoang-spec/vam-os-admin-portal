/** @vitest-environment jsdom */
/**
 * Ban tổ chức sửa nội dung bài chấm — điểm, đề xuất, nhận xét — kể cả bài đã nộp.
 * Core Team với mọi hồ sơ, Support Team với hồ sơ mentee (chủ dự án chốt 18/09/2026).
 *
 * Hai luật phải sống chung mà không giẫm lên nhau: ô chấm của reviewer vẫn chỉ người
 * được giao mới ghi được và chỉ khi bài chưa nộp; đường của ban tổ chức thì ngược lại,
 * nhưng phải ghi lại ai sửa và giá trị trước đó, và phải tính lại trạng thái vòng chấm
 * của hồ sơ — nếu không, điểm trên bài và trạng thái hồ sơ sẽ nói hai điều khác nhau.
 */
import { readFileSync } from "node:fs";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({})),
  canOperateSeason: vi.fn(async () => true),
  canReviewSeason: vi.fn(async () => true),
  getScopeFilter: vi.fn(async () => undefined)
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { overrideApplicationReview } from "@/lib/application-reviews";
import { canEditReviewContent, canEditReviewContentAnyApplication } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { overrideApplicationReviewAction } from "@/app/actions/application-reviews";
import { ReviewOverridePanel, type OverridableReview } from "@/app/applications/[id]/review-override-panel";

const REVIEW_ID = "11111111-1111-4111-8111-111111111111";
const APPLICATION_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"] as const;
const RPC = "vam096_override_application_review";

const MIGRATION = "supabase/migrations/20260918170000_review_content_override.sql";
const sql = readFileSync(MIGRATION, "utf8");
const sqlCode = sql
  .split(String.fromCharCode(10))
  .map((line) => line.replace(/--.*$/, ""))
  .join(String.fromCharCode(10));

function db(options: { roleApplied?: string; reviewStatus?: string; rpcError?: string } = {}) {
  const rpc = vi.fn(async () =>
    options.rpcError ? { data: null, error: { message: options.rpcError } } : { data: REVIEW_ID, error: null }
  );
  const client = {
    from: vi.fn((table: string) => {
      const chain: Record<string, any> = {};
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn(() => chain);
      chain.maybeSingle = vi.fn(async () => {
        if (table === "application_reviews") {
          return {
            data: {
              id: REVIEW_ID,
              application_id: APPLICATION_ID,
              status: options.reviewStatus ?? "submitted"
            },
            error: null
          };
        }
        if (table === "applications") {
          return {
            data: { id: APPLICATION_ID, role_applied: options.roleApplied ?? "mentee", season_id: "season-12", status: "screening_completed" },
            error: null
          };
        }
        if (table === "admin_users") {
          return { data: { id: ACTOR_ID, role: "support_team", status: "active" }, error: null };
        }
        return { data: null, error: null };
      });
      return chain;
    }),
    rpc
  };
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
  return { client, rpc };
}

function signInAs(role: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: ACTOR_ID,
    role,
    status: "active",
    email: "actor@example.com"
  } as never);
}

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const validForm = (extra: Record<string, string> = {}) =>
  form({
    review_id: REVIEW_ID,
    application_id: APPLICATION_ID,
    score_motivation: "4",
    score_goal_clarity: "3",
    score_commitment: "5",
    score_fit: "4",
    score_communication: "3",
    recommendation: "approve_recommended",
    reviewer_note: "Ban tổ chức chỉnh lại sau khi rà soát.",
    ...extra
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(cleanup);

describe("1. hàm quyền", () => {
  it("bài chấm hồ sơ mentor: Core Team trở lên; hồ sơ mentee: thêm Support Team", () => {
    expect(ROLES.filter((role) => canEditReviewContent(role, "mentor"))).toEqual([
      "super_admin",
      "admin",
      "core_team"
    ]);
    expect(ROLES.filter((role) => canEditReviewContent(role, "mentee"))).toEqual([
      "super_admin",
      "admin",
      "core_team",
      "support_team"
    ]);
    expect(ROLES.filter((role) => canEditReviewContentAnyApplication(role))).toEqual([
      "super_admin",
      "admin",
      "core_team",
      "support_team"
    ]);
  });

  it("vai trò ứng tuyển lạ thì theo luật chặt, và người chấm thuê ngoài không sửa được gì", () => {
    for (const applied of [null, "", "trainer", "MENTOR"]) {
      expect(canEditReviewContent("support_team", applied)).toBe(false);
    }
    expect(canEditReviewContent("reviewer", "mentee")).toBe(false);
  });
});

describe("2. đường ghi", () => {
  it("Support Team sửa được bài chấm ĐÃ NỘP của hồ sơ mentee, qua đúng RPC", async () => {
    signInAs("support_team");
    const { rpc } = db({ roleApplied: "mentee", reviewStatus: "submitted" });

    const result = await overrideApplicationReviewAction({ ok: false, message: null }, validForm());

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(RPC, {
      p_review_id: REVIEW_ID,
      p_actor: ACTOR_ID,
      p_score_motivation: 4,
      p_score_goal_clarity: 3,
      p_score_commitment: 5,
      p_score_fit: 4,
      p_score_communication: 3,
      p_recommendation: "approve_recommended",
      p_reviewer_note: "Ban tổ chức chỉnh lại sau khi rà soát."
    });
  });

  it("Support Team không sửa được bài chấm của hồ sơ mentor", async () => {
    signInAs("support_team");
    const { rpc } = db({ roleApplied: "mentor" });

    const result = await overrideApplicationReviewAction({ ok: false, message: null }, validForm());

    expect(result.ok).toBe(false);
    expect(result.message).toContain("hồ sơ mentee");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("Core Team sửa được bài chấm của hồ sơ mentor", async () => {
    signInAs("core_team");
    const { rpc } = db({ roleApplied: "mentor" });

    await expect(
      overrideApplicationReviewAction({ ok: false, message: null }, validForm())
    ).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reviewer và viewer bị chặn ngay ở cổng vai trò, không đọc gì", async () => {
    for (const role of ["reviewer", "viewer"]) {
      signInAs(role);
      const { client, rpc } = db({ roleApplied: "mentee" });
      const result = await overrideApplicationReviewAction({ ok: false, message: null }, validForm());
      expect(result.ok).toBe(false);
      expect(client.from).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("thiếu đề xuất thì không ghi gì", async () => {
    signInAs("core_team");
    const { rpc } = db({ roleApplied: "mentee" });
    const result = await overrideApplicationReviewAction(
      { ok: false, message: null },
      validForm({ recommendation: "" })
    );
    expect(result.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("bài đã huỷ: database từ chối, và câu báo nói đúng lý do", async () => {
    signInAs("core_team");
    db({ roleApplied: "mentee", rpcError: "Review is not editable" });
    const result = await overrideApplicationReviewAction({ ok: false, message: null }, validForm());
    expect(result).toEqual({ ok: false, message: "Bài chấm đã huỷ thì không sửa được nữa." });
  });

  it("ô điểm để trống vẫn gửi đi là null, không thành 0", async () => {
    signInAs("core_team");
    const { rpc } = db({ roleApplied: "mentee" });
    await overrideApplicationReviewAction(
      { ok: false, message: null },
      validForm({ score_communication: "" })
    );
    const args = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(args[1].p_score_communication).toBeNull();
  });

  it("đường của ban tổ chức không đụng tới ô chấm của reviewer", () => {
    const source = readFileSync("lib/application-reviews.ts", "utf8");
    const override = source.slice(source.indexOf("export async function overrideApplicationReview"));
    // Không hỏi "có phải người được giao không" — đó là luật của đường kia.
    expect(override).not.toContain("reviewer_admin_user_id !== input.adminUserId");
    expect(override).toContain("canEditReviewContent(input.actorRole, application.role_applied)");
    // Và luật của đường kia vẫn còn nguyên.
    expect(source).toContain('return { ok: false, message: "Bạn không có quyền submit review này." };');
    expect(source).toContain('return { ok: false, message: "Bạn không có quyền chỉnh sửa review này." };');
  });
});

describe("3. migration", () => {
  it("cổng quyền dùng lại phép chia mentor/mentee của việc đổi kết quả", () => {
    expect(sqlCode).toContain("public.vam096_decision_operator_for_application(p_actor, v_app.id)");
    expect(sqlCode).toContain("raise exception 'Review override actor is not authorized for this application'");
  });

  it("sửa được bài đã nộp, nhưng không sửa bài đã huỷ, và không đổi trạng thái bài", () => {
    expect(sqlCode).toContain("v_review.status not in ('assigned', 'in_progress', 'returned_for_clarification', 'submitted')");
    const update = sqlCode.slice(sqlCode.indexOf("update public.application_reviews"), sqlCode.indexOf("insert into public.admin_audit_log"));
    expect(update).not.toContain("status =");
    expect(update).not.toContain("submitted_at");
    expect(update).toContain("total_score = v_total");
  });

  it("ghi lại người sửa và giá trị trước đó", () => {
    const audit = sqlCode.slice(sqlCode.indexOf("insert into public.admin_audit_log"), sqlCode.indexOf("perform public.vam084_recompute"));
    expect(audit).toContain("'override_application_review'");
    for (const field of ["score_motivation", "recommendation", "reviewer_note", "total_score"]) {
      expect(audit.split(`'${field}', v_review.`).length - 1).toBe(1);
    }
    expect(audit).toContain("'review_id', p_review_id");
  });

  it("tính lại trạng thái vòng chấm bằng chính hàm mà đường nộp bài dùng", () => {
    expect(sqlCode).toContain("perform public.vam084_recompute_application_review_status(v_review.application_id, v_review.review_round)");
  });

  it("nới ràng buộc nhật ký theo lối cộng thêm, không viết đè", () => {
    const widen = sqlCode.slice(sqlCode.indexOf("do $audit_widen$"), sqlCode.indexOf("create or replace function"));
    expect(widen).toContain("pg_get_constraintdef");
    expect(widen).toContain("đã MẤT giá trị cũ");
    // Chính phép so tập, không chỉ câu báo lỗi: một phép so rỗng vẫn để nguyên câu báo.
    expect(widen).toContain("select coalesce(array_agg(b order by b), '{}')");
    expect(widen).toContain("where not (b = any (coalesce(v_after_values, '{}')))");
    expect(widen).toContain("if cardinality(v_lost) > 0 then");
    expect(widen).toContain("tập giá trị sau khi nới không khớp tập mong đợi");
    expect(sqlCode).not.toMatch(/add constraint admin_audit_log_action_type_check check \(action_type in \(/i);
  });

  it("chỉ service_role chạy được, và không phải SECURITY DEFINER", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sqlCode).toContain(`vam096_override_application_review(uuid, uuid, integer, integer, integer, integer, integer, text, text) from ${role};`);
    }
    expect(sqlCode).toContain("to service_role;");
    expect(sqlCode).not.toContain("security definer");
    expect(sqlCode).toContain("current_user <> 'service_role'");
  });

  it("tự kiểm giữ luật của đường nộp bài, và một transaction không dấu gạch chéo ngược", () => {
    const check = sqlCode.slice(sqlCode.indexOf("do $self_check$"));
    expect(check).toContain("v_review.reviewer_admin_user_id <> p_actor");
    expect(check).toContain("override_application_review");
    expect(sqlCode.trim().startsWith("begin;")).toBe(true);
    expect(sqlCode.trim().endsWith("commit;")).toBe(true);
    expect(sql.includes(String.fromCharCode(92))).toBe(false);
  });
});

describe("4. màn hình", () => {
  const review: OverridableReview = {
    id: REVIEW_ID,
    roundLabel: "Vòng hồ sơ",
    reviewerName: "Người chấm A",
    statusLabel: "Đã nộp",
    scoreMotivation: 4,
    scoreGoalClarity: 3,
    scoreCommitment: null,
    scoreFit: 2,
    scoreCommunication: 5,
    totalScore: 14,
    recommendation: "waitlist",
    reviewerNote: "Nhận xét cũ"
  };

  function renderPanel() {
    return render(<ReviewOverridePanel applicationId={APPLICATION_ID} reviews={[review]} />);
  }

  it("mặc định đóng; mở ra thì điền sẵn đúng bài chấm đang sửa", () => {
    const { container } = renderPanel();
    expect(container.querySelector("form")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sửa bài chấm" }));
    const form = container.querySelector("form") as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get("review_id")).toBe(REVIEW_ID);
    expect(data.get("application_id")).toBe(APPLICATION_ID);
    expect(data.get("score_motivation")).toBe("4");
    expect(data.get("score_commitment")).toBe("");
    expect(data.get("recommendation")).toBe("waitlist");
    expect(data.get("reviewer_note")).toBe("Nhận xét cũ");
  });

  it("ô điểm chỉ nhận 1..5", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Sửa bài chấm" }));
    for (const name of ["score_motivation", "score_goal_clarity", "score_commitment", "score_fit", "score_communication"]) {
      const input = document.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      expect(input.min).toBe("1");
      expect(input.max).toBe("5");
    }
  });

  it("nói rõ mỗi lần sửa đều được ghi lại", () => {
    const { container } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Sửa bài chấm" }));
    expect(container.textContent).toContain("ghi lại người sửa và giá trị");
  });

  it("trang hồ sơ hỏi đúng quyền, bỏ bài đã huỷ, và không hiện khi hồ sơ đã rút", () => {
    const page = readFileSync("app/applications/[id]/page.tsx", "utf8");
    expect(page).toContain("canEditReviewContent(adminUser?.role, roleApplied) && canOperateAnyScope(scopeContext)");
    expect(page).toContain("{canEditReviews && !isWithdrawn && reviews.length > 0 ? (");
    expect(page).toContain('review.status !== "cancelled"');
  });
});
