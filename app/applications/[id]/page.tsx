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

  return (
    <>
      <PageHeader title="Chi tiết ứng tuyển" description={displayText(person?.full_name, "Ứng viên chưa rõ")} />
      <ErrorBox message={error} />

      <Card className="mb-4">
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Tóm tắt nhanh</h2>
        <DetailGrid
          rows={[
            ["số câu trả lời", sortedAnswers.length],
            ["câu trả lời dài", longAnswerCount],
            ["final_status", displayText(application.data.final_status)],
            ["mentor/match", relatedMatch ? `${displayText(relatedMentor?.full_name)} - ${displayText(relatedMatch.status)}` : "-"]
          ]}
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Thông tin ứng viên</h2>
          <DetailGrid
            rows={[
              ["full_name", displayText(person?.full_name)],
              ["email_primary", displayText(person?.email_primary)],
              ["phone_primary", displayText(person?.phone_primary)],
              ["gender", displayText(person?.gender)],
              ["source_sheets", displayText(person?.source_sheets)]
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
              ["sbd", displayText(application.data.sbd)],
              ["consent_pdpa", displayConsent(application.data.consent_pdpa)],
              ["consent_pdpa_at", formatDate(application.data.consent_pdpa_at)],
              ["acquisition_channel", displayText(application.data.acquisition_channel)],
              ["final_status", displayText(application.data.final_status)]
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

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Câu trả lời ứng tuyển</h2>
          {sortedAnswers.length ? (
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
          ) : (
            <EmptyState message="Chưa có câu trả lời ứng tuyển." />
          )}
        </Card>
      </div>

      <div className="mt-4 flex gap-4">
        <Link href="/applications" className="text-sm font-medium text-vam-green">Quay lại Applications</Link>
        {person?.id ? <Link href={`/people/${person.id}`} className="text-sm font-medium text-vam-green">Xem hồ sơ người này</Link> : null}
      </div>
    </>
  );
}
