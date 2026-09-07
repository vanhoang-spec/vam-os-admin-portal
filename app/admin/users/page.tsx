import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, ErrorBox, PageHeader, SimpleTable } from "@/components/ui";
import { listAdminAuditLogs, listManagedAdminUsers, requireSuperAdmin, type ManagedAdminUser } from "@/lib/admin-users";
import { displayText, formatDate } from "@/lib/utils";
import { loadProgramContextCatalog, resolveAuthorizedProgramContext } from "@/lib/program-context";
import { ProgramContextError } from "@/lib/program-context-core";
import { CreateAdminUserForm, EditAdminUserForm, RemoveAccessForm, StatusToggleForm, SyncAuthForm, type ScopeCatalogOptions } from "./user-management-forms";

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function roleLabel(role: unknown) {
  if (role === "super_admin") return "Super admin";
  if (role === "admin") return "Admin";
  if (role === "core_team") return "Core team";
  if (role === "support_team") return "Support team";
  if (role === "reviewer") return "Reviewer";
  return "Viewer";
}

function statusLabel(status: unknown) {
  if (status === "active") return "Kích hoạt";
  if (status === "suspended") return "Tạm khóa";
  if (status === "invited") return "Đã mời";
  if (status === "inactive") return "Tạm khóa";
  return displayText(status);
}

function StatusBadges({ user }: { user: ManagedAdminUser }) {
  const active = user.status === "active";
  return (
    <div className="flex flex-wrap gap-1">
      <span className={active ? "rounded-md border border-green-200 bg-green-50 px-2 py-1 text-xs font-medium text-green-700" : "rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"}>
        {statusLabel(user.status)}
      </span>
      {!user.auth_user_id ? (
        <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
          Chưa liên kết Auth
        </span>
      ) : null}
    </div>
  );
}

function scopeText(user: ManagedAdminUser) {
  const scopes = Array.isArray(user.scopes) ? user.scopes : [];
  if (!user.auth_user_id) return "Chưa liên kết Auth";
  if (!scopes.length) return "Chưa có scope (bấm Sửa để tạo)";
  return scopes
    .map((scope) => {
      const program = scope.program_id || scope.program || "all programs";
      const season = scope.season_id || scope.season_code || "all seasons";
      const level = scope.role || scope.scope_level || "read";
      return `${program} / ${season} / ${level} / ${statusLabel(scope.status)}`;
    })
    .join("; ");
}

