/**
 * Xoá hẳn một người, và xoá hẳn một tài khoản ban tổ chức.
 *
 * ---------------------------------------------------------------------------
 * ĐIỀU DỄ SAI NHẤT: XOÁ MỘT NGƯỜI CÒN DỮ LIỆU THẬT
 * ---------------------------------------------------------------------------
 * `people` có khoá ngoại SET NULL từ `matches` và `applications`. Xoá một mentor
 * đang có cặp ghép thì lệnh xoá CHẠY THÀNH CÔNG, và cặp ghép ở lại với một ô
 * trống chỗ tên mentor. Không có lỗi nào hiện ra, không ai biết cho tới khi mở
 * trang ghép cặp — và lúc đó không dựng lại được.
 *
 * Nên phép kiểm quan trọng nhất ở đây không phải "xoá được không", mà là "có
 * TỪ CHỐI đúng lúc không". Mục 2 và mục 4 canh chính điều đó.
 *
 * Phân loại: DIRECT PRODUCTION TESTS — gọi thẳng lib/person-delete.ts,
 * lib/admin-users.ts và lib/permissions.ts.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getCurrentAdminUser: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServiceRoleClient: vi.fn(),
  getSupabaseServiceRoleEnvStatus: vi.fn(() => ({
    envName: "SUPABASE_SERVICE_ROLE_KEY",
    loaded: true,
    usesPublicPrefix: false,
    sameAsAnonKey: false
  }))
}));
vi.mock("@/lib/account-auth-ownership", () => ({
  findExactAuthUsers: vi.fn(),
  resolveAuthOwnership: vi.fn()
}));
vi.mock("@/lib/email", () => ({ sendStaffInvite: vi.fn() }));
vi.mock("@/lib/public-url", () => ({ getPublicOrigin: vi.fn(async () => "https://os.example.org") }));

import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { deletePersonFromSystem, getPersonDeleteReport } from "@/lib/person-delete";
import { deleteManagedAdminAccount } from "@/lib/admin-users";
import {
  MANAGEABLE_ADMIN_ROLES,
  canCreateAdminAccount,
  canDeleteMentee,
  canDeleteMentor,
  canDeletePerson,
  canManageAdminAccount,
  canOpenAdminUsers,
  manageableAdminRoles
} from "@/lib/permissions";

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_ID = "44444444-4444-4444-8444-444444444444";

const PERSON = { id: PERSON_ID, full_name: "Phạm Hồng Ngọc", email: "ngoc@example.com" };

/** Bản kê mà hàm database trả về; test dựng lại đúng hình dạng đó. */
function personReport(patch: Record<string, unknown> = {}) {
  return {
    found: true,
    person: PERSON,
    is_mentor: true,
    is_mentee: false,
    other_roles: [],
    season_ids: [],
    blockers: {},
    removes: { membership: 1, ho_so_mentor: 1 },
    orphans: {},
    can_delete: true,
    ...patch
  };
}

function accountReport(patch: Record<string, unknown> = {}) {
  return {
    found: true,
    account: {
      id: TARGET_ID,
      full_name: "Trần Thị B",
      email: "b@example.com",
      role: "support_team",
      status: "active",
      auth_user_id: AUTH_ID
    },
    blockers: {},
    removes: { bai_cham_da_huy: 10, pham_vi: 1 },
    can_delete: true,
    ...patch
  };
}

type RpcCall = { name: string; args: Record<string, unknown> };

function client(options: {
  reports?: Record<string, unknown>;
  rpcError?: Record<string, { message: string }>;
  targetRole?: string;
  deleteUserFails?: boolean;
}) {
  const calls: RpcCall[] = [];
  const deleteUser = vi.fn(async () =>
    options.deleteUserFails ? { error: { message: "auth down" } } : { error: null }
  );
  return {
    calls,
    deleteUser,
    client: {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const failure = options.rpcError?.[name];
        if (failure) return { data: null, error: failure };
        return { data: options.reports?.[name] ?? null, error: null };
      }),
      from: vi.fn(() => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { role: options.targetRole ?? "support_team" }, error: null })
        };
        return chain;
      }),
      auth: { admin: { deleteUser } }
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR_ID, role: "core_team", status: "active" } as never);
});

// ───────────────────────────────────────────────────────────────────────────

