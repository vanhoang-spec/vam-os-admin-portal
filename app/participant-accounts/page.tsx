import { redirect } from "next/navigation";
import { ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { loadLoginInviteRoster } from "@/lib/login-invite-roster";
import {
  ACCOUNT_STATUS_LABELS,
  BREVO_DAILY_LIMIT,
  INVITE_BATCH_MAX,
  INVITE_DAILY_RESERVE,
  ROSTER_BLOCK_LABELS,
  rosterRoleLabel,
  rosterRowAction,
  selectBulkCandidates,
  type RosterRow
} from "@/lib/participant-invite-core";
import { authorizeParticipantInvites } from "@/lib/participant-invites";
import { canInviteParticipants } from "@/lib/permissions";
import {
  SEASON_CONTEXT_ERROR_MESSAGE,
  SeasonAccessDeniedError,
  SeasonContextError,
  resolveSeasonContext,
  type ResolvedSeasonContext
} from "@/lib/season-context";
import { seasonLabel } from "@/lib/season-labels";
import { formatDateTime, formatTime } from "@/lib/utils";
import { BulkInvitePanel } from "./bulk-invite-panel";
import { RosterClient, type RosterViewRow } from "./roster-client";

export const dynamic = "force-dynamic";
// Lượt mời hàng loạt chạy trong function của trang này. Ngân sách một lượt là
// 35 giây, và một lời gọi Brevo có thể treo tới 20 giây — trần mặc định không
// đủ rộng.
export const maxDuration = 60;

const TITLE = "Tài khoản đăng nhập";
const DESCRIPTION =
  "Mời mentor và mentee của mùa lập tài khoản VAM OS. Trạng thái tài khoản thuộc về người chứ không thuộc về mùa: ai đã vào ở mùa trước cũng hiện là đã vào ở mùa này.";

function toViewRow(row: RosterRow, nowMs: number): RosterViewRow {
  const { action, lockedUntil } = rosterRowAction(row, nowMs);
  const detail = row.blockReason
    ? ROSTER_BLOCK_LABELS[row.blockReason]
    : row.inFlight
      ? "Đang gửi ở một lượt khác"
      : row.status === "send_failed"
        ? "Lần gửi gần nhất bị lỗi"
        : null;

  return {
    personId: row.personId,
    fullName: row.fullName,
    email: row.email,
    roles: row.roles,
    roleLabel: rosterRoleLabel(row.roles),
    status: row.status,
    statusLabel: ACCOUNT_STATUS_LABELS[row.status],
    detail,
    lastInviteLabel: row.latest
      ? `${formatDateTime(row.latest.at)} · ${row.latest.outcome === "sent" ? "đã gửi" : "lỗi"}`
      : "Chưa gửi",
    activatedLabel: row.activatedAt ? formatDateTime(row.activatedAt) : "Chưa",
    action,
    lockedUntilLabel: lockedUntil ? formatTime(lockedUntil) : null,
    inFlight: row.inFlight
  };
}

export default async function ParticipantAccountsPage(props: {
  searchParams?: Promise<{ season?: string | string[] }>;
}) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canInviteParticipants(adminUser.role)) redirect("/");

  let seasonContext: ResolvedSeasonContext;
  try {
    seasonContext = await resolveSeasonContext(searchParams?.season);
  } catch (error) {
    if (error instanceof SeasonAccessDeniedError) {
      return (
        <PageHeader
          title="Không có quyền truy cập"
          description="Bạn chưa được cấp phạm vi truy cập cho mùa vận hành hiện tại. Liên hệ quản trị viên để được cấp quyền."
        />
      );
    }
    if (error instanceof SeasonContextError) {
      return (
        <>
          <PageHeader title={TITLE} description={DESCRIPTION} />
          <ErrorBox message={SEASON_CONTEXT_ERROR_MESSAGE} />
        </>
      );
    }
    throw error;
  }

  const selected = seasonContext.availableSeasons.find((season) => season.id === seasonContext.selectedSeasonId);
  const label = seasonLabel(seasonContext.selectedSeasonCode, selected?.name ?? null);

  // Quyền vận hành ĐÚNG mùa này, kiểm trước mọi lần đọc dữ liệu: danh sách
  // mang email của hàng trăm người.
  const access = await authorizeParticipantInvites(seasonContext.selectedSeasonId);
  if (!access.ok) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorBox
          message={
            access.code === "season_forbidden"
              ? `Bạn cần quyền vận hành ${label} để xem và mời tài khoản.`
              : access.message
          }
        />
      </>
    );
  }

  const nowMs = Date.now();
  const roster = await loadLoginInviteRoster(seasonContext.selectedSeasonId, nowMs);
  if (!roster.ok) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorBox message={roster.error} />
      </>
    );
  }

  const { summary } = roster;
  const eligible = selectBulkCandidates(roster.rows, nowMs).length;
  const sent = roster.sentLast24h;
  const sentTone =
    sent === null
      ? "warning"
      : sent >= BREVO_DAILY_LIMIT - 10
        ? "danger"
        : sent >= BREVO_DAILY_LIMIT - INVITE_DAILY_RESERVE
          ? "warning"
          : "default";

  return (
    <>
      <PageHeader title={`${TITLE} · ${label}`} description={DESCRIPTION} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Chưa mời"
          value={summary.notInvited + summary.sendFailed}
          helper={summary.sendFailed ? `trong đó ${summary.sendFailed} thư lỗi` : undefined}
        />
        <KpiCard label="Đã gửi thư, chưa vào" value={summary.pending} />
        <KpiCard label="Đã vào" value={summary.active} tone="success" />
        <KpiCard label="Không mời được" value={summary.blocked} tone={summary.blocked > 0 ? "danger" : "default"} />
        <KpiCard
          label="Thư đã gửi trong 24 giờ"
          value={sent === null ? "Không đếm được" : `${sent}/${BREVO_DAILY_LIMIT}`}
          tone={sentTone}
          helper="Hạn mức Brevo, dùng chung mọi loại thư"
        />
      </div>

      <BulkInvitePanel
        seasonId={seasonContext.selectedSeasonId}
        seasonLabel={label}
        eligible={eligible}
        budgetLeft={roster.budgetLeft}
        gateOpen={roster.gateOpen}
        batchMax={INVITE_BATCH_MAX}
      />

      <RosterClient rows={roster.rows.map((row) => toViewRow(row, nowMs))} seasonId={seasonContext.selectedSeasonId} />
    </>
  );
}
