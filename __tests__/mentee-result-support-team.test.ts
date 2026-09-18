/**
 * Support Team đổi được kết quả hồ sơ MENTEE, kể cả duyệt chính thức; hồ sơ mentor
 * vẫn là việc của Core Team trở lên (chủ dự án chốt 18/09/2026).
 *
 * Phần chia này phải đúng ở CẢ HAI lớp. Database là lớp quyết định: hàm quyền cũ
 * `vam084_operator_for_season` còn là cổng của sáu việc khác, nên nó không được nới —
 * ba hàm ghi kết quả chuyển sang một hàm quyền đọc theo vai trò ứng tuyển của chính
 * đơn. Lớp app chặn trước để người bấm nút nhận được một câu tiếng Việt, và để một
 * yêu cầu gửi tay không đi thẳng tới database.
 *
 * Vai trò ứng tuyển luôn đọc từ đơn đã lưu. Tin vào ô role trên form là đúng cách để
 * đi vòng qua phần chia này.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  })
}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("@/lib/application-approvals", () => ({ approveApplication: vi.fn() }));
vi.mock("@/lib/bulk-official-approval", () => ({ bulkOfficialApproveApplications: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({
  getAdminScopeContext: vi.fn(async () => ({})),
  canOperateSeason: vi.fn(async () => true),
  getScopeFilter: vi.fn(async () => undefined)
}));
vi.mock("@/lib/application-decisions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  applyApplicationDecisions: vi.fn(async () => ({ ok: true, id: "app-1", applied: 1, failed: 0 })),
  recordApplicationDecision: vi.fn(async () => ({ ok: true, id: "app-1", applied: 1, failed: 0 }))
}));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { approveApplication } from "@/lib/application-approvals";
import {
  applyApplicationDecisions,
  recordApplicationDecision,
  refuseApplicationsBeyondDecisionRole
} from "@/lib/application-decisions";
import { bulkOfficialApproveApplications } from "@/lib/bulk-official-approval";
import { canDecideAnyApplicationResult, canDecideApplicationResult } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { approveApplicationAction } from "@/app/actions/application-approvals";
import { updateApplicationDecisionAction } from "@/app/actions/application-decisions";
import { bulkApplicationDecisionAction } from "@/app/actions/bulk-application-decisions";
import { bulkOfficialApprovalAction } from "@/app/actions/bulk-official-approval";

const MENTEE_ID = "00000000-0000-4000-8000-00000000mentee".replace("mentee", "000001");
const MENTOR_ID = "00000000-0000-4000-8000-000000000002";
const ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"] as const;
const MENTEE_ONLY = "Support Team chỉ đổi được kết quả hồ sơ mentee.";

const MIGRATION = "supabase/migrations/20260918150000_mentee_result_support_team.sql";
const sql = readFileSync(MIGRATION, "utf8");
const sqlCode = sql
  .split(String.fromCharCode(10))
  .map((line) => line.replace(/--.*$/, ""))
  .join(String.fromCharCode(10));

const SEASON_ID = "00000000-0000-4000-8000-0000000000s1".replace("s1", "0009");
const PROGRAM_ID = "00000000-0000-4000-8000-000000000010";

/**
 * Database giả: trả về vai trò ứng tuyển của các đơn được hỏi, và đủ mùa/chương
 * trình cho đường duyệt chính thức từng hồ sơ đọc phạm vi.
 */
function dbWithApplications(rows: Array<{ id: string; role_applied: string }>) {
  const inFilter = vi.fn(async (_column: string, ids: string[]) => ({
    data: rows.filter((row) => ids.includes(row.id)),
    error: null
  }));
  const single = (table: string) => async () =>
    table === "seasons"
      ? { data: { id: SEASON_ID, program_id: PROGRAM_ID }, error: null }
      : { data: { id: rows[0]?.id, season_id: SEASON_ID }, error: null };
  const client = {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        const chain: Record<string, unknown> = { in: inFilter };
        chain.eq = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(single(table));
        return chain;
      })
    })),
    rpc: vi.fn()
  };
  vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);
  return client;
}

function signInAs(role: string) {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({
    id: "actor-1",
    role,
    status: "active",
    email: "actor@example.com",
    full_name: "Người thao tác"
  } as never);
}

