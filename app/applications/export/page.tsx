import { PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowseApplications } from "@/lib/read-access";
import { redirect } from "next/navigation";

export default async function ExportPage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowseApplications(adminUser.role)) redirect(adminUser?.role === "reviewer" ? "/reviews" : "/");

  return (
    <div className="space-y-6">
      <PageHeader title="Xuất dữ liệu tuyển sinh" />
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-sm text-slate-600 mb-6">
          Tải xuống dữ liệu hồ sơ và kết quả chấm điểm. Dữ liệu được giới hạn theo phân quyền của bạn.
        </p>

        <div className="space-y-4">
          <div className="border p-4 rounded-md">
            <h3 className="font-medium mb-2">Kết quả tuyển (Summary)</h3>
            <p className="text-sm text-slate-500 mb-4">Một dòng cho mỗi hồ sơ, bao gồm tổng hợp điểm số.</p>
            <div className="flex gap-4">
              <a
                href="/api/applications/export?type=summary&role=mentee"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Tải Mentee CSV
              </a>
              <a
                href="/api/applications/export?type=summary&role=mentor"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Tải Mentor CSV
              </a>
            </div>
          </div>

          <div className="border p-4 rounded-md">
            <h3 className="font-medium mb-2">Chi tiết chấm (Detail)</h3>
            <p className="text-sm text-slate-500 mb-4">Một dòng cho mỗi lượt chấm điểm (assignment).</p>
            <div className="flex gap-4">
              <a
                href="/api/applications/export?type=detail&role=mentee"
                className="px-4 py-2 bg-slate-100 text-slate-800 border rounded hover:bg-slate-200 text-sm"
              >
                Tải Mentee CSV
              </a>
              <a
                href="/api/applications/export?type=detail&role=mentor"
                className="px-4 py-2 bg-slate-100 text-slate-800 border rounded hover:bg-slate-200 text-sm"
              >
                Tải Mentor CSV
              </a>
            </div>
          </div>

          <div className="border p-4 rounded-md">
            <h3 className="font-medium mb-2">Tổng hợp Excel (XLSX)</h3>
            <p className="text-sm text-slate-500 mb-4">File Excel gồm 2 sheet: Kết quả tuyển & Chi tiết chấm.</p>
            <div className="flex gap-4">
              <a
                href="/api/applications/export?format=xlsx&role=mentee"
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
              >
                Tải Mentee Excel
              </a>
              <a
                href="/api/applications/export?format=xlsx&role=mentor"
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
              >
                Tải Mentor Excel
              </a>
              <a
                href="/api/applications/export?format=xlsx&role=all"
                className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800 text-sm font-medium"
              >
                Tải Tất cả Excel
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
