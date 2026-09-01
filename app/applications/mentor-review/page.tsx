import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getS12ApplicationReviewQueue, classifyS12Mentors } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { displayConsent, displayText, formatDate } from "@/lib/utils";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseApplications } from "@/lib/read-access";
import { canDecide } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { bulkMentorReviewDecisionAction } from "@/app/actions/mentor-review-bulk";
import { MentorBulkDecisionButtons, SelectAllMentorRows } from "./bulk-controls";

type MentorTypeFilter = "all" | "new" | "returning" | "unknown";

type SearchParams = {
  page?: string;
  q?: string;
  mentor_type?: string;
  bulk_result?: string;
  bulk_ok?: string;
};

const TYPE_LABEL: Record<Exclude<MentorTypeFilter, "all">, "Mentor mới" | "Mentor cũ quay lại" | "Chưa xác định"> = {
  new: "Mentor mới",
  returning: "Mentor cũ quay lại",
  unknown: "Chưa xác định"
};

function normalizeMentorType(value?: string): MentorTypeFilter {
  if (value === "new" || value === "returning" || value === "unknown") return value;
  return "all";
}

export default async function MentorReviewQueuePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");
  const scope = await getScopeFilter(await getAdminScopeContext());

  const page = Math.max(1, parseInt(searchParams.page || "1", 10) || 1);
  const q = searchParams.q || "";
  const mentorType = normalizeMentorType(searchParams.mentor_type);
  const pageSize = 25;
  const canBulkDecide = canDecide(adminUser.role);

  let applications: any[] = [];
  let classifications = new Map<string, "Mentor cũ quay lại" | "Mentor mới" | "Chưa xác định">();
  let totalCount = 0;
  let error: string | null = null;

  if (mentorType === "all") {
    const queue = await getS12ApplicationReviewQueue({
      scope,
      role: "mentor",
      page,
      pageSize,
      search: q
    });
    applications = queue.data;
    totalCount = queue.count;
    error = queue.error;
    classifications = await classifyS12Mentors(queue.data);
  } else {
    // Classification requires targeted person/profile evidence. Keep this operational
    // filter bounded: current S12 queues are small, and we refuse to silently return
    // an incomplete classification result if the matching queue ever exceeds 500.
    const queue = await getS12ApplicationReviewQueue({
      scope,
      role: "mentor",
      page: 1,
      pageSize: 501,
      search: q
    });
    error = queue.error;
    if (!error && queue.count > 500) {
      error = "Có hơn 500 hồ sơ phù hợp. Vui lòng nhập thêm từ khóa tìm kiếm trước khi lọc loại Mentor.";
    } else if (!error) {
      classifications = await classifyS12Mentors(queue.data);
      const targetLabel = TYPE_LABEL[mentorType];
      const filtered = queue.data.filter((application) => classifications.get(application.id) === targetLabel);
      totalCount = filtered.length;
      const from = (page - 1) * pageSize;
      applications = filtered.slice(from, from + pageSize);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const rows = applications.map((application: any) => {
    const fullName = application.full_name ?? null;
    const emailPrimary = application.email_primary ?? null;
    const statusUnified = application.status ?? application.final_status ?? null;
    const consentUnified = application.consent_data_storage ?? application.consent_pdpa;
    const classification = classifications.get(application.id) || "Chưa xác định";

    return {
      id: application.id,
      short_application_id: application.id.slice(0, 8),
      sbd: displayText(application.sbd),
      full_name: displayText(fullName),
      email_primary: displayText(emailPrimary),
      status_raw: String(statusUnified ?? ""),
      status_display: applicationStatusLabel(statusUnified),
      submitted_at_display: formatDate(application.submitted_at),
      consent_display: displayConsent(consentUnified),
      source_display: displayText(application.source),
      classification
    };
  });

  const preservedParams = new URLSearchParams();
  if (q) preservedParams.set("q", q);
  if (mentorType !== "all") preservedParams.set("mentor_type", mentorType);
  const preservedQuery = preservedParams.toString();
  const querySuffix = preservedQuery ? `&${preservedQuery}` : "";

  return (
    <>
      <PageHeader title="Duyệt Mentor S12 (Hàng đợi)" description="Danh sách đơn ứng tuyển Mentor S12 đang chờ xử lý." />
      <ErrorBox message={error} />

      {searchParams.bulk_result && (
        <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${searchParams.bulk_ok === "1" ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {searchParams.bulk_result}
        </div>
      )}

      <div className="mb-4 rounded bg-white p-4 shadow">
        <form method="GET" action="/applications/mentor-review" className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="text-sm text-slate-700">
            Tìm kiếm
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Tên, email hoặc SBD"
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm md:w-72"
            />
          </label>
          <label className="text-sm text-slate-700">
            Loại Mentor
            <select
              name="mentor_type"
              defaultValue={mentorType}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm md:w-56"
            >
              <option value="all">Tất cả</option>
              <option value="new">Mentor mới</option>
              <option value="returning">Mentor cũ quay lại</option>
              <option value="unknown">Chưa xác định</option>
            </select>
          </label>
          <button type="submit" className="rounded bg-vam-ink px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Áp dụng
          </button>
          {(q || mentorType !== "all") && (
            <Link href="/applications/mentor-review" className="px-2 py-2 text-sm text-slate-600 hover:underline">
              Xóa lọc
            </Link>
          )}
        </form>
      </div>

      <form action={bulkMentorReviewDecisionAction}>
        <input type="hidden" name="return_q" value={q} />
        <input type="hidden" name="return_mentor_type" value={mentorType} />
        <input type="hidden" name="return_page" value={page} />

        {canBulkDecide && rows.length > 0 && (
          <div className="mb-3 flex flex-col gap-3 rounded-md border border-vam-line bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-4">
              <SelectAllMentorRows />
              <label className="text-xs text-slate-600">
                Ghi chú chung
                <input
                  name="decision_note"
                  placeholder="Không bắt buộc"
                  className="ml-2 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <MentorBulkDecisionButtons />
          </div>
        )}

        <div className="mb-4 overflow-hidden rounded bg-white shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm divide-y divide-vam-line">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {canBulkDecide && <th className="px-3 py-3 font-semibold">Chọn</th>}
                  <th className="px-4 py-3 font-semibold">Loại Mentor</th>
                  <th className="px-4 py-3 font-semibold">SBD</th>
                  <th className="px-4 py-3 font-semibold">Mã đơn</th>
                  <th className="px-4 py-3 font-semibold">Họ tên</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Trạng thái</th>
                  <th className="px-4 py-3 font-semibold">Ngày nộp</th>
                  <th className="px-4 py-3 text-right font-semibold">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line">
                {rows.map((row: any) => {
                  let badgeClass = "bg-slate-100 text-slate-700";
                  if (row.classification === "Mentor cũ quay lại") badgeClass = "bg-blue-100 text-blue-700";
                  if (row.classification === "Mentor mới") badgeClass = "bg-green-100 text-green-700";

                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      {canBulkDecide && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            name="application_id"
                            value={row.id}
                            data-mentor-bulk="1"
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <input type="hidden" name={`expected_status_${row.id}`} value={row.status_raw} />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                          {row.classification}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.sbd}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.short_application_id}</td>
                      <td className="px-4 py-3 font-medium text-vam-ink">{row.full_name}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-slate-600">{row.email_primary}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-md border border-vam-line bg-slate-50 px-2 py-0.5 text-xs font-medium text-vam-ink">
                          {row.status_display}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{row.submitted_at_display}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/applications/${row.id}?queue=mentor-review&page=${page}${querySuffix}`}
                          className="inline-flex rounded-md border border-vam-green px-3 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint"
                        >
                          Duyệt
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={canBulkDecide ? 9 : 8} className="px-4 py-8 text-center text-slate-500">
                      Không tìm thấy đơn nào.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
        <Link
          href={`/applications/mentor-review?page=${Math.max(1, page - 1)}${querySuffix}`}
          className={`rounded-md border border-vam-line bg-white px-4 py-2 ${page <= 1 ? "pointer-events-none opacity-50" : "hover:bg-slate-50"}`}
        >
          Trước
        </Link>
        <span>
          Hiển thị trang {Math.min(page, totalPages)} / {totalPages} (Tổng cộng {totalCount} hồ sơ phù hợp)
        </span>
        <Link
          href={`/applications/mentor-review?page=${Math.min(totalPages, page + 1)}${querySuffix}`}
          className={`rounded-md border border-vam-line bg-white px-4 py-2 ${page >= totalPages ? "pointer-events-none opacity-50" : "hover:bg-slate-50"}`}
        >
          Sau
        </Link>
      </div>
    </>
  );
}
