import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getPeople } from "@/lib/data";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { CreateMenteeForm } from "./create-mentee-form";

export default async function CreateMenteePage() {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const adminUser = scopeContext.adminUser ?? (await getCurrentAdminUser());
  if (!canEditRecaps(adminUser) || !canOperateAnyScope(scopeContext)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được tạo hồ sơ mentee." />
        <ErrorBox message="Bạn không có quyền tạo hồ sơ mentee." />
      </>
    );
  }

  const people = await getPeople(scope);

  return (
    <>
      <PageHeader title="Tạo mentee mới" description="Tạo hồ sơ mentee mới (kiểm tra trùng email và liên kết người sẵn có)." />
      {people.error ? <ErrorBox message={people.error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Hướng dẫn</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Form được chia 2 phần: <strong>Người (person)</strong> và <strong>Hồ sơ mentee</strong>.</p>
            <p>Nếu email đã tồn tại, hệ thống sẽ gợi ý liên kết với người sẵn có thay vì tạo trùng.</p>
            <p>Mọi thao tác đều ghi vào <code>admin_audit_log</code> kèm thông tin người tạo.</p>
            <p className="text-xs text-amber-700">
              Schema mentee_profiles chưa có cột year_of_study và career_interests. Các trường này được ghi vào audit log để truy vết.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Biểu mẫu tạo mentee</h2>
          <CreateMenteeForm people={people.data || []} />
        </Card>
      </div>
    </>
  );
}
