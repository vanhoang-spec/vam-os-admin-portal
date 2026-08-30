import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { getOperationsData } from "@/lib/data";
import { currentMonthVN, operationalMonthRange, VALID_RECAP_STATUSES } from "@/lib/dashboard-month";
import { isEventAbsenceStatus, isEventAttendedStatus } from "@/lib/events";
import { canBrowseOperations } from "@/lib/permissions";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { Event, EventParticipation, MentoringRecap, Season } from "@/lib/types";
import { displayText, formatDate } from "@/lib/utils";
import { SEASON_CONFIG } from "@/lib/season-config";

const SEASON_CODE = SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE;

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function monthFromDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 7);
}

function sanitizeMonthParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = String(raw ?? "").trim().match(/^(\d{4}-(0[1-9]|1[0-2]))/);
  return match?.[1] ?? null;
}

function isValidRecapActivity(recap: MentoringRecap) {
  return VALID_RECAP_STATUSES.has(normalize(recap.status));
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "0%";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

type EventRow = Event & {
  attended: number;
  absent: number;
  total: number;
};

export default async function MonthlyOperationsPage(props: { searchParams?: Promise<{ month?: string | string[] }> }) {
  const searchParams = await props.searchParams;

  // H2 fix: role gate before any scope check or protected data load, mirroring
  // the /operations pattern — getAdminScopeContext/getScopeFilter are *scope*
  // checks (true for any granted scope level, including "review") and must
  // never be the only gate on this route, or a reviewer with a season review
  // grant can reach it.
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!canBrowseOperations(adminUser.role)) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn không có quyền truy cập trang vận hành này."
      />
    );
  }

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const data = await getOperationsData(scope);
  const allowEdit = canEditRecaps(adminUser) && canOperateAnyScope(scopeContext);
  const errors = [
    data.seasons.error,
    data.recaps.error,
    data.events.error,
    data.eventParticipations.error
  ].filter(Boolean);

  const seasons: Season[] = data.seasons.data;
  const season = seasons.find((row) => row.code === SEASON_CODE);
  const seasonRecaps: MentoringRecap[] = data.recaps.data.filter((row) => (season?.id ? row.season_id === season.id : true));
  const seasonEvents: Event[] = data.events.data.filter((row) => (season?.id ? row.season_id === season.id : true));
  const seasonEventIds = new Set(seasonEvents.map((event) => event.id));
  const seasonParticipations: EventParticipation[] = data.eventParticipations.data.filter((row) => {
    if (season?.id) return row.season_id === season.id || (row.event_id ? seasonEventIds.has(row.event_id) : false);
    return true;
  });

  const seasonLatestClosedMonth = data.latestClosedMonth?.data?.find((row: any) => row.season_id === season?.id);
  const officialClosedMonth = typeof seasonLatestClosedMonth?.latest_closed_month === "string" ? seasonLatestClosedMonth.latest_closed_month : null;
  const rpcSelectedMonth = data.kpis.data?.selectedMonth ?? null;

  const nowVN = currentMonthVN();
  const monthOptions = operationalMonthRange(nowVN).sort((a, b) => b.localeCompare(a));
  const requestedMonth = sanitizeMonthParam(searchParams?.month);
  const selectedMonth = requestedMonth ?? officialClosedMonth ?? rpcSelectedMonth ?? monthOptions[monthOptions.length - 1];
  const isClosed = Boolean(officialClosedMonth) && selectedMonth <= officialClosedMonth!;

  const validRecapsInMonth = seasonRecaps.filter((row) => isValidRecapActivity(row) && row.meeting_month === selectedMonth);
  const unmatchedRecapsInMonth = validRecapsInMonth.filter((row) => !row.match_id);

  const eventsInMonth = seasonEvents.filter((event) => monthFromDate(event.starts_at) === selectedMonth);
  const eventIdsInMonth = new Set(eventsInMonth.map((event) => event.id));
  const participationsInMonth = seasonParticipations.filter((row) => row.event_id && eventIdsInMonth.has(row.event_id));

  const attendedCount = participationsInMonth.filter((row) => isEventAttendedStatus(row.attendance_status)).length;
  const absentCount = participationsInMonth.filter((row) => isEventAbsenceStatus(row.attendance_status)).length;
  const totalAttendance = participationsInMonth.length;
  const attendanceRate = percent(attendedCount, attendedCount + absentCount);

  const eventRows: EventRow[] = eventsInMonth
    .map((event) => {
      const rows = participationsInMonth.filter((row) => row.event_id === event.id);
      return {
        ...event,
        attended: rows.filter((row) => isEventAttendedStatus(row.attendance_status)).length,
        absent: rows.filter((row) => isEventAbsenceStatus(row.attendance_status)).length,
        total: rows.length
      };
    })
    .sort((a, b) => String(a.starts_at ?? "").localeCompare(String(b.starts_at ?? "")));

  return (
    <>
      <PageHeader title="Báo cáo hoạt động tháng" description="Tổng quan hoạt động tháng (chỉ xem). KPI chính thức theo tháng đã chốt." />
      {errors.length ? <ErrorBox message="Một phần dữ liệu chưa tải được. Một số chỉ số có thể đang hiển thị 0." /> : null}
      {errors.map((error) => (
        <ErrorBox key={error as string} message={error as string} />
      ))}

      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-[260px_1fr_auto] sm:items-end">
          <label className="block">
            <span className="text-xs font-medium uppercase text-slate-500">Tháng</span>
            <select
              name="month"
              defaultValue={selectedMonth}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {month}
                  {officialClosedMonth && month === officialClosedMonth ? " · đã chốt" : ""}
                </option>
              ))}
              {!monthOptions.includes(selectedMonth) ? (
                <option value={selectedMonth}>{selectedMonth} · ngoài khung</option>
              ) : null}
            </select>
          </label>
          <div className="text-sm text-slate-600">
            <p><span className="font-medium text-vam-ink">Tháng đã chốt gần nhất:</span> {officialClosedMonth ?? "Chưa có"}</p>
            <p className="mt-1 text-xs text-slate-500">
              {isClosed
                ? "Tháng đang xem nằm trong khoảng đã chốt — KPI dùng được cho báo cáo."
                : "Tháng đang xem chưa được chốt — chỉ dùng để theo dõi nội bộ."}
            </p>
          </div>
          <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
            Xem
          </button>
        </form>
      </Card>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Tổng quan tháng — {selectedMonth}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Số recap" value={validRecapsInMonth.length} />
          <KpiCard label="Số sự kiện" value={eventsInMonth.length} />
          <KpiCard label="Tổng lượt tham gia" value={totalAttendance} />
          <KpiCard label="Tỷ lệ tham gia" value={attendanceRate} />
          <KpiCard label="Đã tham gia" value={attendedCount} />
          <KpiCard label="Vắng" value={absentCount} />
          <KpiCard label="Recap chưa khớp match" value={unmatchedRecapsInMonth.length} />
          <KpiCard label="Trạng thái" value={isClosed ? "Đã chốt" : "Đang mở"} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Sự kiện trong tháng</h2>
        {eventRows.length === 0 ? (
          <EmptyState message="Không có sự kiện nào trong tháng này." />
        ) : (
          <SimpleTable
            rows={eventRows}
            columns={[
              {
                key: "event_name",
                label: "Tên sự kiện",
                render: (row) => (
                  <div>
                    <div className="font-medium text-vam-ink">{displayText(row.event_name)}</div>
                    <div className="mt-1 text-xs text-slate-500">{displayText(row.event_type)}</div>
                  </div>
                )
              },
              { key: "starts_at", label: "Ngày", render: (row) => formatDate(row.starts_at) },
              { key: "attended", label: "Đã tham gia", render: (row) => row.attended },
              { key: "absent", label: "Vắng", render: (row) => row.absent },
              { key: "total", label: "Tổng", render: (row) => row.total },
              {
                key: "actions",
                label: "Hành động",
                render: (row) => (
                  <Link href={`/events/${row.id}/attendance`} className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
                    Xem chi tiết tham gia
                  </Link>
                )
              }
            ]}
          />
        )}
      </section>

      <section className="mb-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Recap — {selectedMonth}</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-slate-500">Tổng recap (valid)</dt>
              <dd className="mt-1 text-2xl font-semibold text-vam-ink">{validRecapsInMonth.length}</dd>
            </div>
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-slate-500">Recap chưa khớp match</dt>
              <dd className="mt-1 text-2xl font-semibold text-amber-700">{unmatchedRecapsInMonth.length}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Recap &quot;valid&quot; gồm status: submitted hoặc needs_review (theo định nghĩa hiện hành của Operations).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {allowEdit ? (
              <Link href="/recaps/create" className="inline-flex rounded-md border border-vam-line bg-white px-3 py-2 text-xs font-medium text-vam-green hover:bg-vam-mint">
                Tạo recap thủ công
              </Link>
            ) : null}
            <Link href={`/operations?month=${encodeURIComponent(selectedMonth)}`} className="inline-flex rounded-md border border-vam-line bg-white px-3 py-2 text-xs font-medium text-vam-green hover:bg-vam-mint">
              Mở Operations chi tiết
            </Link>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Sự kiện — {selectedMonth}</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-slate-500">Số sự kiện</dt>
              <dd className="mt-1 text-2xl font-semibold text-vam-ink">{eventsInMonth.length}</dd>
            </div>
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-slate-500">Tỷ lệ tham gia</dt>
              <dd className="mt-1 text-2xl font-semibold text-vam-ink">{attendanceRate}</dd>
            </div>
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-slate-500">Đã tham gia</dt>
              <dd className="mt-1 text-2xl font-semibold text-emerald-700">{attendedCount}</dd>
            </div>
            <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2">
              <dt className="text-xs font-medium uppercase text-slate-500">Vắng</dt>
              <dd className="mt-1 text-2xl font-semibold text-amber-700">{absentCount}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/events" className="inline-flex rounded-md border border-vam-line bg-white px-3 py-2 text-xs font-medium text-vam-green hover:bg-vam-mint">
              Quản lý sự kiện
            </Link>
            {allowEdit ? (
              <Link href="/events/create" className="inline-flex rounded-md border border-vam-line bg-white px-3 py-2 text-xs font-medium text-vam-green hover:bg-vam-mint">
                Tạo sự kiện
              </Link>
            ) : null}
          </div>
        </Card>
      </section>
    </>
  );
}
