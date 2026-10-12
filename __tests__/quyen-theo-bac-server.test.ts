/**
 * Quyền theo bậc ở tầng mã: ai tạo được tài khoản, đặt được cấp nào, và ai bổ
 * nhiệm được trainer / cross mentor.
 *
 * Bộ test Postgres (`quyen-theo-bac-postgres.test.ts`) khoá database. Bộ này
 * khoá nửa còn lại: máy chủ từ chối TRƯỚC khi đụng tới nhà cung cấp Auth, và
 * câu trả lời của máy chủ khớp với thứ màn hình mời.
 *
 * Gọi thẳng `createManagedAdminUser` / `updateManagedAdminUser`, giữ bộ điều
 * phối `manual-staff-provisioning` là hàng thật.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/program-scope", () => ({ getAdminScopeContext: vi.fn(), canOperateSeason: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({
    envName: "SUPABASE_SERVICE_ROLE_KEY", loaded: true, usesPublicPrefix: false, sameAsAnonKey: false
  }))
}));
vi.mock("@/lib/account-auth-ownership", () => ({ findExactAuthUsers: vi.fn(), resolveAuthOwnership: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendStaffInvite: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));

import { createManagedAdminUser, updateManagedAdminUser } from "@/lib/admin-users";
import { addMembershipRoleAction } from "@/app/actions/membership-lifecycle";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { findExactAuthUsers } from "@/lib/account-auth-ownership";
import { sendStaffInvite } from "@/lib/email";
import {
  canAppointMentorRole,
  canChangeSeasonMembership,
  canCreateAdminAccount,
  creatableAdminRoles,
  manageableAdminRoles,
  scopeRoleWithinAdminRole
} from "@/lib/permissions";
import {
  APPOINTMENT_DENIED_MESSAGE,
  MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLE_LABELS,
  isMembershipRole,
  membershipChangeDeniedMessage
} from "@/lib/membership-lifecycle";
import { participantRoleLabel } from "@/lib/participant-home";

const PROGRAM = "11111111-1111-4111-8111-111111111111";
const SEASON = "22222222-2222-4222-8222-222222222222";
const AUTH_ID = "33333333-3333-4333-8333-333333333333";
const TARGET = "44444444-4444-4444-8444-444444444444";
const ACTOR = "55555555-5555-4555-8555-555555555555";
const PERSON = "66666666-6666-4666-8666-666666666666";
const EMAIL = "nguoi.moi@example.com";

const ALL_ROLES = ["super_admin", "admin", "core_team", "support_team", "reviewer", "viewer"];

/**
 * `existing` là dòng admin_users mà phép tìm theo email / id trả về.
 * `lookupError` giả một lần đọc bảng hỏng.
 */
function makeClient(options: { existing?: Record<string, unknown> | null; lookupError?: boolean; rpcError?: string } = {}) {
  const generateLink = vi.fn(async ({ email }: { type: string; email: string }) => ({
    data: { user: { id: AUTH_ID, email }, properties: { hashed_token: "token" } }, error: null
  }));
  const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (options.rpcError) return { data: null, error: { message: options.rpcError } };
    if (name === "vam062_begin_auth_operation") return { data: [{ accepted: true }], error: null };
    if (name === "vam063_add_membership_role") return { data: [{ outcome_status: "created", membership_id: TARGET }], error: null };
    return { data: null, error: null };
  });
  const from = vi.fn((table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      maybeSingle: async () => {
        if (table === "programs") return { data: { id: PROGRAM, is_active: true }, error: null };
        if (table === "seasons") return { data: { id: SEASON, program_id: PROGRAM }, error: null };
        if (table === "admin_users") {
          if (options.lookupError) return { data: null, error: { message: "boom" } };
          return { data: options.existing === undefined ? null : options.existing, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null })
    };
    return chain;
  });
  return { rpc, from, generateLink, auth: { admin: { generateLink, deleteUser: vi.fn(async () => ({ error: null })) } } };
}

