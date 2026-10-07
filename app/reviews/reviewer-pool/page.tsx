import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getReviewerPool, getReviewEligibleReviewers } from "@/lib/data";
import { byVietnameseName } from "@/lib/list-order";
import { canAssignReview, canManageReviewers, canManageUsers, canReview } from "@/lib/permissions";
import { PARTICIPATION_GROUPS, type ParticipationRole } from "@/lib/recruitment-permissions-core";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { BulkGrantForm } from "./bulk-grant-form";
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
  // Support team reaches this screen without the rest of /reviews. A link to a
  // page that turns them away is worse than no link.
  const canOpenReviews = canReview(adminUser.role);

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
  // Bốn nhóm quyền độc lập (BTC 04/10/2026) — mỗi nhóm một danh sách từ database (vam110).
  const groupLists = seasonId
    ? await Promise.all(PARTICIPATION_GROUPS.map((g) => getReviewEligibleReviewers(seasonId, g.stage, g.applied)))
    : PARTICIPATION_GROUPS.map(() => ({ data: [] as Array<{ id: string }>, error: null as string | null }));
  const activeIds = Object.fromEntries(
    PARTICIPATION_GROUPS.map((g, i) => [g.role, groupLists[i].data.map((row) => row.id)])
  ) as Record<ParticipationRole, string[]>;
  const listError = groupLists.find((r) => r.error)?.error ?? null;
  const canGrantMentor = canAssignReview(adminUser.role);

  return (
    <>
      <PageHeader
        title="Danh sách nhân sự tuyển sinh"
        description="Bốn nhóm quyền độc lập theo mùa: Chấm hồ sơ mentee, Phỏng vấn mentee (BTC và Support cấp), Chấm hồ sơ mentor, Phỏng vấn mentor (chỉ Ban điều hành cấp). Có quyền nhóm này không kéo theo nhóm khác. Ban Điều hành và Quản trị viên có cả bốn theo vai trò."
      />

      {/* Back nav */}
      {canOpenReviews ? (
        <div className="mb-4">
          <Link href="/reviews" className="text-sm text-vam-green hover:underline">
            ← Quay lại Đánh giá
          </Link>
        </div>
      ) : null}

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

      <ErrorBox message={intakeBatches.error || pool.error || listError} />

      {/* Bulk grant — dán một danh sách email, xử lý nhiều người trong một lượt bấm */}
      <Card className="mb-5">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Cấp quyền hàng loạt (dán danh sách email)
          </summary>
          <div className="mt-3">
            <BulkGrantForm intakeBatchId={intakeBatchId} canGrantMentor={canGrantMentor} />
          </div>
        </details>
      </Card>

      {/* Batch filter */}
      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Lọc theo đợt tuyển</p>
          {canOpenReviews ? (
            <Link
              href="/reviews/guide"
              className="text-xs text-slate-400 hover:text-vam-green hover:underline"
            >
              Hướng dẫn vận hành
            </Link>
          ) : null}
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
        // Danh sách người: theo tên. Dữ liệu đọc theo id ngẫu nhiên, và phần tài khoản
        // BTC được nối vào cuối, nên không xếp thì bảng không theo thứ tự nào.
        rows={byVietnameseName(pool.data ?? [], (row) => row.full_name)}
        seasonId={seasonId}
        activeIds={activeIds}
        canGrantMentor={canGrantMentor}
      />
    </>
  );
}
