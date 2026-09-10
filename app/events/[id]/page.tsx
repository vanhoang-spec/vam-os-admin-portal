import { headers } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getEventDetailData, isValidUuid, listSeriesSessions } from "@/lib/events";
import { canOperateSeason, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { displayText, formatDateTime } from "@/lib/utils";
import { CheckinLinkPanel, RegistrationLinkPanel } from "./registration-link-panel";
import { eventRegistrationStatusLabel, eventTypeLabel } from "@/lib/event-constants";
import { EventPlaceBlock } from "../event-place";
import { listEventSupporters, listSupporterCandidates } from "@/lib/event-supporters";
import { SupportersPanel } from "./supporters-panel";
import { countScansByStation } from "@/lib/event-checkin";
import { stationLabel } from "@/lib/event-checkin-code";
import { LiveRefresh } from "./live-refresh";
import { AddSessionPanel } from "./add-session-panel";

async function getRequestOrigin() {
  const h = await headers();
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

const REGISTRATION_BADGE_COLORS: Record<string, string> = {
  registered: "bg-slate-100 text-slate-700",
  pending_review: "bg-amber-100 text-amber-800",
  confirmed: "bg-green-100 text-green-800",
  waitlisted: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-red-100 text-red-700"
};

// Chữ lấy từ eventRegistrationStatusLabel, chỉ màu là việc riêng của màn hình
// này: bảng xuất ra Excel không có màu, nhưng phải nói cùng một bộ chữ.
function registrationStatusLabel(value: unknown) {
  const status = String(value ?? "").trim();
  return {
    label: eventRegistrationStatusLabel(status),
    color: REGISTRATION_BADGE_COLORS[status] ?? "bg-slate-100 text-slate-700"
  };
}

export default async function EventDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

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
  const supporters = await listEventSupporters(params.id);
  const supporterCandidates = await listSupporterCandidates(params.id);
  const scanCounts = await countScansByStation(params.id);
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
  const origin = await getRequestOrigin();
  const registrationUrl = detail.registrationLink?.token ? `${origin}/register/${detail.registrationLink.token}` : null;
  const checkinUrl = detail.checkinLink?.token ? `${origin}/checkin/${detail.checkinLink.token}` : null;
  const checkinQrDataUrl = checkinUrl ? await QRCode.toDataURL(checkinUrl, { margin: 1, width: 200 }) : null;
  const canCreateLink = await canOperateSeason(scopeContext, detail.event.season_id ?? null);

  // Sự kiện đơn lẻ trả về mảng rỗng — không có chuỗi thì không có gì để liệt kê.
  const seriesSessions = await listSeriesSessions(params.id);

  // Registration breakdown by status
  const allRegistrations = detail.registrations;
  const activeRegistrations = allRegistrations.filter((row) => row.registration_status !== "cancelled");
  const confirmedRegistrations = activeRegistrations.filter(
    (row) => row.registration_status === "registered" || row.registration_status === "confirmed"
  );
  const pendingReviewRegistrations = activeRegistrations.filter(
    (row) => row.registration_status === "pending_review"
  );
  const waitlistedRegistrations = activeRegistrations.filter(
    (row) => row.registration_status === "waitlisted"
  );
  const checkedInRegistrations = activeRegistrations.filter((row) => row.attendance_status === "checked_in");
  const walkInRegistrations = activeRegistrations.filter(
    (row) => row.is_walk_in === true || String(row.is_walk_in) === "true"
  );

  // Capacity info
  const capacityEnabled = detail.event.capacity_limit_enabled === true;
  const capacityLimit = detail.event.capacity_limit ?? null;
  const waitlistEnabled = detail.event.waitlist_enabled === true;
  // Confirmed seats = registered + pending_review + confirmed (not waitlisted, not rejected)
  const confirmedSeatsCount = confirmedRegistrations.length + pendingReviewRegistrations.length;
  const isOverCapacity = capacityEnabled && capacityLimit != null && confirmedSeatsCount > capacityLimit;

  // Registration link active status (null = no link exists yet)
  const regLinkIsActive: boolean | null =
    detail.registrationLink != null ? (detail.registrationLink.is_active !== false) : null;
  const reopenCapacityWarning =
    capacityEnabled && capacityLimit != null && confirmedSeatsCount >= capacityLimit
      ? `Sức chứa hiện tại: ${confirmedSeatsCount}/${capacityLimit}. Mở lại đăng ký có thể đưa đăng ký mới vào waitlist hoặc bị chặn theo cấu hình hiện tại.`
      : null;

  return (
    <>
      <PageHeader
        title={displayText(detail.event.event_name, "Sự kiện")}
        description={`${displayText(seasonCode)} · ${eventTypeLabel(detail.event.event_type)}`}
      />

      <div className="mb-6 rounded-md border border-vam-line bg-white p-4">
        <EventPlaceBlock event={detail.event} />
      </div>

      {canEditRecaps(adminUser) ? (
        <div className="mb-6">
          <AddSessionPanel
            eventId={params.id}
            startsAt={detail.event.starts_at ?? null}
            endsAt={detail.event.ends_at ?? null}
            seriesIndex={detail.event.series_index ?? null}
            seriesTotal={detail.event.series_total ?? null}
            sessions={seriesSessions}
          />
        </div>
      ) : null}

      <div className="mb-6">
        <SupportersPanel
          eventId={params.id}
          supporters={supporters.rows.map((row) => ({ id: row.id, fullName: row.fullName, email: row.email }))}
          candidates={supporterCandidates.rows}
          canManage={canEditRecaps(adminUser)}
        />
      </div>

      <p className="mb-6">
        <Link
          href={`/events/${params.id}/scan`}
          className="inline-block rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
        >
          Mở máy quét điểm danh
        </Link>
      </p>
      {detail.error ? <ErrorBox message={detail.error} /> : null}

      {/* Capacity / waitlist info banner */}
      {capacityEnabled && capacityLimit != null && (
        <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
          isOverCapacity
            ? "border-red-300 bg-red-50 text-red-800"
            : confirmedSeatsCount >= capacityLimit
            ? "border-amber-300 bg-amber-50 text-amber-800"
            : "border-slate-200 bg-slate-50 text-slate-700"
        }`}>
          <span className="font-semibold">Sức chứa:</span>
          <span>{confirmedSeatsCount} / {capacityLimit} ghế (đã đăng ký / xác nhận)</span>
          {waitlistedRegistrations.length > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
              {waitlistedRegistrations.length} danh sách chờ
            </span>
          )}
          {isOverCapacity && (
            <span className="font-semibold text-red-700">
              ⚠️ Vượt quá giới hạn! ({confirmedSeatsCount - capacityLimit} người thừa so với cap)
            </span>
          )}
          {!waitlistEnabled && confirmedSeatsCount >= capacityLimit && (
            <span className="text-amber-700">— Waitlist tắt: đăng ký mới sẽ bị chặn.</span>
          )}
          {waitlistEnabled && (
            <span className="text-blue-700">— Waitlist bật: đăng ký vượt cap sẽ xếp hàng chờ.</span>
          )}
        </div>
      )}

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
        {canEditRecaps(adminUser) ? (
          <>
            {/* Thẻ <a> thường, không phải <Link>: đây là một file tải về, không
                phải một trang trong ứng dụng. Cho Next điều hướng tới nó sẽ ra
                một màn hình trắng thay vì hộp thoại lưu file. */}
            <a
              href={`/api/exports/event-registrations?event_id=${detail.event.id}`}
              className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
            >
              Tải danh sách (CSV)
            </a>
            {seriesSessions.length > 1 ? (
              <a
                href={`/api/exports/event-registrations?event_id=${detail.event.id}&series=1`}
                className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
              >
                Tải cả {seriesSessions.length} buổi (CSV)
              </a>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mb-3">
        <LiveRefresh />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Tổng đăng ký (không hủy)" value={activeRegistrations.length} />
        <KpiCard label="Giữ ghế (đăng ký / xác nhận)" value={confirmedSeatsCount} />
        <KpiCard label="Danh sách chờ" value={waitlistedRegistrations.length} />
        <KpiCard label="Đã check-in" value={checkedInRegistrations.length} />
        <KpiCard label="Vãng lai" value={walkInRegistrations.length} />
      </div>

      {scanCounts.counts.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {scanCounts.counts.map((row) => (
            <span
              key={row.station}
              className="rounded-full border border-vam-line bg-white px-3 py-1 text-sm text-vam-ink"
            >
              {stationLabel(row.station)}:{" "}
              <strong className="tabular-nums text-vam-green">{row.total}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="grid gap-4">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Liên kết đăng ký công khai</h2>
            <RegistrationLinkPanel
              eventId={detail.event.id}
              registrationUrl={registrationUrl}
              registrationLinkIsActive={regLinkIsActive}
              canCreate={canCreateLink}
              capacityWarning={reopenCapacityWarning}
              seriesTotal={
                typeof detail.event.series_total === "number" ? detail.event.series_total : null
              }
            />
          </Card>

          <Card>
            <h2 className="mb-3 text-base font-semibold text-vam-ink">Liên kết điểm danh / QR</h2>
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
            Danh sách đăng ký &amp; check-in <span className="text-sm font-normal text-slate-500">({activeRegistrations.length})</span>
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
                  render: (row) => {
                    const regBadge = registrationStatusLabel(row.registration_status);
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`rounded px-2 py-1 text-xs font-medium ${regBadge.color}`}>
                          {regBadge.label}
                        </span>
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {attendanceLabel(row.attendance_status)}
                        </span>
                        {row.is_walk_in ? (
                          <span className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">Vãng lai</span>
                        ) : null}
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                          {matchReviewLabel(row.match_review_status)}
                        </span>
                      </div>
                    );
                  }
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
                  render: (row) => formatDateTime(row.registered_at)
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
