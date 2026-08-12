import Link from "next/link";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getMenteeProfiles, getPerson } from "@/lib/data";
import { isValidUuid } from "@/lib/events";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { EditMenteeForm } from "./edit-mentee-form";

export default async function EditMenteePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const adminUser = scopeContext.adminUser ?? (await getCurrentAdminUser());
  if (!canEditRecaps(adminUser) || !canOperateAnyScope(scopeContext)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được sửa hồ sơ mentee." />
        <ErrorBox message="Bạn không có quyền sửa hồ sơ mentee." />
      </>
    );
  }

  if (!isValidUuid(params.id)) {
    return (
      <>
        <PageHeader title="ID mentee không hợp lệ" description="Đường dẫn không chứa UUID mentee_profile hợp lệ." />
        <ErrorBox message="ID mentee không hợp lệ." />
        <Link href="/mentees" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ← Danh sách mentee
        </Link>
      </>
    );
  }

  const mentees = await getMenteeProfiles(scope);
  const mentee = mentees.data.find((row) => row.id === params.id);
  if (!mentee || !mentee.person_id) {
    return (
      <>
        <PageHeader title="Không tìm thấy hồ sơ mentee" />
        {mentees.error ? <ErrorBox message={mentees.error} /> : null}
        <EmptyState message="Không tìm thấy mentee_profile cần chỉnh sửa." />
      </>
    );
  }

  const person = await getPerson(mentee.person_id, scope);
  if (!person.data) {
    return (
      <>
        <PageHeader title="Không tìm thấy person" />
        {person.error ? <ErrorBox message={person.error} /> : null}
        <EmptyState message="Không tìm thấy person liên kết với mentee này." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Sửa hồ sơ mentee" description="Cập nhật thông tin person + mentee_profiles." />
      {mentees.error ? <ErrorBox message={mentees.error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Hướng dẫn</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Form bao gồm 2 phần: <strong>Người (person)</strong> và <strong>Hồ sơ mentee</strong>.</p>
            <p>Mọi thay đổi sẽ được ghi vào <code>admin_audit_log</code> kèm trạng thái before/after.</p>
            <p className="text-xs text-slate-500">
              ID mentee_profile: <span className="font-mono">{mentee.id}</span>
            </p>
            <p className="text-xs text-slate-500">
              ID person: <span className="font-mono">{person.data.id}</span>
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Biểu mẫu sửa mentee</h2>
          <EditMenteeForm mentee={mentee} person={person.data} />
        </Card>
      </div>
    </>
  );
}
