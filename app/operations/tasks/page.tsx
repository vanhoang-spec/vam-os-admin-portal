import Link from "next/link";
import { Card, EmptyState, ErrorBox, FilterBar, KpiCard, PageHeader, SimpleTable } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canManageWorkflow } from "@/lib/auth-constants";
import { getOperationsWorkflowData } from "@/lib/data";
import type { WorkflowOwner, WorkflowQueueItem } from "@/lib/types";
import { displayText, formatDate } from "@/lib/utils";
import { TaskExportButton } from "./task-export-button";
import { AddCommentForm, CreateActionItemForm, GenerateFollowupForm, UpdateActionItemForm } from "./workflow-forms";

const DEFAULT_MONTH = "2026-04";

type TaskFilters = {
  status?: string;
  type?: string;
  priority?: string;
  owner?: string;
  overdue?: string;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanMonth(value: string | string[] | undefined) {
  const raw = single(value);
  const match = String(raw ?? "").trim().match(/^(\d{4}-(0[1-9]|1[0-2]))/);
  return match?.[1] ?? DEFAULT_MONTH;
}

function statusLabel(value: unknown) {
  const key = String(value ?? "");
  if (key === "open") return "Đang mở";
  if (key === "in_progress") return "Đang xử lý";
  if (key === "resolved") return "Đã xử lý";
  if (key === "dropped") return "Đã dừng tham gia";
  if (key === "no_response") return "Không phản hồi";
  if (key === "parked") return "Tạm để sau";
  return displayText(value);
}

function priorityLabel(value: unknown) {
  const key = String(value ?? "");
  if (key === "low") return "Thấp";
  if (key === "medium") return "Vừa";
  if (key === "high") return "Cao";
  if (key === "urgent") return "Khẩn cấp";
  return displayText(value);
}

function actionTypeLabel(value: unknown) {
  const key = String(value ?? "");
  if (key === "followup_no_recap") return "Cần follow-up";
  if (key === "data_issue") return "Lỗi dữ liệu";
  if (key === "correction_request") return "Yêu cầu chỉnh sửa";
  if (key === "event_attendance_issue") return "Lỗi điểm danh event";
  if (key === "manual_task") return "Việc thủ công";
  return displayText(value);
}

function isOverdue(row: WorkflowQueueItem) {
  if (!row.due_date || ["resolved", "dropped", "no_response"].includes(row.status)) return false;
  return row.due_date < new Date().toISOString().slice(0, 10);
}

function filterRows(rows: WorkflowQueueItem[], filters: TaskFilters) {
  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false;
    if (filters.type && row.action_type !== filters.type) return false;
    if (filters.priority && row.priority !== filters.priority) return false;
    if (filters.owner === "__unassigned" && row.owner_name) return false;
    if (filters.owner && filters.owner !== "__unassigned" && row.owner_name !== filters.owner) return false;
    if (filters.overdue === "true" && !isOverdue(row)) return false;
    return true;
  });
}

