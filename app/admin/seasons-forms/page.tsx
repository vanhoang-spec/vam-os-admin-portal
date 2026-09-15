import Link from "next/link";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { APPLICATION_FORM_TEXTS_PATH } from "@/lib/application-form-text-core";
import {
  readApplicationFormControls,
  S12_BINDING,
  type ApplicantRole
} from "@/lib/application-form-controls";
import {
  canEditApplicationFormTexts,
  canToggleApplicationForm,
  canViewApplicationFormControls
} from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { FormControlCard, type RoleControlView } from "./form-control-card";
import { FormControlAuditTable } from "./audit-table";
import { readApplicationFormAudit } from "@/lib/application-form-audit";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Mùa & Form đăng ký — VAM OS"
};

const PUBLIC_PATH: Record<ApplicantRole, string> = {
  mentor: "/apply/mentor",
  mentee: "/apply/mentee"
};

export default async function SeasonsFormsPage() {
  const ctx = await getAdminScopeContext();
  const admin = ctx.adminUser ?? (await getCurrentAdminUser());

  if (!admin?.id || admin.status !== "active" || !canViewApplicationFormControls(admin.role)) {
    return (
      <>
        <PageHeader title="Mùa & Form đăng ký" />
        <ErrorBox message="Bạn không có quyền truy cập màn hình này." />
      </>
    );
  }

  // An unreadable grant table looks exactly like an ungranted user. Say so
  // rather than rendering a screen that implies the admin has no scope.
  if (ctx.scopeError) {
    return (
      <>
        <PageHeader title="Mùa & Form đăng ký" />
        <ErrorBox message={ctx.scopeError} />
      </>
    );
  }

  const lookup = await readApplicationFormControls();

  if (!lookup.ok) {
    return (
      <>
        <PageHeader
          title="Mùa & Form đăng ký"
          description="Điều khiển trạng thái công khai của form đăng ký Mentor và Mentee."
        />
        <ErrorBox
          message={
            "Chưa đọc được bản ghi điều khiển form cho UEHM-S12-B1. " +
            "Nhiều khả năng migration 069 chưa được áp dụng cho môi trường này. " +
            "Cho đến khi đọc được, cả hai form vẫn ĐÓNG."
          }
        />
      </>
    );
  }

  const { controls } = lookup;

  // Toggling needs BOTH a permitted global role and operations scope on this
  // exact season. A user with no UEHM-S12 scope sees the screen read-only.
  const canToggle =
    canToggleApplicationForm(admin.role) &&
    (await canOperateSeason(ctx, controls.mentor.seasonId));

  const views: RoleControlView[] = (["mentor", "mentee"] as const).map((role) => ({
    role,
    state: controls[role].state,
    updatedAt: controls[role].updatedAt,
    updatedByName: controls[role].updatedByName,
    updatedByEmail: controls[role].updatedByEmail,
    publicPath: PUBLIC_PATH[role]
  }));

  const audit = await readApplicationFormAudit();

  return (
    <>
      <PageHeader
        title="Mùa & Form đăng ký"
        description="Điều khiển trạng thái công khai của form đăng ký Mentor và Mentee. Trạng thái được lưu trong cơ sở dữ liệu và có hiệu lực ngay, không cần deploy lại."
      />

      <Card>
        <div className="border-b border-vam-line pb-4">
          <h2 className="text-lg font-semibold text-vam-ink">UEH Mentoring — Season 12</h2>
          <p className="mt-1 text-sm text-slate-600">
            Chương trình <code className="font-mono">{S12_BINDING.programCode}</code> · Mùa{" "}
            <code className="font-mono">{S12_BINDING.seasonCode}</code> · Đợt tuyển{" "}
            <code className="font-mono">{S12_BINDING.intakeBatchCode}</code>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Season 12 chỉ có một đợt tuyển chính. Bổ sung giữa mùa dùng nhập tay/CSV vào cùng
            mùa này.
          </p>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {views.map((view) => (
            <FormControlCard key={view.role} control={view} canToggle={canToggle} />
          ))}
        </div>

        {!canToggle ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Bạn đang ở chế độ chỉ xem. Chỉ Super Admin, hoặc Admin có quyền vận hành mùa
            UEHM-S12, mới có thể thay đổi trạng thái form.
          </p>
        ) : null}
      </Card>

      {canEditApplicationFormTexts(admin.role) ? (
        <Card className="mt-6">
          <h2 className="text-lg font-semibold text-vam-ink">Chữ trên form</h2>
          <p className="mt-1 text-sm text-slate-600">
            Lời giới thiệu, hạn nộp, người liên hệ trên form mentor và mentee. Sửa xong có hiệu lực ngay, không
            cần deploy. Ô cần điền và câu cam kết không đổi ở đó.
          </p>
          <Link
            href={APPLICATION_FORM_TEXTS_PATH}
            className="mt-3 inline-flex w-fit items-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
          >
            Sửa chữ trên form →
          </Link>
        </Card>
      ) : null}

      <Card className="mt-6">
        <h2 className="text-lg font-semibold text-vam-ink">Lịch sử thay đổi</h2>
        <p className="mt-1 text-sm text-slate-600">
          Mỗi lần mở/đóng form đều ghi một dòng kiểm toán trong cùng một transaction với thay
          đổi trạng thái.
        </p>
        <div className="mt-4">
          <FormControlAuditTable rows={audit.rows} error={audit.error} />
        </div>
      </Card>
    </>
  );
}