function form(entries: Array<[string, string]>) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(approveApplication).mockResolvedValue({
    ok: true,
    personId: "p1",
    profileId: "pr1",
    personCreated: false,
    profileCreated: false
  } as never);
  vi.mocked(bulkOfficialApproveApplications).mockResolvedValue({
    ok: true,
    rows: [],
    approved: 1,
    skipped: 0,
    manualRequired: 0,
    failed: 0
  } as never);
});

describe("1. hàm quyền", () => {
  it("hồ sơ mentor: Core Team trở lên; hồ sơ mentee: thêm Support Team", () => {
    expect(ROLES.filter((role) => canDecideApplicationResult(role, "mentor"))).toEqual([
      "super_admin",
      "admin",
      "core_team"
    ]);
    expect(ROLES.filter((role) => canDecideApplicationResult(role, "mentee"))).toEqual([
      "super_admin",
      "admin",
      "core_team",
      "support_team"
    ]);
  });

  it("vai trò lạ hoặc rỗng thì theo luật chặt của mentor, không mở nhầm", () => {
    for (const applied of [null, undefined, "", "trainer", "MENTOR"]) {
      expect(canDecideApplicationResult("support_team", applied)).toBe(false);
    }
    expect(canDecideApplicationResult("support_team", " MENTEE ")).toBe(true);
  });

  it("cổng cho màn hình và route: đúng bốn vai trò, và không thay được phép kiểm từng hồ sơ", () => {
    expect(ROLES.filter((role) => canDecideAnyApplicationResult(role))).toEqual([
      "super_admin",
      "admin",
      "core_team",
      "support_team"
    ]);
    expect(canDecideAnyApplicationResult(null)).toBe(false);
  });
});

