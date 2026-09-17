/** @vitest-environment jsdom */
/**
 * Đổi "Tham dự / Không tham dự" trên hồ sơ CRM, chia theo vai trò (chủ dự án chốt 17/09/2026):
 * mentor do Core Team trở lên đổi; mentee thêm cả Support Team.
 *
 * Trước đó cổng duy nhất là quyền operations trên mùa — Support Team mang quyền đó, nên đổi
 * được cả mentor. Canh: hàm quyền, bảng trạng thái tham dự, hai server action (vai trò lấy từ
 * dòng đã lưu, không từ form), và màn hình không mời một nút mà server sẽ từ chối.
 */
import { readFileSync } from "node:fs";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseServiceRoleClient: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { revalidatePath } from "next/cache";
import { addMembershipRoleAction, transitionMembershipAction } from "@/app/actions/membership-lifecycle";
import { MembershipLifecycleControls } from "@/app/people/[id]/membership-lifecycle-controls";
import {
  initialMembershipLifecycleState,
  membershipChangeDeniedMessage,
  otherMembershipActions,
  participationView
} from "@/lib/membership-lifecycle";
import {
  canChangeMenteeParticipation,
  canChangeMentorParticipation,
  canChangeSeasonMembership
} from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";

const PERSON = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "22222222-2222-4222-8222-222222222222";
const PROGRAM = "33333333-3333-4333-8333-333333333333";
const SEASON = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";

const ADMIN_ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"] as const;

describe("1. hàm quyền", () => {
  it("mentor: Super Admin, Admin, Core Team — không Support Team", () => {
    const allowed = ADMIN_ROLES.filter((role) => canChangeMentorParticipation(role));
    expect(allowed).toEqual(["super_admin", "admin", "core_team"]);
  });

  it("mentee: thêm Support Team", () => {
    const allowed = ADMIN_ROLES.filter((role) => canChangeMenteeParticipation(role));
    expect(allowed).toEqual(["super_admin", "admin", "core_team", "support_team"]);
  });

  it("một cửa theo vai trò của membership, không phân biệt hoa thường hay khoảng trắng", () => {
    expect(canChangeSeasonMembership("support_team", " Mentor ")).toBe(false);
    expect(canChangeSeasonMembership("support_team", "MENTEE")).toBe(true);
    expect(canChangeSeasonMembership("core_team", "mentor")).toBe(true);
  });

  it("vai trò khác của mùa giữ đúng các tầng từng có quyền operations; reviewer, viewer, rỗng thì không", () => {
    for (const membershipRole of ["trainer", "speaker", "interviewer", "reviewer"]) {
      expect(ADMIN_ROLES.filter((role) => canChangeSeasonMembership(role, membershipRole))).toEqual([
        "super_admin",
        "admin",
        "core_team",
        "support_team"
      ]);
    }
    for (const role of [null, undefined, "", "Admin"]) {
      expect(canChangeSeasonMembership(role, "mentee")).toBe(false);
      expect(canChangeSeasonMembership(role, "trainer")).toBe(false);
    }
  });
});

describe("2. bảng trạng thái tham dự", () => {
  it("đang tham dự chỉ chuyển sang Không tham dự bằng opt_out — không phải rút hay hủy", () => {
    expect(participationView("active")).toEqual({ label: "Đang tham dự", moves: ["opt_out"] });
  });

  it("mọi trạng thái không tham dự chuyển về Tham dự", () => {
    expect(participationView("opted_out")).toEqual({ label: "Không tham dự", moves: ["reactivate"] });
    for (const status of ["withdrawn", "cancelled"]) {
      const view = participationView(status);
      expect(view.label.startsWith("Không tham dự")).toBe(true);
      expect(view.moves).toEqual(["reactivate"]);
    }
  });

  it("tạm nghỉ đi được cả hai chiều; được mời chỉ Không tham dự; đã hoàn thành thì không đổi", () => {
    expect(participationView("paused").moves).toEqual(["reactivate", "opt_out"]);
    expect(participationView("invited").moves).toEqual(["opt_out"]);
    expect(participationView("completed")).toEqual({ label: "Đã hoàn thành mùa", moves: [] });
  });

  it("mentor/mentee: hai lần chuyển tham dự không lặp lại ở Thao tác khác; vai trò khác giữ nguyên", () => {
    expect(otherMembershipActions("mentor", "active")).toEqual(["pause", "withdraw", "cancel", "remove_role"]);
    expect(otherMembershipActions("mentee", "opted_out")).toEqual(["cancel"]);
    expect(otherMembershipActions("trainer", "active")).toContain("opt_out");
  });

  it("câu từ chối nói rõ ai được đổi", () => {
    expect(membershipChangeDeniedMessage("mentor")).toContain("Core Team");
    expect(membershipChangeDeniedMessage("mentor")).not.toContain("Support Team");
    expect(membershipChangeDeniedMessage("mentee")).toContain("Support Team");
  });
});

