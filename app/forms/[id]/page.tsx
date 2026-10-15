import Link from "next/link";
import { ErrorBox, PageHeader } from "@/components/ui";
import { CUSTOM_FORM_PUBLIC_PREFIX, CUSTOM_FORMS_PATH } from "@/lib/custom-form-core";
import { getCustomFormForEdit } from "@/lib/custom-forms";
import { getPublicOrigin } from "@/lib/public-url";
import { FormBuilder } from "./form-builder";

/** /forms/[id] — trình tạo form (BTC 15/10/2026). */
export const dynamic = "force-dynamic";

export default async function CustomFormEditPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const result = await getCustomFormForEdit(id);
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Form tùy chỉnh" />
        <ErrorBox message={result.message} />
        <Link href={CUSTOM_FORMS_PATH} className="text-sm text-vam-green underline">
          ← Về danh sách form
        </Link>
      </div>
    );
  }
  const { form, programs, responseCount } = result.data;
  const origin = (await getPublicOrigin()) ?? "";
  return (
    <div className="grid gap-4">
      <Link href={CUSTOM_FORMS_PATH} className="text-sm text-vam-green underline">
        ← Về danh sách form
      </Link>
      <PageHeader title={form.title} description="Sửa câu hỏi, cài đặt rồi bấm “Lưu form”. Công khai để link nhận câu trả lời." />
      <FormBuilder
        form={{
          id: form.id,
          publicCode: form.publicCode,
          title: form.title,
          description: form.description,
          programId: form.programId,
          status: form.status,
          opensAt: form.opensAt,
          closesAt: form.closesAt,
          thankYou: form.thankYou,
          onePerEmail: form.onePerEmail,
          fields: form.fields
        }}
        programs={programs}
        responseCount={responseCount}
        publicUrl={`${origin}${CUSTOM_FORM_PUBLIC_PREFIX}/${form.publicCode}`}
      />
    </div>
  );
}