describe("2. chặn theo đúng những hồ sơ đang thao tác", () => {
  it("Core Team quyết được mọi hồ sơ, và không tốn thêm một phép đọc nào", async () => {
    const db = dbWithApplications([{ id: MENTOR_ID, role_applied: "mentor" }]);
    await expect(
      refuseApplicationsBeyondDecisionRole({ applicationIds: [MENTOR_ID], actorRole: "core_team" })
    ).resolves.toEqual({ ok: true });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("Support Team: toàn hồ sơ mentee thì qua", async () => {
    dbWithApplications([{ id: MENTEE_ID, role_applied: "mentee" }]);
    await expect(
      refuseApplicationsBeyondDecisionRole({ applicationIds: [MENTEE_ID], actorRole: "support_team" })
    ).resolves.toEqual({ ok: true });
  });

  it("Support Team: lẫn một hồ sơ mentor thì chặn cả lượt, và nói rõ bao nhiêu hồ sơ", async () => {
    dbWithApplications([
      { id: MENTEE_ID, role_applied: "mentee" },
      { id: MENTOR_ID, role_applied: "mentor" }
    ]);
    const result = await refuseApplicationsBeyondDecisionRole({
      applicationIds: [MENTEE_ID, MENTOR_ID],
      actorRole: "support_team"
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("1 hồ sơ");
    expect(result.ok === false && result.message).toContain(MENTEE_ONLY);
  });

  it("thiếu hồ sơ trong database thì từ chối, không đoán", async () => {
    dbWithApplications([{ id: MENTEE_ID, role_applied: "mentee" }]);
    const result = await refuseApplicationsBeyondDecisionRole({
      applicationIds: [MENTEE_ID, MENTOR_ID],
      actorRole: "support_team"
    });
    expect(result.ok).toBe(false);
  });

  it("reviewer và viewer không quyết được cả hồ sơ mentee", async () => {
    for (const role of ["reviewer", "viewer"]) {
      dbWithApplications([{ id: MENTEE_ID, role_applied: "mentee" }]);
      const result = await refuseApplicationsBeyondDecisionRole({
        applicationIds: [MENTEE_ID],
        actorRole: role
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe("3. các đường ghi kết quả", () => {
  it("quyết định từng hồ sơ: Support Team đổi được mentee, không đổi được mentor", async () => {
    signInAs("support_team");

    dbWithApplications([{ id: MENTEE_ID, role_applied: "mentee" }]);
    const ok = await updateApplicationDecisionAction(
      { ok: false, message: null },
      form([
        ["application_id", MENTEE_ID],
        ["new_status", "rejected_or_not_fit"],
        ["previous_status", "screening_completed"]
      ])
    );
    expect(ok.ok).toBe(true);
    expect(recordApplicationDecision).toHaveBeenCalledTimes(1);

    vi.mocked(recordApplicationDecision).mockClear();
    dbWithApplications([{ id: MENTOR_ID, role_applied: "mentor" }]);
    const blocked = await updateApplicationDecisionAction(
      { ok: false, message: null },
      form([
        ["application_id", MENTOR_ID],
        ["new_status", "rejected_or_not_fit"],
        ["previous_status", "screening_completed"]
      ])
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain(MENTEE_ONLY);
    expect(recordApplicationDecision).not.toHaveBeenCalled();
  });

  it("quyết định hàng loạt: một hồ sơ mentor trong danh sách là chặn cả lượt", async () => {
    signInAs("support_team");
    dbWithApplications([
      { id: MENTEE_ID, role_applied: "mentee" },
      { id: MENTOR_ID, role_applied: "mentor" }
    ]);
    const result = await bulkApplicationDecisionAction(
      { ok: false, message: null },
      form([
        ["application_id", MENTEE_ID],
        ["application_id", MENTOR_ID],
        ["new_status", "rejected_or_not_fit"],
        [`expected_status_${MENTEE_ID}`, "screening_completed"],
        [`expected_status_${MENTOR_ID}`, "screening_completed"]
      ])
    );
    expect(result.ok).toBe(false);
    expect(applyApplicationDecisions).not.toHaveBeenCalled();
  });

  it("duyệt chính thức từng hồ sơ: Support Team duyệt được mentee", async () => {
    signInAs("support_team");
    dbWithApplications([{ id: MENTEE_ID, role_applied: "mentee" }]);
    const result = await approveApplicationAction(
      { ok: false, message: null },
      form([
        ["application_id", MENTEE_ID],
        ["target_role", "mentee"],
        ["full_name", "Người ví dụ"],
        ["email_primary", "vidu@example.com"]
      ])
    );
    expect(result.ok).toBe(true);
    expect(approveApplication).toHaveBeenCalledTimes(1);
  });

  it("duyệt chính thức từng hồ sơ: form khai 'mentee' cho một đơn mentor vẫn bị chặn", async () => {
    signInAs("support_team");
    dbWithApplications([{ id: MENTOR_ID, role_applied: "mentor" }]);
    const result = await approveApplicationAction(
      { ok: false, message: null },
      form([
        ["application_id", MENTOR_ID],
        ["target_role", "mentee"],
        ["full_name", "Người ví dụ"],
        ["email_primary", "vidu@example.com"]
      ])
    );
    expect(result.ok).toBe(false);
    expect(approveApplication).not.toHaveBeenCalled();
  });

  it("duyệt chính thức hàng loạt: chỉ hồ sơ mentee mới qua", async () => {
    signInAs("support_team");

    dbWithApplications([{ id: MENTEE_ID, role_applied: "mentee" }]);
    const ok = await bulkOfficialApprovalAction({ ok: false, message: null }, form([["application_id", MENTEE_ID]]));
    expect(ok.ok).toBe(true);

    vi.mocked(bulkOfficialApproveApplications).mockClear();
    dbWithApplications([{ id: MENTOR_ID, role_applied: "mentor" }]);
    const blocked = await bulkOfficialApprovalAction({ ok: false, message: null }, form([["application_id", MENTOR_ID]]));
    expect(blocked.ok).toBe(false);
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it("reviewer vẫn bị chặn ngay ở cổng vai trò, không chạm database", async () => {
    signInAs("reviewer");
    const db = dbWithApplications([{ id: MENTEE_ID, role_applied: "mentee" }]);
    const result = await bulkOfficialApprovalAction(
      { ok: false, message: null },
      form([["application_id", MENTEE_ID]])
    );
    expect(result.ok).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
    expect(bulkOfficialApproveApplications).not.toHaveBeenCalled();
  });

  it("mọi đường ghi kết quả đều đi qua phép kiểm này", () => {
    for (const file of [
      "app/actions/application-decisions.ts",
      "app/actions/bulk-application-decisions.ts",
      "app/actions/bulk-invite-interview.ts",
      "app/actions/bulk-official-approval.ts",
      "app/actions/application-approvals.ts",
      "app/actions/s12-screening-bulk.ts"
    ]) {
      expect(readFileSync(file, "utf8")).toContain("refuseApplicationsBeyondDecisionRole");
    }
  });
});

describe("4. migration", () => {
  it("hàm quyền mới chỉ mở thêm đúng hồ sơ mentee cho support_team", () => {
    const fn = sqlCode.slice(
      sqlCode.indexOf("create or replace function public.vam096_decision_operator_for_application"),
      sqlCode.indexOf("revoke all on function")
    );
    expect(fn).toContain("public.vam084_operator_for_season(p_actor, a.season_id)");
    expect(fn).toContain("= 'mentee'");
    expect(fn).toContain("au.role = 'support_team'");
    expect(fn).toContain("au.status = 'active'");
    // Vẫn đòi đúng phạm vi vận hành của mùa đơn đó, không phải một cửa sau.
    expect(fn).toContain("asa.season_id = a.season_id::text");
    expect(fn).toContain("asa.role in ('operations', 'full_access')");
    expect(fn).toContain("current_user = 'service_role'");
  });

  it("chỉ service_role chạy được hàm quyền mới", () => {
    for (const role of ["public", "anon", "authenticated"]) {
      expect(sqlCode).toContain(`vam096_decision_operator_for_application(uuid, uuid) from ${role};`);
    }
    expect(sqlCode).toContain("grant execute on function public.vam096_decision_operator_for_application(uuid, uuid) to service_role;");
  });

  it("vá đúng ba hàm ghi kết quả, mỗi hàm một dòng", () => {
    const patch = sqlCode.slice(sqlCode.indexOf("do $patch$"), sqlCode.indexOf("do $self_check$"));
    for (const name of [
      "vam084_apply_application_decisions",
      "vam090_finalize_recruitment_approval",
      "vam092_bulk_official_approve_applications"
    ]) {
      expect(patch).toContain(name);
    }
    expect(patch).toContain("if v_matches <> 1 then");
    expect(patch).toContain("md5(replace(v_new_def, v_target.new_text, v_target.old_text)) <> md5(v_def)");
    expect(patch).toContain("execute v_new_def;");
    // Đọc bản đang chạy rồi thay, không chép lại thân hàm.
    expect(sqlCode).not.toMatch(/create or replace function public[.]vam08[0-9]|create or replace function public[.]vam09[0-5]/);
  });

  it("chạy lại vô hại, và quyền của ba hàm không được đổi", () => {
    const patch = sqlCode.slice(sqlCode.indexOf("do $patch$"), sqlCode.indexOf("do $self_check$"));
    const skip = patch.indexOf("if position(v_target.new_text in v_def) > 0 then");
    expect(skip).toBeGreaterThan(-1);
    expect(patch.slice(skip, skip + 200)).toContain("continue;");
    expect(skip).toBeLessThan(patch.indexOf("execute v_new_def;"));
    for (const column of ["v_acl_before", "v_secdef_before", "v_config_before"]) {
      expect(patch).toContain(column);
    }
  });

  it("hàm quyền cũ không bị nới, và vẫn còn chỗ khác dùng nó", () => {
    expect(sqlCode).not.toMatch(/create or replace function public[.]vam084_operator_for_season/);
    const check = sqlCode.slice(sqlCode.indexOf("do $self_check$"));
    expect(check).toContain("vẫn còn gọi hàm quyền cũ");
    expect(check).toContain("hàm quyền cũ chỉ còn % chỗ dùng");
  });

  it("một transaction, có lock_timeout, không có dấu gạch chéo ngược", () => {
    expect(sqlCode.trim().startsWith("begin;")).toBe(true);
    expect(sqlCode.trim().endsWith("commit;")).toBe(true);
    expect(sqlCode).toContain("set local lock_timeout = '10s';");
    expect(sql.includes(String.fromCharCode(92))).toBe(false);
  });
});

describe("5. màn hình", () => {
  it("hàng đợi mentee mở nút cho Support Team, hàng đợi mentor thì không", () => {
    expect(readFileSync("app/applications/mentee-review/page.tsx", "utf8")).toContain(
      'canDecideApplicationResult(adminUser.role, "mentee")'
    );
    const mentor = readFileSync("app/applications/mentor-review/page.tsx", "utf8");
    // Đúng một cổng, không nối thêm vai trò nào bên cạnh nó.
    expect(mentor).toContain("const canBulkDecide = canDecide(adminUser.role);");
    expect(mentor).not.toContain("canDecideApplicationResult");
    expect(mentor).not.toContain("support_team");
  });

  it("trang hồ sơ hỏi theo vai trò ứng tuyển của chính hồ sơ đó", () => {
    const page = readFileSync("app/applications/[id]/page.tsx", "utf8");
    expect(page).toContain("canDecideApplicationResult(adminUser?.role, roleApplied)");
    expect(page).not.toMatch(/canDecide\(adminUser[?][.]role\)/);
  });
});
