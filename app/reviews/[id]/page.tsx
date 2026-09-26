import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import {
  getApplication,
  getApplicationReviewById,
  getPerson,
  getSeasons,
  getReviewEligibleReviewers,
  keyById
} from "@/lib/data";
import { canAssignReview, canReview } from "@/lib/permissions";
import { isEditableReviewStatus } from "@/lib/review-status";
import { flattenRawPayload, humanizeKey } from "@/lib/application-export";
import { displayText, formatDate } from "@/lib/utils";
import { Card, DetailGrid, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { ReviewForm } from "./review-form";
import { ReviewOperations } from "./review-operations";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reviewStatusLabel(status: string) {
  if (status === "assigned") return "Chưa bắt đầu";
  if (status === "in_progress") return "Đang làm";
  if (status === "submitted") return "Đã nộp";
  if (status === "returned_for_clarification") return "Cần làm rõ";
  if (status === "cancelled") return "Đã huỷ";
  return status;
}

function roundLabel(round: string) {
  if (round === "profile_screening") return "Hồ sơ (Profile Screening)";
  if (round === "interview") return "Phỏng vấn (Interview)";
  return round;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReviewDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canReview(adminUser.role)) redirect("/");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const reviewerConstraint = adminUser.role === "reviewer" ? adminUser.id : null;
  const [reviewResult, seasons] = await Promise.all([
    getApplicationReviewById(params.id, scope, reviewerConstraint),
    getSeasons(scope)
  ]);

  const review = reviewResult.data;

  if (!review) {
    return (
      <>
        <PageHeader title="Không tìm thấy review." />
        <ErrorBox message={reviewResult.error} />
        <EmptyState message="Review không tồn tại hoặc bạn không có quyền truy cập." />
        <div className="mt-4">
          <Link href="/reviews" className="text-sm font-medium text-vam-green">
            Quay lại Reviews
          </Link>
        </div>
      </>
    );
  }

  // Fetch application for this review
  const appResult = await getApplication(review.application_id, scope);
  const app = appResult.data;
  const reviewersResult = adminUser.role !== "reviewer" && app?.season_id
    ? await getReviewEligibleReviewers(
        app.season_id,
        review.review_round as "profile_screening" | "interview"
      )
    : { data: [], error: null };
  const personResult = app?.person_id ? await getPerson(app.person_id, scope) : { data: null, error: null };

  const seasonsById = keyById(seasons.data);
  const person = personResult.data ?? undefined;
  const season = app?.season_id ? seasonsById.get(app.season_id) : undefined;

  // Coalesced identity (same as application detail page)
  const displayFullName = app?.full_name ?? person?.full_name ?? null;
  const displayEmail = app?.email_primary ?? person?.email_primary ?? null;
  const displayPhone = app?.phone_primary ?? person?.phone_primary ?? null;
  const displayGender = app?.gender ?? person?.gender ?? null;
  const displayStatus = app?.status ?? app?.final_status ?? null;
  const applicationWithdrawn = displayStatus === "withdrawn";

  /**
   * The applicant's answers, labelled the way the applicant saw them.
   *
   * This used to walk `raw_payload` directly and print each key in upper case
   * — a reviewer read "IF_NOT_EFFECTIVE_TEXT" above the answer and had to guess
   * which question it belonged to. The export layer already owns the mapping
   * from storage key to the Vietnamese question, so this screen now asks it
   * instead of inventing a second, worse answer.
   *
   * `flattenRawPayload` also brings something the old inline walk lacked: it
   * drops the segments reserved for internal, scoring and authorisation
   * metadata, so a nested field that was never meant for a reviewer cannot
   * surface here just because it happens to sit in the payload.
   */
  const rawPayloadEntries = flattenRawPayload(
    (app?.raw_payload ?? null) as Record<string, unknown> | null
  );

  const isSubmitted = review.status === "submitted";

  // Permission guard: a review is edited ONLY by the person it was assigned to.
  //
  // This used to admit super_admin / admin / core_team as well, which rendered
  // an editable form for an operator the server always refuses:
  // vam084_submit_application_review and vam095_save_application_review_draft
  // both require `v_review.reviewer_admin_user_id = p_actor`, and
  // lib/application-reviews.ts checks the same thing before either is called.
  // The form could therefore never succeed — it only invited Core Team to lose
  // work. Correction stays available through cancel and reassign below, which
  // is where those roles genuinely have authority.
  const isOwner = review.reviewer_admin_user_id === adminUser.id;
  const canEdit =
    !applicationWithdrawn && isEditableReviewStatus(review.status) && isOwner;
  const canManageAssignment =
    canAssignReview(adminUser.role) && isEditableReviewStatus(review.status);

  const error = reviewResult.error ?? appResult.error ?? personResult.error ?? seasons.error;

  return (
    <>
      <PageHeader
        title={`Review: ${displayText(displayFullName, "Ứng viên")}`}
        description={`${roundLabel(review.review_round)} • ${reviewStatusLabel(review.status)}`}
      />
      <ErrorBox message={error} />

      {applicationWithdrawn ? (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">Hồ sơ đã rút khỏi quy trình tuyển</p>
          <p className="mt-1">Review này chỉ còn để xem lịch sử và không thể tiếp tục hoặc nộp.</p>
        </div>
      ) : null}

      {/* Review meta */}
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin review</h2>
        <DetailGrid
          rows={[
            ["Vòng review", roundLabel(review.review_round)],
            ["Trạng thái", reviewStatusLabel(review.status)],
            ["Hạn nộp", review.due_at ? formatDate(review.due_at) : "-"],
            ["Nộp lúc", review.submitted_at ? formatDate(review.submitted_at) : "-"],
            ["Điểm tổng", review.total_score !== null ? String(review.total_score) : "-"],
            ["Đề xuất", displayText(review.recommendation)]
          ]}
        />
      </Card>

      {/* Application summary */}
      {/*
        Stacked, not two columns. The answers are long-form Vietnamese prose —
        several paragraphs per question — and half a screen forced them into a
        column narrow enough that reviewers reported not being able to read the
        application at all.
      */}
      {app ? (
        <div className="mb-4 grid gap-4">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin ứng viên</h2>
            <DetailGrid
              rows={[
                ["Họ tên", displayText(displayFullName)],
                ["Email", displayText(displayEmail)],
                ["SĐT", displayText(displayPhone)],
                ["Giới tính", displayText(displayGender)],
                ["Mùa", displayText(season?.name ?? season?.code)],
                ["Vai trò ứng tuyển", displayText(app.role_applied)],
                ["Trạng thái đơn", displayText(displayStatus)],
                ["Nộp lúc", formatDate(app.submitted_at)]
              ]}
            />
            {adminUser.role !== "reviewer" ? <div className="mt-3">
              <Link
                href={`/applications/${app.id}`}
                className="text-sm font-medium text-vam-green hover:underline"
              >
                Xem chi tiết đơn ứng tuyển →
              </Link>
            </div> : null}
          </Card>

          {/* Raw payload answers */}
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">
              Nội dung đơn
            </h2>
            {rawPayloadEntries.length > 0 ? (
              /*
                No `max-h` and no inner scroll. A fixed-height well inside an
                already-scrolling page gave the reviewer a second scrollbar and
                a viewport a few lines tall for answers that run to paragraphs.
                The page scrolls; the answers do not need to.
              */
              <dl className="grid gap-2">
                {rawPayloadEntries.map(({ key, value }) => (
                  <div
                    key={key}
                    className="rounded-md border border-vam-line bg-slate-50 px-3 py-2.5"
                  >
                    <dt className="text-xs font-semibold text-slate-500">{humanizeKey(key)}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-vam-ink">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <EmptyState message="Không có raw_payload. Xem câu trả lời legacy tại trang chi tiết đơn." />
            )}
          </Card>
        </div>
      ) : (
        <ErrorBox message={appResult.error ?? "Không tìm thấy đơn ứng tuyển liên quan."} />
      )}

      {/* Scoring form */}
      <Card className="mb-4">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-vam-ink">
            Đánh giá & Chấm điểm
          </h2>
          {/*
            The form labels each score but not what it MEANS; those descriptions
            live only in the guide. A first-time reviewer needs them here, at the
            moment of scoring, not after hunting for a page nothing links to.
          */}
          <Link href="/reviews/guide" className="text-sm font-medium text-vam-green hover:underline">
            Xem mô tả 5 tiêu chí chấm điểm
          </Link>
        </div>
        {canEdit ? (
          <ReviewForm
            reviewId={review.id}
            reviewRound={review.review_round}
            isSubmitted={isSubmitted}
            defaultScoreMotivation={review.score_motivation}
            defaultScoreGoalClarity={review.score_goal_clarity}
            defaultScoreCommitment={review.score_commitment}
            defaultScoreFit={review.score_fit}
            defaultScoreCommunication={review.score_communication}
            defaultRecommendation={review.recommendation}
            defaultReviewerNote={review.reviewer_note}
          />
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {applicationWithdrawn
              ? "Hồ sơ đã rút khỏi quy trình tuyển; review ở chế độ chỉ đọc."
              : isEditableReviewStatus(review.status) && !isOwner
                ? "Đánh giá này thuộc về reviewer khác. Bạn có thể huỷ hoặc chuyển phân công, nhưng không chỉnh sửa hay nộp thay."
                : "Bạn không có quyền chỉnh sửa review này."}
          </div>
        )}
      </Card>

      {canManageAssignment && !isSubmitted && review.status !== "cancelled" && (
        <Card className="mb-4">
          <ReviewOperations
            reviewId={review.id}
            applicationId={review.application_id}
            isSubmitted={isSubmitted}
            isCancelled={review.status === "cancelled"}
            allowReassign={!applicationWithdrawn}
            reviewers={reviewersResult.data}
            currentDueAt={review.due_at ?? null}
          />
        </Card>
      )}

      <div className="flex gap-4">
        {review.review_round === "interview" ? (
          <Link href="/interviews" className="text-sm font-medium text-vam-green">
            ← Quay lại Phỏng vấn
          </Link>
        ) : (
          <Link href="/reviews" className="text-sm font-medium text-vam-green">
            ← Quay lại Reviews
          </Link>
        )}
        {app && adminUser.role !== "reviewer" && (
          <Link
            href={`/applications/${app.id}`}
            className="text-sm font-medium text-vam-green"
          >
            Xem đơn ứng tuyển
          </Link>
        )}
      </div>
    </>
  );
}
