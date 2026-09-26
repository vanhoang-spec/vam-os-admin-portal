import { redirect } from "next/navigation";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { AUTOMATION_GROUPS, AUTOMATION_SLOTS } from "@/lib/email-automation-core";
import { listAutomationContent, listRecentHistory } from "@/lib/email-automation";
import { emailSamplesByGroup, type EmailSample } from "@/lib/email-samples";
import { canViewEmailSamples, canViewOutboundEmails } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { AutomationEditor } from "./automation-editor";
import { MailTabs } from "../mail-tabs";

// Trang đọc nội dung đã lưu ở mỗi lần mở: sửa xong là thấy ngay, không chờ
// vòng đời cache của Next.
export const dynamic = "force-dynamic";

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

  const [list, history] = await Promise.all([listAutomationContent(), listRecentHistory()]);
  const groups = emailSamplesByGroup();

  // Những lá thư chưa sửa được từ đây vẫn hiện ở dưới, chỉ để đọc. Giấu chúng
  // đi thì màn hình nói rằng hệ thống chỉ gửi những lá sửa được, và người trực support sẽ
  // đi tìm lá thư sự kiện ở một chỗ không có nó.
  const editableKinds = new Set(AUTOMATION_SLOTS.map((slot) => slot.kind));
  const readOnlyGroups = groups
    .map((group) => ({
      group: group.group,
      samples: group.samples.filter((sample) => !editableKinds.has(sample.kind))
    }))
    .filter((group) => group.samples.length > 0);

  return (
    <>
      <PageHeader
        title="Thư tự động"
        description="Nội dung từng lá thư hệ thống tự gửi. Ban tổ chức sửa và lưu được; thư gửi sau đó dùng nội dung mới."
      />

      <MailTabs active="samples" canSeeLog={canViewOutboundEmails(adminUser.role)} canSeeSamples />

      <Card className="mb-6">
        <p className="text-sm text-slate-700">
          Sửa câu chữ của thư tự động ngay tại đây, không cần chờ bản cập nhật. Bấm{" "}
          <strong>Xem và sửa</strong> ở lá thư cần đổi, sửa rồi bấm <strong>Lưu</strong> — mọi lá
          thư hệ thống gửi từ lúc đó dùng nội dung mới.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Những phần trong dấu <code className="rounded bg-slate-100 px-1">{"{{ }}"}</code> là{" "}
          <strong>ô điền</strong>: hệ thống thay bằng tên, đường dẫn riêng và mốc thời gian thật của
          từng người lúc gửi. Giữ nguyên chúng — ô có dấu <span className="text-red-600">*</span> mà
          bị xoá thì hệ thống từ chối lưu.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Mỗi lần lưu đều ghi lại bản trước đó, nên sửa nhầm vẫn xem lại và quay về được.
        </p>
        <p className="mt-2 text-sm text-slate-700">
          Muốn biết một người đã nhận thư nào và vào lúc nào thì xem tab &quot;Nhật ký gửi&quot;. Sổ
          thư ghi người nhận, tiêu đề và trạng thái, nhưng <strong>không lưu nội dung</strong> từng
          lá — nên nội dung đúng của một lá thư đã gửi là bản đang hiện ở đây.
        </p>
      </Card>

      {!list.ok ? (
        <ErrorBox message={list.message} />
      ) : (
        AUTOMATION_GROUPS.map((groupName) => {
          const views = list.views.filter((view) => view.slot.group === groupName);
          if (!views.length) return null;
          return (
            <section key={groupName} className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-vam-ink">{groupName}</h2>
              {views.map((view) => (
                <AutomationEditor
                  key={view.slot.id}
                  slot={{
                    id: view.slot.id,
                    title: view.slot.title,
                    audience: view.slot.audience,
                    trigger: view.slot.trigger,
                    kind: view.slot.kind,
                    note: view.slot.note,
                    placeholders: view.slot.placeholders.map((p) => ({
                      key: p.key,
                      label: p.label,
                      required: p.required,
                      hint: p.hint
                    })),
                    subject: view.content.subject,
                    body: view.content.body,
                    customised: view.customised,
                    updatedLabel: view.updatedAt
                      ? `${view.updatedByName || "—"} · ${formatDateTime(view.updatedAt)}`
                      : null,
                    previewHtml: view.preview?.html ?? null,
                    history: (history.get(view.slot.id) ?? []).map((row) => ({
                      id: row.id,
                      action: row.action,
                      changedByName: row.changedByName,
                      changedAt: formatDateTime(row.changedAt),
                      subjectBefore: row.subjectBefore,
                      bodyBefore: row.bodyBefore
                    }))
                  }}
                />
              ))}
            </section>
          );
        })
      )}

      {readOnlyGroups.length ? (
        <section className="mt-10 border-t border-vam-line pt-6">
          <h2 className="mb-2 text-lg font-semibold text-vam-ink">Chưa sửa được từ màn hình này</h2>
          <p className="mb-4 text-sm text-slate-600">
            Thư sự kiện mang mã QR và bảng buổi do hệ thống sinh ra, nên chúng cần một cách sửa khác
            với một ô chữ. Thư thông báo do ban tổ chức tự soạn thì nội dung nằm ở tab{" "}
            &quot;Mẫu thư&quot;. Dữ liệu trong các mẫu dưới đây là ví dụ, không thuộc về ai.
          </p>
          {readOnlyGroups.map((group) => (
            <div key={group.group} className="mb-6">
              <h3 className="mb-3 text-base font-medium text-slate-700">{group.group}</h3>
              {group.samples.map((sample) => (
                <SampleCard key={`${sample.kind}-${sample.title}`} sample={sample} />
              ))}
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
