import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getEventDetailData, isValidUuid } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayText, formatDate } from "@/lib/utils";
import { CheckinLinkPanel, RegistrationLinkPanel } from "./registration-link-panel";

function getRequestOrigin() {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

function attendanceLabel(value: unknown) {
  const status = String(value ?? "").trim();
  if (status === "pending") return "Chưa check-in";
  if (status === "checked_in") return "Đã check-in";
  if (status === "cancelled") return "Đã hủy";
  if (status === "no_show") return "Không tham dự";
  return displayText(status);
}

function matchReviewLabel(value: unknown) {
  const status = String(value ?? "").trim();
  if (status === "pending_review") return "Chờ rà soát";
  if (status === "auto_linked") return "Đã khớp hồ sơ";
  if (status === "confirmed") return "Đã xác nhận";
  if (status === "rejected") return "Đã từ chối";
  if (status === "unlinked") return "Chưa khớp hồ sơ";
  return displayText(status);
}

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const adminUser = await getCurrentAdminUser();

  if (!canEditRecaps(adminUser)) {
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
  const registrationUrl = detail.registrationLink?.token ? `${origin}/register/${detail.registrationLink.token}` : null;
  const checkinUrl = detail.checkinLink?.token ? `${origin}/checkin/${detail.checkinLink.token}` : null;
  const checkinQrDataUrl = checkinUrl ? await QRCode.toDataURL(checkinUrl, { margin: 1, width: 200 }) : null;
  const canCreateLink = await canOperateSeason(scopeContext, detail.event.season_id ?? null);
  const activeRegistrations = detail.registrations.filter((row) => row.registration_status !== "cancelled");
  const checkedInRegistrations = activeRegistrations.filter((row) => row.attendance_status === "checked_in");
  const walkInRegistrations = activeRegistrations.filter((row) => row.is_walk_in === true || String(row.is_walk_in) === "true");

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Đăng ký" value={activeRegistrations.length} />
        <KpiCard label="Đã check-in" value={checkedInRegistrations.length} />
        <KpiCard label="Walk-in" value={walkInRegistrations.length} />
        <KpiCard label="Chờ rà soát" value={activeRegistrations.filter((row) => row.match_review_status === "pending_review").length} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="grid gap-4">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Link đăng ký công khai</h2>
            <RegistrationLinkPanel
              eventId={detail.event.id}
              registrationUrl={registrationUrl}
              canCreate={canCreateLink}
            />
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Link check-in / QR check-in</h2>
            <CheckinLinkPanel
              eventId={detail.event.id}
              checkinUrl={checkinUrl}
              canCreate={canCreateLink}
              qrDataUrl={checkinQrDataUrl}
            />
          </Card>
        </div>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">
            Danh sách đăng ký & check-in <span className="text-sm font-normal text-slate-500">({activeRegistrations.length})</span>
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
                  key: "status",
                  label: "Trạng thái",
                  render: (row) => (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {attendanceLabel(row.attendance_status)}
                      </span>
                      {row.is_walk_in ? (
                        <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">Walk-in</span>
                      ) : null}
                      <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                        {matchReviewLabel(row.match_review_status)}
                      </span>
                    </div>
                  )
                },
                {
                  key: "meal_payment",
                  label: "Ăn trưa / Thanh toán",
                  render: (row) => (
                    <div className="flex flex-wrap gap-1">
                      {row.meal_selected === true ? (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-800">
                          🍱{row.meal_fee_amount ? ` ${new Intl.NumberFormat("vi-VN").format(row.meal_fee_amount)}` : ""}
                        </span>
                      ) : null}
                      {row.payment_status && row.payment_status !== "not_required" ? (
                        <span className={
                          row.payment_status === "confirmed"
                            ? "rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800"
                            : row.payment_status === "submitted"
                              ? "rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                              : "rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                        }>
                          {row.payment_status === "confirmed" ? "✓ TT" : row.payment_status === "submitted" ? "⏳ TT" : row.payment_status}
                        </span>
                      ) : null}
                    </div>
                  )
                },
                {
                  key: "registered_at",
                  label: "Thời gian",
                  render: (row) => formatDate(row.registered_at)
                },
                {
                  key: "actions",
                  label: "",
                  render: (row) => (
                    <Link
                      href={`/events/${detail.event!.id}/registrations/${row.id}`}
                      className="inline-flex items-center rounded border border-vam-line bg-white px-2 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                    >
                      Xem →
                    </Link>
                  )
                }
              ]}
            />
          )}
        </Card>
      </div>
    </>
  );
}
