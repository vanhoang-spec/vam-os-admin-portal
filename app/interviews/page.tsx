import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getIntakeBatches, getInterviewCandidates } from "@/lib/data";
import { canSelfClaimInterview } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { InterviewsClient } from "./interviews-client";

// ---------------------------------------------------------------------------
// Page: /interviews
// Phase 044B — Interview self-claim workflow
//
// Purpose: On interview day, interviewers (reviewer/core_team/admin) open
// this page, search for the candidate they are about to interview, and click
// "Bắt đầu phỏng vấn" to create (or resume) an interview review row.
// ---------------------------------------------------------------------------

export default async function InterviewsPage({
  searchParams
}: {
  searchParams: { intake_batch_id?: string; role_applied?: string };
}) {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canSelfClaimInterview(adminUser.role)) redirect("/");

  const intakeBatchId = searchParams.intake_batch_id?.trim() || null;
  const roleApplied = searchParams.role_applied?.trim() || null;
  const scope = await getScopeFilter(await getAdminScopeContext());

  const [intakeBatches, candidates] = await Promise.all([
    getIntakeBatches(scope),
    // Only fetch candidates when a batch is selected (to avoid showing all seasons)
    intakeBatchId
      ? getInterviewCandidates({ intakeBatchId, roleApplied, scope })
      : Promise.resolve({ data: [] as Awaited<ReturnType<typeof getInterviewCandidates>>["data"], error: null })
  ]);

  return (
    <>
      <PageHeader
        title="Phỏng vấn ứng viên"
        description="Dành cho interviewer / reviewer. Tìm ứng viên đã được mời phỏng vấn và bắt đầu ghi nhận kết quả interview."
      />

      {/* Nav */}
      <div className="mb-4">
        <Link href="/reviews" className="text-sm text-vam-green hover:underline">
          ← Quay lại Reviews
        </Link>
      </div>

      <ErrorBox message={intakeBatches.error || candidates.error} />

      {/* Batch + role selector (required — prevents showing all seasons at once) */}
      <Card className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Chọn đợt tuyển để xem danh sách ứng viên phỏng vấn</p>
          <Link
            href="/reviews/guide"
            className="text-xs text-slate-400 hover:text-vam-green hover:underline"
          >
            Hướng dẫn vận hành
          </Link>
        </div>
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Đợt tuyển</label>
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId ?? ""}
              className="rounded-md border border-vam-line px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-vam-green"
            >
              <option value="">-- Chọn đợt --</option>
              {intakeBatches.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name ?? b.code ?? b.id}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">Vai trò ứng tuyển</label>
            <select
              name="role_applied"
              defaultValue={roleApplied ?? "mentee"}
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
            Xem ứng viên
          </button>
          {intakeBatchId && (
            <Link
              href="/interviews"
              className="rounded-md border border-vam-line px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Đặt lại
            </Link>
          )}
        </form>
      </Card>

      {/* No batch selected yet — show prompt */}
      {!intakeBatchId ? (
        <div className="rounded-md border border-dashed border-vam-line px-4 py-10 text-center text-sm text-slate-400">
          Chọn đợt tuyển để xem danh sách ứng viên đã được mời phỏng vấn.
        </div>
      ) : (
        <InterviewsClient
          rows={candidates.data}
          currentUserId={adminUser.id}
        />
      )}
    </>
  );
}
