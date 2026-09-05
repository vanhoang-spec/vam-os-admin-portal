import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications, getMyApplicationReviews } from "@/lib/data";
import { canReview } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { buildMyWorkItems, type MyWorkSourceApplication } from "@/lib/my-work";
import { ErrorBox, PageHeader } from "@/components/ui";
import { MyWorkClient } from "./my-work-client";

/**
 * CÔNG VIỆC CỦA TÔI — the personal recruitment work inbox.
 *
 * ---------------------------------------------------------------------------
 * SCOPING: ASSIGNMENT, NOT ROLE
 * ---------------------------------------------------------------------------
 * The list comes from `getMyApplicationReviews(adminUser.id, scope)`, which
 * filters `application_reviews.reviewer_admin_user_id = <this account>` and
 * drops `cancelled` rows, inside the caller's canonical program/season scope.
 *
 * There is no role branch here, and that is deliberate. Everywhere else in the
 * app an admin tier sees more than a reviewer; My Work must NOT work that way.
 * A super admin opening this page sees the assignments made to their own
 * account and nothing else — "my work" would be a lie otherwise, and the
 * requirement says Team Work is not in v1. `canReview` gates ACCESS to the
 * screen; it never widens WHOSE work is listed.
 *
 * `buildMyWorkItems` re-applies the same assignee filter on the rows it is
 * handed, so the personal guarantee does not rest on one query staying correct.
 */
export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canReview(adminUser.role)) redirect("/");

  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) {
    return (
      <>
        <PageHeader title="Công việc của tôi" description="Không thể xác minh phạm vi dữ liệu." />
        <ErrorBox message={scopeContext.scopeError} />
      </>
    );
  }
  const scope = await getScopeFilter(scopeContext);

  const reviewsResult = await getMyApplicationReviews(adminUser.id, scope);
  const reviews = reviewsResult.data;

  // Applicant name and Mentor/Mentee role live on the application, not the
  // review row. Read the scoped application set once and index it, rather than
  // issuing one request per assignment as /reviews does — an inbox is opened
  // constantly and the row count here is bounded by one person's workload.
  const applicationsResult = reviews.length
    ? await getApplications(scope)
    : { data: [], error: null };

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

  return (
    <>
      <PageHeader
        title="Công việc của tôi"
        description="Các phân công tuyển chọn đang thuộc về tài khoản của bạn."
      />
      <ErrorBox message={reviewsResult.error ?? applicationsResult.error} />
      <MyWorkClient items={items} />
    </>
  );
}
