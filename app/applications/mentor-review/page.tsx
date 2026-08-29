import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getIntakeBatches, getPeople, getSeasons, keyById, getMentorReviewQueue } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { displayCode, displayConsent, displayText, formatDate } from "@/lib/utils";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseApplications } from "@/lib/read-access";
import { redirect } from "next/navigation";

export default async function MentorReviewQueuePage(props: { searchParams: Promise<{ page?: string }> }) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");
  const scope = await getScopeFilter(await getAdminScopeContext());

  const page = Math.max(1, parseInt(searchParams.page || "1", 10) || 1);
  const pageSize = 25;

  const queue = await getMentorReviewQueue(scope, page, pageSize);
  
  const personIds = queue.data.map((app: any) => app.person_id).filter(Boolean) as string[];
  const seasonIds = queue.data.map((app: any) => app.season_id).filter(Boolean) as string[];
  
  const [people, seasons, intakeBatchesRes] = await Promise.all([
    personIds.length > 0 ? getPeople(scope, personIds) : Promise.resolve({ data: [], error: null }),
    getSeasons(scope),
    getIntakeBatches(scope)
  ]);
  
  const peopleById = keyById(people.data);
  const seasonsById = keyById(seasons.data);
  const batchById = new Map(intakeBatchesRes.data.map((b: any) => [b.id, b]));

  const totalPages = Math.max(1, Math.ceil(queue.count / pageSize));

  const rows = queue.data.map((application: any) => {
    const person = application.person_id ? peopleById.get(application.person_id) : undefined;
    const season = application.season_id ? seasonsById.get(application.season_id) : undefined;
    const seasonCode = season?.code ?? season?.name ?? null;

    const fullName = application.full_name ?? person?.full_name ?? null;
    const emailPrimary = application.email_primary ?? person?.email_primary ?? null;
    const statusUnified = application.status ?? application.final_status ?? null;
    const consentUnified = application.consent_data_storage ?? application.consent_pdpa;
    const batch = application.intake_batch_id ? batchById.get(application.intake_batch_id) : undefined;
    const intakeBatchCode = batch?.code ?? batch?.name ?? (application.intake_batch_id ? "Batch không rõ" : "Chưa gán");

    return {
      id: application.id,
      short_application_id: application.id.slice(0, 8),
      sbd: displayText(application.sbd),
      full_name: displayText(fullName),
      email_primary: displayText(emailPrimary),
      role_applied: displayText(application.role_applied),
      status_display: applicationStatusLabel(statusUnified),
      submitted_at_display: formatDate(application.submitted_at),
      consent_display: displayConsent(consentUnified),
      source_display: displayText(application.source),
    };
  });

  const error = queue.error || people.error || seasons.error || intakeBatchesRes.error;

  return (
    <>
      <PageHeader title="Duyệt Mentor S12 (Hàng đợi)" description="Danh sách đơn ứng tuyển Mentor S12 đang chờ xử lý." />
      <ErrorBox message={error} />
      
      <div className="mb-4 bg-white rounded shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left divide-y divide-vam-line">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">SBD</th>
                <th className="px-4 py-3 font-semibold">Mã đơn</th>
                <th className="px-4 py-3 font-semibold">Họ tên</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Vai trò</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 font-semibold">Ngày nộp</th>
                <th className="px-4 py-3 font-semibold">Lưu trữ</th>
                <th className="px-4 py-3 font-semibold text-right">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line">
              {rows.map((row: any) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">{row.sbd}</td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">{row.short_application_id}</td>
                  <td className="px-4 py-3 font-medium text-vam-ink">{row.full_name}</td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-xs">{row.email_primary}</td>
                  <td className="px-4 py-3 text-slate-600">{row.role_applied}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2 py-0.5 text-xs font-medium text-vam-ink">
                      {row.status_display}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{row.submitted_at_display}</td>
                  <td className="px-4 py-3 text-slate-600">{row.consent_display}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/applications/${row.id}?queue=mentor-review&page=${page}`}
                      className="inline-flex rounded-md border border-vam-green px-3 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                    >
                      Duyệt
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                    Không có đơn nào cần xử lý.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600 mt-4">
        <Link
          href={`/applications/mentor-review?page=${Math.max(1, page - 1)}`}
          className={`rounded-md border border-vam-line bg-white px-4 py-2 ${page <= 1 ? "opacity-50 pointer-events-none" : "hover:bg-slate-50"}`}
        >
          Trước
        </Link>
        <span>
          Hiển thị trang {page} / {totalPages} (Tổng cộng {queue.count} đơn)
        </span>
        <Link
          href={`/applications/mentor-review?page=${Math.min(totalPages, page + 1)}`}
          className={`rounded-md border border-vam-line bg-white px-4 py-2 ${page >= totalPages ? "opacity-50 pointer-events-none" : "hover:bg-slate-50"}`}
        >
          Sau
        </Link>
      </div>
    </>
  );
}
