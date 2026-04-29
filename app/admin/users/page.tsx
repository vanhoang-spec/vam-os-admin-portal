import { notFound } from "next/navigation";
import { Card, EmptyState, ErrorBox, PageHeader, SimpleTable } from "@/components/ui";
import { listAdminAuditLogs, listManagedAdminUsers, requireSuperAdmin, type ManagedAdminUser } from "@/lib/admin-users";
import { displayText, formatDate } from "@/lib/utils";
import { deactivateAdminUserAction } from "./actions";
import { CreateAdminUserForm, EditAdminUserForm } from "./user-management-forms";

function roleLabel(role: string) {
  if (role === "super_admin") return "Super admin";
  if (role === "admin") return "Admin";
  if (role === "reviewer") return "Reviewer";
  return "Viewer";
}

function statusLabel(status: string) {
  if (status === "active") return "Kích hoạt";
  if (status === "suspended") return "Tạm khóa";
  if (status === "invited") return "Đã mời";
  if (status === "inactive") return "Không hoạt động";
  return displayText(status);
}

function scopeText(user: ManagedAdminUser) {
  if (!user.scopes.length) return "-";
  return user.scopes
    .map((scope) => {
      const program = scope.program_id || "all programs";
      const season = scope.season_id || "all seasons";
      return `${program} / ${season} / ${scope.role} / ${statusLabel(scope.status)}`;
    })
    .join("; ");
}

function DeactivateForm({ id, disabled }: { id: string; disabled: boolean }) {
  return (
    <form action={deactivateAdminUserAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Tạm khóa
      </button>
    </form>
  );
}

export default async function AdminUsersPage() {
  const adminUser = await requireSuperAdmin();
  if (!adminUser) notFound();

  const [usersResult, auditResult] = await Promise.all([
    listManagedAdminUsers(),
    listAdminAuditLogs()
  ]);
  const users = usersResult.data;
  const activeSuperAdminCount = users.filter((user) => user.role === "super_admin" && user.status === "active").length;

  return (
    <>
      <PageHeader title="Quản lý người dùng" description="Super Admin Console cho user, vai trò, trạng thái và phân quyền mùa/chương trình." />
      {usersResult.error ? <ErrorBox message={usersResult.error} /> : null}
      {auditResult.error ? <ErrorBox message={auditResult.error} /> : null}

      <Card className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Tạo / mời admin user</h2>
        <p className="mb-4 text-sm text-slate-600">
          Invite Supabase Auth được chạy bằng server-only service-role key. Service-role key không được gửi xuống trình duyệt.
        </p>
        <CreateAdminUserForm />
      </Card>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Danh sách người dùng</h2>
        <SimpleTable
          rows={users}
          columns={[
            { key: "email", label: "Email", render: (row) => displayText(row.email) },
            { key: "full_name", label: "Họ tên", render: (row) => displayText(row.full_name) },
            { key: "role", label: "Vai trò", render: (row) => roleLabel(row.role) },
            { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) },
            { key: "auth_user_id", label: "auth_user_id", render: (row) => displayText(row.auth_user_id) },
            { key: "scope", label: "Mùa/Chương trình được truy cập", render: (row) => scopeText(row) },
            { key: "created_at", label: "created_at", render: (row) => formatDate(row.created_at) },
            { key: "updated_at", label: "last updated", render: (row) => formatDate(row.updated_at) },
            {
              key: "deactivate",
              label: "Tạm khóa",
              render: (row) => (
                <DeactivateForm
                  id={row.id}
                  disabled={row.role === "super_admin" && row.status === "active" && activeSuperAdminCount <= 1}
                />
              )
            }
          ]}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Chỉnh sửa vai trò và phân quyền</h2>
        {users.length ? (
          <div className="grid gap-4">
            {users.map((user) => (
              <Card key={user.id}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-vam-ink">{displayText(user.email)}</div>
                    <div className="text-xs text-slate-500">{roleLabel(user.role)} / {statusLabel(user.status)}</div>
                  </div>
                  <div className="max-w-xl text-xs text-slate-500">Phân quyền hiện tại: {scopeText(user)}</div>
                </div>
                <EditAdminUserForm user={user} />
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState message="Chưa có admin user để hiển thị." />
        )}
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
            { key: "after_data", label: "Sau thay đổi", render: (row) => displayText(JSON.stringify(row.after_data ?? {})) }
          ]}
        />
      </section>
    </>
  );
}
