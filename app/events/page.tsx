import Link from "next/link";
import { Card, EmptyState, ErrorBox, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canEditRecaps } from "@/lib/auth-constants";
import { EVENT_TYPE_OPTIONS, getEventListData } from "@/lib/events";
import type { Event, EventParticipation, Season } from "@/lib/types";
import { displayText, formatDate } from "@/lib/utils";

type EventRow = Event & {
  season_code: string | null;
  participant_total: number;
  attended_count: number;
  registered_absent_count: number;
};

const TYPE_LABELS = new Map<string, string>(EVENT_TYPE_OPTIONS.map((option) => [option.value, option.label]));

function selectedParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function buildEventRows(events: Event[], participations: EventParticipation[], seasons: Season[]): EventRow[] {
  const seasonsById = new Map(seasons.map((season) => [season.id, season]));
  const partsByEvent = new Map<string, EventParticipation[]>();
  for (const part of participations) {
    if (!part.event_id) continue;
    const arr = partsByEvent.get(part.event_id) ?? [];
    arr.push(part);
    partsByEvent.set(part.event_id, arr);
  }

  return events
    .map((event): EventRow => {
      const rows = partsByEvent.get(event.id) ?? [];
      return {
        ...event,
        season_code: event.season_id ? seasonsById.get(event.season_id)?.code ?? null : null,
        participant_total: rows.length,
        attended_count: rows.filter((row) => String(row.attendance_status ?? "").trim() === "attended").length,
        registered_absent_count: rows.filter((row) => String(row.attendance_status ?? "").trim() === "registered_absent").length
      };
    })
    .sort((a, b) => String(b.starts_at ?? "").localeCompare(String(a.starts_at ?? "")));
}

export default async function EventsPage({ searchParams }: { searchParams?: { season?: string | string[]; type?: string | string[] } }) {
  const [data, adminUser] = await Promise.all([getEventListData(), getCurrentAdminUser()]);
  const allowEdit = canEditRecaps(adminUser);

  const seasonFilter = selectedParam(searchParams?.season).trim();
  const typeFilter = selectedParam(searchParams?.type).trim();

  const allRows = buildEventRows(data.events, data.participations, data.seasons);
  const filteredRows = allRows.filter((row) => {
    if (seasonFilter && row.season_code !== seasonFilter) return false;
    if (typeFilter && row.event_type !== typeFilter) return false;
    return true;
  });

  const seasonOptions = Array.from(new Set(data.seasons.map((season) => season.code).filter(Boolean) as string[])).sort();

  return (
    <>
      <PageHeader title="Danh sách sự kiện" description="Quản lý sự kiện và hoạt động (training, workshop, orientation, ...) trong mùa." />
      {data.error ? <ErrorBox message={data.error} /> : null}

      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-[200px_200px_1fr_auto] sm:items-end">
          <label className="block">
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
          <label className="block">
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
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button type="submit" className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
              Lọc
            </button>
            <Link href="/events" className="inline-flex w-fit items-center justify-center rounded-md border border-vam-line bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Xoá lọc
            </Link>
            {allowEdit ? (
              <Link href="/events/create" className="inline-flex w-fit items-center justify-center rounded-md border border-transparent bg-vam-ink px-4 py-2 text-sm font-medium text-white hover:bg-vam-ink/90">
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
                  <div className="font-medium text-vam-ink">{displayText(row.event_name)}</div>
                  <div className="mt-1 text-xs text-slate-500">{displayText(row.season_code)}</div>
                </div>
              )
            },
            { key: "starts_at", label: "Thời gian", render: (row) => formatDate(row.starts_at) },
            { key: "event_type", label: "Loại", render: (row) => displayText(TYPE_LABELS.get(String(row.event_type ?? "")) ?? row.event_type) },
            { key: "participant_total", label: "Tổng người tham gia", render: (row) => row.participant_total },
            {
              key: "attendance_summary",
              label: "Đã tham gia / Đăng ký không tham gia",
              render: (row) => `${row.attended_count} / ${row.registered_absent_count}`
            },
            {
              key: "actions",
              label: "Hành động",
              render: (row) => (
                <div className="flex flex-wrap gap-2">
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
