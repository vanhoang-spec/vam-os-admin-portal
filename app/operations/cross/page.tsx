import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, EmptyState, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canTriageCrossRequest } from "@/lib/permissions";
import { formatVietnameseDateTime, listCrossRequests } from "@/lib/cross-requests";
import { REQUEST_STATUS_LABELS } from "@/lib/cross-mentoring-core";

/**
 * Page: /operations/cross
 *
 * The queue. One row per mentee's wish, newest first, with the three numbers an
 * organiser actually acts on: how long it has been waiting, how many mentors
 * were written to, and how many said yes.
 *
 * Open to support team as well as the admin tier — the owner asked for that in
 * as many words, and triage is coordination work. What support team cannot do
 * from here is publish: the buttons that create a public event and send two
 * irreversible letters live on the detail page behind `canPublishCrossSession`.
 */
export const dynamic = "force-dynamic";

const OPEN_STATUSES = new Set(["submitted", "approved", "inviting", "selecting"]);

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "rejected" || status === "cancelled"
      ? "bg-slate-100 text-slate-600"
      : status === "completed"
        ? "bg-emerald-50 text-emerald-700"
        : status === "submitted"
          ? "bg-amber-50 text-amber-800"
          : "bg-[#eef5f1] text-vam-green";

  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {REQUEST_STATUS_LABELS[status as keyof typeof REQUEST_STATUS_LABELS] ?? status}
    </span>
  );
}

function waitingDays(createdAt: string): number | null {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return Math.floor((Date.now() - created.getTime()) / 86_400_000);
}

export default async function OperationsCrossPage(
  props: {
    searchParams?: Promise<{ status?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();

  // Not-found rather than a refusal: a role that cannot triage has no reason to
  // learn that this queue exists.
  if (!canTriageCrossRequest(adminUser?.role)) notFound();

  const status = searchParams?.status?.trim() || null;
  const requests = await listCrossRequests({ status });

  const waiting = requests.filter((request) => request.status === "submitted").length;
  const inFlight = requests.filter((request) => OPEN_STATUSES.has(request.status)).length;
  const scheduled = requests.filter((request) =>
    ["scheduled", "published"].includes(request.status)
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cross-mentoring"
        description="Nguyện vọng của mentee được gặp một mentor ngoài cặp của mình, từ lúc gửi tới lúc buổi gặp diễn ra."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Chờ duyệt" value={waiting} />
        <KpiCard label="Đang xử lý" value={inFlight} />
        <KpiCard label="Đã chốt lịch" value={scheduled} />
      </div>

      <Card>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/operations/cross"
            className={`rounded-md border px-3 py-1.5 ${
              !status ? "border-vam-green bg-[#eef5f1] text-vam-green" : "border-vam-line text-vam-ink"
            }`}
          >
            Tất cả
          </Link>
          {["submitted", "inviting", "selecting", "scheduled", "completed"].map((value) => (
            <Link
              key={value}
              href={`/operations/cross?status=${value}`}
              className={`rounded-md border px-3 py-1.5 ${
                status === value
                  ? "border-vam-green bg-[#eef5f1] text-vam-green"
                  : "border-vam-line text-vam-ink"
              }`}
            >
              {REQUEST_STATUS_LABELS[value as keyof typeof REQUEST_STATUS_LABELS]}
            </Link>
          ))}
        </div>
      </Card>

      {requests.length === 0 ? (
        <EmptyState message="Chưa có đề xuất cross-mentoring nào." />
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            const days = waitingDays(request.createdAt);

            return (
              <Link
                key={request.id}
                href={`/operations/cross/${request.id}`}
                className="block rounded-lg border border-vam-line bg-white p-4 transition hover:border-vam-green"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-semibold text-vam-ink">{request.fieldLabel}</span>
                    {request.requesterName ? (
                      <span className="ml-2 text-sm text-vam-muted">
                        — {request.requesterName}
                      </span>
                    ) : null}
                  </div>
                  <StatusPill status={request.status} />
                </div>

                {request.topic ? (
                  <p className="mt-2 line-clamp-2 text-sm text-vam-muted">{request.topic}</p>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-vam-muted">
                  {request.status === "submitted" && days !== null ? (
                    <span className={days >= 7 ? "font-semibold text-amber-700" : ""}>
                      Chờ {days} ngày
                    </span>
                  ) : null}
                  {request.invited ? (
                    <span>
                      Đã mời {request.invited} mentor · {request.accepted ?? 0} nhận lời
                    </span>
                  ) : null}
                  {request.scheduledAt ? (
                    <span>
                      {formatVietnameseDateTime(request.scheduledAt)}
                      {request.location ? ` — ${request.location}` : ""}
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
