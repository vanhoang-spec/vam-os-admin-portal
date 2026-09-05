import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ErrorBox, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { canBrowseOperations } from "@/lib/permissions";
import { getIntakeBatches } from "@/lib/data";
import { EVENT_TYPE_OPTIONS, getEventListData, isEventAbsenceStatus, isEventAttendedStatus } from "@/lib/events";
import type { EventListData } from "@/lib/events";
import { canOperateAnyScope, getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import type { Event, EventParticipation, IntakeBatch, Season } from "@/lib/types";
import { displayText, formatDate } from "@/lib/utils";

type EventRow = Event & {
  season_code: string | null;
  batch_code: string | null;
  participant_total: number;
  attended_count: number;
  registered_absent_count: number;
  pending_count: number;
  reg_count: number;
  reg_pending_review_count: number;
};

const TYPE_LABELS = new Map<string, string>(EVENT_TYPE_OPTIONS.map((option) => [option.value, option.label]));

function selectedParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isEventPendingStatus(value: unknown) {
  const status = String(value ?? "").trim();
  return status === "registered_no_response" || status === "unknown";
}

function buildEventRows(
  events: Event[],
  participations: EventParticipation[],
  seasons: Season[],
  batches: IntakeBatch[],
  registrationRows: EventListData["registrationRows"]
): EventRow[] {
  const seasonsById = new Map(seasons.map((season) => [season.id, season]));
  const batchesById = new Map(batches.map((b) => [b.id, b]));
  const partsByEvent = new Map<string, EventParticipation[]>();
  for (const part of participations) {
    if (!part.event_id) continue;
    const arr = partsByEvent.get(part.event_id) ?? [];
    arr.push(part);
    partsByEvent.set(part.event_id, arr);
  }

  // Count public registrations per event (exclude cancelled)
  const regCountByEvent = new Map<string, number>();
  const regPendingByEvent = new Map<string, number>();
  for (const row of registrationRows) {
    if (!row.event_id || row.registration_status === "cancelled") continue;
    regCountByEvent.set(row.event_id, (regCountByEvent.get(row.event_id) ?? 0) + 1);
    if (row.registration_status === "pending_review") {
      regPendingByEvent.set(row.event_id, (regPendingByEvent.get(row.event_id) ?? 0) + 1);
    }
  }

  return events
    .map((event): EventRow => {
      const rows = partsByEvent.get(event.id) ?? [];
      return {
        ...event,
        season_code: event.season_id ? (seasonsById.get(event.season_id)?.code ?? null) : null,
        batch_code: event.intake_batch_id ? (batchesById.get(event.intake_batch_id)?.code ?? null) : null,
        participant_total: rows.length,
        attended_count: rows.filter((row) => isEventAttendedStatus(row.attendance_status)).length,
        registered_absent_count: rows.filter((row) => isEventAbsenceStatus(row.attendance_status)).length,
        pending_count: rows.filter((row) => isEventPendingStatus(row.attendance_status)).length,
        reg_count: regCountByEvent.get(event.id) ?? 0,
        reg_pending_review_count: regPendingByEvent.get(event.id) ?? 0
      };
    })
    .sort((a, b) => String(b.starts_at ?? "").localeCompare(String(a.starts_at ?? "")));
}

export default async function EventsPage(props: { searchParams?: Promise<{
    season?: string | string[];
    type?: string | string[];
    batch?: string | string[];
    status?: string | string[];
  }> }) {
  const searchParams = await props.searchParams;

  // Role gate BEFORE any protected read.
  //
  // Every other route in the events subtree already refuses a standalone
  // reviewer through `canEditRecaps` before it loads anything. This index was
  // the one that did not: `getCurrentAdminUser` sat inside the Promise.all below
  // and was used only for the edit-controls flag, so the event list — with its
  // registration and attendance counts — was reachable by any reviewer holding a
  // season grant.
  //
  // canBrowseOperations rather than canEditRecaps deliberately: this is a
  // browsing gate, and support_team must keep the read access it already has
  // here, exactly as it does on /operations.
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!canBrowseOperations(adminUser.role)) redirect("/");

  const scopeContext = await getAdminScopeContext();
  const scope = await getScopeFilter(scopeContext);
  const [data, intakeBatchesRes] = await Promise.all([
    getEventListData(scope),
    getIntakeBatches(scope)
  ]);
  const allowEdit = canEditRecaps(adminUser) && canOperateAnyScope(scopeContext);

  const seasonFilter = selectedParam(searchParams?.season).trim();
  const typeFilter = selectedParam(searchParams?.type).trim();
  const batchFilter = selectedParam(searchParams?.batch).trim();
  // Default to "active" when no status param is provided
  const rawStatus = selectedParam(searchParams?.status).trim();
  const statusFilter = rawStatus || "active";

  const batchOptions = intakeBatchesRes.data ?? [];

  const allRows = buildEventRows(data.events, data.participations, data.seasons, batchOptions, data.registrationRows);
  const filteredRows = allRows.filter((row) => {
    if (seasonFilter && row.season_code !== seasonFilter) return false;
    if (typeFilter && row.event_type !== typeFilter) return false;
    if (batchFilter && row.intake_batch_id !== batchFilter) return false;
    if (statusFilter && statusFilter !== "all") {
      const rowStatus = row.status ?? "active";
      if (rowStatus !== statusFilter) return false;
    }
    return true;
  });

  const seasonOptions = Array.from(new Set(data.seasons.map((season) => season.code).filter(Boolean) as string[])).sort();

  return (
    <>
      <PageHeader
        title="Danh sách sự kiện"
        description="Quản lý sự kiện và hoạt động (orientation, training, networking, closing, ...) trong mùa."
      />
      {data.error ? <ErrorBox message={data.error} /> : null}
      {intakeBatchesRes.error ? <ErrorBox message={intakeBatchesRes.error} /> : null}

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[160px] flex-1">
            <span className="text-xs font-medium uppercase text-slate-500">Mùa</span>
            <select
              name="season"
              defaultValue={seasonFilter}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Tất cả --</option>
              {seasonOptions.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </label>

          <label className="block min-w-[160px] flex-1">
            <span className="text-xs font-medium uppercase text-slate-500">Loại sự kiện</span>
            <select
              name="type"
              defaultValue={typeFilter}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Tất cả --</option>
              {EVENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block min-w-[160px] flex-1">
            <span className="text-xs font-medium uppercase text-slate-500">Đợt tuyển</span>
            <select
              name="batch"
              defaultValue={batchFilter}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="">-- Tất cả --</option>
              {batchOptions.map((b) => (
                <option key={b.id} value={b.id}>{b.code ?? b.name ?? b.id}</option>
              ))}
            </select>
          </label>

          <label className="block min-w-[140px] flex-1">
            <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
            <select
              name="status"
              defaultValue={rawStatus}
              className="mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint"
            >
              <option value="active">Đang hoạt động</option>
              <option value="cancelled">Đã hủy</option>
              <option value="all">Tất cả</option>
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
            >
              Lọc
            </button>
            <Link
              href="/events"
              className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Xoá lọc
            </Link>
            {allowEdit ? (
              <Link
                href="/events/create"
                className="inline-flex w-fit items-center justify-center rounded-md border border-transparent bg-vam-ink px-4 py-2 text-sm font-medium text-white hover:bg-vam-ink/90"
              >
                Tạo sự kiện
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {filteredRows.length === 0 ? (
        <EmptyState message="Chưa có sự kiện nào phù hợp với bộ lọc." />
      ) : (
        <SimpleTable
          rows={filteredRows}
          columns={[
            {
              key: "event_name",
              label: "Sự kiện",
              render: (row) => (
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/events/${row.id}`} className="font-medium text-vam-ink hover:text-vam-green">
                      {displayText(row.event_name)}
                    </Link>
                    {row.status === "cancelled" && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                        Đã hủy
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {[row.season_code, row.batch_code].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
              )
            },
            {
              key: "starts_at",
              label: "Thời gian",
              render: (row) => formatDate(row.starts_at)
            },
            {
              key: "event_type",
              label: "Loại",
              render: (row) => displayText(TYPE_LABELS.get(String(row.event_type ?? "")) ?? row.event_type)
            },
            {
              key: "reg_count",
              label: "Đăng ký",
              render: (row) => (
                <span className="tabular-nums">
                  {row.reg_count > 0 ? (
                    <>
                      {row.reg_count}
                      {row.reg_pending_review_count > 0 ? (
                        <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          {row.reg_pending_review_count} chờ
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </span>
              )
            },
            {
              key: "participant_total",
              label: "Tổng SL",
              render: (row) => row.participant_total
            },
            {
              key: "attendance_summary",
              label: "Đã tham gia / Vắng / Chưa cập nhật",
              render: (row) => (
                <span>
                  <span className="font-medium text-vam-green">{row.attended_count}</span>
                  <span className="mx-1 text-slate-400">/</span>
                  <span className="text-amber-700">{row.registered_absent_count}</span>
                  <span className="mx-1 text-slate-400">/</span>
                  <span className="text-slate-600">{row.pending_count}</span>
                </span>
              )
            },
            {
              key: "actions",
              label: "Hành động",
              render: (row) => (
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/events/${row.id}`}
                    className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                  >
                    Chi tiết
                  </Link>
                  <Link
                    href={`/events/${row.id}/attendance`}
                    className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                  >
                    Quản lý tham gia
                  </Link>
                  {allowEdit ? (
                    <Link
                      href={`/events/${row.id}/edit`}
                      className="inline-flex rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                    >
                      Sửa
                    </Link>
                  ) : null}
                </div>
              )
            }
          ]}
        />
      )}
    </>
  );
}