function canRemoveOrDeactivate(user: ManagedAdminUser, activeSuperAdminCount: number) {
  return !(user.role === "super_admin" && user.status === "active" && activeSuperAdminCount <= 1);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function UserManagementTable({ users, activeSuperAdminCount }: { users: ManagedAdminUser[]; activeSuperAdminCount: number }) {
  if (!users.length) return <EmptyState message="Chưa có admin user để hiển thị." />;
  return (
    <><div className="grid gap-3 md:hidden">
      {users.map((user) => <article key={user.id} className="rounded-lg border border-vam-line bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="break-words font-semibold text-vam-ink">{displayText(user.full_name)}</h3><p className="break-all text-sm text-slate-600">{displayText(user.email)}</p></div><StatusBadges user={user} /></div>
        <dl className="mt-3 grid gap-2 text-sm"><div><dt className="text-xs uppercase text-slate-500">Operational role</dt><dd>{roleLabel(user.role)}</dd></div><div><dt className="text-xs uppercase text-slate-500">Program / season scope</dt><dd className="break-words">{scopeText(user)}</dd></div><div><dt className="text-xs uppercase text-slate-500">Auth identity</dt><dd>{user.auth_user_id ? "Đã liên kết" : "Chưa liên kết"}</dd></div><div><dt className="text-xs uppercase text-slate-500">Participant membership</dt><dd>Không quản lý tại tài khoản staff</dd></div></dl>
        <div className="mt-4 grid gap-2"><Link href={`/admin/users?edit=${user.id}`} className="min-h-11 rounded-md border border-vam-line px-3 py-2.5 text-center font-medium text-vam-green">Sửa tài khoản</Link><StatusToggleForm user={user} disabled={!canRemoveOrDeactivate(user, activeSuperAdminCount)} /><RemoveAccessForm user={user} disabled={!canRemoveOrDeactivate(user, activeSuperAdminCount)} /></div>
      </article>)}
    </div><div className="hidden overflow-hidden rounded-lg border border-vam-line bg-white md:block">
      <div className="overflow-x-auto">
        <table className="min-w-[1280px] divide-y divide-vam-line text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Họ tên</th>
              <th className="px-4 py-3">Vai trò</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Auth ID</th>
              <th className="px-4 py-3">Scope hiện tại</th>
              <th className="sticky right-0 z-10 w-64 border-l border-vam-line bg-slate-50 px-4 py-3">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-vam-line">
            {users.map((user) => {
              const safe = canRemoveOrDeactivate(user, activeSuperAdminCount);
              return (
                <tr key={user.id} className="align-top">
                  <td className="max-w-64 break-words px-4 py-3 font-medium text-vam-ink">{displayText(user.email)}</td>
                  <td className="max-w-48 break-words px-4 py-3 text-slate-700">{displayText(user.full_name)}</td>
                  <td className="px-4 py-3 text-slate-700">{roleLabel(user.role)}</td>
                  <td className="px-4 py-3"><StatusBadges user={user} /></td>
                  <td className="max-w-64 break-all px-4 py-3 font-mono text-xs text-slate-700">{displayText(user.auth_user_id)}</td>
                  <td className="max-w-80 break-words px-4 py-3 text-slate-700">{scopeText(user)}</td>
                  <td className="sticky right-0 z-10 w-64 min-w-64 border-l border-vam-line bg-white px-4 py-3 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.35)]">
                    <div className="grid gap-2">
                      <Link href={`/admin/users?edit=${user.id}`} className="inline-flex justify-center rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
                        Sửa
                      </Link>
                      <SyncAuthForm user={user} />
                      <StatusToggleForm user={user} disabled={!safe} />
                      <RemoveAccessForm user={user} disabled={!safe} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div></>
  );
}

export default async function AdminUsersPage(
  props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  const adminUser = await requireSuperAdmin();
  if (!adminUser) notFound();

  const [usersResult, auditResult, catalog] = await Promise.all([
    listManagedAdminUsers(),
    listAdminAuditLogs(),
    loadProgramContextCatalog()
  ]);
  const requestedProgram = single(searchParams?.program);
  const requestedSeason = single(searchParams?.season);
  let contextError = "";
  let selectedProgramId = "";
  let selectedSeasonId = "";
  if (requestedProgram || requestedSeason) {
    try {
      const context = await resolveAuthorizedProgramContext({ programCode: requestedProgram, seasonCode: requestedSeason });
      selectedProgramId = context.selectedProgramId;
      selectedSeasonId = context.selectedSeasonId ?? "";
      if (!selectedSeasonId) contextError = "Hãy chọn một season hợp lệ trước khi tạo hoặc sửa scope.";
    } catch (error) {
      contextError = error instanceof ProgramContextError ? error.message : "Không thể xác minh phạm vi đã chọn.";
    }
  } else {
    contextError = "Hãy chọn chương trình và season từ bộ chọn phạm vi; hệ thống sẽ không dùng giá trị mặc định ngầm định.";
  }
  const scopeOptions: ScopeCatalogOptions = { programs: catalog.programs, seasons: catalog.seasons, selectedProgramId, selectedSeasonId };
  const users = usersResult.data;
  const activeSuperAdminCount = users.filter((user) => user.role === "super_admin" && user.status === "active").length;
  const selectedEditId = single(searchParams?.edit);
  const selectedUser = selectedEditId ? users.find((user) => user.id === selectedEditId) : null;

  return (
    <>
      <PageHeader title="Quản lý người dùng" description="Super Admin Console cho user, vai trò, trạng thái và phân quyền mùa/chương trình." />
      <div className="mb-6 flex flex-wrap gap-3"><Link href="/admin/users/import" className="min-h-11 rounded-md bg-vam-green px-4 py-2.5 font-medium text-white">Import CSV an toàn</Link></div>
      {usersResult.error ? <ErrorBox message={usersResult.error} /> : null}
      {auditResult.error ? <ErrorBox message={auditResult.error} /> : null}
      {catalog.warnings?.length ? <ErrorBox message={catalog.warnings.join(" ")} /> : null}
      {contextError ? <ErrorBox message={contextError} /> : (
        <Card className="mb-6"><p className="text-sm text-slate-700">Program: <strong>{requestedProgram}</strong> · Season: <strong>{requestedSeason}</strong></p></Card>
      )}

      <Card className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Thêm user quản trị</h2>
        <p className="mb-4 text-sm text-slate-600">
          Luồng tạo user sẽ tìm hoặc mời Supabase Auth user trước, sau đó lưu admin_users với auth_user_id và cập nhật scope. Service-role key chỉ chạy server-side.
        </p>
        {contextError ? <p className="text-sm text-slate-600">Chọn phạm vi hợp lệ để bật biểu mẫu.</p> : <CreateAdminUserForm scopeOptions={scopeOptions} />}
      </Card>

      {selectedUser ? (
        <section className="mb-6">
          <h2 className="mb-3 text-lg font-semibold text-vam-ink">Sửa người dùng</h2>
          <Card>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-vam-ink">{displayText(selectedUser.email)}</div>
                <div className="mt-1"><StatusBadges user={selectedUser} /></div>
              </div>
              <Link href="/admin/users" className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
                Đóng form sửa
              </Link>
            </div>
            {contextError ? <ErrorBox message="Không thể sửa scope khi phạm vi trang chưa hợp lệ." /> : <EditAdminUserForm user={selectedUser} scopeOptions={scopeOptions} />}
          </Card>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 id="managed-users" className="mb-3 scroll-mt-24 text-lg font-semibold text-vam-ink">Danh sách người dùng</h2>
        <UserManagementTable users={users} activeSuperAdminCount={activeSuperAdminCount} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Nhật ký thay đổi quyền</h2>
        <SimpleTable
          rows={auditResult.data}
          columns={[
            { key: "created_at", label: "Thời gian", render: (row) => formatDate(row.created_at) },
            { key: "action_type", label: "Hành động", render: (row) => displayText(row.action_type) },
            { key: "actor_admin_user_id", label: "Người thực hiện", render: (row) => displayText(row.actor_admin_user_id) },
            { key: "target_admin_user_id", label: "Người bị thay đổi", render: (row) => displayText(row.target_admin_user_id) },
            { key: "after_data", label: "Sau thay đổi", render: (row) => displayText(safeJson(row.after_data)) }
          ]}
        />
      </section>
    </>
  );
}
