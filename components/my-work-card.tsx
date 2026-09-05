import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications, getMyApplicationReviews } from "@/lib/data";
import { canReview } from "@/lib/permissions";
import type { ScopeFilter } from "@/lib/program-scope";
import { buildMyWorkItems, summarize, type MyWorkSourceApplication } from "@/lib/my-work";

/**
 * The "what is assigned to me" card at the top of the authenticated landing
 * page.
 *
 * ---------------------------------------------------------------------------
 * WHY A CARD RATHER THAN A REDIRECT
 * ---------------------------------------------------------------------------
 * The requirement is that assigned work is immediately discoverable after
 * login, and that the broader dashboard survives for Core Team and Admin.
 * Redirecting everyone to /my-work would satisfy the first and break the
 * second. Putting the personal counts at the TOP of the page they already land
 * on satisfies both, and costs one scoped query for an account with no
 * assignments.
 *
 * It renders NOTHING when the account has no assignments, so an admin who
 * never reviews does not get a permanent row of zeroes above their dashboard.
 *
 * Failure is silent by design: this is an additive banner on a page that has
 * its own job to do, so a scope or query fault hides the card rather than
 * replacing the dashboard with an error.
 */
export async function MyWorkCard({ scope }: { scope?: ScopeFilter }) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id || !canReview(adminUser.role)) return null;

  const reviewsResult = await getMyApplicationReviews(adminUser.id, scope);
  const reviews = reviewsResult.data;
  if (!reviews.length) return null;

  const applicationsResult = await getApplications(scope);
  const neededIds = new Set(reviews.map((review) => review.application_id));
  const applications = new Map<string, MyWorkSourceApplication>();
  for (const app of applicationsResult.data) {
    if (neededIds.has(app.id)) {
      applications.set(app.id, {
        id: app.id,
        full_name: app.full_name,
        role_applied: app.role_applied,
        status: app.status
      });
    }
  }

  const items = buildMyWorkItems({
    reviews,
    applications,
    assigneeAdminUserId: adminUser.id,
    now: new Date()
  });
  if (!items.length) return null;

  const summary = summarize(items);
  const outstanding = summary.todo + summary.doing;

  return (
    <section
      data-testid="landing-my-work-card"
      data-outstanding={outstanding}
      data-overdue={summary.overdue}
      className="mb-6 rounded-lg border border-vam-line bg-white p-5 shadow-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-vam-ink">Công việc của tôi</h2>
          <p className="mt-1 text-sm text-slate-600">
            {outstanding > 0
              ? `Bạn còn ${outstanding} việc tuyển chọn cần xử lý.`
              : "Bạn đã hoàn tất các việc tuyển chọn được giao."}
          </p>
        </div>
        <Link
          href="/my-work"
          data-testid="landing-my-work-link"
          className="inline-flex rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
        >
          Xem công việc của tôi
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-600">
          Cần làm: <strong>{summary.todo}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700">
          Đang làm: <strong>{summary.doing}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 font-medium text-red-700">
          Quá hạn: <strong>{summary.overdue}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 font-medium text-green-700">
          Hoàn tất: <strong>{summary.done}</strong>
        </span>
      </div>
    </section>
  );
}
