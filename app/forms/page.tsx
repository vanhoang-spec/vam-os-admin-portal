import Link from "next/link";
import { Card, EmptyState, ErrorBox, PageHeader } from "@/components/ui";
import { CUSTOM_FORM_PUBLIC_PREFIX, CUSTOM_FORM_STATUS_LABELS, CUSTOM_FORMS_PATH } from "@/lib/custom-form-core";
import { listCustomForms } from "@/lib/custom-forms";
import { getPublicOrigin } from "@/lib/public-url";
import { formatDateTime } from "@/lib/utils";
import { createCustomFormAction } from "./actions";

/**
 * /forms — Form tùy chỉnh (BTC 15/10/2026). Support team tự tạo form cho từng đợt (vd. tuyển mentee
 * Job Shadowing), bật công khai để có link trên tên miền của CRM, rồi xem câu trả lời ngay ở đây.
 */
export const dynamic = "force-dynamic";

const TITLE = "Form tùy chỉnh";
const DESCRIPTION =
  "Tạo form như Google Form ngay trong CRM: tự chọn câu hỏi, bắt buộc hay tùy chọn, định dạng MSSV, CCCD, ngày DD/MM/YYYY… Bật công khai để có link gửi cho người điền; câu trả lời lưu tại đây.";

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  published: "bg-green-50 text-green-800",
  closed: "bg-amber-50 text-amber-900"
};

export default async function CustomFormsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const result = await listCustomForms();
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorBox message={result.message} />
      </div>
    );
  }
  const origin = (await getPublicOrigin()) ?? "";
  const { forms } = result.data;
  return (
    <div className="grid gap-4">
      <PageHeader title={TITLE} description={DESCRIPTION} />
      {searchParams.loi === "tao-form" ? <ErrorBox message="Chưa tạo được form mới. Thử lại sau ít phút." /> : null}
      <Card>
        <form action={createCustomFormAction} className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Form mới có sẵn ba câu: Họ và tên, Email, Số điện thoại — sửa, xoá hay thêm câu tùy ý trước khi công khai.
          </p>
          <button type="submit" data-testid="create-form" className="rounded-md bg-vam-green px-4 py-2 text-sm font-semibold text-white hover:bg-vam-green/90">
            Tạo form mới
          </button>
        </form>
      </Card>
      {forms.length === 0 ? (
        <EmptyState message="Chưa có form nào. Bấm “Tạo form mới” để bắt đầu." />
      ) : (
        <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
          <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="form-list">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Form</th>
                <th className="px-3 py-2">Chương trình</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2">Mở – đóng</th>
                <th className="px-3 py-2">Câu trả lời</th>
                <th className="px-3 py-2">Link công khai</th>
                <th className="px-3 py-2">Sửa lần cuối</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line">
              {forms.map((form) => (
                <tr key={form.id} data-form={form.id}>
                  <td className="px-3 py-2 font-medium text-vam-ink">
                    <Link href={`${CUSTOM_FORMS_PATH}/${form.id}`} className="underline decoration-vam-line underline-offset-2 hover:text-vam-green">
                      {form.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{form.programName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[form.status] ?? ""}`}>{CUSTOM_FORM_STATUS_LABELS[form.status]}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {form.opensAt ? formatDateTime(form.opensAt) : "Ngay khi công khai"}
                    {" – "}
                    {form.closesAt ? formatDateTime(form.closesAt) : "không hạn"}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`${CUSTOM_FORMS_PATH}/${form.id}/tra-loi`} className="font-medium text-vam-green underline">
                      {form.responseCount}
                    </Link>
                  </td>
                  <td className="break-all px-3 py-2 text-xs text-slate-600">
                    {form.status === "draft" ? "Chưa công khai" : `${origin}${CUSTOM_FORM_PUBLIC_PREFIX}/${form.publicCode}`}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{form.updatedAt ? formatDateTime(form.updatedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
