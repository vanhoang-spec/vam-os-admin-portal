import Link from "next/link";
import { ApplicationAnswerCard } from "@/components/application-answer-card";
import { Card, DetailGrid, EmptyState, ErrorBox, ExternalLinkButton, PageHeader, SimpleTable } from "@/components/ui";
import {
  getApplication,
  getAnswersForApplication,
  getApplicationDecisions,
  getApplicationReviewsForApplication,
  getReviewEligibleReviewers,
  getSeasons,
  getMatchesForPerson,
  getPersonByAuthorizedApplicationPersonId,
  getMentorProfileByAuthorizedApplicationPersonId,
  getMenteeProfileByAuthorizedApplicationPersonId,
  getPersonByAuthorizedMatchPartnerId,
  getS12ApplicationReviewQueue,
  keyById,
  getActiveAdminUsers
} from "@/lib/data";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canAssignReview, canDecide } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { ApplicationDecision, ApplicationReview, JsonRecord, Match, Person } from "@/lib/types";
import { applicationStatusLabel, applicationAcquisitionChannelLabel } from "@/lib/ui-labels";
import { displayText, formatDate } from "@/lib/utils";
import { canBrowseApplications } from "@/lib/read-access";
import { getStageRequirements, type StageRequirement } from "@/lib/recruitment-stage-requirements";
import {
  PROFILE_DECISION_STATUSES,
  SCREENING_DECISION_CHOICES,
  buildScreeningDecisionState
} from "@/lib/screening-decision";
import { getApplicationDecisionEligibility } from "@/lib/application-decisions";
import { findReturningMentorProfile } from "@/lib/returning-mentor";
import { redirect } from "next/navigation";
import {
  mentorExperienceFromAnswers,
  summarizeAcknowledgements,
  type ApplicationCommitmentRole
} from "@/lib/application-commitments";
import { AssignmentControls } from "./assign-reviewer-form";
import { DecisionForm } from "./decision-form";
import { ScreeningDecisionPanel } from "./screening-decision-panel";
import { ApprovalForm } from "./approval-form";
import { RestoreWithdrawnForm } from "./restore-withdrawn-form";
import { isApplicationReviewAssignable } from "@/lib/application-review-assignability";
import { isEditableReviewStatus } from "@/lib/review-status";

const QUESTION_ORDER = [
  "consent_marketing_email",
  "topics_top3",
  "goal_main",
  "mentor_support_domain",
  "soft_skill_wanted",
  "mentor_support_format",
  "preference_mentor_gender",
  "activities_wanted",
  "preference_frequency",
  "cv_url",
  "challenges_text",
  "why_uehm",
  "plan_in_season",
  "knowledge_about_uehm",
  "friction_response",
  "commitments",
  "dropout_reason_hypo",
  "reaction_pattern",
  "best_self_1y",
  "wanted_training_topics",
  "extra_question",
  "extra_message",
  "acquisition_channel"
];

const questionOrder = new Map(QUESTION_ORDER.map((key, index) => [key, index]));

function matchRank(match: Match) {
  const status = String(match.status ?? "").trim().toLowerCase();
  if (status === "active") return 0;
  if (status === "completed") return 1;
  if (status === "dropped") return 3;
  return 2;
}

function reviewStatusLabel(status: string) {
  if (status === "assigned") return "Chưa bắt đầu";
  if (status === "in_progress") return "Đang làm";
  if (status === "submitted") return "Đã nộp";
  if (status === "returned_for_clarification") return "Cần làm rõ";
  if (status === "cancelled") return "Đã huỷ";
  return status;
}

function roundLabel(round: string) {
  if (round === "profile_screening") return "Hồ sơ";
  if (round === "interview") return "Phỏng vấn";
  return round;
}

