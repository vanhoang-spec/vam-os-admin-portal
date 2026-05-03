import Link from "next/link";
import { ApplicationAnswerCard } from "@/components/application-answer-card";
import { Card, DetailGrid, EmptyState, ErrorBox, ExternalLinkButton, PageHeader, SimpleTable } from "@/components/ui";
import {
  getAnswersForApplication,
  getApplication,
  getMatches,
  getMenteeProfiles,
  getMentorProfiles,
  getPeople,
  getSeasons,
  keyById
} from "@/lib/data";
import { Match } from "@/lib/types";
import { displayCode, displayConsent, displayText, formatDate } from "@/lib/utils";

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

export default async function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const [application, people, seasons, mentees, mentors, matches, answers] = await Promise.all([
    getApplication(params.id),
    getPeople(),
    getSeasons(),
    getMenteeProfiles(),
    getMentorProfiles(),
    getMatches(),
    getAnswersForApplication(params.id)
  ]);

  const peopleById = keyById(people.data);
  const seasonsById = keyById(seasons.data);
  const person = application.data?.person_id ? peopleById.get(application.data.person_id) : undefined;
  const season = application.data?.season_id ? seasonsById.get(application.data.season_id) : undefined;
  const menteeProfile = mentees.data.find((profile) => profile.person_id === application.data?.person_id);
  const mentorProfile = mentors.data.find((profile) => profile.person_id === application.data?.person_id);
  const relatedMatch = application.data?.person_id
    ? matches.data
        .filter((match) => match.mentee_person_id === application.data?.person_id)
        .sort((a, b) => matchRank(a) - matchRank(b))[0]
    : undefined;
  const relatedMentor = relatedMatch?.mentor_person_id ? peopleById.get(relatedMatch.mentor_person_id) : undefined;
  const sortedAnswers = answers.data
    .map((answer, index) => ({ ...answer, original_index: index }))
    .sort((a, b) => {
      const aOrder = questionOrder.get(String(a.question_key ?? "")) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = questionOrder.get(String(b.question_key ?? "")) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.original_index - b.original_index;
    });
  const longAnswerCount = sortedAnswers.filter((answer) => displayText(answer.value_text).length > 800).length;
  const error =
    application.error || people.error || seasons.error || mentees.error || mentors.error || matches.error || answers.error;

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

  // raw_payload from native S12 form — entries rendered when no legacy answers exist
  const rawPayloadEntries = ((): [string, string][] => {
    const payload = application.data.raw_payload;
    if (!payload || typeof payload !== "object") return [];
    return Object.entries(payload)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]): [string, string] => [k, Array.isArray(v) ? (v as string[]).join(", ") : String(v)]);
  })();

  return (
    <>
      <PageHeader title="Chi tiết ứng tuyển" description={displayText(displayFullName, "Ứng viên chưa rõ")} />
      <ErrorBox message={error} />

      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Tóm tắt nhanh</h2>
        <DetailGrid
          rows={[
            ["status", displayText(displayStatus)],
            ["source", displayText(application.data.source)],
            ["câu trả lời legacy", sortedAnswers.length > 0 ? sortedAnswers.length : "-"],
            ["raw_payload fields (S12)", rawPayloadEntries.length > 0 ? rawPayloadEntries.length : "-"],
            ["mentor/match", relatedMatch ? `${displayText(relatedMentor?.full_name)} - ${displayText(relatedMatch.status)}` : "-"]
          ]}
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin ứng viên</h2>
          <DetailGrid
            rows={[
              ["full_name", displayText(displayFullName)],
              ["email_primary", displayText(displayEmail)],
              ["phone_primary", displayText(displayPhone)],
              ["gender", displayText(displayGender)],
              ["source_sheets (person)", displayText(person?.source_sheets)]
            ]}
          />
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Tóm tắt ứng tuyển</h2>
          <DetailGrid
            rows={[
              ["season_code", displayCode(season?.code ?? season?.name)],
              ["role_applied", displayText(application.data.role_applied)],
              ["submitted_at", formatDate(application.data.submitted_at)],
              ["status (S12)", displayText(application.data.status)],
              ["final_status (S11)", displayText(application.data.final_status)],
              ["source", displayText(application.data.source)],
              ["sbd", displayText(application.data.sbd)],
              ["consent_data_storage (S12)", displayConsent(application.data.consent_data_storage)],
              ["consent_pdpa (S11)", displayConsent(application.data.consent_pdpa)],
              ["consent_pdpa_at", formatDate(application.data.consent_pdpa_at)],
              ["acquisition_channel", displayText(application.data.acquisition_channel)]
            ]}
          />
          <div className="mt-3 rounded-md border border-vam-line bg-slate-50 px-3 py-2">
            <div className="text-xs font-medium uppercase text-slate-500">profile_url</div>
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
                ["mentee_code", displayCode(menteeProfile.mentee_code)],
                ["school_code", displayCode(menteeProfile.school_code)],
                ["major", displayText(menteeProfile.major)],
                ["class_cohort", displayText(menteeProfile.class_cohort)],
                ["mssv", displayText(menteeProfile.mssv)]
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
                ["mentor_code", displayCode(mentorProfile.mentor_code)],
                ["company_current", displayText(mentorProfile.company_current)],
                ["title_current", displayText(mentorProfile.title_current)]
              ]}
            />
          ) : (
            <EmptyState message="Chưa có mentor profile liên quan." />
          )}
        </Card>
      </div>

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

        {/* Legacy answer table (Season 11 and earlier) */}
        {sortedAnswers.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Câu trả lời ứng tuyển (legacy)</h2>
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

        {/* Native S12 form payload — shown when raw_payload is populated */}
        {rawPayloadEntries.length > 0 && (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Nội dung đơn (S12 native form)</h2>
            <DetailGrid rows={rawPayloadEntries} />
          </Card>
        )}

        {/* Empty state only when neither legacy answers nor raw_payload exist */}
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
