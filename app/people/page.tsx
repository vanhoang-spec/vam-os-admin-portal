import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getPeople } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBrowsePeople } from "@/lib/read-access";
import { redirect } from "next/navigation";
export default async function PeoplePage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser || !canBrowsePeople(adminUser.role)) redirect("/");
  const scope = await getScopeFilter(await getAdminScopeContext());
  const people = await getPeople(scope);
  return (
    <>
      <PageHeader title="Cộng đồng VAM" description="Danh sách hồ sơ người tham gia trong hệ thống." />
      <ErrorBox message={people.error} />
      <FilterableTable
        rows={people.data}
        searchPlaceholder="Tìm theo tên, email hoặc số điện thoại"
        searchKeys={["full_name", "email_primary", "phone_primary"]}
        filters={[{ key: "gender", label: "Giới tính", valueKey: "gender" }]}
        // Mặc định người mới vào hệ thống trước, như mọi danh sách (BTC 07/10/2026).
        // Trước đó bảng không có thứ tự: đọc phân trang trả về theo id ngẫu nhiên.
        sortOptions={[
          { label: "Mới thêm gần đây", key: "created_at", direction: "desc", type: "text", emptyLast: true, secondaryKey: "full_name" },
          { label: "Tên A-Z", key: "full_name", direction: "asc", type: "text", emptyLast: true }
        ]}
        getHref={{ prefix: "/people/", key: "id" }}
        columns={[
          { key: "full_name", label: "Họ và tên" },
          { key: "email_primary", label: "Email" },
          { key: "phone_primary", label: "Điện thoại" },
          { key: "gender", label: "Giới tính" },
          { key: "source_sheets", label: "Nguồn" }
        ]}
      />
    </>
  );
}
