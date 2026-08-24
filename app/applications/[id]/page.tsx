import Link from "next/link";
import { ApplicationAnswerCard } from "@/components/application-answer-card";
import { Card, DetailGrid, EmptyState, ErrorBox, ExternalLinkButton, PageHeader, SimpleTable } from "@/components/ui";
import { UnassignReviewButton } from "./unassign-review-button";
import {
  getActiveAdminUsers,
  keyById
} from "@/lib/data";
import { getApplicationDetailContext } from "@/lib/application-detail";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canAssignReview, canDecide } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { ApplicationDecision, ApplicationReview, JsonRecord, Match } from "@/lib/types";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { displayText, formatDate } from "@/lib/utils";
import { canBrowseApplications } from "@/lib/read-access";
import { findReturningMentorProfile } from "@/lib/returning-mentor";
import { redirect } from "next/navigation";
import {
  mentorExperienceFromAnswers,
  summarizeAcknowledgements,
  type ApplicationCommitmentRole
} from "@/lib/application-commitments";
import { AssignReviewerForm } from "./assign-reviewer-form";
import { DecisionForm } from "./decision-form";
import { ApprovalForm } from "./approval-form";

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

export default async function ApplicationDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  
  const [detailContext, reviewersResult] = await Promise.all([
    getApplicationDetailContext(params.id, scope),
    getActiveAdminUsers()
  ]);

  if (detailContext.error || !detailContext.application) {
    return (
      <>
        <PageHeader title="Không tìm thấy hồ sơ ứng tuyển." />
        <ErrorBox message={detailContext.error || "Không tìm thấy hồ sơ hoặc không có quyền truy cập."} />
        <EmptyState message="Không tìm thấy hồ sơ ứng tuyển." />
      </>
    );
  }

  const {
    application, person, season, menteeProfile, mentorProfile, relatedMatch, relatedMentor,
    answers, reviews, decisions
  } = detailContext;

  const sortedAnswers = answers
    .map((answer, index): JsonRecord => ({ ...answer, original_index: index }))
    .sort((a, b) => {
      const aOrder = questionOrder.get(String(a.question_key ?? "")) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = questionOrder.get(String(b.question_key ?? "")) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.original_index as number) - (b.original_index as number);
    });

  const error = reviewersResult.error;

  // Coalesced display values:
  //   Identity — application-level (S12 native form) takes precedence over person-level (S11 legacy)
  //   Status   — application.status (S12 pipeline) ?? application.final_status (S11 legacy)
  //   Consent  — application.consent_data_storage (S12) ?? application.consent_pdpa (S11)
  const displayFullName   = application.full_name    ?? person?.full_name    ?? null;
  const displayEmail      = application.email_primary ?? person?.email_primary ?? null;
  const displayPhone      = application.phone_primary ?? person?.phone_primary ?? null;
  const displayGender     = application.gender        ?? person?.gender        ?? null;
  const displayStatus     = application.status        ?? application.final_status ?? null;
  const displayConsentVal = application.consent_data_storage ?? application.consent_pdpa;
  const returningMentorProfile = findReturningMentorProfile(
    {
      person_id: application.person_id,
      email_primary: displayEmail,
      role_applied: application.role_applied,
      status: application.status
    },
    person ? [person] : [], // Dummy, only needs to check identity
    mentorProfile ? [mentorProfile] : []
  );
  const commitmentRole =
    application.role_applied === "mentor" || application.role_applied === "mentee"
      ? (application.role_applied as ApplicationCommitmentRole)
      : null;
  const acknowledgementSummary = commitmentRole
    ? summarizeAcknowledgements(commitmentRole, answers)
    : null;
  const mentorExperience = commitmentRole === "mentor" ? mentorExperienceFromAnswers(answers) : null;

  // raw_payload from native S12 form — entries rendered when no legacy answers exist
  const rawPayloadEntries = ((): [string, string][] => {
    const payload = application.raw_payload;
    if (!payload || typeof payload !== "object") return [];
    return Object.entries(payload)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]): [string, string] => [k, Array.isArray(v) ? (v as string[]).join(", ") : String(v)]);
  })();

  const canAssign = canAssignReview(adminUser?.role) && canOperateAnyScope(scopeContext);
  const canMakeDecision = canDecide(adminUser?.role) && canOperateAnyScope(scopeContext);

  // Latest submitted review (for the decision form context)
  const latestSubmittedReview = reviews.find((r) => r.status === "submitted");
  const hasSubmittedReview = !!latestSubmittedReview;

  return (
    <>
      <PageHeader title="Chi tiết ứng tuyển" description={displayText(displayFullName, "Ứng viên chưa rõ")} />
      <ErrorBox message={error} />

      {/* ── Assign reviewer (admin / core_team only) ─────────────────────────── */}
      {canAssign && (
        <Card className="mb-4">
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Giao Review</h2>
          {reviewersResult.error && (
            <ErrorBox message={`Không thể tải danh sách reviewer: ${reviewersResult.error}`} />
          )}
          <AssignReviewerForm
            applicationId={application.id}
            reviewers={reviewersResult.data ?? []}
          />
        </Card>
      )}

      {/* ── Review history ─────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">
          Lịch sử Review{reviews.length > 0 ? ` (${reviews.length})` : ""}
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
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3">Hạn nộp</th>
                    <th className="px-4 py-3">Điểm tổng</th>
                    <th className="px-4 py-3">Đề xuất</th>
                    <th className="px-4 py-3">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {reviews.map((review) => (
                    <tr key={review.id} className="hover:bg-vam-mint/40">
                      <td className="px-4 py-3 text-slate-700">{roundLabel(review.review_round)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2 py-0.5 text-xs font-medium text-vam-ink">
                          {reviewStatusLabel(review.status)}
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
                      <td className="px-4 py-3 flex items-center gap-2">
                        <Link
                          href={`/reviews/${review.id}`}
                          className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                        >
                          {review.status === "submitted" ? "Xem" : "Làm review"}
                        </Link>
                        {canAssign && review.status !== "submitted" && review.status !== "cancelled" && (
                          <UnassignReviewButton reviewId={review.id} applicationId={application.id} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* ── Admin/core-team decision ──────────────────────────────────────────── */}
      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">
          Quyết định của Admin / Core team
        </h2>
        {canMakeDecision ? (
          <DecisionForm
            applicationId={application.id}
            currentStatus={displayStatus}
            hasSubmittedReview={hasSubmittedReview}
            latestRecommendation={latestSubmittedReview?.recommendation}
            latestTotalScore={latestSubmittedReview?.total_score}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Chỉ admin / core team mới có thể ra quyết định cho đơn này.
          </p>
        )}
      </Card>

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
      {canMakeDecision && (
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
            applicationId={application.id}
            currentStatus={displayStatus}
            fullName={displayFullName}
            emailPrimary={displayEmail}
            phonePrimary={displayPhone}
            gender={displayGender}
            roleApplied={application.role_applied}
            seasonCode={season?.code ?? null}
            intakeBatchId={application.intake_batch_id}
            alreadyApproved={!!application.person_id}
            personId={application.person_id}
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
            ["Giới tính", displayText(displayGender)]
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
            ["Nguồn dữ liệu", displayText(application.source)],
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
              ["Vai trò ứng tuyển", displayText(application.role_applied)],
              ["Ngày nộp đơn", formatDate(application.submitted_at)],
              ["Trạng thái hồ sơ", displayText(application.status)],
              ["Trạng thái cũ", displayText(application.final_status)],
              ["Nguồn dữ liệu", displayText(application.source)],
              ["SBD (Số báo danh)", displayText(application.sbd)],
              ["Đồng ý lưu dữ liệu", String(displayConsentVal ?? "-")],
              ["Đồng ý PDPA (cũ)", displayText(application.consent_pdpa)],
              ["Thời điểm đồng ý PDPA", formatDate(application.consent_pdpa_at)],
              ["Kênh tiếp cận", displayText(application.acquisition_channel)]
            ]}
          />
          <div className="mt-3 rounded-md border border-vam-line bg-slate-50 px-3 py-2">
            <div className="text-xs font-medium uppercase text-slate-500">Link hồ sơ ứng viên</div>
            <div className="mt-1">
              <ExternalLinkButton href={application.profile_url} label="Xem profile ứng viên" />
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
        <Link href="/applications" className="text-sm font-medium text-vam-green">Quay lại Applications</Link>
        {person?.id ? <Link href={`/people/${person.id}`} className="text-sm font-medium text-vam-green">Xem hồ sơ người này</Link> : null}
      </div>
    </>
  );
}
