import { headers } from "next/headers";
import Link from "next/link";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getEventDetailData, isValidUuid } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayText, formatDate } from "@/lib/utils";
import { RegistrationLinkPanel } from "./registration-link-panel";

function getRequestOrigin() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const adminUser = await getCurrentAdminUser();
  const allowAdminEventAccess = canEditRecaps(adminUser);

  if (!allowAdminEventAccess) {
    return (
      <>
        <PageHeader title="Không có quyền truy cập" />
        <ErrorBox message="Bạn không có quyền xem chi tiết sự kiện." />
      </>
    );
  }

  if (!isValidUuid(params.id)) {
    return (
      <>
        <PageHeader title="ID sự kiện không hợp lệ" />
        <ErrorBox message="Đường dẫn không chứa UUID sự kiện hợp lệ." />
      </>
    );
  }

  const detail = await getEventDetailData(params.id, scope);
  if (!detail.event) {
    return (
      <>
        <PageHeader title="Không tìm thấy sự kiện" />
        {detail.error ? <ErrorBox message={detail.error} /> : null}
        <EmptyState message="Không tìm thấy sự kiện trong phạm vi truy cập của bạn." />
      </>
    );
  }

  const seasonsById = new Map(detail.seasons.map((season) => [season.id, season]));
  const seasonCode = detail.event.season_id ? (seasonsById.get(detail.event.season_id)?.code ?? null) : null;
  const origin = getRequestOrigin();
  const registrationUrl = detail.registrationLink?.token
    ? `${origin}/register/${detail.registrationLink.token}`
    : null;
  const canCreateLink = await canOperateSeason(scopeContext, detail.event.season_id ?? null);
  const activeRegistrations = detail.registrations.filter((row) => row.registration_status !== "cancelled");

  return (
    <>
      <PageHeader
        title={displayText(detail.event.event_name, "Sự kiện")}
        description={`${displayText(seasonCode)} · ${formatDate(detail.event.starts_at)} · ${displayText(detail.event.event_type)}`}
      />
      {detail.error ? <ErrorBox message={detail.error} /> : null}

      <div className="mb-4 flex flex-wrap gap-3">
        <Link
          href="/events"
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Danh sách sự kiện
        </Link>
        <Link
          href={`/events/${detail.event.id}/attendance`}
          className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
        >
          Quản lý tham gia
        </Link>
        {canCreateLink ? (
          <Link
            href={`/events/${detail.event.id}/edit`}
            className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
          >
            Sửa sự kiện
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Đăng ký" value={activeRegistrations.length} />
        <KpiCard label="Đã liên kết người" value={activeRegistrations.filter((row) => row.linked_person_id).length} />
        <KpiCard label="Chờ rà soát" value={activeRegistrations.filter((row) => row.match_review_status === "pending_review").length} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Link đăng ký công khai</h2>
          <RegistrationLinkPanel
            eventId={detail.event.id}
            registrationUrl={registrationUrl}
            canCreate={canCreateLink}
          />
          <p className="mt-3 text-xs text-slate-500">
            Link này chỉ cho phép gửi đăng ký, không hiển thị danh sách người tham dự công khai.
          </p>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">
            Danh sách đăng ký <span className="text-sm font-normal text-slate-500">({activeRegistrations.length})</span>
          </h2>
          {activeRegistrations.length === 0 ? (
            <EmptyState message="Chưa có đăng ký nào cho sự kiện này." />
          ) : (
            <SimpleTable
              rows={activeRegistrations}
              columns={[
                {
                  key: "full_name",
                  label: "Người đăng ký",
                  render: (row) => (
                    <div>
                      <div className="font-medium text-vam-ink">{displayText(row.full_name)}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{displayText(row.email)}</div>
                    </div>
                  )
                },
                {
                  key: "school",
                  label: "Thông tin",
                  render: (row) => (
                    <div className="text-xs text-slate-600">
                      <div>{displayText(row.school)}</div>
                      <div className="mt-0.5">{displayText(row.program_of_study)}</div>
                    </div>
                  )
                },
                {
                  key: "match_review_status",
                  label: "Khớp hồ sơ",
                  render: (row) => (
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                      {displayText(row.match_review_status)}
                    </span>
                  )
                },
                {
                  key: "registered_at",
                  label: "Thời gian",
                  render: (row) => formatDate(row.registered_at)
                }
              ]}
            />
          )}
        </Card>
      </div>
    </>
  );
}
