import { ErrorBox, PageHeader } from "@/components/ui";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseApplications } from "@/lib/read-access";
import { redirect } from "next/navigation";
import { getApplicationFacets, getPagedApplications } from "@/lib/applications-list";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { displayCode, displayConsent, displayText, formatDate } from "@/lib/utils";
import Link from "next/link";
import { getSeasons, getIntakeBatches } from "@/lib/data";

export default async function ApplicationsPage(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");
  const scope = await getScopeFilter(await getAdminScopeContext());

  const page = Number(searchParams?.page) || 1;
  const q = typeof searchParams?.q === "string" ? searchParams.q : undefined;
  const status = typeof searchParams?.status === "string" ? searchParams.status : undefined;
  const role = typeof searchParams?.role === "string" ? searchParams.role : undefined;
  const season = typeof searchParams?.season === "string" ? searchParams.season : undefined;
  const batch = typeof searchParams?.batch === "string" ? searchParams.batch : undefined;
  const consent = typeof searchParams?.consent === "string" ? searchParams.consent : undefined;

  const [applicationsRes, facetsRes, seasonsRes, batchesRes] = await Promise.all([
    getPagedApplications({
      scope,
      page,
      limit: 50,
      q,
      status,
      role_applied: role,
      season_code: season,
      intake_batch: batch,
      consent,
    }),
    getApplicationFacets(scope),
    getSeasons(scope),
    getIntakeBatches(scope)
  ]);

  const rows = applicationsRes.data;
  const count = applicationsRes.count;
  const totalPages = Math.ceil(count / 50);

  const facets = facetsRes.data || [];
  const statusOptions = Array.from(new Set(facets.map((f) => f.status_unified).filter(Boolean)));
  const roleOptions = Array.from(new Set(facets.map((f) => f.role_applied).filter(Boolean)));
  
  // Resolve season codes/batch codes for facets if needed, but we can just use the provided season and batches
  const seasonsByCode = new Map(seasonsRes.data.map(s => [s.code || s.name, s.id]));
  const batchesByCode = new Map(batchesRes.data.map(b => [b.code || b.name, b.id]));
  const seasonOptions = Array.from(seasonsByCode.keys());
  const batchOptions = Array.from(batchesByCode.keys());

  return (
    <>
      <PageHeader title="Ứng tuyển" description="Đơn ứng tuyển mentor/mentee và trạng thái xử lý." />
      <ErrorBox message={applicationsRes.error || facetsRes.error} />
      
      <div className="mb-4 bg-white p-4 rounded shadow">
        <form className="flex flex-wrap gap-4 items-end" method="GET">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Tìm kiếm</label>
            <input type="text" name="q" defaultValue={q} placeholder="Tên, email, SBD..." className="border px-2 py-1 rounded" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Trạng thái</label>
            <select name="status" defaultValue={status || ""} className="border px-2 py-1 rounded">
              <option value="">Tất cả</option>
              {statusOptions.map(opt => <option key={opt} value={opt}>{applicationStatusLabel(opt)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Vai trò</label>
            <select name="role" defaultValue={role || ""} className="border px-2 py-1 rounded">
              <option value="">Tất cả</option>
              {roleOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Mùa</label>
            <select name="season" defaultValue={season || ""} className="border px-2 py-1 rounded">
              <option value="">Tất cả</option>
              {seasonOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Đợt tuyển</label>
            <select name="batch" defaultValue={batch || ""} className="border px-2 py-1 rounded">
              <option value="">Tất cả</option>
              {batchOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Đồng ý lưu trữ</label>
            <select name="consent" defaultValue={consent || ""} className="border px-2 py-1 rounded">
              <option value="">Tất cả</option>
              <option value="yes">Có</option>
              <option value="no">Không</option>
              <option value="unknown">Chưa rõ</option>
            </select>
          </div>
          <button type="submit" className="bg-blue-600 text-white px-4 py-1 rounded">Lọc</button>
          <Link href="/applications" className="text-gray-500 underline ml-2">Xóa lọc</Link>
        </form>
      </div>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3">SBD</th>
              <th className="px-4 py-3">Mã đơn</th>
              <th className="px-4 py-3">Họ tên</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Vai trò</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Nguồn</th>
              <th className="px-4 py-3">Ngày nộp</th>
              <th className="px-4 py-3">Đồng ý lưu trữ</th>
              <th className="px-4 py-3">Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-3">{displayText(row.sbd)}</td>
                <td className="px-4 py-3">{row.id.slice(0,8)}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{displayText(row.full_name)}</div>
                  <div className="text-xs text-gray-500">{row.person_id ? row.person_id.slice(0,8) : "-"}</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">{displayText(row.email_primary)}</td>
                <td className="px-4 py-3">{displayText(row.role_applied)}</td>
                <td className="px-4 py-3">
                  <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-xs">
                    {applicationStatusLabel(row.status_unified)}
                  </span>
                </td>
                <td className="px-4 py-3">{displayText(row.source)}</td>
                <td className="px-4 py-3">{formatDate(row.submitted_at)}</td>
                <td className="px-4 py-3">
                  <span className="bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-xs">
                    {displayConsent(row.consent_unified)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/applications/${row.id}`} className="text-blue-600 hover:underline">Xem</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                  Không tìm thấy đơn ứng tuyển nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-4">
          <div className="text-sm text-gray-600">
            Hiển thị {rows.length} / {count} (Trang {page}/{totalPages})
          </div>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={`?page=${page - 1}&q=${q || ""}&status=${status || ""}&role=${role || ""}&season=${season || ""}&batch=${batch || ""}&consent=${consent || ""}`} className="px-3 py-1 bg-gray-200 rounded">
                Trước
              </Link>
            )}
            {page < totalPages && (
              <Link href={`?page=${page + 1}&q=${q || ""}&status=${status || ""}&role=${role || ""}&season=${season || ""}&batch=${batch || ""}&consent=${consent || ""}`} className="px-3 py-1 bg-gray-200 rounded">
                Tiếp
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