describe("1. ai được xoá ai", () => {
  it("mentor: admin và core team, KHÔNG có support team", () => {
    expect(canDeleteMentor("admin")).toBe(true);
    expect(canDeleteMentor("core_team")).toBe(true);
    expect(canDeleteMentor("support_team")).toBe(false);
    expect(canDeleteMentor("reviewer")).toBe(false);
  });

  it("mentee: support team có mặt", () => {
    expect(canDeleteMentee("support_team")).toBe(true);
    expect(canDeleteMentee("reviewer")).toBe(false);
  });

  it("người vừa là mentor vừa là mentee tính theo mức CHẶT hơn", () => {
    expect(canDeletePerson("support_team", { isMentee: true })).toBe(true);
    expect(canDeletePerson("support_team", { isMentee: true, isMentor: true })).toBe(false);
  });

  it("mentee mang thêm vai trò khác cũng tính theo mức chặt hơn", () => {
    expect(canDeletePerson("support_team", { isMentee: true, hasOtherRole: true })).toBe(false);
    expect(canDeletePerson("core_team", { isMentee: true, hasOtherRole: true })).toBe(true);
  });

  it("không rõ vai trò thì đòi mức chặt — fail-closed", () => {
    expect(canDeletePerson("support_team", null)).toBe(false);
    expect(canDeletePerson(null, { isMentee: true })).toBe(false);
  });
});

describe("2. bậc quản lý tài khoản", () => {
  it("chỉ quản được cấp THẤP HƠN mình", () => {
    expect(canManageAdminAccount("admin", "core_team")).toBe(true);
    expect(canManageAdminAccount("core_team", "support_team")).toBe(true);
    expect(canManageAdminAccount("super_admin", "admin")).toBe(true);
  });

  it("không ai quản được người ngang cấp", () => {
    expect(canManageAdminAccount("admin", "admin")).toBe(false);
    expect(canManageAdminAccount("core_team", "core_team")).toBe(false);
    expect(canManageAdminAccount("super_admin", "super_admin")).toBe(false);
  });

  it("không ai quản ngược lên cấp trên", () => {
    expect(canManageAdminAccount("core_team", "admin")).toBe(false);
    expect(canManageAdminAccount("admin", "super_admin")).toBe(false);
    expect(canManageAdminAccount("support_team", "reviewer")).toBe(false);
  });

  it("vai trò lạ hoặc rỗng: không quản được gì", () => {
    expect(manageableAdminRoles("nguoi_la")).toEqual([]);
    expect(canManageAdminAccount(null, "viewer")).toBe(false);
    expect(canManageAdminAccount("admin", "")).toBe(false);
    expect(canManageAdminAccount("admin", null)).toBe(false);
  });

  it("không bảng nào tự chứa vai trò của chính mình", () => {
    for (const [role, managed] of Object.entries(MANAGEABLE_ADMIN_ROLES)) {
      expect(managed, `${role} tự quản chính mình`).not.toContain(role);
    }
  });

  it("mở được trang: super admin, admin, core team", () => {
    expect(canOpenAdminUsers("super_admin")).toBe(true);
    expect(canOpenAdminUsers("admin")).toBe(true);
    expect(canOpenAdminUsers("core_team")).toBe(true);
    expect(canOpenAdminUsers("support_team")).toBe(false);
    expect(canOpenAdminUsers("viewer")).toBe(false);
  });

  it("tạo tài khoản mới vẫn chỉ của super admin", () => {
    expect(canCreateAdminAccount("super_admin")).toBe(true);
    expect(canCreateAdminAccount("admin")).toBe(false);
  });
});

