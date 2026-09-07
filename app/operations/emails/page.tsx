import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Card,
  ErrorBox,
  FilterBar,
  InternalLinkButton,
  KpiCard,
  PageHeader,
  SimpleTable
} from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { countConfirmationBackfillCandidates } from "@/lib/confirmation-backfill";
import { evaluateEmailGate } from "@/lib/email-core";
import {
  MAIN_OUTBOUND_EMAIL_KINDS,
  OUTBOUND_EMAIL_STATUSES,
  outboundEmailKindLabel,
  outboundEmailStatusLabel,
  outboundEmailQueryString,
  parseOutboundEmailFilters
} from "@/lib/outbound-emails-core";
import {
  listOutboundEmails,
  countOutboundEmailsByStatus,
  OUTBOUND_EMAIL_PAGE_SIZE,
  type OutboundEmailRow
} from "@/lib/outbound-emails";
import { canRunConfirmationBackfill, canViewOutboundEmails } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { displayText, formatDateTime } from "@/lib/utils";
import { BackfillPanel } from "./backfill-panel";

export const dynamic = "force-dynamic";

/** Lượt gửi bù gọi nhà cung cấp email tuần tự; trần mặc định của Vercel quá ngắn. */
export const maxDuration = 60;

export const metadata = {
  title: "Email đã gửi — VAM OS"
};

export default async function OutboundEmailsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;

  // Cổng vai trò trước mọi lần đọc dữ liệu, và trước cả kiểm phạm vi — phạm vi
  // là câu hỏi khác, và nó đúng với cả những mức quyền không nên vào đây.
  const adminUser = await getCurrentAdminUser();
  if (!adminUser) redirect("/login");
  if (!canViewOutboundEmails(adminUser.role)) {
    return (
      <PageHeader
        title="Không có quyền truy cập"
        description="Bạn không có quyền xem sổ thư đã gửi."
      />
    );
  }

  const scopeContext = await getAdminScopeContext();
  if (scopeContext.scopeError) {
    return (
      <>
        <PageHeader title="Email đã gửi" description="Không tải được sổ thư." />
        <ErrorBox message={scopeContext.scopeError} />
      </>
    );
  }

  const filters = parseOutboundEmailFilters(searchParams);
  const [counts, listing, candidates] = await Promise.all([
    countOutboundEmailsByStatus(),
    listOutboundEmails(filters),
    countConfirmationBackfillCandidates()
  ]);

  const gate = evaluateEmailGate(process.env);
  const canRun =
    canRunConfirmationBackfill(adminUser.role) &&
    candidates.ok &&
    (await canOperateSeason(scopeContext, candidates.seasonId));

  const totalPages = Math.max(1, Math.ceil(listing.count / OUTBOUND_EMAIL_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Email đã gửi"
        description="Mỗi lần hệ thống thử gửi một lá thư đều để lại đúng một dòng ở đây — kể cả những lần bị cấu hình chặn."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Đã gửi" value={counts.sent} tone="success" />
        <KpiCard label="Lỗi" value={counts.failed} tone={counts.failed > 0 ? "danger" : "default"} />
        <KpiCard
          label="Bỏ qua"
          value={counts.skipped}
          tone={counts.skipped > 0 ? "warning" : "default"}
          helper="Cấu hình chặn, không phải lỗi"
        />
        <KpiCard
          label="Đang chờ"
          value={counts.queued}
          helper="Chỗ đã đặt nhưng chưa chốt kết quả"
        />
      </div>

      <div className="mb-6">
        {candidates.ok ? (
          <BackfillPanel
            pending={candidates.pending}
            pendingCapped={candidates.pendingCapped}
            byRole={candidates.byRole}
            canRun={canRun}
            gate={{ canSend: gate.canSend, reason: gate.canSend ? null : gate.reason }}
          />
        ) : (
          <ErrorBox message={candidates.error} />
        )}
      </div>

      <Card className="mb-4">
        <form method="get">
          <FilterBar>
            <select
              name="status"
              defaultValue={filters.status ?? ""}
              className="h-10 rounded-md border border-vam-line bg-white px-3 text-sm"
              aria-label="Lọc theo trạng thái"
            >
              <option value="">Mọi trạng thái</option>
              {OUTBOUND_EMAIL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {outboundEmailStatusLabel(status)}
                </option>
              ))}
            </select>

            <select
              name="kind"
              defaultValue={filters.kind ?? ""}
              className="h-10 rounded-md border border-vam-line bg-white px-3 text-sm"
              aria-label="Lọc theo loại thư"
            >
              <option value="">Mọi loại thư</option>
              {MAIN_OUTBOUND_EMAIL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {outboundEmailKindLabel(kind)}
                </option>
              ))}
            </select>

            <input
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Tìm theo email người nhận"
              className="h-10 min-w-56 flex-1 rounded-md border border-vam-line bg-white px-3 text-sm"
              aria-label="Tìm theo email người nhận"
            />

            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-md bg-vam-green px-4 text-sm font-medium text-white hover:bg-vam-green/90"
            >
              Lọc
            </button>
            <Link
              href="/operations/emails"
              className="inline-flex h-10 items-center rounded-md border border-vam-line px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              Xóa lọc
            </Link>
          </FilterBar>
        </form>
      </Card>

      {listing.error ? <ErrorBox message={listing.error} /> : null}

      <SimpleTable<OutboundEmailRow>
        rows={listing.rows}
        columns={[
          {
            key: "createdAt",
            label: "Thời điểm",
            render: (row) => formatDateTime(row.createdAt)
          },
          {
            key: "kind",
            label: "Loại thư",
            render: (row) => outboundEmailKindLabel(row.kind)
          },
          { key: "toEmail", label: "Người nhận" },
          {
            key: "status",
            label: "Trạng thái",
            render: (row) => outboundEmailStatusLabel(row.status)
          },
          {
            key: "providerMessageId",
            label: "Provider · Message-ID",
            render: (row) => (
              <span title={row.providerMessageId ?? undefined}>
                {row.provider}
                {row.providerMessageId ? ` · ${row.providerMessageId}` : ""}
              </span>
            )
          },
          {
            key: "error",
            label: "Ghi chú lỗi",
            render: (row) => <span title={row.error ?? undefined}>{displayText(row.error)}</span>
          },
          {
            key: "relatedId",
            label: "Đơn",
            render: (row) =>
              row.relatedTable === "applications" && row.relatedId ? (
                <InternalLinkButton href={`/applications/${row.relatedId}`} label="Mở đơn" />
              ) : (
                "-"
              )
          }
        ]}
      />

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Phân trang">
          {filters.page > 1 ? (
            <Link
              className="text-vam-green hover:underline"
              href={`/operations/emails${outboundEmailQueryString(filters, filters.page - 1)}`}
            >
              ← Trang trước
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">
            Trang {filters.page}/{totalPages} · {listing.count} dòng
          </span>
          {filters.page < totalPages ? (
            <Link
              className="text-vam-green hover:underline"
              href={`/operations/emails${outboundEmailQueryString(filters, filters.page + 1)}`}
            >
              Trang sau →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  );
}
