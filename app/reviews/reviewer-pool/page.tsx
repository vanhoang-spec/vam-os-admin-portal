import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getReviewerPool } from "@/lib/data";
import { listSeasonReviewerCandidates } from "@/lib/mentor-confirmations";
import { canManageReviewers } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { SEASON_CONFIG } from "@/lib/season-config";
import type { ReviewerPoolRow } from "@/lib/types";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { ReviewerPoolClient, type ReviewerPoolClientRow } from "./reviewer-pool-client";

// ---------------------------------------------------------------------------
// Page: /reviews/reviewer-pool
//
// Season 12 sources this list from mentor_season_confirmations: the mentors who
// said they continue, and specifically the ones who agreed to score mentee
// applications. The older batch-based pool (lib/data.ts#getReviewerPool) lists
// mentors by the intake batch their profile sits in, which excludes every
// returning mentor — precisely the people who volunteer to review. It is kept
// as a fallback for seasons that never ran a confirmation round.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function ReviewerPoolPage(
  props: {
    searchParams: Promise<{ intake_batch_id?: string; season?: string; agreed?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canManageReviewers(adminUser.role)) redirect("/reviews");

  const intakeBatchId = param(searchParams.intake_batch_id).trim() || null;
  const seasonCode = param(searchParams.season).trim() || SEASON_CONFIG.CURRENT_APPLICATION_SEASON_CODE;
  const onlyAgreed = param(searchParams.agreed) === "1";

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  const [intakeBatches, seasonPool] = await Promise.all([
    getIntakeBatches(scope),
    listSeasonReviewerCandidates({ seasonIdOrCode: seasonCode })
  ]);

  const seasonLabel = seasonPool.season?.name || seasonPool.season?.code || seasonCode;
  const hasSeasonRows = seasonPool.rows.length > 0;

  // Fallback for a season with no confirmation round at all.
  const batchPool = hasSeasonRows ? null : await getReviewerPool({ intakeBatchId, scope });

  const rows: ReviewerPoolClientRow[] = hasSeasonRows
    ? seasonPool.rows
        .filter((row) => (onlyAgreed ? row.agree_to_review === true : true))
        .map((row) => ({
          mentor_profile_id: row.confirmation_id,
          person_id: row.person_id,
          full_name: row.full_name,
          email_primary: row.email_primary,
          mentor_code: row.mentor_code,
          intake_batch_id: null,
          admin_user_id: row.admin_user_id,
          admin_user_role: row.admin_user_role,
          admin_user_status: row.admin_user_status,
          agree_to_review: row.agree_to_review,
          agree_to_interview: row.agree_to_interview,
          max_mentees: row.max_mentees
        }))
    : ((batchPool?.data ?? []) as ReviewerPoolRow[]).map((row) => ({ ...row }));

  const agreedCount = seasonPool.rows.filter((row) => row.agree_to_review === true).length;

  return (
    <>
      <PageHeader
        title="Danh sách Reviewer"
        description={
          hasSeasonRows
            ? `Mentor đã xác nhận đồng hành ${seasonLabel}. Cấp quyền reviewer để họ chấm hồ sơ mentee.`
            : "Danh sách mentor có email trong hệ thống. Admin có thể cấp quyền reviewer để họ tham gia review hồ sơ."
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/reviews" className="text-sm text-vam-green hover:underline">
          ← Quay lại Reviews
        </Link>
        <Link href="/mentors/season-confirmations" className="text-sm text-vam-green hover:underline">
          Xác nhận mentor mùa mới
        </Link>
      </div>

      <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Lưu ý:</strong> Cấp quyền reviewer sẽ tạo tài khoản VAM OS cho mentor và gửi email mời
        đặt mật khẩu. Nếu email chưa gửi được, có thể gửi lại tại{" "}
        <Link href="/admin/users" className="underline hover:text-amber-900">
          /admin/users
        </Link>
        .
      </div>

      <ErrorBox message={intakeBatches.error || seasonPool.error || batchPool?.error} />

      {hasSeasonRows ? (
        <Card className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-slate-700">
              <strong>{seasonLabel}</strong> · {seasonPool.rows.length} mentor đã xác nhận ·{" "}
              <span className="text-vam-green">{agreedCount} người đồng ý chấm hồ sơ</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Link
                href="/reviews/reviewer-pool"
                className={`rounded-md border px-3 py-1.5 ${
                  onlyAgreed ? "border-vam-line text-slate-600 hover:bg-slate-50" : "border-vam-green bg-vam-mint text-vam-green"
                }`}
              >
                Tất cả
              </Link>
              <Link
                href="/reviews/reviewer-pool?agreed=1"
                className={`rounded-md border px-3 py-1.5 ${
                  onlyAgreed ? "border-vam-green bg-vam-mint text-vam-green" : "border-vam-line text-slate-600 hover:bg-slate-50"
                }`}
              >
                Chỉ người đồng ý chấm ({agreedCount})
              </Link>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="mb-5">
          <p className="mb-3 text-sm text-slate-600">
            Mùa <strong>{seasonLabel}</strong> chưa có mentor nào xác nhận, nên danh sách dưới đây lấy
            theo đợt tuyển như trước. Gửi link xác nhận tại{" "}
            <Link href="/mentors/season-confirmations" className="text-vam-green underline">
              trang xác nhận mentor
            </Link>
            .
          </p>
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
          </form>
        </Card>
      )}

      <ReviewerPoolClient rows={rows} showAgreementColumns={hasSeasonRows} />
    </>
  );
}
