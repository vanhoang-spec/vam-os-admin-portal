import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getParticipantAdminView } from "@/lib/participant-admin";
import { ParticipantsClient } from "./participants-client";

/**
 * Page: /admin/participants
 *
 * The two decisions a super admin makes for the new sign-in: which season each
 * programme is running, and who may enter which programme.
 *
 * Both used to require a developer. The season was a constant in the source;
 * membership did not exist as a concept. Putting them here is most of what makes
 * five programmes running out of step something the organisers can operate
 * themselves.
 */
export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function ParticipantsAdminPage({
  searchParams
}: {
  searchParams?: { q?: string | string[] };
}) {
  const adminUser = await getCurrentAdminUser();
  // Not-found rather than a refusal: the same treatment /admin/users gives, so
  // the existence of the screen is not confirmed to somebody without the role.
  if (adminUser?.role !== "super_admin") notFound();

  const view = await getParticipantAdminView({ query: param(searchParams?.q).trim() });

  const withoutSeason = view.programs.filter((program) => !program.currentSeason).length;
  const inferred = view.programs.filter(
    (program) => program.currentSeason && !program.currentSeason.explicit
  ).length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Tài khoản mentor và mentee"
        description="Đặt mùa đang chạy cho từng chương trình, và quyết định ai vào được chương trình nào. Người tham gia đăng nhập bằng email và mật khẩu, rồi hệ thống tự đưa họ vào đúng mùa của chương trình đã chọn."
      />

      {view.error ? <ErrorBox message={view.error} /> : null}

      {withoutSeason > 0 ? (
        <ErrorBox
          message={`${withoutSeason} chương trình chưa có mùa nào. Người tham gia của những chương trình đó sẽ thấy thông báo "chưa mở mùa nào".`}
        />
      ) : null}

      {inferred > 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            {inferred} chương trình đang dùng mùa <strong>suy ra tự động</strong> (mã mùa cao nhất) vì
            chưa ai chọn. Chọn tường minh bên dưới để chắc chắn.
          </p>
        </Card>
      ) : null}

      <ParticipantsClient
        programs={view.programs}
        seasonsByProgram={view.seasonsByProgram}
        query={view.query}
        results={view.results}
        searched={view.searched}
      />

      <Card>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link className="text-vam-green underline" href="/admin/users">
            Quản lý tài khoản nội bộ
          </Link>
          <Link className="text-vam-green underline" href="/portfolio">
            Danh mục chương trình
          </Link>
        </div>
      </Card>
    </div>
  );
}