function actAs(role: string, status = "active") {
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR, role, status } as never);
}
function create(overrides: Record<string, unknown> = {}) {
  return createManagedAdminUser({
    email: EMAIL, fullName: "Người Mới", role: "core_team", status: "invited",
    programId: PROGRAM, seasonId: SEASON, scopeRole: "operations", scopeStatus: "active", ...overrides
  });
}
function update(overrides: Record<string, unknown> = {}) {
  return updateManagedAdminUser({
    id: TARGET, fullName: "Tên Mới", role: "core_team", status: "active", scopeId: "",
    programId: PROGRAM, seasonId: SEASON, scopeRole: "operations", scopeStatus: "active", ...overrides
  });
}
const rpcNames = (client: ReturnType<typeof makeClient>) => client.rpc.mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(findExactAuthUsers)
    .mockResolvedValueOnce({ ok: true, users: [] } as never)
    .mockResolvedValueOnce({ ok: true, users: [{ id: AUTH_ID }] } as never);
  vi.mocked(sendStaffInvite).mockResolvedValue({ ok: true, skipped: false } as never);
});

describe("1. ai tạo được tài khoản, và đặt được cấp nào", () => {
  it("chỉ super admin và admin tạo được", () => {
    expect(ALL_ROLES.filter((role) => canCreateAdminAccount(role))).toEqual(["super_admin", "admin"]);
    expect(canCreateAdminAccount(null)).toBe(false);
    expect(canCreateAdminAccount(undefined)).toBe(false);
  });

  it("super admin đặt được mọi cấp như trước; admin chỉ đặt được cấp mình quản", () => {
    expect([...creatableAdminRoles("super_admin")].sort()).toEqual([...ALL_ROLES].sort());
    expect(creatableAdminRoles("admin")).toEqual(manageableAdminRoles("admin"));
    expect(creatableAdminRoles("admin")).toEqual(["core_team", "support_team", "reviewer", "viewer"]);
  });

  it("Core team quản được cấp dưới nhưng không tạo được cấp nào", () => {
    expect(manageableAdminRoles("core_team").length).toBeGreaterThan(0);
    expect(creatableAdminRoles("core_team")).toEqual([]);
    expect(creatableAdminRoles("support_team")).toEqual([]);
    expect(creatableAdminRoles(null)).toEqual([]);
  });

  it.each([
    ["core_team", "operations", true], ["core_team", "read", true], ["core_team", "full_access", false],
    ["support_team", "operations", true], ["support_team", "full_access", false],
    ["reviewer", "review", true], ["reviewer", "operations", false],
    ["viewer", "read", true], ["viewer", "review", false],
    ["admin", "read", false], ["super_admin", "full_access", false],
    ["core_team", "", false], ["core_team", "khac", false], ["", "read", false]
  ] as const)("phạm vi: cấp %s nhận \"%s\": %s", (role, scope, expected) => {
    expect(scopeRoleWithinAdminRole(role, scope)).toBe(expected);
  });
});

