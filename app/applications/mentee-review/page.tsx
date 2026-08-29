import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getS12ApplicationReviewQueue } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { displayConsent, displayText, formatDate } from "@/lib/utils";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseApplications } from "@/lib/read-access";
import { redirect } from "next/navigation";

export default async function MenteeReviewQueuePage(props: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");
  const scope = await getScopeFilter(await getAdminScopeContext());

  const page = Math.max(1, parseInt(searchParams.page || "1", 10) || 1);
  const q = searchParams.q || "";
  const pageSize = 25;

  const queue = await getS12ApplicationReviewQueue({
    scope,
    role: "mentee",
    page,
    pageSize,
    search: q
  });
  const totalPages = Math.max(1, Math.ceil(queue.count / pageSize));

  const rows = queue.data.map((application: any) => {
    const fullName = application.full_name ?? null;
    const emailPrimary = application.email_primary ?? null;
    const statusUnified = application.status ?? application.final_status ?? null;
    const consentUnified = application.consent_data_storage ?? application.consent_pdpa;

    return {
      id: application.id,
      short_application_id: application.id.slice(0, 8),
      sbd: displayText(application.sbd),
      full_name: displayText(fullName),
      email_primary: displayText(emailPrimary),
      status_display: applicationStatusLabel(statusUnified),
      submitted_at_display: formatDate(application.submitted_at),
      consent_display: displayConsent(consentUnified),
      source_display: displayText(application.source),
    };
  });

  const error = queue.error;
  
  // Build query string for navigation links
  const queryParams = new URLSearchParams();
  if (q) queryParams.set("q", q);
  const baseQueryStr = queryParams.toString();
  const queryStrWithAmp = baseQueryStr ? `&${baseQueryStr}` : "";

  return (
    <>
      <PageHeader title="Duyệt Mentee S12 (Hàng đợi)" description="Danh sách đơn ứng tuyển Mentee S12 đang chờ xử lý." />
      <ErrorBox message={error} />
      
      <div className="mb-4 bg-white p-4 rounded shadow flex flex-col md:flex-row gap-4 justify-between items-center">
        <form method="GET" action="/applications/mentee-review" className="flex w-full md:w-auto gap-2">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Tìm theo tên, email hoặc SBD"
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-full md:w-64"
          />
          <button type="submit" className="bg-vam-ink text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-slate-800">
            Tìm kiếm
          </button>
        </form>
      </div>

      <div className="mb-4 bg-white rounded shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left divide-y divide-vam-line">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">SBD</th>
                <th className="px-4 py-3 font-semibold">Mã đơn</th>
                <th className="px-4 py-3 font-semibold">Họ tên</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 font-semibold">Ngày nộp</th>
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
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2 py-0.5 text-xs font-medium text-vam-ink">
                      {row.status_display}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{row.submitted_at_display}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/applications/${row.id}?queue=mentee-review&page=${page}${queryStrWithAmp}`}
                      className="inline-flex rounded-md border border-vam-green px-3 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                    >
                      Duyệt
                    </Link>
                  </td>
                </tr>
              ))}
              {queue.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Không tìm thấy đơn nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-600 mt-4">
        <Link
          href={`/applications/mentee-review?page=${Math.max(1, page - 1)}${queryStrWithAmp}`}
          className={`rounded-md border border-vam-line bg-white px-4 py-2 ${page <= 1 ? "opacity-50 pointer-events-none" : "hover:bg-slate-50"}`}
        >
          Trước
        </Link>
        <span>
          Hiển thị trang {page} / {totalPages} (Tổng cộng {queue.count} đơn khớp từ khóa tìm kiếm)
        </span>
        <Link
          href={`/applications/mentee-review?page=${Math.min(totalPages, page + 1)}${queryStrWithAmp}`}
          className={`rounded-md border border-vam-line bg-white px-4 py-2 ${page >= totalPages ? "opacity-50 pointer-events-none" : "hover:bg-slate-50"}`}
        >
          Sau
        </Link>
      </div>
    </>
  );
}
