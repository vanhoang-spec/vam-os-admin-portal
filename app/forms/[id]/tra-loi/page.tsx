import Link from "next/link";
import { ErrorBox, PageHeader, SimpleTable } from "@/components/ui";
import { answerText, CUSTOM_FORMS_PATH, responseColumns } from "@/lib/custom-form-core";
import { listCustomFormResponses } from "@/lib/custom-forms";
import { formatDateTime } from "@/lib/utils";

/**
 * /forms/[id]/tra-loi — câu trả lời của một form, mới nhất trước (BTC 15/10/2026). Mỗi câu hỏi một
 * cột, kể cả câu đã ẩn: dữ liệu cũ vẫn phải xem được.
 */
export const dynamic = "force-dynamic";

const AT_KEY = "__gui_luc";

export default async function CustomFormResponsesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const result = await listCustomFormResponses(id);
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Câu trả lời" />
        <ErrorBox message={result.message} />
      </div>
    );
  }
  const { form, responses } = result.data;
  const columns = responseColumns(form.fields);
  const rows = responses.map((r) => ({
    [AT_KEY]: formatDateTime(r.createdAt),
    ...Object.fromEntries(columns.map((c) => [c.id, answerText(r.answers[c.id])]))
  }));
  return (
    <div className="grid gap-4">
      <Link href={`${CUSTOM_FORMS_PATH}/${form.id}`} className="text-sm text-vam-green underline">
        ← Về form “{form.title}”
      </Link>
      <PageHeader title={`Câu trả lời — ${form.title}`} description={`Tổng cộng ${responses.length} câu trả lời, mới nhất ở trên.`} />
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/exports/custom-form/${form.id}`}
          data-testid="download-csv"
          className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90"
        >
          Tải CSV
        </a>
        <Link
          href={`${CUSTOM_FORMS_PATH}/${form.id}/doi-chieu?doi_tuong=mentee`}
          data-testid="roster-check-link"
          className="rounded-md border border-vam-green px-4 py-2 text-sm font-semibold text-vam-green hover:bg-vam-mint/40"
        >
          Đối chiếu với danh sách mentee/mentor
        </Link>
      </div>
      <SimpleTable
        rows={rows}
        search="Tìm theo tên, email, MSSV…"
        columns={[{ key: AT_KEY, label: "Gửi lúc", nowrap: true }, ...columns.map((c) => ({ key: c.id, label: c.label }))]}
      />
    </div>
  );
}
