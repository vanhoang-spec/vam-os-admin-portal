import type { Metadata } from "next";
import { getPublicCustomForm } from "@/lib/custom-forms";
import { formatDateTime } from "@/lib/utils";
import { FormHeader } from "./form-header";
import { PublicForm } from "./public-form";

/**
 * Form tùy chỉnh công khai — /f/<mã> (BTC 15/10/2026). Người điền không cần đăng nhập.
 *
 * Mở trang không ghi gì; chỉ nút "Gửi" mới ghi. Form nháp, chưa tới giờ mở hay đã đóng thì chỉ hiện
 * một câu báo — form nháp không lộ cả tiêu đề cho người đoán trúng mã.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Form · Vietnam Alumni Mentoring",
  robots: { index: false, follow: false }
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-vam-green">Vietnam Alumni Mentoring</p>
        {children}
      </div>
    </main>
  );
}

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4" data-testid="form-unavailable">
      <h1 className="text-lg font-semibold text-amber-900">{title}</h1>
      <p className="mt-1 text-sm text-amber-900">{message}</p>
    </div>
  );
}

export default async function CustomFormPublicPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const data = await getPublicCustomForm(code);
  if (data.state === "error") {
    return (
      <Shell>
        <Notice title="Chưa mở được form" message="Hệ thống đang bận, bạn thử tải lại trang sau ít phút." />
      </Shell>
    );
  }
  if (data.state === "invalid") {
    return (
      <Shell>
        <Notice title="Không tìm thấy form" message="Đường dẫn không đúng hoặc form không còn tồn tại. Bạn kiểm tra lại đường dẫn đã nhận." />
      </Shell>
    );
  }
  if (data.availability === "draft") {
    return (
      <Shell>
        <Notice title="Form chưa mở" message="Form này chưa mở nhận câu trả lời." />
      </Shell>
    );
  }
  if (data.availability === "not_open") {
    return (
      <Shell>
        <Notice title={data.title} message={`Form mở nhận câu trả lời lúc ${data.opensAt ? formatDateTime(data.opensAt) : ""} (giờ Việt Nam). Bạn quay lại đúng đường dẫn này khi tới giờ.`} />
      </Shell>
    );
  }
  if (data.availability === "closed") {
    return (
      <Shell>
        <Notice title={data.title} message="Form đã đóng, không nhận thêm câu trả lời. Cảm ơn bạn đã quan tâm." />
      </Shell>
    );
  }
  return (
    <Shell>
      <FormHeader title={data.title} description={data.description} closesAt={data.closesAt} />
      <div className="rounded-lg border border-vam-line bg-white px-4 py-5">
        <PublicForm code={code} fields={data.fields} />
      </div>
    </Shell>
  );
}
