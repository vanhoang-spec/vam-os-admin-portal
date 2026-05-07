import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getFunctionAreas, getIndustries, getPeople, getPrograms } from "@/lib/data";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { CreateMentorForm } from "./create-mentor-form";

export default async function CreateMentorPage() {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const adminUser = scopeContext.adminUser ?? (await getCurrentAdminUser());
  if (!canEditRecaps(adminUser) || !canOperateAnyScope(scopeContext)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được tạo hồ sơ mentor." />
        <ErrorBox message="Bạn không có quyền tạo hồ sơ mentor." />
      </>
    );
  }

  const [people, programs, industries, functionAreas] = await Promise.all([
    getPeople(scope),
    getPrograms(scope),
    getIndustries(),
    getFunctionAreas()
  ]);
  const catalogError = programs.error || industries.error || functionAreas.error;

  return (
    <>
      <PageHeader title="Tạo mentor mới" description="Tạo hồ sơ mentor mới (tự động kiểm tra trùng email và liên kết người sẵn có)." />
      {people.error ? <ErrorBox message={people.error} /> : null}
      {catalogError ? <ErrorBox message={catalogError} /> : null}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Hướng dẫn</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Form được chia 2 phần: <strong>Người (person)</strong> và <strong>Hồ sơ mentor</strong>.</p>
            <p>Nếu email đã tồn tại, hệ thống sẽ gợi ý liên kết với người sẵn có thay vì tạo trùng.</p>
            <p>Mọi thao tác đều ghi vào <code>admin_audit_log</code> kèm thông tin người tạo.</p>
            <p className="text-xs text-slate-500">
              Mentor có thể thuộc nhiều chương trình, ngành nghề và chức năng. Lựa chọn đầu tiên sẽ được ghi vào các cột tương thích cũ (
              <code>mentor_profiles.industry</code> / <code>function_area</code>) — bảng many-to-many mới là nguồn dữ liệu chính.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Biểu mẫu tạo mentor</h2>
          <CreateMentorForm
            people={people.data || []}
            programs={programs.data || []}
            industries={industries.data || []}
            functionAreas={functionAreas.data || []}
          />
        </Card>
      </div>
    </>
  );
}
