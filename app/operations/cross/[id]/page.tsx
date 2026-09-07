import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, DetailGrid, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canPublishCrossSession, canTriageCrossRequest } from "@/lib/permissions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase-server";
import { countPassedOver } from "@/lib/cross-invitations";
import { formatVietnameseDateTime, getCrossRequestDetail } from "@/lib/cross-requests";
import { invitationStatusLabel, requestStatusLabel } from "@/lib/cross-mentoring-core";
import {
  CancelPanel,
  ClosePanel,
  DecidePanel,
  PostPanel,
  PublishPanel,
  ReviewPanel,
  SchedulePanel,
  SweepPanel
} from "./cross-detail-client";

/**
 * Page: /operations/cross/[id]
 *
 * One request, everything that has happened to it, and only the buttons that
 * make sense right now.
 *
 * Panels are shown by status rather than all at once and greyed: an organiser
 * looking at a request that is waiting for mentors should see "invite mentors",
 * not eight controls of which seven would be refused. The library re-checks
 * every one of them, so hiding is for clarity, not for safety.
 */
export const dynamic = "force-dynamic";

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in Vietnamese wall-clock time. */
function toLocalInput(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false
  }).format(date);

  return parts.replace(" ", "T").slice(0, 16);
}

export default async function CrossRequestDetailPage({
  params
}: {
  params: { id: string };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!canTriageCrossRequest(adminUser?.role)) notFound();

  const request = await getCrossRequestDetail(params.id);
  if (!request) notFound();

  const canPublish = canPublishCrossSession(adminUser?.role);

  // How often each of these mentors has volunteered and not been chosen this
  // season, shown next to their name so the person deciding can see who is
  // about to be rested — before they rest them.
  const client = getSupabaseServiceRoleClient();
  const passedOver = client ? await countPassedOver(client, request.seasonId) : new Map();

  const invitations = request.invitations.map((invitation) => ({
    id: invitation.id,
    mentorName: invitation.mentorName,
    status: invitation.status,
    statusLabel: invitationStatusLabel(invitation.status),
    note: invitation.note,
    slots: invitation.slots
      .map((slot) => formatVietnameseDateTime(slot.startsAt))
      .filter((slot): slot is string => Boolean(slot)),
    timesPassedOver: passedOver.get(invitation.mentorPersonId) ?? 0
  }));

  const status = request.status;
  const showReview = status === "submitted";
  const showSweep = ["approved", "inviting", "selecting"].includes(status);
  const showDecide = ["inviting", "selecting"].includes(status);
  const showSchedule = canPublish && status === "selecting";
  const showPost = canPublish && ["scheduled", "published"].includes(status);
  const showPublish = canPublish && status === "scheduled";
  const showClose = canPublish && status === "published";
  const showCancel =
    canPublish && !["completed", "cancelled", "rejected"].includes(status);

  return (
    <div className="space-y-6">
      <Link href="/operations/cross" className="text-sm font-medium text-vam-green hover:underline">
        ← Về hàng đợi cross-mentoring
      </Link>

      <PageHeader
        title={request.fieldLabel}
        description={`Đề xuất của ${request.requesterName ?? "một bạn mentee"} — ${requestStatusLabel(status)}`}
      />

      <Card>
        <DetailGrid
          rows={[
            ["Lĩnh vực", request.fieldLabel],
            ["Người đề xuất", request.requesterName],
            ["Trạng thái", requestStatusLabel(status)],
            ["Gửi lúc", formatVietnameseDateTime(request.createdAt)],
            ["Thời gian buổi gặp", formatVietnameseDateTime(request.scheduledAt)],
            ["Địa điểm", request.location],
            ["Ghi chú của ban tổ chức", request.reviewNote]
          ]}
        />

        {request.topic ? (
          <div className="mt-4 rounded-md bg-[#f7faf8] px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-vam-muted">
              Mentee muốn nghe về
            </p>
            <p className="mt-1 text-sm leading-6 text-vam-ink">{request.topic}</p>
          </div>
        ) : null}

        {request.note ? (
          <p className="mt-3 text-sm text-vam-muted">Ghi chú thêm: {request.note}</p>
        ) : null}

        {request.eventId ? (
          <p className="mt-4 text-sm">
            <Link
              href={`/events/${request.eventId}`}
              className="font-medium text-vam-green hover:underline"
            >
              Xem sự kiện, link đăng ký và điểm danh →
            </Link>
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {showReview ? <ReviewPanel requestId={request.id} /> : null}
        {showSweep ? <SweepPanel requestId={request.id} fieldLabel={request.fieldLabel} /> : null}
        {showDecide ? <DecidePanel requestId={request.id} invitations={invitations} /> : null}
        {showSchedule ? (
          <SchedulePanel
            requestId={request.id}
            defaultEventName={`Cross-mentoring — ${request.fieldLabel}`}
            scheduledAt={toLocalInput(request.scheduledAt)}
            location={request.location}
          />
        ) : null}
        {showPost ? (
          <PostPanel requestId={request.id} draft={request.postDraft} aiModel={null} />
        ) : null}
        {showPublish ? <PublishPanel requestId={request.id} /> : null}
        {showClose ? <ClosePanel requestId={request.id} /> : null}
        {showCancel ? <CancelPanel requestId={request.id} /> : null}
      </div>

      {invitations.length > 0 ? (
        <Card>
          <h2 className="text-sm font-semibold text-vam-ink">Mentor đã mời</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-vam-line pb-2 last:border-0"
              >
                <span className="text-vam-ink">{invitation.mentorName ?? "(chưa rõ tên)"}</span>
                <span className="text-xs text-vam-muted">
                  {invitation.statusLabel}
                  {invitation.slots.length ? ` · ${invitation.slots.join(" · ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {request.history.length > 0 ? (
        <Card>
          <h2 className="text-sm font-semibold text-vam-ink">Lịch sử</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {request.history.map((entry, index) => (
              <li key={index} className="flex flex-wrap gap-x-3 text-vam-muted">
                <span className="text-vam-ink">{requestStatusLabel(entry.newStatus)}</span>
                <span>{formatVietnameseDateTime(entry.createdAt)}</span>
                {entry.reason ? <span>— {entry.reason}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