describe("3. xoá một người", () => {
  it("đọc bản kê và nói rõ mất gì", async () => {
    const fake = client({ reports: { vam097_person_delete_report: personReport() } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const loaded = await getPersonDeleteReport(PERSON_ID);

    expect(loaded.ok).toBe(true);
    expect(loaded.allowed).toBe(true);
    expect(loaded.report?.fullName).toBe("Phạm Hồng Ngọc");
    expect(loaded.report?.removes.map((entry) => entry.key)).toContain("ho_so_mentor");
    expect(loaded.report?.canDelete).toBe(true);
  });

  it("support team không xoá được mentor — và KHÔNG gọi lệnh xoá", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR_ID, role: "support_team", status: "active" } as never);
    const fake = client({ reports: { vam097_person_delete_report: personReport() } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deletePersonFromSystem({
      personId: PERSON_ID,
      reason: "trùng hồ sơ",
      confirmName: PERSON.full_name
    });

    expect(result.ok).toBe(false);
    expect(fake.calls.some((call) => call.name === "vam097_delete_person")).toBe(false);
  });

  it("support team xoá được mentee thuần", async () => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR_ID, role: "support_team", status: "active" } as never);
    const fake = client({
      reports: { vam097_person_delete_report: personReport({ is_mentor: false, is_mentee: true }) }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deletePersonFromSystem({
      personId: PERSON_ID,
      reason: "đăng ký nhầm hai lần",
      confirmName: PERSON.full_name
    });

    expect(result.ok).toBe(true);
    const call = fake.calls.find((entry) => entry.name === "vam097_delete_person");
    expect(call?.args).toMatchObject({ p_actor: ACTOR_ID, p_person_id: PERSON_ID, p_reason: "đăng ký nhầm hai lần" });
  });

  it("còn cặp ghép thì TỪ CHỐI, và không gọi lệnh xoá", async () => {
    const fake = client({
      reports: {
        vam097_person_delete_report: personReport({ blockers: { cap_ghep: 2 }, can_delete: false })
      }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deletePersonFromSystem({
      personId: PERSON_ID,
      reason: "dọn dữ liệu",
      confirmName: PERSON.full_name
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("cặp ghép");
    expect(fake.calls.some((call) => call.name === "vam097_delete_person")).toBe(false);
  });

  it("gõ sai họ tên thì không xoá", async () => {
    const fake = client({ reports: { vam097_person_delete_report: personReport() } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deletePersonFromSystem({
      personId: PERSON_ID,
      reason: "trùng hồ sơ",
      confirmName: "Phạm Hồng Ngoc"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("chưa khớp");
    expect(fake.calls.some((call) => call.name === "vam097_delete_person")).toBe(false);
  });

  it("gõ đúng tên nhưng lệch hoa thường và khoảng trắng thì vẫn nhận", async () => {
    const fake = client({ reports: { vam097_person_delete_report: personReport() } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deletePersonFromSystem({
      personId: PERSON_ID,
      reason: "trùng hồ sơ",
      confirmName: "  phạm  hồng ngọc "
    });

    expect(result.ok).toBe(true);
  });

  it("thiếu lý do thì không xoá", async () => {
    const fake = client({ reports: { vam097_person_delete_report: personReport() } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deletePersonFromSystem({ personId: PERSON_ID, reason: "  ", confirmName: PERSON.full_name });

    expect(result.ok).toBe(false);
    expect(fake.calls.some((call) => call.name === "vam097_delete_person")).toBe(false);
  });

  it("database từ chối thì giữ nguyên câu của database", async () => {
    const fake = client({
      reports: { vam097_person_delete_report: personReport() },
      rpcError: { vam097_delete_person: { message: "Bạn không có quyền vận hành trong mọi mùa mà người này thuộc về." } }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deletePersonFromSystem({
      personId: PERSON_ID,
      reason: "dọn dữ liệu",
      confirmName: PERSON.full_name
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mọi mùa");
  });
});

describe("4. xoá một tài khoản ban tổ chức", () => {
  beforeEach(() => {
    vi.mocked(getCurrentAdminUser).mockResolvedValue({ id: ACTOR_ID, role: "core_team", status: "active" } as never);
  });

  it("core team xoá được tài khoản support team, và xoá luôn danh tính đăng nhập", async () => {
    const fake = client({
      reports: {
        vam097_admin_account_delete_report: accountReport(),
        vam097_delete_admin_account: { ok: true, auth_user_id: AUTH_ID }
      }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deleteManagedAdminAccount({
      id: TARGET_ID,
      reason: "cấp nhầm",
      confirmEmail: "B@Example.com"
    });

    expect(result.ok).toBe(true);
    expect(fake.deleteUser).toHaveBeenCalledWith(AUTH_ID);
  });

  it("gõ sai email thì không xoá", async () => {
    const fake = client({ reports: { vam097_admin_account_delete_report: accountReport() } });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deleteManagedAdminAccount({
      id: TARGET_ID,
      reason: "cấp nhầm",
      confirmEmail: "khac@example.com"
    });

    expect(result.ok).toBe(false);
    expect(fake.calls.some((call) => call.name === "vam097_delete_admin_account")).toBe(false);
    expect(fake.deleteUser).not.toHaveBeenCalled();
  });

  it("tài khoản đã chấm bài thì TỪ CHỐI, và mách dùng Ngừng quyền", async () => {
    const fake = client({
      reports: {
        vam097_admin_account_delete_report: accountReport({
          blockers: { bai_cham_dang_hoac_da_lam: 3 },
          can_delete: false
        })
      }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deleteManagedAdminAccount({
      id: TARGET_ID,
      reason: "dọn tài khoản",
      confirmEmail: "b@example.com"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("bài chấm");
    expect(fake.calls.some((call) => call.name === "vam097_delete_admin_account")).toBe(false);
  });

  it("không đủ bậc quản lý thì dừng ngay, không đọc cả bản kê", async () => {
    const fake = client({
      targetRole: "admin",
      reports: { vam097_admin_account_delete_report: accountReport() }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deleteManagedAdminAccount({
      id: TARGET_ID,
      reason: "dọn tài khoản",
      confirmEmail: "b@example.com"
    });

    expect(result.ok).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("xoá xong mà không xoá được danh tính Auth thì nói thẳng", async () => {
    const fake = client({
      deleteUserFails: true,
      reports: {
        vam097_admin_account_delete_report: accountReport(),
        vam097_delete_admin_account: { ok: true, auth_user_id: AUTH_ID }
      }
    });
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(fake.client as never);

    const result = await deleteManagedAdminAccount({
      id: TARGET_ID,
      reason: "cấp nhầm",
      confirmEmail: "b@example.com"
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("chưa xoá được danh tính đăng nhập");
  });
});

describe("5. hợp đồng của migration", () => {
  const sql = readFileSync("supabase/migrations/20260920060000_delete_person_and_admin_account.sql", "utf8");

  it("đọc vai trò API từ claim của request, không hỏi current_user", () => {
    expect(sql).toContain("vam063_trusted_api_role()");
    // Bài học 18/09/2026: trong hàm SECURITY DEFINER, hai phép kiểm này luôn sai.
    // Tìm LỜI GỌI, không tìm cái tên — tên còn nằm trong khối tự kiểm dưới dạng chuỗi.
    const body = sql.slice(0, sql.indexOf("do $self_check$"));
    expect(body).not.toContain("vam084_operator_for_season(");
    expect(body).not.toContain("vam084_staffing_operator_for_season(");
  });

  it("dọn nhật ký membership trước khi xoá người — nếu không, RESTRICT chặn", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.vam097_delete_person"));
    const deleteLog = fn.indexOf("delete from public.person_season_membership_log");
    const deletePerson = fn.indexOf("delete from public.people");
    expect(deleteLog).toBeGreaterThan(-1);
    expect(deletePerson).toBeGreaterThan(deleteLog);
  });

  it("ghi nhật ký TRƯỚC khi xoá, vì sau đó không còn gì để chụp", () => {
    const fn = sql.slice(
      sql.indexOf("create or replace function public.vam097_delete_person"),
      sql.indexOf("create or replace function public.vam097_admin_account_delete_report")
    );
    expect(fn.indexOf("insert into public.admin_audit_log")).toBeLessThan(fn.indexOf("delete from public.people"));
  });

  it("từ chối đúng những thứ không được phép mất", () => {
    for (const key of ["cap_ghep", "don_ung_tuyen", "recap", "tham_du_su_kien", "tai_khoan_dang_nhap"]) {
      expect(sql, `bản kê thiếu phép chặn ${key}`).toContain(key);
    }
  });

  it("bậc quản lý trong database khớp bảng trong mã nguồn", () => {
    const fn = sql.slice(sql.indexOf("v_manageable := case v_actor_role"));
    for (const [role, managed] of Object.entries(MANAGEABLE_ADMIN_ROLES)) {
      const line = fn.slice(fn.indexOf(`when '${role}'`), fn.indexOf(`when '${role}'`) + 220);
      for (const target of managed) {
        expect(line, `SQL thiếu ${role} → ${target}`).toContain(`'${target}'`);
      }
    }
  });

  it("chỉ service_role được chạy, không anon/authenticated", () => {
    for (const fn of [
      "vam097_person_delete_report",
      "vam097_delete_person",
      "vam097_admin_account_delete_report",
      "vam097_delete_admin_account"
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn}`);
      expect(sql).toContain(`grant execute on function public.${fn}`);
    }
    expect(sql).toContain("from public, anon, authenticated");
  });

  it("không tự xoá chính mình", () => {
    expect(sql).toContain("Không tự xoá tài khoản của chính mình");
  });
});
