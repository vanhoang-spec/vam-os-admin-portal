import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getReviewerPool, getReviewEligibleReviewers } from "@/lib/data";
import { canManageReviewers, canManageUsers } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { ReviewerPoolClient } from "./reviewer-pool-client";

// ---------------------------------------------------------------------------
// Page: /reviews/reviewer-pool
// Phase 044A-2 — Enable mentors as reviewers
// ---------------------------------------------------------------------------

export default async function ReviewerPoolPage(props: { searchParams: Promise<{ intake_batch_id?: string }> }) {
  const searchParams = await props.searchParams;

  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canManageReviewers(adminUser.role)) redirect("/reviews");
  const canManageUserAccounts = canManageUsers(adminUser.role);

  const intakeBatchId = searchParams.intake_batch_id?.trim() || null;
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  const [intakeBatches, pool] = await Promise.all([
    getIntakeBatches(scope),
    getReviewerPool({ intakeBatchId, scope })
  ]);
  const seasonId = intakeBatchId
    ? String(intakeBatches.data.find((batch) => batch.id === intakeBatchId)?.season_id ?? "") || null
    : null;
  const [activeReviewers, activeInterviewers] = seasonId
    ? await Promise.all([
        getReviewEligibleReviewers(seasonId, "profile_screening"),
        getReviewEligibleReviewers(seasonId, "interview")
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  return (
    <>
      <PageHeader
        title="Danh sách nhân sự tuyển sinh"
        description="Ban Điều hành và Quản trị viên đang hoạt động có quyền đánh giá hồ sơ và phỏng vấn theo vai trò, không cần cấp thủ công. Chỉ người đánh giá/phỏng vấn độc lập bên ngoài mới cần cấp quyền."
      />

      {/* Back nav */}
      <div className="mb-4">
        <Link href="/reviews" className="text-sm text-vam-green hover:underline">
          ← Quay lại Reviews
        </Link>
      </div>

      {/* Auth caution callout */}
      <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Lưu ý Auth:</strong> Quyền chỉ được cấp cho cá nhân tham gia tuyển sinh trong mùa đã chọn.
        Nếu người này chưa có tài khoản Auth, hệ thống tự gửi invitation cá nhân; không dùng tài khoản chung.
        Không cần tạo tài khoản thủ công trong Supabase Dashboard.
        {canManageUserAccounts ? (
          <> Có thể quản lý tài khoản tại{" "}
            <Link href="/admin/users" className="underline hover:text-amber-900">
              /admin/users
            </Link>
          </>
        ) : (
          <> Liên hệ Super Admin nếu cần hỗ trợ tài khoản.</>
        )}
      </div>

      <ErrorBox message={intakeBatches.error || pool.error || activeReviewers.error || activeInterviewers.error} />

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
              <option value="">-- Chọn đợt để cấp quyền --</option>
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
      <ReviewerPoolClient
        rows={pool.data ?? []}
        seasonId={seasonId}
        activeReviewerIds={activeReviewers.data.map((row) => row.id)}
        activeInterviewerIds={activeInterviewers.data.map((row) => row.id)}
      />
    </>
  );
}
