/** @vitest-environment jsdom */
/**
 * Trang quản lý tài khoản: ô chọn cấp chỉ mời những cấp người đang thao tác đặt
 * được (BTC 13/10/2026 — admin đổi được thành viên Core team).
 *
 * Trước đó ô chọn mời đủ sáu cấp cho mọi người. Admin chọn "Admin" cho một tài
 * khoản Core team, bấm Lưu, và chỉ lúc đó mới biết là không được. Màn hình không
 * được mời một nút mà máy chủ sẽ từ chối.
 */
import { readFileSync } from "node:fs";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/admin/users/actions", () => ({
  createAdminUserAction: vi.fn(),
  deleteAdminAccountAction: vi.fn(),
  removeAdminAccessAction: vi.fn(),
  resendAdminInviteAction: vi.fn(),
  setAdminUserStatusAction: vi.fn(),
  syncAdminUserAuthAction: vi.fn(),
  updateAdminUserAction: vi.fn()
}));
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useFormState: (action: unknown, initial: unknown) => [initial, action],
    useFormStatus: () => ({ pending: false })
  };
});

import { CreateAdminUserForm, EditAdminUserForm, type ScopeCatalogOptions } from "@/app/admin/users/user-management-forms";
import { creatableAdminRoles, manageableAdminRoles } from "@/lib/permissions";
import type { ManagedAdminUser } from "@/lib/admin-users";

const PROGRAM = "11111111-1111-4111-8111-111111111111";
const SEASON = "22222222-2222-4222-8222-222222222222";
const scopeOptions: ScopeCatalogOptions = {
  programs: [{ id: PROGRAM, code: "UEHM", name: "UEH Mentoring", isActive: true }],
  seasons: [{ id: SEASON, code: "S12", name: "Mùa 12", programId: PROGRAM }],
  selectedProgramId: PROGRAM,
  selectedSeasonId: SEASON
};

function account(role: string): ManagedAdminUser {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    auth_user_id: "33333333-3333-4333-8333-333333333333",
    email: "nguoi@example.com",
    full_name: "Người Được Sửa",
    role: role as ManagedAdminUser["role"],
    status: "active",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    scopes: [{
      id: "55555555-5555-4555-8555-555555555555", user_id: "33333333-3333-4333-8333-333333333333",
      program_id: PROGRAM, season_id: SEASON, role: "operations", status: "active",
      created_at: "2026-10-01T00:00:00Z", updated_at: null
    }]
  };
}

/** Soi đúng ô chọn CẤP, không tìm chữ trên cả trang: ô phạm vi cũng có các dòng riêng. */
function roleSelect(container: HTMLElement) {
  const select = container.querySelector('select[name="role"]') as HTMLSelectElement | null;
  if (!select) throw new Error("Không thấy ô chọn cấp");
  return { values: Array.from(select.options).map((option) => option.value), selected: select.value };
}

afterEach(() => cleanup());

describe("trang nối đúng danh sách cấp vào từng form", () => {
  // Trang là server component, hai form bị thay bằng bản rỗng ở các test khác,
  // nên chỗ nối này chỉ soi được ở mã nguồn. Đổi nhầm hai danh sách cho nhau thì
  // super admin mất hai dòng "Admin" và "Super admin" trong form tạo.
  const page = readFileSync("app/admin/users/page.tsx", "utf8");

  it("form tạo nhận danh sách cấp TẠO được", () => {
    expect(page).toContain("<CreateAdminUserForm scopeOptions={scopeOptions} roles={creatableAdminRoles(adminUser.role)} />");
  });

  it("form sửa nhận danh sách cấp QUẢN được", () => {
    expect(page).toContain("<EditAdminUserForm user={selectedUser} scopeOptions={scopeOptions} roles={manageableAdminRoles(adminUser.role)} />");
  });

  it("form tạo chỉ hiện cho người tạo được tài khoản", () => {
    expect(page).toContain("{canCreateAdminAccount(adminUser.role) ? (");
  });
});

describe("form tạo tài khoản", () => {
  it("admin chỉ được mời bốn cấp mình tạo được — không có Admin, không có Super admin", () => {
    const { container } = render(<CreateAdminUserForm scopeOptions={scopeOptions} roles={creatableAdminRoles("admin")} />);
    const { values, selected } = roleSelect(container);
    expect(values).toEqual(["viewer", "reviewer", "support_team", "core_team"]);
    expect(selected).toBe("viewer");
  });

  it("super admin vẫn thấy đủ sáu cấp như trước", () => {
    const { container } = render(<CreateAdminUserForm scopeOptions={scopeOptions} roles={creatableAdminRoles("super_admin")} />);
    expect(roleSelect(container).values).toEqual(["viewer", "reviewer", "support_team", "core_team", "admin", "super_admin"]);
  });

  it("danh sách không có Viewer thì ô chọn mở ở dòng đầu của chính danh sách đó", () => {
    const { container } = render(<CreateAdminUserForm scopeOptions={scopeOptions} roles={["core_team", "support_team"]} />);
    const { values, selected } = roleSelect(container);
    expect(values).toEqual(["support_team", "core_team"]);
    expect(values).toContain(selected);
  });
});

describe("form sửa tài khoản", () => {
  it("admin sửa một tài khoản Core team: mời bốn cấp, đang chọn đúng cấp hiện tại", () => {
    const { container } = render(<EditAdminUserForm user={account("core_team")} scopeOptions={scopeOptions} roles={manageableAdminRoles("admin")} />);
    const { values, selected } = roleSelect(container);
    expect(values).toEqual(["viewer", "reviewer", "support_team", "core_team"]);
    expect(selected).toBe("core_team");
  });

  it("Core team sửa một tài khoản Support team: không được mời Core team", () => {
    const { container } = render(<EditAdminUserForm user={account("support_team")} scopeOptions={scopeOptions} roles={manageableAdminRoles("core_team")} />);
    const { values, selected } = roleSelect(container);
    expect(values).toEqual(["viewer", "reviewer", "support_team"]);
    expect(selected).toBe("support_team");
  });

  it("cấp hiện tại luôn có mặt và đang được chọn, kể cả khi nằm ngoài danh sách", () => {
    // Thiếu dòng này thì trình duyệt lặng lẽ chọn dòng đầu ("Viewer"), và bấm
    // Lưu để đổi mỗi cái tên là hạ luôn cấp của người ta.
    const { container } = render(<EditAdminUserForm user={account("core_team")} scopeOptions={scopeOptions} roles={manageableAdminRoles("core_team")} />);
    const { values, selected } = roleSelect(container);
    expect(selected).toBe("core_team");
    expect(values).toEqual(["viewer", "reviewer", "support_team", "core_team"]);
  });
});
