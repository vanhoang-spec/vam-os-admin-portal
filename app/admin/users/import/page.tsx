import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/admin-users";
import { AccountImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function AccountImportPage() {
  if (!(await requireSuperAdmin())) notFound();
  return <>
    <PageHeader title="Import tài khoản và membership" description="Xem trước, xác nhận và nhận kết quả từng dòng. Không lưu CSV thô; không tạo Auth cho mentor/mentee." />
    <div className="mb-6 flex flex-wrap gap-3"><Link href="/admin/users" className="min-h-11 rounded-md border border-vam-line bg-white px-4 py-2.5 font-medium text-vam-green">Quay lại tài khoản</Link><a href="/admin/users/import/template" className="min-h-11 rounded-md bg-vam-green px-4 py-2.5 font-medium text-white">Tải mẫu CSV UTF-8</a></div>
    <section className="mb-6 rounded-lg border border-vam-line bg-white p-4 text-sm leading-6 sm:p-6"><h2 className="font-semibold text-vam-ink">Hướng dẫn kiểm tra</h2><ul className="mt-2 list-disc pl-5"><li>Giữ đúng 6 header và đúng thứ tự trong template.</li><li>Role staff: viewer, reviewer, support_team, core_team, admin.</li><li>Role business membership: mentor, mentee — không tạo tài khoản đăng nhập.</li><li>Program, season và intake batch phải tồn tại và thuộc đúng nhau.</li><li>Không thêm cột password, token hoặc dữ liệu nhạy cảm khác.</li></ul></section>
    <AccountImportClient />
  </>;
}