describe("2. admin tạo tài khoản", () => {
  it("tạo được tài khoản Core team: nhật ký, tài khoản và thư đều mang id của admin", async () => {
    actAs("admin");
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create();

    expect(result.ok).toBe(true);
    expect(rpcNames(client)).toContain("vam062_begin_auth_operation");
    const commit = client.rpc.mock.calls.find((call) => call[0] === "vam062_admin_mutation_atomic");
    expect(commit?.[1]).toMatchObject({ p_actor_admin_user_id: ACTOR, p_operation: "upsert" });
    expect((commit?.[1] as any).p_payload).toMatchObject({ email: EMAIL, role: "core_team", scope_role: "operations", status: "active" });
    expect(sendStaffInvite).toHaveBeenCalledTimes(1);
  });

  it.each(["admin", "super_admin"])("KHÔNG tạo được tài khoản cấp %s — và không đụng tới Auth", async (role) => {
    actAs("admin");
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create({ role, scopeRole: "operations" });

    expect(result).toMatchObject({ ok: false, status: "rejected", failureClass: "account_tier_denied", reconciliationRequired: false });
    expect(result.message).toContain("không thể tạo tài khoản cấp");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.generateLink).not.toHaveBeenCalled();
    expect(sendStaffInvite).not.toHaveBeenCalled();
  });

  it("phạm vi vượt cấp bị từ chối trước khi đụng tới Auth", async () => {
    actAs("admin");
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create({ role: "reviewer", scopeRole: "operations" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vượt quá cấp");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.generateLink).not.toHaveBeenCalled();
  });

  it.each(["super_admin", "admin"])("email đã thuộc một tài khoản %s: từ chối, không ghi đè", async (existingRole) => {
    actAs("admin");
    const client = makeClient({ existing: { role: existingRole } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("đã thuộc một tài khoản bạn không quản được");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.generateLink).not.toHaveBeenCalled();
  });

  it("dòng đang lưu thiếu vai trò: coi như không quản được", async () => {
    actAs("admin");
    const client = makeClient({ existing: { role: null } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    expect((await create()).ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("không đọc được bảng tài khoản thì KHÔNG tạo — lỗi hạ tầng không thành quyền", async () => {
    actAs("admin");
    const client = makeClient({ lookupError: true });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Không kiểm tra được");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.generateLink).not.toHaveBeenCalled();
  });

  it("email đã thuộc một tài khoản cấp dưới thì đi tiếp như super admin vẫn đi", async () => {
    actAs("admin");
    const client = makeClient({ existing: { id: TARGET, role: "reviewer" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    await create();

    expect(rpcNames(client)).toContain("vam062_begin_auth_operation");
  });
});

describe("3. những người không tạo được tài khoản", () => {
  it.each(["core_team", "support_team", "reviewer", "viewer"])("%s bị từ chối, không lệnh nào được gọi", async (role) => {
    actAs(role);
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create({ role: "viewer", scopeRole: "read" });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Chỉ super admin và admin");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.generateLink).not.toHaveBeenCalled();
  });

  it("admin đã bị tạm khoá cũng bị từ chối", async () => {
    actAs("admin", "inactive");
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    expect((await create()).ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("super admin giữ nguyên: tạo được admin với full_access, không bị hỏi bậc", async () => {
    actAs("super_admin");
    // Dòng trả về không có `role` — đúng hình dạng mà test cũ của luồng này dùng.
    const client = makeClient({ existing: { id: TARGET } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await create({ role: "admin", scopeRole: "full_access" });

    expect(result.ok).toBe(true);
    const commit = client.rpc.mock.calls.find((call) => call[0] === "vam062_admin_mutation_atomic");
    expect((commit?.[1] as any).p_payload).toMatchObject({ role: "admin", scope_role: "full_access" });
  });
});

describe("4. sửa tài khoản: phạm vi không là cửa sau", () => {
  it("admin sửa một tài khoản Core team: gọi đúng một lệnh ghi, mang id của admin", async () => {
    actAs("admin");
    const client = makeClient({ existing: { id: TARGET, role: "core_team", status: "active" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await update();

    expect(result.ok).toBe(true);
    expect(rpcNames(client)).toEqual(["vam062_admin_mutation_atomic"]);
    expect(client.rpc.mock.calls[0][1]).toMatchObject({ p_actor_admin_user_id: ACTOR, p_operation: "update", p_target_admin_user_id: TARGET });
  });

  it.each([
    ["admin", "core_team", "full_access"],
    ["admin", "reviewer", "operations"],
    ["core_team", "viewer", "review"]
  ])("%s đặt cấp %s với phạm vi %s: từ chối, không ghi", async (actorRole, nextRole, scopeRole) => {
    actAs(actorRole);
    const client = makeClient({ existing: { id: TARGET, role: "viewer", status: "active" } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await update({ role: nextRole, scopeRole });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("vượt quá cấp");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("database từ chối thì máy chủ báo thất bại, không báo \"đã cập nhật\"", async () => {
    actAs("admin");
    const client = makeClient({ existing: { id: TARGET, role: "core_team", status: "active" }, rpcError: "VAM120 target above actor tier" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await update();

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("Đã cập nhật");
  });
});

describe("5. Cross mentor và trainer: bổ nhiệm là việc của Core team trở lên", () => {
  it("cross_mentor là một vai trò thêm tay được, có nhãn, và nhãn chỉ có một cách viết", () => {
    expect(MEMBERSHIP_ROLES).toEqual(["mentor", "mentee", "trainer", "speaker", "cross_mentor"]);
    expect(isMembershipRole("cross_mentor")).toBe(true);
    expect(MEMBERSHIP_ROLE_LABELS.cross_mentor).toBe("Cross mentor");
    expect(participantRoleLabel("cross_mentor")).toBe("Cross mentor");
  });

  it.each(["trainer", "cross_mentor", " Cross_Mentor "])("%s: chỉ Core team, admin, super admin", (membershipRole) => {
    expect(ALL_ROLES.filter((role) => canChangeSeasonMembership(role, membershipRole))).toEqual(["super_admin", "admin", "core_team"]);
    expect(canChangeSeasonMembership(null, membershipRole)).toBe(false);
  });

  it("các vai trò khác giữ nguyên bậc cũ", () => {
    const who = (membershipRole: string) => ALL_ROLES.filter((role) => canChangeSeasonMembership(role, membershipRole));
    expect(who("mentor")).toEqual(["super_admin", "admin", "core_team"]);
    expect(who("mentee")).toEqual(["super_admin", "admin", "core_team", "support_team"]);
    expect(who("speaker")).toEqual(["super_admin", "admin", "core_team", "support_team"]);
  });

  it("canAppointMentorRole đi cùng bậc với đổi trạng thái mentor", () => {
    expect(ALL_ROLES.filter((role) => canAppointMentorRole(role))).toEqual(["super_admin", "admin", "core_team"]);
  });

  it("lời từ chối nói đúng ai được làm", () => {
    expect(membershipChangeDeniedMessage("cross_mentor")).toBe(APPOINTMENT_DENIED_MESSAGE);
    expect(membershipChangeDeniedMessage("trainer")).toBe(APPOINTMENT_DENIED_MESSAGE);
    expect(APPOINTMENT_DENIED_MESSAGE).toContain("Core Team");
    expect(membershipChangeDeniedMessage("mentor")).not.toBe(APPOINTMENT_DENIED_MESSAGE);
  });

  function form(role: string) {
    const data = new FormData();
    for (const [key, value] of Object.entries({ person_id: PERSON, program_id: PROGRAM, season_id: SEASON, role, reason: "BTC đề nghị" })) data.set(key, value);
    return data;
  }
  function membershipActor(role: string) {
    vi.mocked(getAdminScopeContext).mockResolvedValue({ adminUser: { id: ACTOR, role, status: "active" } } as never);
    vi.mocked(canOperateSeason).mockResolvedValue(true as never);
  }

  it("Core team bổ nhiệm cross mentor: đúng một lệnh ghi, đúng vai trò", async () => {
    membershipActor("core_team");
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await addMembershipRoleAction({ ok: false, message: "" }, form("cross_mentor"));

    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith("vam063_add_membership_role", expect.objectContaining({
      p_actor_admin_user_id: ACTOR, p_person_id: PERSON, p_season_id: SEASON, p_role: "cross_mentor"
    }));
  });

  it.each(["cross_mentor", "trainer"])("Support team gửi thẳng form bổ nhiệm %s: bị từ chối, không lệnh ghi nào", async (role) => {
    // Ô chọn đã lọc trên màn hình không phải một phép kiểm — form là thứ người gửi tự đặt được.
    membershipActor("support_team");
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await addMembershipRoleAction({ ok: false, message: "" }, form(role));

    expect(result).toEqual({ ok: false, message: APPOINTMENT_DENIED_MESSAGE });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("Support team vẫn thêm được mentee", async () => {
    membershipActor("support_team");
    const client = makeClient();
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    expect((await addMembershipRoleAction({ ok: false, message: "" }, form("mentee"))).ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("database từ chối bổ nhiệm thì người dùng nhận đúng câu giải thích, không phải câu chung chung", async () => {
    membershipActor("core_team");
    const client = makeClient({ rpcError: "VAM120 appointment requires core team" });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(client as never);

    const result = await addMembershipRoleAction({ ok: false, message: "" }, form("cross_mentor"));

    expect(result).toEqual({ ok: false, message: APPOINTMENT_DENIED_MESSAGE });
  });
});