describe("3. server action", () => {
  function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  }

  function query(single: unknown) {
    const chain: any = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: vi.fn(async () => single) };
    return chain;
  }

  function client(membership: { role: string; status: string }, rpcOutcome = "transitioned") {
    const row = { id: MEMBERSHIP, person_id: PERSON, program_id: PROGRAM, season_id: SEASON, ...membership };
    const membershipQuery = query({ data: row, error: null });
    const seasonQuery = query({ data: { id: SEASON, program_id: PROGRAM }, error: null });
    const rpc = vi.fn(async () => ({ data: [{ outcome_status: rpcOutcome }], error: null }));
    const from = vi.fn((table: string) => (table === "person_season_memberships" ? membershipQuery : seasonQuery));
    return { from, rpc, membershipQuery };
  }

  function actingAs(role: string) {
    vi.mocked(getAdminScopeContext).mockResolvedValue({
      adminUser: { id: ACTOR, role, status: "active", auth_user_id: "auth-synthetic" } as any,
      authUserId: "auth-synthetic",
      globalRole: role,
      isSuperAdmin: false,
      programScopes: [],
      scopeError: null
    } as any);
  }

  function transition(operation: string, expectedStatus: string, extra: Record<string, string> = {}) {
    return transitionMembershipAction(
      initialMembershipLifecycleState,
      form({ membership_id: MEMBERSHIP, person_id: PERSON, expected_status: expectedStatus, operation, reason: "", ...extra })
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canOperateSeason).mockResolvedValue(true);
  });

  it("Support Team có quyền operations mùa vẫn không đổi được mentor, và không gọi RPC nào", async () => {
    const db = client({ role: "mentor", status: "active" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    actingAs("support_team");
    const result = await transition("opt_out", "active");
    expect(result).toEqual({ ok: false, message: membershipChangeDeniedMessage("mentor") });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("vai trò lấy từ dòng đã lưu: form tự khai 'mentee' về một mentor vẫn bị từ chối", async () => {
    const db = client({ role: "mentor", status: "active" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    actingAs("support_team");
    const result = await transition("opt_out", "active", { role: "mentee", membership_role: "mentee" });
    expect(result.ok).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.membershipQuery.select).toHaveBeenCalledWith("id,person_id,program_id,season_id,role,status");
  });

  it("Support Team chuyển mentee sang Không tham dự: đúng RPC opt_out, actor của phiên", async () => {
    const db = client({ role: "mentee", status: "active" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    actingAs("support_team");
    const result = await transition("opt_out", "active", { actor_admin_user_id: "forged" });
    expect(result).toMatchObject({ ok: true, message: "Đã chuyển sang Không tham dự và ghi lịch sử kiểm toán." });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("vam063_opt_out_membership", {
      p_actor_admin_user_id: ACTOR,
      p_membership_id: MEMBERSHIP,
      p_reason: null
    });
    expect(revalidatePath).toHaveBeenCalledWith("/mentors");
    expect(revalidatePath).toHaveBeenCalledWith("/mentees");
  });

  it("Core Team chuyển mentor từ Không tham dự về Tham dự: RPC reactivate", async () => {
    const db = client({ role: "mentor", status: "opted_out" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    actingAs("core_team");
    const result = await transition("reactivate", "opted_out");
    expect(result).toMatchObject({ ok: true, message: "Đã chuyển sang Tham dự và ghi lịch sử kiểm toán." });
    expect(db.rpc).toHaveBeenCalledWith("vam063_reactivate_membership", expect.objectContaining({ p_actor_admin_user_id: ACTOR }));
  });

  it("Support Team cũng không dùng Thao tác khác để vòng qua mentor", async () => {
    for (const [operation, status] of [["withdraw", "active"], ["pause", "active"], ["cancel", "opted_out"], ["reactivate", "opted_out"]]) {
      const db = client({ role: "mentor", status });
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
      actingAs("support_team");
      const result = await transition(operation, status, { reason: "synthetic" });
      expect(result.ok).toBe(false);
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it("reviewer hay viewer lỡ được cấp quyền operations cũng không đổi được mentee", async () => {
    for (const role of ["reviewer", "viewer"]) {
      const db = client({ role: "mentee", status: "active" });
      vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
      actingAs(role);
      expect((await transition("opt_out", "active")).ok).toBe(false);
      expect(db.rpc).not.toHaveBeenCalled();
    }
  });

  it("thêm vai trò: Support Team không thêm được mentor, thêm được mentee; Core Team thêm được mentor", async () => {
    const add = (role: string) =>
      addMembershipRoleAction(
        initialMembershipLifecycleState,
        form({ person_id: PERSON, program_id: PROGRAM, season_id: SEASON, role, reason: "Tiếp tục tham gia Mùa 12" })
      );

    let db = client({ role: "mentor", status: "active" }, "created");
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    actingAs("support_team");
    expect(await add("mentor")).toEqual({ ok: false, message: membershipChangeDeniedMessage("mentor") });
    expect(db.rpc).not.toHaveBeenCalled();

    expect((await add("mentee")).ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("vam063_add_membership_role", expect.objectContaining({ p_role: "mentee", p_actor_admin_user_id: ACTOR }));

    db = client({ role: "mentor", status: "active" }, "created");
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(db as any);
    actingAs("core_team");
    expect((await add("mentor")).ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("vam063_add_membership_role", expect.objectContaining({ p_role: "mentor" }));
  });
});

describe("4. hồ sơ CRM", () => {
  const PROD_UEHM_PROGRAM = "61701ee8-64a6-4673-b261-ba12ce9a3ee3";
  const PROD_S11 = "710f4ec9-1cf7-461e-98d4-f33799047add";
  const PROD_S12 = "32fbfc86-1d67-4158-b9d4-1e6bff48b2c1";
  const PROGRAMS = [{ id: PROD_UEHM_PROGRAM, label: "UEHM", code: "UEHM", isActive: true }];
  const SEASONS = [
    { id: PROD_S11, label: "Mùa 11", code: "UEHM-S11", programId: PROD_UEHM_PROGRAM },
    { id: PROD_S12, label: "Mùa 12", code: "UEHM-S12", programId: PROD_UEHM_PROGRAM }
  ];
  const MENTOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const MENTEE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function membership(id: string, role: string, status: string, season: "S11" | "S12" = "S12") {
    return {
      id,
      role,
      status,
      intakeBatchCode: null,
      programLabel: "UEHM",
      seasonLabel: season === "S12" ? "Mùa 12" : "Mùa 11",
      programCode: "UEHM",
      seasonCode: `UEHM-${season}`,
      programId: PROD_UEHM_PROGRAM,
      seasonId: season === "S12" ? PROD_S12 : PROD_S11
    };
  }

  function renderAs(adminRole: string | null, memberships: ReturnType<typeof membership>[]) {
    return render(
      <MembershipLifecycleControls
        personId={PERSON}
        adminRole={adminRole}
        memberships={memberships}
        programs={PROGRAMS}
        seasons={SEASONS}
        enabled
        canOperateUehmS12
      />
    );
  }

  function section(container: HTMLElement, id: string) {
    const found = container.querySelector(`[data-vam-membership-id="${id}"]`) as HTMLElement | null;
    if (!found) throw new Error(`missing section ${id}`);
    return found;
  }

  function hidden(form: HTMLElement, name: string) {
    return (form.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value;
  }

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("Support Team: mentor không có nút nào và thấy lý do; mentee có nút Chuyển sang Không tham dự", () => {
    const { container } = renderAs("support_team", [
      membership(MENTOR_ID, "mentor", "active"),
      membership(MENTEE_ID, "mentee", "active")
    ]);

    const mentor = section(container, MENTOR_ID);
    expect(mentor.querySelectorAll("form")).toHaveLength(0);
    expect(mentor.querySelectorAll("button")).toHaveLength(0);
    expect(mentor.textContent).toContain(membershipChangeDeniedMessage("mentor"));
    expect(mentor.textContent).toContain("Mentor · Đang tham dự");

    const mentee = section(container, MENTEE_ID);
    const button = within(mentee).getByRole("button", { name: "Chuyển sang Không tham dự" });
    const toggle = button.closest("form") as HTMLElement;
    expect(hidden(toggle, "operation")).toBe("opt_out");
    expect(hidden(toggle, "membership_id")).toBe(MENTEE_ID);
    expect(hidden(toggle, "expected_status")).toBe("active");
  });

  it("Core Team: mentor Không tham dự có nút Chuyển sang Tham dự (reactivate), không lặp Kích hoạt lại", () => {
    const { container } = renderAs("core_team", [membership(MENTOR_ID, "mentor", "opted_out")]);
    const mentor = section(container, MENTOR_ID);
    expect(mentor.textContent).toContain("Mentor · Không tham dự");
    const button = within(mentor).getByRole("button", { name: "Chuyển sang Tham dự" });
    expect(hidden(button.closest("form") as HTMLElement, "operation")).toBe("reactivate");
    expect(within(mentor).queryByRole("button", { name: "Kích hoạt lại" })).toBeNull();
    expect(within(mentor).queryByRole("button", { name: "Chuyển sang Không tham dự" })).toBeNull();
  });

  it("thiếu vai trò người xem: không membership nào có nút, không có form thêm vai trò", () => {
    const { container } = renderAs(null, [membership(MENTEE_ID, "mentee", "active")]);
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });

  it("hỏi lại trước khi chuyển, nói rõ hệ quả; bấm Huỷ thì form không gửi", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { container } = renderAs("support_team", [membership(MENTEE_ID, "mentee", "active")]);
    const button = within(section(container, MENTEE_ID)).getByRole("button", { name: "Chuyển sang Không tham dự" });
    const submitted = fireEvent.submit(button.closest("form") as HTMLElement);
    expect(submitted).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    const message = String(confirm.mock.calls[0][0]);
    expect(message).toContain('Chuyển Mentee · Mùa 12 sang "Không tham dự"?');
    expect(message).toContain("không được mời tạo tài khoản");
  });

  it("form thêm vai trò: Support Team không thấy Mentor; Core Team thấy", () => {
    const optionsFor = (adminRole: string) => {
      const view = renderAs(adminRole, []);
      const select = view.container.querySelector('select[name="role"]') as HTMLSelectElement;
      const values = Array.from(select.options).map((option) => option.value).filter(Boolean);
      cleanup();
      return values;
    };
    expect(optionsFor("support_team")).toEqual(["mentee", "trainer", "speaker"]);
    expect(optionsFor("core_team")).toEqual(["mentor", "mentee", "trainer", "speaker"]);
  });

  it("Tiếp tục sang Mùa 12: Support Team chỉ thấy cho mentee, Core Team thấy cả mentor", () => {
    const s11 = [membership(MENTOR_ID, "mentor", "completed", "S11"), membership(MENTEE_ID, "mentee", "completed", "S11")];
    const continuations = (adminRole: string) => {
      const view = renderAs(adminRole, s11);
      const roles = Array.from(view.container.querySelectorAll('button[name="continue_s12"]')).map((button) =>
        hidden(button.closest("form") as HTMLElement, "role")
      );
      cleanup();
      return roles;
    };
    expect(continuations("support_team")).toEqual(["mentee"]);
    expect(continuations("core_team")).toEqual(["mentor", "mentee"]);
  });

  it("trang hồ sơ truyền đúng vai trò của người đang đăng nhập", () => {
    const page = readFileSync("app/people/[id]/page.tsx", "utf8");
    expect(page).toContain("<MembershipLifecycleControls personId={params.id}");
    expect(page).toContain("adminRole={adminUser.role}");
  });
});
