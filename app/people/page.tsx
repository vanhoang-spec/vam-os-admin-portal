import { FilterableTable } from "@/components/filterable-table";
import { ErrorBox, PageHeader } from "@/components/ui";
import { getPeople } from "@/lib/data";
export default async function PeoplePage() {
  const people = await getPeople();
  return (
    <>
      <PageHeader title="People" description="Danh sách hồ sơ người tham gia trong hệ thống." />
      <ErrorBox message={people.error} />
      <FilterableTable
        rows={people.data}
        searchPlaceholder="Tìm theo tên, email hoặc số điện thoại"
        searchKeys={["full_name", "email_primary", "phone_primary"]}
        filters={[{ key: "gender", label: "Gender", valueKey: "gender" }]}
        getHref={{ prefix: "/people/", key: "id" }}
        columns={[
          { key: "full_name", label: "full_name" },
          { key: "email_primary", label: "email_primary" },
          { key: "phone_primary", label: "phone_primary" },
          { key: "gender", label: "gender" },
          { key: "source_sheets", label: "source_sheets" },
          { key: "data_quality_flags", label: "data_quality_flags" }
        ]}
      />
    </>
  );
}
