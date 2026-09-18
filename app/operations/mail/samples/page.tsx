import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { emailSamplesByGroup, type EmailSample } from "@/lib/email-samples";
import { canViewEmailSamples, canViewOutboundEmails } from "@/lib/permissions";
import { MailTabs } from "../mail-tabs";

export const metadata = {
  title: "Thư tự động — VAM OS"
};

/**
 * Nội dung những lá thư hệ thống tự gửi.
 *
 * Bản có định dạng nằm trong iframe `sandbox` rỗng: thư dựng bằng HTML có style
 * riêng, thả thẳng vào trang quản trị thì CSS của thư và CSS của app chồng lên
 * nhau. Trong iframe, thư hiển thị đúng như trong hộp thư và không chạm được vào
 * trang bao quanh.
 */
function SampleCard({ sample }: { sample: EmailSample }) {
  return (
    <Card className="mb-4">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-vam-ink">{sample.title}</h3>
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-medium">Gửi cho:</span> {sample.audience}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">
          <span className="font-medium">Khi nào gửi:</span> {sample.trigger}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Loại thư trong Nhật ký gửi: <code className="rounded bg-slate-100 px-1 py-0.5">{sample.kind}</code>
        </p>
        {sample.note ? <p className="mt-2 text-sm text-slate-700">{sample.note}</p> : null}
      </div>

      {sample.body ? (
        <>
          <p className="mb-2 rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium text-slate-600">Tiêu đề:</span>{" "}
            <span className="text-vam-ink">{sample.body.subject}</span>
          </p>
          <iframe
            title={`Nội dung thư: ${sample.title}`}
            sandbox=""
            srcDoc={sample.body.html}
            className="h-[28rem] w-full rounded-md border border-vam-line bg-white"
          />
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-slate-600">Xem bản chữ thuần</summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md border border-vam-line bg-slate-50 p-3 text-sm text-vam-ink">
              {sample.body.text}
            </pre>
          </details>
        </>
      ) : (
        <p className="rounded-md border border-dashed border-vam-line bg-slate-50 px-3 py-3 text-sm text-slate-700">
          Lá thư này không có nội dung dựng sẵn. Mở tab &quot;Mẫu thư&quot; để đọc đúng bản thảo đang dùng.
        </p>
      )}
    </Card>
  );
}

export default async function EmailSamplesPage() {
  // Cổng vai trò trước mọi thứ khác, như hai trang còn lại của module Mail.
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!canViewEmailSamples(adminUser.role)) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn không có quyền xem nội dung thư tự động."
      />
    );
  }

  const groups = emailSamplesByGroup();

  return (
    <>
      <PageHeader
        title="Thư tự động"
        description="Nội dung từng lá thư hệ thống tự gửi, dựng từ chính bộ tạo thư đang chạy."
      />

      <MailTabs active="samples" canSeeLog={canViewOutboundEmails(adminUser.role)} canSeeSamples />

      <Card className="mb-6">
        <p className="text-sm text-slate-700">
          Mọi tên, email, đường dẫn và mã vé dưới đây là dữ liệu ví dụ, không thuộc về ai. Thư thật
          mang tên và đường dẫn riêng của từng người nhận; phần còn lại giữ nguyên như ở đây.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Muốn biết một người đã nhận thư nào và vào lúc nào thì xem tab &quot;Nhật ký gửi&quot;. Sổ thư ghi
          người nhận, tiêu đề và trạng thái, nhưng không lưu nội dung từng lá.
        </p>
      </Card>

      {groups.map((group) => (
        <section key={group.group} className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-vam-ink">{group.group}</h2>
          {group.samples.map((sample) => (
            <SampleCard key={`${sample.kind}-${sample.title}`} sample={sample} />
          ))}
        </section>
      ))}
    </>
  );
}
