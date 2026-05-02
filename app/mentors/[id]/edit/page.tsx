import Link from "next/link";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import {
  getFunctionAreas,
  getIndustries,
  getMentorFunctionAreaLinks,
  getMentorIndustryLinks,
  getMentorProgramParticipations,
  getMentorProfiles,
  getPerson,
  getPrograms
} from "@/lib/data";
import { isValidUuid } from "@/lib/events";
import { EditMentorForm } from "./edit-mentor-form";

export default async function EditMentorPage({ params }: { params: { id: string } }) {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được sửa hồ sơ mentor." />
        <ErrorBox message="Bạn không có quyền sửa hồ sơ mentor." />
      </>
    );
  }

  if (!isValidUuid(params.id)) {
    return (
      <>
        <PageHeader title="ID mentor không hợp lệ" description="Đường dẫn không chứa UUID mentor_profile hợp lệ." />
        <ErrorBox message="ID mentor không hợp lệ." />
        <Link href="/mentors" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ← Danh sách mentor
        </Link>
      </>
    );
  }

  const [mentors, programs, industries, functionAreas, programLinks, industryLinks, functionLinks] = await Promise.all([
    getMentorProfiles(),
    getPrograms(),
    getIndustries(),
    getFunctionAreas(),
    getMentorProgramParticipations(),
    getMentorIndustryLinks(),
    getMentorFunctionAreaLinks()
  ]);

  const mentor = mentors.data.find((row) => row.id === params.id);
  if (!mentor || !mentor.person_id) {
    return (
      <>
        <PageHeader title="Không tìm thấy hồ sơ mentor" />
        {mentors.error ? <ErrorBox message={mentors.error} /> : null}
        <EmptyState message="Không tìm thấy mentor_profile cần chỉnh sửa." />
      </>
    );
  }

  const person = await getPerson(mentor.person_id);
  if (!person.data) {
    return (
      <>
        <PageHeader title="Không tìm thấy person" />
        {person.error ? <ErrorBox message={person.error} /> : null}
        <EmptyState message="Không tìm thấy person liên kết với mentor này." />
      </>
    );
  }

  const selectedProgramIds = programLinks.data
    .filter((link) => link.mentor_profile_id === mentor.id)
    .map((link) => link.program_id);
  const selectedIndustryIds = industryLinks.data
    .filter((link) => link.mentor_profile_id === mentor.id)
    .map((link) => link.industry_id);
  const selectedFunctionAreaIds = functionLinks.data
    .filter((link) => link.mentor_profile_id === mentor.id)
    .map((link) => link.function_area_id);

  const catalogError = programs.error || industries.error || functionAreas.error;

  return (
    <>
      <PageHeader title="Sửa hồ sơ mentor" description="Cập nhật thông tin person + mentor_profiles + chương trình / ngành / chức năng." />
      {mentors.error ? <ErrorBox message={mentors.error} /> : null}
      {catalogError ? <ErrorBox message={catalogError} /> : null}

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Hướng dẫn</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>Form bao gồm 2 phần: <strong>Người (person)</strong> và <strong>Hồ sơ mentor</strong>.</p>
            <p>Mọi thay đổi sẽ được ghi vào <code>admin_audit_log</code> kèm trạng thái before/after và danh sách liên kết.</p>
            <p className="text-xs text-slate-500">
              ID mentor_profile: <span className="font-mono">{mentor.id}</span>
            </p>
            <p className="text-xs text-slate-500">
              ID person: <span className="font-mono">{person.data.id}</span>
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Biểu mẫu sửa mentor</h2>
          <EditMentorForm
            mentor={mentor}
            person={person.data}
            programs={programs.data || []}
            industries={industries.data || []}
            functionAreas={functionAreas.data || []}
            selectedProgramIds={selectedProgramIds}
            selectedIndustryIds={selectedIndustryIds}
            selectedFunctionAreaIds={selectedFunctionAreaIds}
          />
        </Card>
      </div>
    </>
  );
}
