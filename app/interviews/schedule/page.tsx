import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getInterviewCandidates, getReviewEligibleReviewers, getSeasons } from "@/lib/data";
import { canBulkAssignReviews } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { listSeasonReviewerCandidates } from "@/lib/mentor-confirmations";
import { ScheduleClient } from "./schedule-client";

/**
 * Page: /interviews/schedule
 *
 * Books the candidates a selection run invited. One interviewer at a time: pick
 * the mentor, pick the candidates, give a start time and a gap, and everybody
 * involved is told. The screen shows who is already booked and with whom, so
 * two mentors are never sent to the same call.
 */
export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function InterviewSchedulePage(
  props: {
    searchParams?: Promise<{ intake_batch_id?: string | string[]; role?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canBulkAssignReviews(adminUser.role)) redirect("/interviews");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);

  const intakeBatchId = param(searchParams?.intake_batch_id).trim();
  const roleApplied = param(searchParams?.role).trim() || "mentee";

  const [batches, seasons, reviewers] = await Promise.all([
    getIntakeBatches(scope),
    getSeasons(scope),
    getReviewEligibleReviewers()
  ]);

  const selectedBatch = intakeBatchId ? batches.data.find((batch) => batch.id === intakeBatchId) : undefined;
  const seasonId = selectedBatch?.season_id ?? null;
  const season = seasonId ? seasons.data.find((row) => row.id === seasonId) : undefined;
  const seasonLabel = season?.code ?? season?.name ?? "";

  const [candidates, seasonPool] = await Promise.all([
    intakeBatchId
      ? getInterviewCandidates({ intakeBatchId, roleApplied, scope })
      : Promise.resolve({ data: [], error: null } as Awaited<ReturnType<typeof getInterviewCandidates>>),
    seasonId
      ? listSeasonReviewerCandidates({ seasonIdOrCode: seasonId })
      : Promise.resolve(null)
  ]);

  // Mentors who said yes to interviewing and already have a login. They are the
  // people this page exists for, so they are offered first.
  const agreedInterviewerIds = new Set(
    (seasonPool?.rows ?? [])
      .filter((row) => row.agree_to_interview === true && row.admin_user_status === "active")
      .map((row) => row.admin_user_id)
      .filter((id): id is string => Boolean(id))
  );

  const interviewerOptions = reviewers.data
    .map((reviewer) => ({
      id: reviewer.id,
      label: reviewer.full_name?.trim() || reviewer.email,
      email: reviewer.email,
      agreedToInterview: agreedInterviewerIds.has(reviewer.id)
    }))
    .sort((a, b) => {
      if (a.agreedToInterview !== b.agreedToInterview) return a.agreedToInterview ? -1 : 1;
      return a.label.localeCompare(b.label, "vi");
    });

  const rows = candidates.data;
  const unscheduled = rows.filter((row) => !row.interview_scheduled_at).length;
  const scheduled = rows.filter((row) => row.interview_scheduled_at).length;
  const completed = rows.filter((row) => row.status === "interview_completed").length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Xếp lịch phỏng vấn"
        description="Chọn người phỏng vấn và các ứng viên, đặt giờ bắt đầu và khoảng cách giữa hai ca. Hệ thống chia ca liên tiếp, gửi lịch cho người phỏng vấn và giờ hẹn cho từng ứng viên."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/interviews" className="text-sm text-vam-green hover:underline">
          ← Danh sách phỏng vấn
        </Link>
        <Link href="/reviews/selection" className="text-sm text-vam-green hover:underline">
          Chốt danh sách phỏng vấn
        </Link>
        <Link href="/reviews/progress" className="text-sm text-vam-green hover:underline">
          Tiến độ chấm
        </Link>
      </div>

      <ErrorBox message={batches.error || seasons.error || reviewers.error || candidates.error || seasonPool?.error} />

      <Card>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Đợt tuyển</label>
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="">-- Chọn đợt tuyển --</option>
              {batches.data.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code ?? batch.name ?? batch.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Vai trò</label>
            <select
              name="role"
              defaultValue={roleApplied}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="mentee">Mentee</option>
              <option value="mentor">Mentor</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-md bg-vam-green px-4 py-1.5 text-sm font-medium text-white hover:bg-vam-green/90"
          >
            Xem
          </button>
        </form>
      </Card>

      {!intakeBatchId ? (
        <Card>
          <p className="text-sm text-slate-600">Chọn một đợt tuyển để xem ứng viên cần xếp lịch phỏng vấn.</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Chưa có lịch" value={unscheduled} tone={unscheduled > 0 ? "warning" : "default"} helper="Đã mời phỏng vấn, chờ xếp giờ" />
            <KpiCard label="Đã có lịch" value={scheduled} tone="success" helper="Đã hẹn giờ với người phỏng vấn" />
            <KpiCard label="Đã phỏng vấn xong" value={completed} helper="Đã nộp điểm phỏng vấn" />
            <KpiCard
              label="Mentor nhận phỏng vấn"
              value={agreedInterviewerIds.size}
              helper="Đã xác nhận đồng ý phỏng vấn và có tài khoản"
            />
          </div>

          <ScheduleClient
            rows={rows}
            interviewers={interviewerOptions}
            seasonLabel={seasonLabel}
            currentAdminUserId={adminUser.id}
          />
        </>
      )}
    </div>
  );
}
