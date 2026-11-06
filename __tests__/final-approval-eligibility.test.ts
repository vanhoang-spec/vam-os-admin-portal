/**
 * Duyệt thành viên chính thức — màn hình phải nói thiếu gì.
 *
 * Lỗi có thật, 21/10/2026: hai đơn mentor nằm ở `interview_passed` mà chưa có
 * phiếu phỏng vấn nào được nộp. Thẻ "Duyệt thành viên chính thức" chỉ xét trạng
 * thái nên vẫn hiện nút; `vam084_application_decision_eligibility` còn đếm phiếu
 * nên mọi lần bấm đều bị từ chối bằng một câu chung chung. BTC phải mở database
 * mới biết thiếu gì.
 *
 * Các ca dưới đây dựng lại đúng tình huống đó: trạng thái hợp lệ, phiếu phỏng
 * vấn bằng 0, và đòi hỏi câu trả lời phải gọi tên được `interview_review_minimum_not_met`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: () => null }));

import { getFinalApprovalEligibility } from "@/lib/application-decisions";
import {
  FINAL_APPROVAL_REASONS,
  FINAL_APPROVAL_REASON_MESSAGE,
  finalApprovalNextStep,
  finalApprovalReasonMessage,
  finalApprovalTargetStatus,
  isFinalApprovalReason
} from "@/lib/final-approval-eligibility";

function read(relative: string): string {
  return readFileSync(join(process.cwd(), relative), "utf8");
}

/** Bản giả chỉ trả về đúng một câu trả lời của RPC, và ghi lại nó được hỏi gì. */
function clientReturning(answer: { data?: unknown; error?: unknown }) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: answer.data ?? null, error: answer.error ?? null };
      }
    } as never
  };
}

const APP_ID = "cccccccc-0000-4000-8000-00000000000c";

describe("đọc điều kiện duyệt chính thức", () => {
  it("giữ nguyên mã lý do database trả về, không gộp thành 'không đọc được'", async () => {
    const { client, calls } = clientReturning({
      data: [{ eligible: false, reason: "interview_review_minimum_not_met" }]
    });

    const answer = await getFinalApprovalEligibility(APP_ID, "approved_as_mentor", client);

    expect(answer).toEqual({ eligible: false, reason: "interview_review_minimum_not_met" });
    // Hỏi đúng hàm mà đường ghi hỏi, với đúng trạng thái đích.
    expect(calls).toEqual([
      {
        name: "vam084_application_decision_eligibility",
        args: { p_application_id: APP_ID, p_new_status: "approved_as_mentor" }
      }
    ]);
  });

  it("mỗi nhánh từ chối của hàm SQL đều ra một mã riêng", async () => {
    for (const reason of ["invalid_transition", "stage_requirement_missing", "application_role_mismatch"]) {
      const { client } = clientReturning({ data: [{ eligible: false, reason }] });
      expect((await getFinalApprovalEligibility(APP_ID, "approved_as_mentee", client)).reason).toBe(reason);
    }
  });

  it("đọc lỗi thì từ chối, không bao giờ cho phép", async () => {
    const { client } = clientReturning({ error: { message: "boom" } });
    expect(await getFinalApprovalEligibility(APP_ID, "approved_as_mentor", client)).toEqual({
      eligible: false,
      reason: "eligibility_unknown"
    });
  });

  it("không có client thì từ chối", async () => {
    expect(await getFinalApprovalEligibility(APP_ID, "approved_as_mentor", null as never)).toEqual({
      eligible: false,
      reason: "eligibility_unknown"
    });
  });

  it("câu trả lời rỗng hoặc sai hình thì từ chối", async () => {
    for (const data of [null, [], [{ reason: "eligible" }]]) {
      const { client } = clientReturning({ data });
      expect((await getFinalApprovalEligibility(APP_ID, "approved_as_mentor", client)).eligible).toBe(false);
    }
  });

  it("mã lạ vẫn là từ chối, chỉ không giải thích được", async () => {
    const { client } = clientReturning({ data: [{ eligible: false, reason: "ly_do_moi_toanh" }] });
    expect(await getFinalApprovalEligibility(APP_ID, "approved_as_mentor", client)).toEqual({
      eligible: false,
      reason: "eligibility_unknown"
    });
  });

  it("đủ điều kiện thì nói đủ", async () => {
    const { client } = clientReturning({ data: [{ eligible: true, reason: "eligible" }] });
    expect(await getFinalApprovalEligibility(APP_ID, "approved_as_mentor", client)).toEqual({
      eligible: true,
      reason: "eligible"
    });
  });
});

