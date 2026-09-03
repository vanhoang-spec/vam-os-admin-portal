import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getApplications, getIntakeBatches } from "@/lib/data";
import { canDecide } from "@/lib/permissions";
import { getAdminScopeContext, getScopeFilter } from "@/lib/program-scope";
import { Card, ErrorBox, PageHeader } from "@/components/ui";
import { MAX_BULK_APPROVAL_IDS } from "@/lib/bulk-official-approval-types";
import { BulkApprovalForm } from "./bulk-approval-form";

/**
 * The only status the individual official-approval path (and the shared
 * eligibility gate vam084_application_decision_eligibility) accepts for
 * approved_as_mentor/approved_as_mentee. Default-filtering the candidate
 * list to this keeps the operator looking at applications that can actually
 * be approved, without weakening the server-side gate — every row is still
 * re-checked at execution time regardless of what's shown here.
 */
const OFFICIAL_APPROVAL_READY_STATUS = "interview_passed";

export default async function BulkApprovalPage(props: {
  searchParams: Promise<{ intake_batch_id?: string; role_applied?: string; include_renewals?: string }>;
}) {
  const searchParams = await props.searchParams;
  const actor = await getCurrentAdminUser();
  if (!actor?.id) redirect("/login");
  if (!canDecide(actor.role)) redirect("/applications");

  const scope = await getScopeFilter(await getAdminScopeContext());
  const [result, batches] = await Promise.all([getApplications(scope), getIntakeBatches(scope)]);

  const intakeBatchId = searchParams.intake_batch_id?.trim() ?? "";
  const roleApplied = searchParams.role_applied?.trim() ?? "";
  const includeRenewals = searchParams.include_renewals === "1";

  const candidates = result.data.filter(
    (app) =>
      app.status === OFFICIAL_APPROVAL_READY_STATUS &&
      (app.role_applied === "mentor" || app.role_applied === "mentee") &&
      (!intakeBatchId || app.intake_batch_id === intakeBatchId) &&
      (!roleApplied || app.role_applied === roleApplied) &&
      (includeRenewals || app.source !== "s12_mentor_renewal")
  );

  const rows = candidates.slice(0, 500).map((app) => ({
    id: app.id,
    fullName: String(app.full_name ?? app.email_primary ?? app.id),
    email: app.email_primary ?? "",
    role: String(app.role_applied ?? "-") as "mentor" | "mentee",
    status: String(app.status ?? ""),
    isRenewal: app.source === "s12_mentor_renewal"
  }));

  return (
    <>
      <PageHeader
        title="Duyệt Chính Thức Hàng Loạt"
        description="Duyệt hàng loạt ứng viên đủ điều kiện thành mentor/mentee chính thức — tạo/liên kết hồ sơ người và profile qua một RPC đáng tin cậy riêng, có kiểm tra atomic từng dòng."
      />
      {/* Slice 2A deliberately hid the "Bulk Final Decision" entry point
          (/applications/bulk-decision) pending its own Owner mutation UAT. The
          historical M092 page linked to it from here; that link is NOT ported,
          so this page cannot become a back door to it. */}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/applications" className="text-vam-green hover:underline">
          ← Quay lại danh sách
        </Link>
      </div>
      <ErrorBox message={result.error || batches.error} />
      <Card className="mb-4">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Đợt tuyển
            <select
              name="intake_batch_id"
              defaultValue={intakeBatchId}
              className="mt-1 block rounded-md border border-vam-line px-3 py-2"
            >
              <option value="">Tất cả</option>
              {batches.data.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name ?? batch.code ?? batch.id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Vai trò
            <select
              name="role_applied"
              defaultValue={roleApplied}
              className="mt-1 block rounded-md border border-vam-line px-3 py-2"
            >
              <option value="">Mentor + Mentee</option>
              <option value="mentor">Mentor</option>
              <option value="mentee">Mentee</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="include_renewals" value="1" defaultChecked={includeRenewals} />
            Hiện cả đơn gia hạn (sẽ luôn bị bỏ qua — cần duyệt qua luồng gia hạn riêng)
          </label>
          <button className="rounded-md border border-vam-line px-4 py-2 text-sm">Lọc</button>
        </form>
      </Card>
      <p className="mb-3 text-xs text-slate-500">
        Chỉ hiển thị đơn ở trạng thái <code>{OFFICIAL_APPROVAL_READY_STATUS}</code> (đã qua vòng phỏng vấn — điều kiện
        vòng đời để duyệt chính thức). Danh sách này chỉ để chọn nhanh; mỗi đơn vẫn được kiểm tra lại đầy đủ tại
        database khi thực thi.
      </p>
      {candidates.length > 500 && (
        <p className="mb-3 text-sm text-amber-700">
          Có {candidates.length} đơn phù hợp; thu hẹp bộ lọc để danh sách ngắn hơn ({MAX_BULK_APPROVAL_IDS} đơn mỗi
          lượt duyệt).
        </p>
      )}
      <Card>
        <BulkApprovalForm rows={rows} />
      </Card>
    </>
  );
}
