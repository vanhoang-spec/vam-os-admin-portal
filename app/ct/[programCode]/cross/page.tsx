import { notFound, redirect } from "next/navigation";

import { ParticipantShell } from "@/components/participant-shell";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getCurrentParticipant } from "@/lib/participant-auth";
import { getParticipantHome } from "@/lib/participant-home";
import { ROUTES } from "@/lib/participant-auth-core";
import { requestableFields } from "@/lib/cross-fields-core";
import { getMentorFields } from "@/lib/mentor-cross-fields";
import {
  formatVietnameseDateTime,
  listMyCrossRequests,
  MAX_LIVE_REQUESTS_PER_MENTEE
} from "@/lib/cross-requests";
import { listOpenCrossSessions } from "@/lib/participant-event-registration";
import {
  BackLink,
  MenteeRequestPanel,
  MentorFieldsPanel,
  OpenSessionsPanel
} from "./cross-client";

/**
 * Page: /ct/[programCode]/cross
 *
 * Where cross-mentoring starts, for both sides of it.
 *
 * A mentee asks for a session here. A mentor says which fields they can take —
 * here rather than on the season confirmation form, because that form locks the
 * moment a mentor has an active match, and cross-mentoring runs after matching.
 * Collecting it there would have meant collecting nothing from exactly the
 * mentors this feature needs.
 *
 * The programme code decides the season, as everywhere in the portal, and it is
 * checked against this person's own membership before anything loads.
 */
export const dynamic = "force-dynamic";

const LIVE_STATUSES = new Set([
  "submitted",
  "approved",
  "inviting",
  "selecting",
  "scheduled",
  "published"
]);

export default async function ParticipantCrossPage(
  props: {
    params: Promise<{ programCode: string }>;
  }
) {
  const params = await props.params;
  const adminUser = await getCurrentAdminUser();
  if (adminUser) redirect("/operations/cross");

  const participant = await getCurrentParticipant();
  if (participant.state !== "participant") redirect(ROUTES.noMembership);

  const view = await getParticipantHome({
    personId: participant.account.personId,
    programCode: params.programCode
  });

  if (!view.program) notFound();

  const seasonId = view.currentSeason?.id ?? null;
  const industries = requestableFields("industry");
  const functions = requestableFields("function");

  const isMentor = view.role === "mentor";
  const isMentee = view.role === "mentee";

  const requests = isMentee ? await listMyCrossRequests(params.programCode) : [];
  const liveCount = requests.filter((request) => LIVE_STATUSES.has(request.status)).length;

  // Everybody in the season sees what is open — a cross session is not private
  // to the mentee who asked for it.
  const sessions = seasonId
    ? await listOpenCrossSessions({ personId: participant.account.personId, seasonId })
    : [];

  const declared =
    isMentor && seasonId
      ? await getMentorFields({ personId: participant.account.personId, seasonId })
      : null;

  return (
    <ParticipantShell
      programName={view.program.name}
      seasonLabel={view.currentSeason?.name ?? view.currentSeason?.code ?? null}
      personName={participant.account.fullName}
    >
      <div className="space-y-8">
        <BackLink programCode={params.programCode} />

        <div>
          <h1 className="text-xl font-semibold text-vam-ink">Cross-mentoring</h1>
          <p className="mt-1 text-sm text-vam-muted">
            Những buổi chia sẻ ngắn với một mentor ngoài cặp của bạn, về một lĩnh vực cụ thể.
          </p>
        </div>

        {!seasonId ? (
          <p className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-muted">
            Chương trình chưa mở mùa mới. Khi mùa bắt đầu, phần này sẽ mở lại.
          </p>
        ) : null}

        {seasonId ? (
          <OpenSessionsPanel
            programCode={params.programCode}
            sessions={sessions.map((session) => ({
              eventId: session.eventId,
              eventName: session.eventName,
              timeLabel: formatVietnameseDateTime(session.startsAt),
              description: session.description,
              registered: session.registered
            }))}
          />
        ) : null}

        {seasonId && isMentee ? (
          <MenteeRequestPanel
            programCode={params.programCode}
            industries={industries}
            functions={functions}
            atLimit={liveCount >= MAX_LIVE_REQUESTS_PER_MENTEE}
            requests={requests.map((request) => ({
              id: request.id,
              fieldLabel: request.fieldLabel,
              topic: request.topic,
              status: request.status,
              statusLabel: request.statusLabel,
              reviewNote: request.reviewNote,
              scheduledAt: formatVietnameseDateTime(request.scheduledAt),
              location: request.location,
              createdAt: request.createdAt
            }))}
          />
        ) : null}

        {seasonId && isMentor ? (
          <MentorFieldsPanel
            programCode={params.programCode}
            seasonId={seasonId}
            industries={industries}
            functions={functions}
            selectedIndustries={declared?.industries ?? []}
            selectedFunctions={declared?.functions ?? []}
            source={declared?.source ?? null}
          />
        ) : null}

        {seasonId && !isMentor && !isMentee ? (
          <p className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-muted">
            Phần này dành cho mentor và mentee của mùa đang chạy.
          </p>
        ) : null}
      </div>
    </ParticipantShell>
  );
}