export default async function ApplicationDetailPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const queueType = searchParams.queue === "mentor-review" ? "mentor-review" : (searchParams.queue === "mentee-review" ? "mentee-review" : null);
  const queuePage = parseInt(searchParams.page as string || "1", 10) || 1;
  const q = searchParams.q as string || "";
  const queryParams = new URLSearchParams();
  if (q) queryParams.set("q", q);
  const baseQueryStr = queryParams.toString();
  const queryStrWithAmp = baseQueryStr ? `&${baseQueryStr}` : "";

  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  
  const [application, seasons, answers, reviewsResult, decisionsResult, adminUsersRes] =
    await Promise.all([
      getApplication(params.id, scope),
      getSeasons(scope),
      getAnswersForApplication(params.id),
      getApplicationReviewsForApplication(params.id, scope),
      getApplicationDecisions(params.id, scope),
      getActiveAdminUsers()
    ]);
  const [profileReviewersResult, interviewersResult, stageRequirementsResult] = application.data?.season_id
    ? await Promise.all([
        getReviewEligibleReviewers(application.data.season_id, "profile_screening"),
        getReviewEligibleReviewers(application.data.season_id, "interview"),
        getStageRequirements([application.data.season_id])
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [] as StageRequirement[], error: null }
      ];

  // The season's configured minimum, for display only. NULL when it could not
  // be read — the panel then refuses rather than assuming a minimum of 1 and
  // showing controls the server would reject.
  const requiredProfileReviews = stageRequirementsResult.error
    ? null
    : stageRequirementsResult.data.find((r) => r.review_stage === "profile_screening")
        ?.minimum_submitted_reviews ?? null;

  const personId = application.data?.person_id;
  const roleApplied = application.data?.role_applied;

  const [personRes, menteesRes, mentorsRes, matchesRes] = await Promise.all([
    personId ? getPersonByAuthorizedApplicationPersonId(personId) : Promise.resolve({ data: null, error: null }),
    personId && roleApplied === "mentee" ? getMenteeProfileByAuthorizedApplicationPersonId(personId) : Promise.resolve({ data: null, error: null }),
    personId && roleApplied === "mentor" ? getMentorProfileByAuthorizedApplicationPersonId(personId) : Promise.resolve({ data: null, error: null }),
    personId && application.data?.season_id ? getMatchesForPerson(personId, application.data.season_id) : Promise.resolve({ data: [], error: null })
  ]);

  const person = personRes.data;
  const menteeProfile = menteesRes.data;
  const mentorProfile = mentorsRes.data;
  const seasonsById = keyById(seasons.data);
  const season = application.data?.season_id ? seasonsById.get(application.data.season_id) : undefined;
  
  const relatedMatch = application.data?.person_id
    ? matchesRes.data
        .sort((a, b) => matchRank(a) - matchRank(b))[0]
    : undefined;
    
  // If we have a related match, we might need to fetch the OTHER person in the match to display their name.
  // We can't use getPersonByAuthorizedApplicationPersonId because that person isn't the applicant.
  // We can use getPersonByAuthorizedMatchPartnerId for the match partner, which is safe for 1 ID.
  let relatedMentor: Person | undefined = undefined;
  if (relatedMatch?.mentor_person_id && relatedMatch.mentor_person_id !== personId) {
     const matchPersonFetch = await getPersonByAuthorizedMatchPartnerId(relatedMatch.mentor_person_id);
     if (matchPersonFetch.data) {
       relatedMentor = matchPersonFetch.data;
     }
  } else if (relatedMatch?.mentor_person_id === personId) {
     relatedMentor = person ?? undefined;
  }

  const sortedAnswers = answers.data
    // Annotated: an object spread does not carry the source index signature, so
    // without this the sorted rows lose every answer field but `original_index`.
    .map((answer, index): JsonRecord => ({ ...answer, original_index: index }))
    .sort((a, b) => {
      const aOrder = questionOrder.get(String(a.question_key ?? "")) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = questionOrder.get(String(b.question_key ?? "")) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.original_index - b.original_index;
    });
  const error =
    application.error || personRes.error || seasons.error || menteesRes.error || mentorsRes.error || matchesRes.error || answers.error;

  if (!application.data) {
    return (
      <>
        <PageHeader title="Không tìm thấy hồ sơ ứng tuyển." />
        <ErrorBox message={error} />
        <EmptyState message="Không tìm thấy hồ sơ ứng tuyển." />
      </>
    );
  }

  // Coalesced display values:
  //   Identity — application-level (S12 native form) takes precedence over person-level (S11 legacy)
  //   Status   — application.status (S12 pipeline) ?? application.final_status (S11 legacy)
  //   Consent  — application.consent_data_storage (S12) ?? application.consent_pdpa (S11)
  const displayFullName   = application.data.full_name    ?? person?.full_name    ?? null;
  const displayEmail      = application.data.email_primary ?? person?.email_primary ?? null;
  const displayPhone      = application.data.phone_primary ?? person?.phone_primary ?? null;
  const displayGender     = application.data.gender        ?? person?.gender        ?? null;
  const displayStatus     = application.data.status        ?? application.data.final_status ?? null;
  const displayConsentVal = application.data.consent_data_storage ?? application.data.consent_pdpa;
  const returningMentorProfile = findReturningMentorProfile(
    {
      person_id: application.data.person_id,
      email_primary: displayEmail,
      role_applied: application.data.role_applied,
      status: application.data.status
    },
    person ? [person] : [],
    mentorProfile ? [mentorProfile] : []
  );
  const commitmentRole =
    application.data.role_applied === "mentor" || application.data.role_applied === "mentee"
      ? (application.data.role_applied as ApplicationCommitmentRole)
      : null;
  const acknowledgementSummary = commitmentRole
    ? summarizeAcknowledgements(commitmentRole, answers.data)
    : null;
  const mentorExperience = commitmentRole === "mentor" ? mentorExperienceFromAnswers(answers.data) : null;

  // raw_payload from native S12 form — entries rendered when no legacy answers exist
  const rawPayloadEntries = ((): [string, string][] => {
    const payload = application.data.raw_payload;
    if (!payload || typeof payload !== "object") return [];
    return Object.entries(payload)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]): [string, string] => [k, Array.isArray(v) ? (v as string[]).join(", ") : String(v)]);
  })();

  const reviews: ApplicationReview[] = reviewsResult.data ?? [];
  const adminUsers = adminUsersRes.data ?? [];
  const adminUserMap = new Map(adminUsers.map((u) => [u.id, u]));

  const assignedProfileReviewers = reviews
    .filter((r) => r.review_round === "profile_screening" && r.status !== "cancelled")
    .map((r) => {
      const user = r.reviewer_admin_user_id ? adminUserMap.get(r.reviewer_admin_user_id) : null;
      const identity = user ? (user.full_name || user.email) : "Không xác định";
      return `${identity} (${reviewStatusLabel(r.status)})`;
    });

  const assignedInterviewers = reviews
    .filter((r) => r.review_round === "interview" && r.status !== "cancelled")
    .map((r) => {
      const user = r.reviewer_admin_user_id ? adminUserMap.get(r.reviewer_admin_user_id) : null;
      const identity = user ? (user.full_name || user.email) : "Không xác định";
      return `${identity} (${reviewStatusLabel(r.status)})`;
    });

  const decisions: ApplicationDecision[] = decisionsResult.data ?? [];
  const canAssign = canAssignReview(adminUser?.role) && canOperateAnyScope(scopeContext);
  const canMakeDecision = canDecide(adminUser?.role) && canOperateAnyScope(scopeContext);
  const isWithdrawn = displayStatus === "withdrawn";
  const latestWithdrawal = decisions.find((decision) => decision.new_status === "withdrawn") ?? null;
  const correctionNeededReviews = reviews.filter((review) => isEditableReviewStatus(review.status));
  const hasAnyInterviewReview = reviews.some((review) => review.review_round === "interview");
  const profileAssignable = isApplicationReviewAssignable({
    status: displayStatus,
    reviewRound: "profile_screening",
    hasAnyInterviewReview
  });
  const interviewAssignable = isApplicationReviewAssignable({
    status: displayStatus,
    reviewRound: "interview",
    hasAnyInterviewReview
  });

  // Latest submitted review (for the decision form context)
  const latestSubmittedReview = reviews.find((r) => r.status === "submitted");
  const hasSubmittedReview = !!latestSubmittedReview;

  // Profile-round decision state. Reuses the reviews and admin users this page
  // already loaded — no extra query, no N+1.
  const reviewerNameById = new Map(
    adminUsers.map((u) => [u.id, u.full_name || u.email] as const)
  );
  const inProfileStage =
    !isWithdrawn && PROFILE_DECISION_STATUSES.has(String(displayStatus ?? "").trim());

  // Eligibility is ASKED OF THE DATABASE, one call per offered decision, and
  // only for an application still in the profile round. This is the same
  // function the write path consults, so the control an operator sees and the
  // transition the server would perform cannot disagree. A failed read comes
  // back as `eligibility_unknown`, which renders as unavailable.
  const screeningEligibility = inProfileStage
    ? Object.fromEntries(
        await Promise.all(
          SCREENING_DECISION_CHOICES.map(async (choice) => [
            choice.value,
            await getApplicationDecisionEligibility(application.data!.id, choice.value)
          ] as const)
        )
      )
    : {};

  const screeningState = buildScreeningDecisionState({
    applicationStatus: displayStatus,
    reviews,
    requiredCount: requiredProfileReviews,
    actorAdminUserId: adminUser?.id ?? null,
    reviewerNameById,
    eligibility: screeningEligibility
  });

  let prevAppId: string | null = null;
  let nextAppId: string | null = null;
  let computedPrevPage: number = queuePage;
  let computedNextPage: number = queuePage;

  if (queueType === "mentor-review" || queueType === "mentee-review") {
    const roleToFetch = queueType === "mentor-review" ? "mentor" : "mentee";
    const queueOptions = { scope, role: roleToFetch as "mentor"|"mentee", page: queuePage, pageSize: 25, search: q };
    
    const queue = await getS12ApplicationReviewQueue(queueOptions);
    const currentAppId = application.data.id;
    const currentIndex = queue.data.findIndex((app: any) => app.id === currentAppId);
    if (currentIndex > 0) {
      prevAppId = queue.data[currentIndex - 1].id;
    } else if (currentIndex === 0 && queuePage > 1) {
      const prevQueue = await getS12ApplicationReviewQueue({ ...queueOptions, page: queuePage - 1 });
      if (prevQueue.data.length > 0) {
        prevAppId = prevQueue.data[prevQueue.data.length - 1].id;
        computedPrevPage = queuePage - 1;
      }
    }

    if (currentIndex >= 0 && currentIndex < queue.data.length - 1) {
      nextAppId = queue.data[currentIndex + 1].id;
    } else if (currentIndex === queue.data.length - 1) {
      const nextQueue = await getS12ApplicationReviewQueue({ ...queueOptions, page: queuePage + 1 });
      if (nextQueue.data.length > 0) {
        nextAppId = nextQueue.data[0].id;
        computedNextPage = queuePage + 1;
      }
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <PageHeader title="Chi tiết ứng tuyển" description={displayText(displayFullName, "Ứng viên chưa rõ")} />
        <div className="flex flex-wrap justify-end gap-2">
          <a
            href={`/applications/${application.data.id}/export/csv`}
            download
            className="inline-flex rounded-md border border-vam-line px-3 py-1 text-sm font-medium text-vam-green hover:bg-vam-mint"
          >
            Tải CSV
          </a>
          <a
            href={`/applications/${application.data.id}/export/pdf`}
            download
            className="inline-flex rounded-md border border-vam-line px-3 py-1 text-sm font-medium text-vam-green hover:bg-vam-mint"
          >
            Tải PDF
          </a>
          {(queueType === "mentor-review" || queueType === "mentee-review") && (
            <>
            <Link
              href={prevAppId ? `/applications/${prevAppId}?queue=${queueType}&page=${computedPrevPage}${queryStrWithAmp}` : "#"}
              className={`inline-flex rounded-md border border-vam-line px-3 py-1 text-sm ${prevAppId ? "hover:bg-slate-50 text-vam-ink" : "opacity-50 pointer-events-none text-slate-400"}`}
            >
              Trước
            </Link>
            <Link
              href={nextAppId ? `/applications/${nextAppId}?queue=${queueType}&page=${computedNextPage}${queryStrWithAmp}` : "#"}
              className={`inline-flex rounded-md border border-vam-line px-3 py-1 text-sm ${nextAppId ? "hover:bg-slate-50 text-vam-ink" : "opacity-50 pointer-events-none text-slate-400"}`}
            >
              Tiếp
            </Link>
            <Link
              href={`/applications/${queueType}?page=${queuePage}${queryStrWithAmp}`}
              className="inline-flex rounded-md border border-vam-line px-3 py-1 text-sm hover:bg-slate-50 text-vam-ink"
            >
              Quay lại Hàng đợi
            </Link>
            </>
          )}
        </div>
      </div>
      <p className="mb-3 text-xs leading-5 text-slate-500">
        Hai tệp trên được tạo sẵn trên máy chủ và tải xuống trực tiếp. Không cần dùng lệnh in của
        trình duyệt, nên tệp PDF không kèm URL, đầu trang hay chân trang của trình duyệt. Nội dung
        trong PDF là văn bản nên có thể bôi đen, tìm kiếm và sao chép.
      </p>
      <ErrorBox message={error} />

      {isWithdrawn ? (
        <Card className="mb-4 border-red-300 bg-red-50">
          <h2 data-testid="withdrawn-terminal-banner" className="text-base font-semibold text-red-900">
            Hồ sơ đã rút khỏi quy trình tuyển
          </h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase text-red-700">Thời gian</dt>
              <dd className="mt-1 text-red-950">
                {latestWithdrawal?.created_at ? formatDate(latestWithdrawal.created_at) : "Không xác định"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-red-700">Người thực hiện</dt>
              <dd className="mt-1 text-red-950">{displayText(latestWithdrawal?.decided_by_name)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase text-red-700">Lý do / ghi chú</dt>
              <dd className="mt-1 whitespace-pre-wrap text-red-950">
                {displayText(latestWithdrawal?.decision_note)}
              </dd>
            </div>
          </dl>
          {correctionNeededReviews.length > 0 ? (
            <div className="mt-4 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-800">
              <p className="font-semibold">Cần huỷ phân công</p>
              <p className="mt-1">
                Phát hiện {correctionNeededReviews.length} phân công chưa kết thúc từ dữ liệu cũ. Không được tiếp tục review;
                Core Team/Admin cần huỷ các phân công này có audit.
              </p>
            </div>
          ) : null}
          {canMakeDecision ? (
            <RestoreWithdrawnForm applicationId={application.data.id} />
          ) : (
            <p className="mt-4 text-sm text-red-800">Chỉ Core Team/Admin mới có thể khôi phục hồ sơ.</p>
          )}
        </Card>
      ) : null}

      {/* ── Assign reviewer (admin / core_team only) ─────────────────────────── */}
      {/* Withdrawn quarantine: no assignment surface on a terminal application.
          The id is the anchor target for the screening panel's
          "Giao review hồ sơ" CTA, which only renders while operational. */}
      {canAssign && !isWithdrawn && (
        <Card className="mb-4" id="assign-review-card">
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Giao Review</h2>
          {(profileReviewersResult.error || interviewersResult.error) && (
            <ErrorBox message={`Không thể tải danh sách người tham gia: ${profileReviewersResult.error || interviewersResult.error}`} />
          )}
          <AssignmentControls
            applicationId={application.data.id}
            profileReviewers={profileReviewersResult.data}
            interviewers={interviewersResult.data}
            activeProfileReview={(() => {
              const r = reviews.find((rv) => rv.review_round === "profile_screening" && rv.status !== "cancelled");
              if (!r) return undefined;
              const u = r.reviewer_admin_user_id ? adminUserMap.get(r.reviewer_admin_user_id) : null;
              return { ...r, reviewer_name: u ? (u.full_name || u.email) : "Không xác định" };
            })()}
            activeInterviewReview={(() => {
              const r = reviews.find((rv) => rv.review_round === "interview" && rv.status !== "cancelled");
              if (!r) return undefined;
              const u = r.reviewer_admin_user_id ? adminUserMap.get(r.reviewer_admin_user_id) : null;
              return { ...r, reviewer_name: u ? (u.full_name || u.email) : "Không xác định" };
            })()}
            profileAssignable={profileAssignable}
            interviewAssignable={interviewAssignable}
          />
        </Card>
      )}

      {/* ── Review history ─────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">
          Lịch sử đánh giá{reviews.length > 0 ? ` (${reviews.length})` : ""}
        </h2>
        {reviews.length === 0 ? (
          <EmptyState message="Chưa có review nào cho đơn này." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-vam-line">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-vam-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Vòng</th>
                    <th className="px-4 py-3">Người phụ trách</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3">Hạn nộp</th>
                    <th className="px-4 py-3">Điểm tổng</th>
                    <th className="px-4 py-3">Đề xuất</th>
                    <th className="px-4 py-3">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {reviews.map((review) => {
                    const user = review.reviewer_admin_user_id ? adminUserMap.get(review.reviewer_admin_user_id) : null;
                    const identity = user ? (user.full_name || user.email) : "-";
                    return (
                    <tr key={review.id} className="hover:bg-vam-mint/40">
                      <td className="px-4 py-3 text-slate-700">{roundLabel(review.review_round)}</td>
                      <td className="px-4 py-3 text-slate-700">{identity}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2 py-0.5 text-xs font-medium text-vam-ink">
                          {reviewStatusLabel(review.status)}
                          {isWithdrawn && isEditableReviewStatus(review.status) ? " · Cần huỷ phân công" : ""}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {review.due_at ? formatDate(review.due_at) : "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {review.total_score !== null ? review.total_score : "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {displayText(review.recommendation)}
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          // An unfinished review belongs to exactly one person.
                          // Offering "Thực hiện đánh giá" on somebody else's row
                          // walked Core Team into an editor the server always
                          // refuses; the row is read-only for everyone but its
                          // owner. Cancel and reassign stay on the assignment
                          // surface, where they are authorized.
                          const isOpen = isEditableReviewStatus(review.status);
                          const isMine = review.reviewer_admin_user_id === adminUser?.id;
                          if (isWithdrawn && isOpen) {
                            return (
                              <Link
                                href={`/reviews/${review.id}`}
                                className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                              >
                                Huỷ phân công
                              </Link>
                            );
                          }
                          if (isOpen && !isMine) {
                            return (
                              <span
                                data-testid="review-owned-by-other"
                                className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2.5 py-1 text-xs text-slate-500"
                              >
                                {identity} đang thực hiện
                              </span>
                            );
                          }
                          return (
                            <Link
                              href={`/reviews/${review.id}`}
                              className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                            >
                              {isOpen ? "Mở đánh giá của tôi" : "Xem"}
                            </Link>
                          );
                        })()}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* ── Admin/core-team decision ──────────────────────────────────────────── */}
      {!isWithdrawn && <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">
          Quyết định của Admin / Core team
        </h2>
        {canMakeDecision ? (
          screeningState.inProfileStage ? (
            // One Core Team action closes the profile round: invite, reject, or
            // ask for more. "Qua vòng hồ sơ" is no longer a separate step.
            <ScreeningDecisionPanel
              applicationId={application.data.id}
              currentStatus={displayStatus}
              state={screeningState}
              canAssignReview={canAssign}
            />
          ) : (
          <DecisionForm
            applicationId={application.data.id}
            currentStatus={displayStatus}
            hasSubmittedReview={hasSubmittedReview}
            latestRecommendation={latestSubmittedReview?.recommendation}
            latestTotalScore={latestSubmittedReview?.total_score}
          />
          )
        ) : (
          <p className="text-sm text-slate-500">
            Chỉ admin / core team mới có thể ra quyết định cho đơn này.
          </p>
        )}
      </Card>}

      {/* ── Decision history ──────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">
          Lịch sử quyết định{decisions.length > 0 ? ` (${decisions.length})` : ""}
        </h2>
        {decisions.length === 0 ? (
          <EmptyState message="Chưa có quyết định nào được ghi nhận." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-vam-line">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-vam-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Thời gian</th>
                    <th className="px-4 py-3">Người quyết định</th>
                    <th className="px-4 py-3">Trước</th>
                    <th className="px-4 py-3">Sau</th>
                    <th className="px-4 py-3">Ghi chú</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {decisions.map((d) => (
                    <tr key={d.id} className="hover:bg-vam-mint/40">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {formatDate(d.created_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {displayText(d.decided_by_name)}
                      </td>
                      <td className="px-4 py-3 text-slate-500 italic">
                        {displayText(d.previous_status)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2 py-0.5 text-xs font-medium text-vam-ink">
                          {d.new_status}
                        </span>
                      </td>
                      <td className="max-w-xs break-words px-4 py-3 text-slate-600">
                        {displayText(d.decision_note)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* ── Final approval (admin / core-team only) ───────────────────────────── */}
      {canMakeDecision && displayStatus === "interview_passed" && (
        <Card className="mb-4 border-vam-green/30">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-vam-ink">
              Duyệt thành viên chính thức
            </h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Tạo hồ sơ <strong>people</strong> và <strong>mentor_profiles / mentee_profiles</strong> từ
            đơn ứng tuyển này. Sau khi duyệt, admin có thể bổ sung thông tin chi tiết trên trang chỉnh sửa hồ sơ.
          </p>
          <ApprovalForm
            applicationId={application.data.id}
            currentStatus={displayStatus}
            fullName={displayFullName}
            emailPrimary={displayEmail}
            phonePrimary={displayPhone}
            gender={displayGender}
            roleApplied={application.data.role_applied}
            seasonCode={season?.code ?? null}
            intakeBatchId={application.data.intake_batch_id}
            alreadyApproved={!!application.data.person_id}
            personId={application.data.person_id}
          />
        </Card>
      )}

      {/* ── Thông tin ứng viên — moved to top so operator knows who they're reviewing ── */}
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin ứng viên</h2>
        <DetailGrid
          rows={[
            ["Họ tên", displayText(displayFullName)],
            ["Email", displayText(displayEmail)],
            ["Số điện thoại", displayText(displayPhone)],
            ["Giới tính", displayText(displayGender)],
            ["Người review hồ sơ", assignedProfileReviewers.length > 0 ? assignedProfileReviewers.join(", ") : "-"],
            ["Người phỏng vấn", assignedInterviewers.length > 0 ? assignedInterviewers.join(", ") : "-"]
          ]}
        />
      </Card>

      {commitmentRole ? (
        <Card className="mb-4">
          <h2 className="mb-3 text-base font-semibold text-vam-ink">
            Điều kiện và xác nhận tham gia — V1
          </h2>
          {acknowledgementSummary?.isHistorical ? (
            <EmptyState message="Không được thu thập cho phiên bản đơn này." />
          ) : (
            <>
              {mentorExperience ? (
                <div className="mb-4">
                  <DetailGrid
                    rows={[
                      ["Tổng số năm kinh nghiệm làm việc", displayText(mentorExperience.totalWorkYears)],
                      ["Số năm quản lý con người/đội ngũ", displayText(mentorExperience.peopleManagementYears)],
                      ["Đội ngũ lớn nhất trực tiếp quản lý", displayText(mentorExperience.largestTeamSize)],
                      ["Người giới thiệu/người tham chiếu", displayText(mentorExperience.reference)],
                      [
                        "Điều kiện Mentor",
                        mentorExperience.eligibility === "STANDARD_ELIGIBILITY_MET"
                          ? "✓ Standard eligibility met"
                          : mentorExperience.eligibility === "REQUIRES_CORE_TEAM_EXCEPTION_REVIEW"
                            ? "⚠ Requires Core Team exception review"
                            : "Không được thu thập cho phiên bản đơn này"
                      ]
                    ]}
                  />
                </div>
              ) : null}
              <details className="rounded-md border border-vam-line bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-vam-ink">
                  {acknowledgementSummary?.completed
                    ? "✓ Acknowledgements completed"
                    : "Acknowledgements đã thu thập một phần (phiên bản lịch sử)"}
                </summary>
                <div className="mt-3 grid gap-2">
                  {acknowledgementSummary?.collected.map(({ definition, answer }) => (
                    <div key={definition.key} className="rounded-md border border-vam-line bg-white p-3 text-sm">
                      <div className="font-medium text-vam-ink">{definition.wording}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {definition.key} · version {definition.version} · {answer?.value_text === "true" ? "Đã xác nhận" : "Chưa thu thập"}
                        {answer?.created_at ? ` · ${formatDate(answer.created_at)}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </Card>
      ) : null}

      {/* ── Quick summary ── */}
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Tóm tắt nhanh</h2>
        <DetailGrid
          rows={[
            ["Trạng thái hồ sơ", applicationStatusLabel(displayStatus)],
            ["Nguồn dữ liệu", displayText(application.data.source)],
            ["Câu trả lời (dữ liệu cũ)", sortedAnswers.length > 0 ? sortedAnswers.length : "-"],
            ["Nội dung form đăng ký", rawPayloadEntries.length > 0 ? rawPayloadEntries.length : "-"],
            ["Mentor / Match", relatedMatch ? `${displayText(relatedMentor?.full_name)} — ${displayText(relatedMatch.status)}` : "-"]
          ]}
        />
      </Card>

      {/* ── Detailed info ── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Tóm tắt ứng tuyển</h2>
          <DetailGrid
            rows={[
              ["Mùa tuyển sinh", displayText(season?.code ?? season?.name)],
              ["Vai trò ứng tuyển", displayText(application.data.role_applied)],
              ["Ngày nộp đơn", formatDate(application.data.submitted_at)],
              ["Trạng thái hồ sơ", displayText(application.data.status)],
              ["Trạng thái cũ", displayText(application.data.final_status)],
              ["Nguồn dữ liệu", displayText(application.data.source)],
              ["SBD (Số báo danh)", displayText(application.data.sbd)],
              ["Đồng ý lưu dữ liệu", String(displayConsentVal ?? "-")],
              ["Đồng ý PDPA (cũ)", displayText(application.data.consent_pdpa)],
              ["Thời điểm đồng ý PDPA", formatDate(application.data.consent_pdpa_at)],
              ["Biết đến chương trình qua", applicationAcquisitionChannelLabel(application.data.raw_payload, application.data.acquisition_channel)]
            ]}
          />
          <div className="mt-3 rounded-md border border-vam-line bg-slate-50 px-3 py-2">
            <div className="text-xs font-medium uppercase text-slate-500">Link hồ sơ ứng viên</div>
            <div className="mt-1">
              <ExternalLinkButton href={application.data.profile_url} label="Xem profile ứng viên" />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentee profile liên quan</h2>
          {menteeProfile ? (
            <DetailGrid
              rows={[
                ["Mã mentee", displayText(menteeProfile.mentee_code)],
                ["Mã trường", displayText(menteeProfile.school_code)],
                ["Ngành học", displayText(menteeProfile.major)],
                ["Khóa / Lớp", displayText(menteeProfile.class_cohort)],
                ["MSSV", displayText(menteeProfile.mssv)]
              ]}
            />
          ) : (
            <EmptyState message="Chưa có mentee profile liên quan." />
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Mentor profile liên quan</h2>
          {mentorProfile ? (
            <DetailGrid
              rows={[
                ["Mã mentor", displayText(mentorProfile.mentor_code)],
                ["Công ty hiện tại", displayText(mentorProfile.company_current)],
                ["Chức danh", displayText(mentorProfile.title_current)]
              ]}
            />
          ) : returningMentorProfile ? (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <div className="font-semibold">Đã tìm thấy Mentor hiện hữu</div>
              <div className="mt-1">Mã mentor: {displayText(returningMentorProfile.mentor_code)}</div>
            </div>
          ) : (
            <EmptyState message="Chưa có mentor profile liên quan." />
          )}
        </Card>
      </div>

      {/* ── Match + Answers ── */}
      <div className="mt-4 grid gap-4">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Match liên quan</h2>
          {relatedMatch ? (
            <SimpleTable
              rows={[relatedMatch]}
              columns={[
                { key: "mentor_name", label: "Mentor", render: () => displayText(relatedMentor?.full_name) },
                { key: "mentor_email", label: "Email mentor", render: () => displayText(relatedMentor?.email_primary) },
                { key: "status", label: "Trạng thái", render: (row) => displayText(row.status) },
                { key: "match_link", label: "Match", internalHrefKey: "id", internalHrefPrefix: "/matches/", internalLabel: "Xem match" }
              ]}
            />
          ) : (
            <EmptyState message="Chưa có match liên quan cho ứng viên này." />
          )}
        </Card>

        {/* Câu trả lời (dữ liệu cũ — Season 11 và trước đó) */}
        {sortedAnswers.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Câu trả lời ứng tuyển</h2>
            <div className="grid gap-3">
              {sortedAnswers.map((answer, index) => (
                <ApplicationAnswerCard
                  key={`${answer.application_id}-${answer.question_key}-${index}`}
                  questionLabel={answer.question_label ?? answer.question_key}
                  questionKey={answer.question_key}
                  valueText={answer.value_text}
                />
              ))}
            </div>
          </Card>
        )}

        {/* Nội dung form đăng ký native (raw_payload) */}
        {rawPayloadEntries.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Nội dung form đăng ký</h2>
            <DetailGrid rows={rawPayloadEntries} />
          </Card>
        )}

        {/* Empty state chỉ khi không có cả hai */}
        {sortedAnswers.length === 0 && rawPayloadEntries.length === 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Câu trả lời ứng tuyển</h2>
            <EmptyState message="Chưa có câu trả lời ứng tuyển." />
          </Card>
        )}
      </div>

      <div className="mt-4 flex gap-4">
        {queueType === "mentor-review" ? (
          <Link href={`/applications/mentor-review?page=${queuePage}`} className="text-sm font-medium text-vam-green">
            Quay lại Hàng đợi duyệt
          </Link>
        ) : (
          <Link href="/applications" className="text-sm font-medium text-vam-green">Quay lại Applications</Link>
        )}
        {person?.id ? <Link href={`/people/${person.id}`} className="text-sm font-medium text-vam-green">Xem hồ sơ người này</Link> : null}
      </div>
    </>
  );
}