function uniqueOwnerNames(rows: WorkflowQueueItem[]) {
  return Array.from(new Set(rows.map((row) => String(row.owner_name ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"));
}

function taskCsvFilename(month: string) {
  return `vam-os-live-ops-tasks-${month}.csv`;
}

function ActiveFilters({ filters }: { filters: TaskFilters }) {
  const active = [
    filters.status ? `status=${filters.status}` : null,
    filters.type ? `type=${filters.type}` : null,
    filters.priority ? `priority=${filters.priority}` : null,
    filters.owner ? `owner=${filters.owner === "__unassigned" ? "unassigned" : filters.owner}` : null,
    filters.overdue === "true" ? "overdue=true" : null
  ].filter(Boolean);
  if (!active.length) return null;
  return <p className="mt-2 text-xs text-slate-500">Bộ lọc đang áp dụng: {active.join(" / ")}</p>;
}

function WorkflowFilters({ selectedMonth, filters, ownerNames }: { selectedMonth: string; filters: TaskFilters; ownerNames: string[] }) {
  const inputClass = "mt-1 w-full rounded-md border border-vam-line bg-white px-3 py-2 text-sm text-vam-ink outline-none focus:border-vam-green focus:ring-2 focus:ring-vam-mint";
  return (
    <form action="/operations/tasks">
      <FilterBar>
        <input type="hidden" name="month" value={selectedMonth} />
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Trạng thái</span>
          <select name="status" defaultValue={filters.status ?? ""} className={inputClass}>
            <option value="">Tất cả</option>
            <option value="open">Đang mở</option>
            <option value="in_progress">Đang xử lý</option>
            <option value="resolved">Đã xử lý</option>
            <option value="dropped">Đã dừng tham gia</option>
            <option value="no_response">Không phản hồi</option>
            <option value="parked">Tạm để sau</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Người phụ trách</span>
          <select name="owner" defaultValue={filters.owner ?? ""} className={inputClass}>
            <option value="">Tất cả</option>
            <option value="__unassigned">Chưa gán</option>
            {ownerNames.map((owner) => (
              <option key={owner} value={owner}>{owner}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Loại việc</span>
          <select name="type" defaultValue={filters.type ?? ""} className={inputClass}>
            <option value="">Tất cả</option>
            <option value="followup_no_recap">Cần follow-up</option>
            <option value="data_issue">Lỗi dữ liệu</option>
            <option value="correction_request">Yêu cầu chỉnh sửa</option>
            <option value="event_attendance_issue">Lỗi điểm danh event</option>
            <option value="manual_task">Việc thủ công</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-slate-500">Ưu tiên</span>
          <select name="priority" defaultValue={filters.priority ?? ""} className={inputClass}>
            <option value="">Tất cả</option>
            <option value="low">Thấp</option>
            <option value="medium">Vừa</option>
            <option value="high">Cao</option>
            <option value="urgent">Khẩn cấp</option>
          </select>
        </label>
        <label className="flex items-end gap-2 text-sm text-slate-600">
          <input type="checkbox" name="overdue" value="true" defaultChecked={filters.overdue === "true"} className="mb-3 h-4 w-4 rounded border-vam-line text-vam-green" />
          <span className="mb-2">Chỉ việc quá hạn</span>
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="rounded-md bg-vam-green px-3 py-2 text-sm font-medium text-white hover:bg-vam-green/90">
            Lọc
          </button>
          <Link href={`/operations/tasks?month=${encodeURIComponent(selectedMonth)}`} className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
            Xóa lọc
          </Link>
        </div>
      </FilterBar>
    </form>
  );
}

function WorkflowTable({
  rows,
  owners,
  canManage,
  includePeople = false
}: {
  rows: WorkflowQueueItem[];
  owners: WorkflowOwner[];
  canManage: boolean;
  includePeople?: boolean;
}) {
  if (!rows.length) return <EmptyState message="Không có công việc phù hợp với bộ lọc hiện tại. Nếu đang trực live ops, hãy xóa lọc hoặc kiểm tra lại tháng đang xem." />;
  return (
    <div className="grid gap-4">
      <SimpleTable
        rows={rows}
        columns={[
          {
            key: "title",
            label: "Công việc",
            render: (row) => (
              <div>
                <div className="font-medium text-vam-ink">{displayText(row.title)}</div>
                <div className="mt-1 text-xs text-slate-500">{actionTypeLabel(row.action_type)}</div>
                {includePeople ? <div className="mt-1 text-xs text-slate-500">Mentee: {displayText(row.mentee_name)} / Mentor: {displayText(row.mentor_name)}</div> : null}
              </div>
            )
          },
          { key: "status", label: "Trạng thái", render: (row) => statusLabel(row.status) },
          { key: "priority", label: "Mức độ ưu tiên", render: (row) => priorityLabel(row.priority) },
          { key: "owner", label: "Người phụ trách", render: (row) => displayText(row.owner_name) },
          { key: "due_date", label: "Hạn xử lý", render: (row) => (row.due_date ? formatDate(row.due_date) : "-") },
          { key: "updated_at", label: "Hoạt động gần nhất", render: (row) => formatDate(row.updated_at) }
        ]}
      />
      {canManage ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.slice(0, 8).map((row) => (
            <Card key={row.id}>
              <div className="mb-3">
                <div className="text-sm font-semibold text-vam-ink">{row.title}</div>
                <div className="mt-1 text-xs text-slate-500">{statusLabel(row.status)} / {priorityLabel(row.priority)}</div>
              </div>
              <div className="grid gap-3">
                <UpdateActionItemForm id={row.id} owners={owners} canManage={canManage} />
                <AddCommentForm id={row.id} canManage={canManage} />
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default async function OperationsTasksPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const selectedMonth = cleanMonth(searchParams?.month);
  const [workflow, adminUser] = await Promise.all([
    getOperationsWorkflowData("UEHM-S11", selectedMonth),
    getCurrentAdminUser()
  ]);
  const canManage = canManageWorkflow(adminUser);
  const filters = {
    status: single(searchParams?.status),
    type: single(searchParams?.type),
    priority: single(searchParams?.priority),
    owner: single(searchParams?.owner),
    overdue: single(searchParams?.overdue)
  };

  const data = workflow.data;
  const allQueue = [...(data?.followUpQueue ?? []), ...(data?.dataIssuesQueue ?? [])];
  const filteredFollowUps = filterRows(data?.followUpQueue ?? [], filters);
  const filteredIssues = filterRows(data?.dataIssuesQueue ?? [], filters);
  const filteredMine = filterRows(data?.myTasks ?? [], filters);
  const filteredAll = filterRows(allQueue, filters);
  const ownerNames = uniqueOwnerNames(allQueue);

  return (
    <>
      <PageHeader title="Công việc Operations" description="Theo dõi follow-up, lỗi dữ liệu, correction và việc vận hành hằng tháng." />
      {workflow.error ? <ErrorBox message={workflow.error} /> : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/operations" className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
          Quay lại dashboard
        </Link>
        <Link href={`/operations/tasks?month=${selectedMonth}&type=followup_no_recap`} className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
          Cần follow-up
        </Link>
        <Link href={`/operations/tasks?month=${selectedMonth}&type=data_issue`} className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
          Lỗi dữ liệu
        </Link>
        <Link href={`/operations/tasks?month=${selectedMonth}&overdue=true`} className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint">
          Quá hạn
        </Link>
        <TaskExportButton rows={filteredAll} filename={taskCsvFilename(selectedMonth)} />
      </div>
      <ActiveFilters filters={filters} />

      <WorkflowFilters selectedMonth={selectedMonth} filters={filters} ownerNames={ownerNames} />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Công việc đang mở" value={data?.summary.openActionCount ?? 0} />
        <KpiCard label="Quá hạn" value={data?.summary.overdueActionCount ?? 0} />
        <KpiCard label="Cần follow-up" value={data?.summary.followUpOpenCount ?? 0} />
        <KpiCard label="Lỗi dữ liệu" value={data?.summary.dataIssueOpenCount ?? 0} />
        <KpiCard label="Nhật ký chỉnh sửa tháng này" value={data?.summary.correctionsThisMonth ?? 0} />
      </div>

      <section className="mb-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Tạo follow-up tự động</h2>
          <p className="mb-3 text-sm text-slate-600">Dành cho Recap Steward: chỉ tạo danh sách follow-up sau khi đã đối chiếu recap tháng hiện tại. Follow-up là tín hiệu hỗ trợ nội bộ, không phải đánh giá tiêu cực.</p>
          {canManage ? <GenerateFollowupForm selectedMonth={selectedMonth} /> : <p className="text-sm text-slate-500">Viewer chỉ xem dữ liệu, không tạo công việc.</p>}
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-vam-ink">Tạo công việc thủ công</h2>
          <p className="mb-3 text-sm text-slate-600">Dành cho Ops Lead: dùng việc thủ công cho các xử lý pilot nằm ngoài recap tự động, ví dụ xác minh owner, hẹn follow-up, hoặc ghi nhận lỗi dữ liệu.</p>
          <CreateActionItemForm owners={data?.owners ?? []} canManage={canManage} />
          {!canManage ? <p className="text-sm text-slate-500">Bạn đang ở chế độ chỉ xem.</p> : null}
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Việc của tôi</h2>
        <WorkflowTable rows={filteredMine} owners={data?.owners ?? []} canManage={canManage} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Follow-up Queue</h2>
        <WorkflowTable rows={filteredFollowUps} owners={data?.owners ?? []} canManage={canManage} includePeople />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Data Issues Queue</h2>
        <WorkflowTable rows={filteredIssues} owners={data?.owners ?? []} canManage={canManage} />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Nhật ký chỉnh sửa</h2>
        <SimpleTable
          rows={data?.correctionLog ?? []}
          columns={[
            { key: "entity_type", label: "Đối tượng", render: (row) => displayText(row.entity_type) },
            { key: "correction_type", label: "Loại chỉnh sửa", render: (row) => displayText(row.correction_type) },
            { key: "reason", label: "Lý do", render: (row) => displayText(row.reason) },
            { key: "requested_by_name", label: "Người yêu cầu", render: (row) => displayText(row.requested_by_name) },
            { key: "status", label: "Trạng thái", render: (row) => displayText(row.status) },
            { key: "created_at", label: "Ngày tạo", render: (row) => formatDate(row.created_at) }
          ]}
        />
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-vam-ink">Tất cả công việc phù hợp bộ lọc</h2>
        <WorkflowTable rows={filteredAll} owners={data?.owners ?? []} canManage={canManage} includePeople />
      </section>
    </>
  );
}
