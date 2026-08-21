import Link from "next/link";
import { Card, EmptyState, ErrorBox, ExternalLinkButton, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageWorkflow } from "@/lib/auth-constants";
import { getAdminCorrectionData, type AdminActionItem, type AdminDataIssue } from "@/lib/admin-corrections";
import { canManageUsers } from "@/lib/permissions";
import { displayText, formatDate } from "@/lib/utils";
import { SEASON_CONFIG } from "@/lib/season-config";
import { ActionItemUpdateForm, CreateIssueActionForm, EditRecapInlineForm, QuickResolveForm } from "./admin-correction-forms";

export const dynamic = "force-dynamic";

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function activeTab(value: string | string[] | undefined) {
  const tab = single(value);
  return tab === "follow-up" ? "follow-up" : "data-issues";
}

function statusLabel(value: unknown) {
  const key = String(value ?? "");
  if (key === "open") return "Đang mở";
  if (key === "in_progress") return "Đang xử lý";
  if (key === "resolved") return "Đã xử lý";
  if (key === "dropped") return "Đã dừng";
  if (key === "no_response") return "Không phản hồi";
  return displayText(value);
}

function typeLabel(value: unknown) {
  const key = String(value ?? "");
  if (key === "followup_no_recap") return "Cần hỗ trợ follow-up";
  if (key === "unmatched_recap") return "Recap chưa khớp match";
  if (key === "missing_mentee") return "Thiếu mentee";
  if (key === "missing_mentor") return "Thiếu mentor";
  if (key === "invalid_date") return "Ngày không hợp lệ";
  if (key === "duplicate_recap") return "Recap trùng lặp";
  if (key === "data_issue") return "Vấn đề dữ liệu";
  return displayText(value);
}

function tabClass(selected: boolean) {
  return selected
    ? "rounded-md border border-vam-green bg-vam-mint px-3 py-2 text-sm font-medium text-vam-green"
    : "rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50";
}

function IssueActionPanel({ issue }: { issue: AdminDataIssue }) {
  if (issue.actionItem) {
    return (
      <div className="grid gap-3">
        <div className="rounded-md border border-vam-line bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Việc: {statusLabel(issue.actionItem.status)} / Phụ trách: {displayText(issue.actionItem.owner_email)}
        </div>
        <QuickResolveForm id={issue.actionItem.id} />
      </div>
    );
  }

  return (
    <CreateIssueActionForm
      type={issue.type}
      targetPersonId={issue.target_person_id}
      seasonCode={issue.season_code}
      issueKey={issue.key}
      defaultNotes={`${issue.label}: ${issue.details} Recap ${issue.recap_id}`}
    />
  );
}

