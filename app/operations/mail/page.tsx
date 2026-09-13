import { redirect } from "next/navigation";
import { ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { countBulkRecipients, listEmailBatches } from "@/lib/bulk-mail";
import { evaluateEmailGate } from "@/lib/email-core";
import {
  countEmailTemplatesByStatus,
  getMailSeason,
  listEmailTemplates
} from "@/lib/email-templates";
import {
  canApproveEmailTemplate,
  canComposeEmailTemplate,
  canSendBulkEmail,
  canViewOutboundEmails
} from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { formatDateTime } from "@/lib/utils";
import { MailClient, type MailTemplateSummary } from "./mail-client";
import { MailTabs } from "./mail-tabs";
import { SendPanel } from "./send-panel";

export const dynamic = "force-dynamic";

/** Lượt gửi gọi nhà cung cấp email tuần tự; trần mặc định của Vercel quá ngắn. */
export const maxDuration = 60;

export const metadata = {
  title: "Mail — VAM OS"
};

export default async function MailPage() {
  // Cổng vai trò trước mọi lần đọc dữ liệu, và trước cả kiểm phạm vi — phạm vi
  // là câu hỏi khác, và nó đúng với cả những mức quyền không nên vào đây.
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!canComposeEmailTemplate(adminUser.role)) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn không có quyền soạn thư gửi hàng loạt."
      />
    );
  }

  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) {
    return (
      <>
        <PageHeader title="Mail" description="Không tải được kho mẫu thư." />
        <ErrorBox message={scopeContext.scopeError} />
      </>
    );
  }

  const season = await getMailSeason();
  if (!season.ok) {
    return (
      <>
        <PageHeader title="Mail" description="Không xác định được mùa đang vận hành." />
        <ErrorBox message={season.error} />
      </>
    );
  }

  if (!(await canOperateSeason(scopeContext, season.id))) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn không có phạm vi vận hành trên mùa này."
      />
    );
  }

  const maySend = canSendBulkEmail(adminUser.role);

  // Đếm người nhận chỉ khi người đang xem gửi được: ba lượt đọc qua toàn bộ
  // membership của mùa là cái giá không đáng trả cho một màn hình chỉ để soạn.
  const [listing, counts, batches, recipientCounts] = await Promise.all([
    listEmailTemplates(season.id),
    countEmailTemplatesByStatus(season.id),
    maySend ? listEmailBatches(season.id) : Promise.resolve({ rows: [], error: null }),
    maySend
      ? countBulkRecipients(season.id)
      : Promise.resolve({ counts: {}, events: [], error: null })
  ]);

  const templates: MailTemplateSummary[] = listing.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    subject: row.subject,
    body: row.body,
    status: row.status,
    updatedAt: formatDateTime(row.updatedAt),
    approverName: row.approverName
  }));

  // Cấu hình gửi thư có thể đang tắt — nói ngay ở đây, chứ không để người ta
  // soạn và duyệt xong mới phát hiện không có gì đi được.
  const gate = evaluateEmailGate(process.env);

  return (
    <>
      <PageHeader
        title="Mail"
        description="Soạn nội dung thư gửi hàng loạt cho mentor và mentee, rồi tra lại mọi lá thư đã đi."
      />

      <MailTabs active="templates" canSeeLog={canViewOutboundEmails(adminUser.role)} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Đã duyệt"
          value={counts.approved}
          tone={counts.approved > 0 ? "success" : "default"}
          helper="Dùng được cho một lượt gửi"
        />
        <KpiCard
          label="Bản nháp"
          value={counts.draft}
          helper="Chờ quản trị viên duyệt"
        />
        <KpiCard label="Lưu trữ" value={counts.archived} helper="Đã cất đi" />
      </div>

      {!gate.canSend ? (
        <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Hệ thống đang không gửi thư được.</strong>{" "}
          {gate.reason} Mẫu thư vẫn soạn và duyệt được bình thường.
        </div>
      ) : null}

      {listing.error ? <ErrorBox message={listing.error} /> : null}

      <MailClient
        templates={templates}
        canApprove={canApproveEmailTemplate(adminUser.role)}
        seasonCode={season.code}
      />

      <div className="mt-6">
        {recipientCounts.error ? <ErrorBox message={recipientCounts.error} /> : null}
        <SendPanel
          canSend={maySend}
          templates={templates
            .filter((row) => row.status === "approved")
            .map((row) => ({ id: row.id, name: row.name, subject: row.subject }))}
          counts={recipientCounts.counts}
          eventOptions={recipientCounts.events}
          batches={batches.rows.map((row) => ({
            id: row.id,
            note: row.note,
            status: row.status,
            requestedCount: row.requestedCount,
            sentCount: row.sentCount,
            skippedCount: row.skippedCount,
            failedCount: row.failedCount,
            createdAt: formatDateTime(row.createdAt)
          }))}
        />
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Mẫu thư giữ ô điền chứ không giữ tên một người cụ thể. Giá trị thật được điền lúc gửi,
        nên nội dung ở đây soạn và chuyền tay đọc được mà không lộ dữ liệu của ai.
      </p>
    </>
  );
}
