import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getReviewerPool } from "@/lib/data";
import { canManageReviewers } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { ReviewerPoolClient } from "./reviewer-pool-client";

// ---------------------------------------------------------------------------
// Page: /reviews/reviewer-pool
// Phase 044A-2 — Enable mentors as reviewers
// ---------------------------------------------------------------------------

export default async function ReviewerPoolPage({
  searchParams
}: {
  searchParams: { intake_batch_id?: string };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canManageReviewers(adminUser.role)) redirect("/reviews");

  const intakeBatchId = searchParams.intake_batch_id?.trim() || null;
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  const [intakeBatches, pool] = await Promise.all([
    getIntakeBatches(scope),
    getReviewerPool({ intakeBatchId, scope })
  ]);

  return (
    <>
      <PageHeader
        title="Danh sách Reviewer"
        description="Danh sách mentor có email trong hệ thống. Admin có thể cấp quyền reviewer để họ tham gia review hồ sơ."
      />

      {/* Back nav */}
      <div className="mb-4">
        <Link href="/reviews" className="text-sm text-vam-green hover:underline">
          ← Quay lại Reviews
        </Link>
      </div>

      {/* Auth caution callout */}
      <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Lưu ý Auth:</strong> Việc cấp quyền reviewer tạo hoặc kích hoạt quyền trong VAM OS.
        Nếu người này chưa từng đăng nhập, admin vẫn cần gửi invitation / reset password
        theo quy trình Auth hiện tại (qua Supabase Dashboard hoặc trang{" "}
        <Link href="/admin/users" className="underline hover:text-amber-900">
          /admin/users
        </Link>
        ).
      </div>

      <ErrorBox message={intakeBatches.error || pool.error} />

      {/* Batch filter */}
      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Lọc theo đợt tuyển</p>
          <Link
            href="/reviews/guide"
            className="text-xs text-slate-400 hover:text-vam-green hover:underline"
          >
            Hướng dẫn vận hành
          </Link>
        </div>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Đợt tuyển</label>
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId ?? ""}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="">Tất cả đợt</option>
              {intakeBatches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.code ?? b.id}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Lọc
          </button>
          {intakeBatchId && (
            <Link
              href="/reviews/reviewer-pool"
              className="rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Xem tất cả
            </Link>
          )}
        </form>
      </Card>

      {/* Pool table */}
      <ReviewerPoolClient rows={pool.data ?? []} />
    </>
  );
}
