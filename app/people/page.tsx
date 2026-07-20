import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getPeople } from "@/lib/data";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
export default async function PeoplePage() {
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
