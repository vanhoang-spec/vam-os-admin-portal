import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import {
  getActiveAdminUsers,
  getApplication,
  getApplicationReviewById,
  getApplicationReviewsForApplication,
  getPeople,
  getSeasons,
  keyById
} from "@/lib/data";
import { canReview } from "@/lib/permissions";
import { displayText, formatDate } from "@/lib/utils";
import { formatInterviewTimeVi, INTERVIEW_MODE_LABELS } from "@/lib/interview-scheduling-core";
import { getMentorSelectionContext } from "@/lib/mentor-selection";
import { Card, DetailGrid, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { ReviewForm } from "./review-form";
import { ScreeningSummary } from "./screening-summary";
import { SelectMenteePanel } from "./select-mentee-panel";

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

export default async function ReviewDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canReview(adminUser.role)) redirect("/");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [reviewResult, people, seasons] = await Promise.all([
    getApplicationReviewById(params.id, scope),
    getPeople(scope),
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

  const peopleById = keyById(people.data);
  const seasonsById = keyById(seasons.data);
  const person = app?.person_id ? peopleById.get(app.person_id) : undefined;
  const season = app?.season_id ? seasonsById.get(app.season_id) : undefined;

  // Coalesced identity (same as application detail page)
  const displayFullName = app?.full_name ?? person?.full_name ?? null;
  const displayEmail = app?.email_primary ?? person?.email_primary ?? null;
  const displayPhone = app?.phone_primary ?? person?.phone_primary ?? null;
  const displayGender = app?.gender ?? person?.gender ?? null;
  const displayStatus = app?.status ?? app?.final_status ?? null;

  // raw_payload entries
  const rawPayloadEntries = ((): [string, string][] => {
    const payload = app?.raw_payload;
    if (!payload || typeof payload !== "object") return [];
    return Object.entries(payload)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]): [string, string] => [
        k,
        Array.isArray(v) ? (v as string[]).join(", ") : String(v)
      ]);
  })();

  const isSubmitted = review.status === "submitted";

  // Permission guard: reviewer may only edit their own review
  const isOwner = review.reviewer_admin_user_id === adminUser.id;
  const canEdit = isOwner || ["super_admin", "admin", "core_team"].includes(adminUser.role);

  const isInterview = review.review_round === "interview";

  // An interviewer scores against what the form already said, so the screening
  // round is loaded alongside the interview form. Once their own score is in,
  // their standing for taking this candidate as a mentee is loaded too.
  const [applicationReviews, reviewerDirectory, selectionContext] = await Promise.all([
    isInterview
      ? getApplicationReviewsForApplication(review.application_id, scope)
      : Promise.resolve(
          { data: [], error: null } as Awaited<ReturnType<typeof getApplicationReviewsForApplication>>
        ),
    isInterview
      ? getActiveAdminUsers()
      : Promise.resolve({ data: [], error: null } as Awaited<ReturnType<typeof getActiveAdminUsers>>),
    isInterview && isOwner && isSubmitted && app?.role_applied === "mentee"
      ? getMentorSelectionContext({ applicationId: review.application_id })
      : Promise.resolve(null)
  ]);

  const reviewerNameById = new Map(
    reviewerDirectory.data.map((row) => [row.id, row.full_name ?? row.email])
  );

  const error =
    reviewResult.error ?? appResult.error ?? people.error ?? seasons.error ?? applicationReviews.error;

  return (
    <>
      <PageHeader
        title={`Review: ${displayText(displayFullName, "Ứng viên")}`}
        description={`${roundLabel(review.review_round)} • ${reviewStatusLabel(review.status)}`}
      />
      <ErrorBox message={error} />

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
            ["Đề xuất", displayText(review.recommendation)],
            ...(review.interview_scheduled_at
              ? ([
                  ["Lịch phỏng vấn", formatInterviewTimeVi(review.interview_scheduled_at) ?? "-"],
                  [
                    "Hình thức",
                    review.interview_mode
                      ? INTERVIEW_MODE_LABELS[review.interview_mode as "online" | "offline"] ??
                        review.interview_mode
                      : "-"
                  ],
                  ["Địa điểm / đường dẫn", review.interview_location ?? "-"]
                ] as Array<[string, unknown]>)
              : [])
          ]}
        />
      </Card>

      {/* Application summary */}
      {app ? (
        <div className="mb-4 grid gap-4 xl:grid-cols-2">
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
            <div className="mt-3">
              <Link
                href={`/applications/${app.id}`}
                className="text-sm font-medium text-vam-green hover:underline"
              >
                Xem chi tiết đơn ứng tuyển →
              </Link>
            </div>
          </Card>

          {/* Raw payload answers */}
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">
              Nội dung đơn
            </h2>
            {rawPayloadEntries.length > 0 ? (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {rawPayloadEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="rounded-md border border-vam-line bg-slate-50 px-3 py-2"
                  >
                    <dt className="text-xs font-medium uppercase text-slate-500">{key}</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-vam-ink">
                      {value}
                    </dd>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Không có raw_payload. Xem câu trả lời legacy tại trang chi tiết đơn." />
            )}
          </Card>
        </div>
      ) : (
        <ErrorBox message={appResult.error ?? "Không tìm thấy đơn ứng tuyển liên quan."} />
      )}

      {/* What the form round said — the interviewer scores against this */}
      {isInterview ? (
        <div className="mb-4">
          <ScreeningSummary reviews={applicationReviews.data} reviewerNameById={reviewerNameById} />
        </div>
      ) : null}

      {/* Scoring form */}
      <Card className="mb-4">
        <h2 className="mb-4 text-base font-semibold text-vam-ink">
          Đánh giá & Chấm điểm
        </h2>
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
            Bạn không có quyền chỉnh sửa review này.
          </div>
        )}
      </Card>

      {/* After the interview: the mentor may take this candidate as their mentee */}
      {selectionContext?.available ? (
        <Card className="mb-4">
          <SelectMenteePanel
            applicationId={review.application_id}
            candidateName={displayFullName ?? "Ứng viên"}
            cap={selectionContext.cap}
            activeCount={selectionContext.activeCount}
            canSelect={selectionContext.canSelect}
            capExceeded={selectionContext.capExceeded}
            alreadyMine={Boolean(selectionContext.alreadyMineMatchId)}
            blockedMessage={selectionContext.message}
          />
        </Card>
      ) : null}

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
        {app && (
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