describe("từ vựng lý do", () => {
  const SOURCES = [
    "supabase/migrations/20260903180000_p0_restore_recruitment_review_rpcs.sql",
    "supabase/migrations/20260906090000_s12_direct_interview_invite.sql"
  ];

  /** Mã lý do trong thân hàm chỉ xuất hiện ở ba khuôn này. */
  function reasonsInGate(sql: string): string[] {
    const start = sql.indexOf("FUNCTION public.vam084_application_decision_eligibility");
    expect(start).toBeGreaterThan(-1);
    const rest = sql.slice(start);
    const end = rest.indexOf("CREATE OR REPLACE FUNCTION", 10);
    const body = end === -1 ? rest : rest.slice(0, end);
    const found = new Set<string>();
    const pattern = /then\s+'([a-z_]+)'|else\s+'([a-z_]+)'\s+end|select\s+(?:true|false),\s*'([a-z_]+)'/g;
    for (const match of Array.from(body.matchAll(pattern))) {
      found.add(match[1] ?? match[2] ?? match[3]);
    }
    // `case when p_new_status = 'approved_as_mentor' then 'mentor' else 'mentee' end`
    // là phép so vai trò, không phải nhánh lý do — cùng khuôn chữ nên lọt vào regex.
    found.delete("mentor");
    found.delete("mentee");
    return Array.from(found).sort();
  }

  for (const source of SOURCES) {
    it(`không bỏ sót mã nào của ${source.split("/").pop()}`, () => {
      const reasons = reasonsInGate(read(source));
      expect(reasons.length).toBeGreaterThan(3);
      for (const reason of reasons) {
        expect(isFinalApprovalReason(reason), `thiếu mã "${reason}" trong FINAL_APPROVAL_REASONS`).toBe(true);
      }
      // Ca mà lỗi 21/10 rơi vào, nêu đích danh để không ai gỡ nhầm.
      expect(reasons).toContain("interview_review_minimum_not_met");
    });
  }

  it("mã nào cũng có câu tiếng Việt, không mã nào vẽ thành chuỗi rỗng", () => {
    for (const reason of FINAL_APPROVAL_REASONS) {
      expect(FINAL_APPROVAL_REASON_MESSAGE[reason].trim().length).toBeGreaterThan(0);
    }
  });

  it("mã lạ vẫn ra một câu đọc được, không ra 'undefined'", () => {
    expect(finalApprovalReasonMessage("khong_biet")).toBe(
      FINAL_APPROVAL_REASON_MESSAGE.eligibility_unknown
    );
    expect(finalApprovalReasonMessage(undefined)).toBe(
      FINAL_APPROVAL_REASON_MESSAGE.eligibility_unknown
    );
  });

  it("thiếu phiếu phỏng vấn thì nói rõ là phiếu phỏng vấn, không phải đánh giá hồ sơ", () => {
    expect(finalApprovalReasonMessage("interview_review_minimum_not_met")).toContain("phỏng vấn");
    expect(finalApprovalReasonMessage("profile_review_minimum_not_met")).toContain("hồ sơ");
    expect(finalApprovalReasonMessage("interview_review_minimum_not_met")).not.toBe(
      finalApprovalReasonMessage("profile_review_minimum_not_met")
    );
  });

  it("nói cả việc phải làm tiếp, kể cả chỗ không phân công được nữa", () => {
    const next = finalApprovalNextStep("interview_review_minimum_not_met");
    expect(next).toBeTruthy();
    expect(next).toContain("phân công");
    expect(finalApprovalNextStep("ly_do_la")).toBeNull();
  });
});

describe("trạng thái đích theo vai trò", () => {
  it("mentor và mentee đi về hai trạng thái khác nhau", () => {
    expect(finalApprovalTargetStatus("mentor")).toBe("approved_as_mentor");
    expect(finalApprovalTargetStatus("MENTEE")).toBe("approved_as_mentee");
    expect(finalApprovalTargetStatus(" mentor ")).toBe("approved_as_mentor");
  });

  it("vai trò lạ hoặc trống thì không có trạng thái đích", () => {
    for (const role of [null, undefined, "", "support_team", 7]) {
      expect(finalApprovalTargetStatus(role)).toBeNull();
    }
  });
});

describe("hai cửa không được đọc hai thứ khác nhau", () => {
  it("thẻ duyệt trên trang đơn hỏi database, không chỉ xét trạng thái", () => {
    const page = read("app/applications/[id]/page.tsx");
    expect(page).toContain("getFinalApprovalEligibility");
    // Nút duyệt treo vào câu trả lời của database, không treo vào riêng trạng thái.
    expect(page).toContain("finalApproval?.eligible");
    expect(page).not.toMatch(/\{canMakeDecision && displayStatus === "interview_passed" && \(/);
  });

  it("trang đơn in lý do bị chặn ngay tại chỗ", () => {
    const page = read("app/applications/[id]/page.tsx");
    expect(page).toContain("final-approval-blocked");
    expect(page).toContain("finalApprovalReasonMessage");
  });

  it("đường ghi cũng nói thiếu gì, không còn một câu gộp cho mọi nhánh", () => {
    const approvals = read("lib/application-approvals.ts");
    expect(approvals).toContain("finalApprovalReasonMessage");
    expect(approvals).not.toContain(
      "Đơn chưa đủ điều kiện vòng đời để duyệt thành viên. Không có thay đổi nào được thực hiện."
    );
  });
});
