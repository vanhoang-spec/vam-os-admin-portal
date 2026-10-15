import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { CUSTOM_FORMS_PATH } from "@/lib/custom-form-core";
import { getCustomFormForEdit } from "@/lib/custom-forms";
import { FormHeader } from "@/app/f/[code]/form-header";
import { PublicForm } from "@/app/f/[code]/public-form";

/**
 * /forms/[id]/xem-thu — bản xem thử của form, bản ĐÃ LƯU (BTC 15/10/2026). Dùng đúng thành phần của
 * form công khai; bấm "Gửi" chỉ kiểm câu trả lời, không gửi đi đâu.
 */
export const dynamic = "force-dynamic";

export default async function CustomFormPreviewPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const result = await getCustomFormForEdit(id);
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Xem thử form" />
        <ErrorBox message={result.message} />
      </div>
    );
  }
  const { form } = result.data;
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <Link href={`${CUSTOM_FORMS_PATH}/${form.id}`} className="text-sm text-vam-green underline">
        ← Về trình tạo form
      </Link>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="preview-note">
        Bản xem thử của bản đã lưu — người điền sẽ thấy đúng như dưới đây. Bấm “Gửi” chỉ để thử phần kiểm lỗi, không ghi gì.
      </p>
      <FormHeader title={form.title} description={form.description} closesAt={form.closesAt} />
      <div className="rounded-lg border border-vam-line bg-white px-4 py-5">
        <PublicForm code={form.publicCode} fields={form.fields.filter((f) => !f.hidden)} preview />
      </div>
    </div>
  );
}
