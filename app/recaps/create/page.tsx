import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getMatches, getMenteeProfiles, getMentorProfiles, getPeople, getSeasons } from "@/lib/data";
import { RecapCreateForm } from "./create-form";

export default async function CreateRecapPage() {
  const adminUser = await getCurrentAdminUser();
  if (!canEditRecaps(adminUser)) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" description="Chỉ admin hoặc super_admin được sử dụng chức năng này." />
        <ErrorBox message="Bạn không có quyền thêm mới mentoring recap." />
      </>
    );
  }

  const [people, matches, seasons, mentorProfiles, menteeProfiles] = await Promise.all([
    getPeople(),
    getMatches(),
    getSeasons(),
    getMentorProfiles(),
    getMenteeProfiles()
  ]);

  const error = people.error || matches.error || seasons.error || mentorProfiles.error || menteeProfiles.error;

  return (
    <>
      <PageHeader title="Tạo mentoring recap" description="Ghi nhận thủ công các hoạt động mentoring (Correction Workflow)." />
      {error ? <ErrorBox message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Hướng dẫn</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              Chức năng này dùng để tạo thủ công mentoring recap khi ứng viên/mentor quên nộp qua form chính thức.
            </p>
            <p>
              <strong>Bắt buộc:</strong> Chọn đúng Season và Ngày họp.
            </p>
            <p>
              <strong>Gán người tham gia:</strong> Chọn Mentor và Mentee. Bạn cũng có thể chọn thêm Match ID để liên kết dữ liệu chặt chẽ hơn.
            </p>
            <p>
              Việc tạo thủ công sẽ tự động đánh dấu `recap_source = admin_input` và ghi log vào hệ thống audit.
            </p>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Biểu mẫu tạo Recap</h2>
          <RecapCreateForm
            seasons={seasons.data || []}
            matches={matches.data || []}
            people={people.data || []}
            mentorProfiles={mentorProfiles.data || []}
            menteeProfiles={menteeProfiles.data || []}
          />
        </Card>
      </div>
    </>
  );
}