function DataIssuesTab({ issues }: { issues: AdminDataIssue[] }) {
  const openIssues = issues.filter((issue) => !issue.actionItem || !["resolved", "dropped"].includes(issue.actionItem.status));
  const byType = new Map<string, number>();
  for (const issue of openIssues) byType.set(issue.type, (byType.get(issue.type) ?? 0) + 1);
  const topIssues = openIssues.slice(0, 30);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Recap chưa khớp match" value={byType.get("unmatched_recap") ?? 0} />
        <KpiCard label="Thiếu mentee" value={byType.get("missing_mentee") ?? 0} />
        <KpiCard label="Thiếu mentor" value={byType.get("missing_mentor") ?? 0} />
        <KpiCard label="Ngày không hợp lệ" value={byType.get("invalid_date") ?? 0} />
        <KpiCard label="Recap trùng lặp" value={byType.get("duplicate_recap") ?? 0} />
      </div>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Thêm recap manual</h2>
        <p className="mb-3 text-sm text-slate-600">
          Chức năng tạo recap thủ công đã được hợp nhất tại trang <strong>/recaps/create</strong> (giao diện tìm kiếm mentor/mentee và auto-detect match_id).
        </p>
        <Link
          href="/recaps/create"
          className="inline-flex w-fit rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white hover:bg-vam-green/90"
        >
          Mở trang Tạo mentoring recap
        </Link>
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Danh sách dữ liệu cần kiểm tra</h2>
        {!topIssues.length ? <EmptyState message="Không có data issue mở theo rule hiện tại." /> : null}
        <div className="grid gap-4">
          {topIssues.map((issue) => (
            <Card key={issue.key}>
              <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-1 text-xs font-medium text-vam-ink">{typeLabel(issue.type)}</span>
                    <span className={issue.severity === "high" ? "rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700" : "rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"}>
                      {issue.severity}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold text-vam-ink">{issue.label}</h3>
                  <p className="mt-1 text-sm text-slate-600">{issue.details}</p>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                    <div><span className="font-medium text-vam-ink">Season:</span> {issue.season_code}</div>
                    <div><span className="font-medium text-vam-ink">Date:</span> {formatDate(issue.meeting_date)}</div>
                    <div><span className="font-medium text-vam-ink">Mentee:</span> {displayText(issue.mentee_name)}</div>
                    <div><span className="font-medium text-vam-ink">Mentor:</span> {displayText(issue.mentor_name)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/recaps/${issue.recap_id}/edit`} className="rounded-md border border-vam-line px-2.5 py-1 text-xs font-medium text-vam-green hover:bg-vam-mint">
                      Mở correction cũ
                    </Link>
                    <ExternalLinkButton href={issue.recap_url} label="Mở recap" />
                  </div>
                </div>
                <IssueActionPanel issue={issue} />
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function FollowUpTab({ items }: { items: AdminActionItem[] }) {
  const openItems = items.filter((item) => item.status !== "resolved" && item.status !== "dropped");
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Chưa xử lý" value={items.filter((item) => item.status === "open").length} />
        <KpiCard label="Đang xử lý" value={items.filter((item) => item.status === "in_progress").length} />
        <KpiCard label="Chưa nhận phản hồi" value={items.filter((item) => item.status === "no_response").length} />
        <KpiCard label="Đã hoàn tất" value={items.filter((item) => item.status === "resolved").length} />
        <KpiCard label="Đang cần xử lý" value={openItems.length} />
      </div>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-vam-ink">Tạo follow-up thủ công</h2>
        <CreateIssueActionForm type="followup_no_recap" seasonCode={SEASON_CONFIG.CURRENT_OPERATING_SEASON_CODE} defaultNotes="Manual follow-up from /admin" />
      </Card>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Danh sách cần hỗ trợ</h2>
        {!items.length ? <EmptyState message="Chưa có action item follow-up." /> : null}
        <div className="grid gap-4">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-vam-line bg-slate-50 px-2 py-1 text-xs font-medium text-vam-ink">{typeLabel(item.type)}</span>
                    <span className="rounded-md border border-vam-line bg-white px-2 py-1 text-xs font-medium text-slate-600">{statusLabel(item.status)}</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                    <div><span className="font-medium text-vam-ink">Season:</span> {displayText(item.season_code)}</div>
                    <div><span className="font-medium text-vam-ink">Phụ trách:</span> {displayText(item.owner_email)}</div>
                    <div><span className="font-medium text-vam-ink">Ngày tạo:</span> {formatDate(item.created_at)}</div>
                    <div><span className="font-medium text-vam-ink">Cập nhật:</span> {formatDate(item.updated_at)}</div>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap rounded-md border border-vam-line bg-slate-50 p-3 text-xs text-slate-700">{displayText(item.notes, "Chưa có ghi chú")}</pre>
                </div>
                <ActionItemUpdateForm id={item.id} ownerEmail={item.owner_email} status={item.status} />
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function RecentRecapCorrection({ recaps }: { recaps: Array<any> }) {
  const rows = recaps
    .filter((recap) => recap.status !== "deleted" && recap.status !== "excluded")
    .sort((a, b) => String(b.meeting_date ?? "").localeCompare(String(a.meeting_date ?? "")))
    .slice(0, 10);
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-lg font-semibold text-vam-ink">Edit / soft delete recap gần đây</h2>
      {!rows.length ? <EmptyState message="Chưa có recap để chỉnh sửa." /> : null}
      <div className="grid gap-4">
        {rows.map((recap) => (
          <details key={recap.id} className="rounded-lg border border-vam-line bg-white p-4 shadow-soft">
            <summary className="cursor-pointer text-sm font-semibold text-vam-ink">
              {formatDate(recap.meeting_date)} / {displayText(recap.status)} / {recap.id}
            </summary>
            <div className="mt-4">
              <EditRecapInlineForm recap={recap} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default async function AdminCorrectionPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;

  const adminUser = await getCurrentAdminUser();
  const canManage = canManageWorkflow(adminUser);
  const canManageUserAccounts = canManageUsers(adminUser?.role);
  const tab = activeTab(searchParams?.tab);

  if (!canManage) {
    return (
      <>
        <PageHeader title="Quy trình điều chỉnh dữ liệu" description="Giải quyết vấn đề dữ liệu, phân công, và chỉnh sửa recap." />
        <ErrorBox message="Bạn cần quyền admin hoặc super_admin để dùng trang này." />
      </>
    );
  }

  const data = await getAdminCorrectionData();
  const followups = data.actionItems.filter((item) => item.type === "followup_no_recap");

  return (
    <>
      <PageHeader title="Quy trình điều chỉnh dữ liệu" description="Rà soát dữ liệu và hỗ trợ follow-up cho core team, không cần sửa CSV/DB thủ công." />
      {data.error ? <ErrorBox message={data.error} /> : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <Link href="/admin?tab=data-issues" className={tabClass(tab === "data-issues")}>Rà soát dữ liệu</Link>
        <Link href="/admin?tab=follow-up" className={tabClass(tab === "follow-up")}>Hỗ trợ follow-up</Link>
        {canManageUserAccounts ? (
          <Link href="/admin/users" className="rounded-md border border-vam-line bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Tài khoản</Link>
        ) : null}
      </div>

      {tab === "data-issues" ? <DataIssuesTab issues={data.issues} /> : <FollowUpTab items={followups} />}

      {tab === "data-issues" ? <RecentRecapCorrection recaps={data.recaps} /> : null}

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Lịch sử việc cần xử lý</h2>
        <SimpleTable
          rows={data.actionItems.slice(0, 20)}
          columns={[
            { key: "updated_at", label: "Cập nhật", render: (row) => formatDate(row.updated_at) },
            { key: "type", label: "Loại việc", render: (row) => typeLabel(row.type) },
            { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) },
            { key: "owner_email", label: "Phụ trách", render: (row) => displayText(row.owner_email) },
            { key: "season_code", label: "Season", render: (row) => displayText(row.season_code) },
            { key: "notes", label: "Ghi chú", render: (row) => displayText(row.notes) }
          ]}
        />
      </section>
    </>
  );
}
