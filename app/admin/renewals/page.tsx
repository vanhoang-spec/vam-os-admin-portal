import { ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { loadRenewalConsoleData, loadRenewalSeasonContext } from "@/lib/renewal-console";
import { canAccessAdminUser } from "@/lib/permissions";
import { canOperateSeason, getAdminScopeContext } from "@/lib/program-scope";
import { displayText, formatDate } from "@/lib/utils";
import type { RenewalConsoleRow } from "@/lib/renewal-console";
import { CreateRenewalInviteForm, RenewalInviteActions as RenewalInviteControls } from "./renewal-controls";
import { BatchRenewalInviteForm } from "./mentor-batch-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATE_LABEL = {
  live: "Đang hiệu lực",
  expired: "Hết hạn",
  revoked: "Đã thu hồi",
  accepted: "Đồng ý",
  declined: "Từ chối"
} as const;

const FIELD_LABEL: Record<string, string> = {
  company_current: "Công ty hiện tại",
  title_current: "Chức danh hiện tại",
  function_area: "Lĩnh vực chuyên môn",
  industry: "Ngành",
  years_experience_min: "Số năm kinh nghiệm",
  years_experience_text: "Nhóm kinh nghiệm",
  capacity_target: "Số mentee có thể đồng hành"
};

export default async function AdminRenewalsPage() {
  const context = await getAdminScopeContext();
  const admin = context.adminUser ?? (await getCurrentAdminUser());
  if (!admin || !canAccessAdminUser(admin.role)) {
    return <><PageHeader title="Gia hạn mentor S12" /><ErrorBox message="Bạn không có quyền truy cập trang này." /></>;
  }
  if (context.scopeError) {
    return <><PageHeader title="Gia hạn mentor S12" /><ErrorBox message={context.scopeError} /></>;
  }

  // Resolve only the non-sensitive season key before authorization. The
  // people/profile/invite inventory is not read until operations scope passes.
  const season = await loadRenewalSeasonContext();
  if (!season) return <><PageHeader title="Gia hạn mentor S12" /><ErrorBox message="Không tìm thấy Season 12 canonical." /></>;
  const canOperate = await canOperateSeason(context, season.id);
  if (!canOperate) {
    return <><PageHeader title="Gia hạn mentor S12" /><ErrorBox message="Bạn cần quyền operations cho UEHM-S12 để sử dụng console gia hạn." /></>;
  }
  const data = await loadRenewalConsoleData(season);
  if (!data.season) return <><PageHeader title="Gia hạn mentor S12" /><ErrorBox message={data.error} /></>;

  const attention = data.invites.filter((row) => row.needsAttention);
  const pending = data.invites.filter((row) => row.inviteState === "accepted" && !String(row.applicationStatus ?? "").startsWith("approved_as_"));

  return (
    <div className="grid gap-6">
      <PageHeader title="Gia hạn mentor — Season 12" description="Tạo link cá nhân, theo dõi phản hồi, đối chiếu thay đổi hồ sơ và hoàn tất lifecycle." />
      <ErrorBox message={data.error} />

      {attention.length ? (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-red-900">
          <h2 className="font-semibold">Cần operator xử lý membership ({attention.length})</h2>
          <p className="mt-1 text-sm">Có phản hồi từ chối nhưng membership chưa được reconciliation tự động. Không chạy mutation thay thế từ console này.</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Tổng invite" value={data.invites.length} />
        <KpiCard label="Chờ admin xác nhận" value={pending.length} tone={pending.length ? "warning" : "default"} />
        <KpiCard label="Cần operator xử lý" value={attention.length} tone={attention.length ? "danger" : "default"} />
      </div>

      <BatchRenewalInviteForm mentors={data.mentors} programId={data.season.programId} seasonId={data.season.id} />

      <CreateRenewalInviteForm mentors={data.mentors} programId={data.season.programId} seasonId={data.season.id} />

      <section className="grid gap-4">
        <h2 className="text-lg font-semibold text-vam-ink">Danh sách invite</h2>
        {!data.invites.length ? <p className="rounded-lg border border-dashed border-vam-line bg-white p-6 text-center text-sm text-slate-500">Chưa có invite gia hạn S12.</p> : null}
        {data.invites.map((row) => (
          <article key={row.id} className={`rounded-lg border bg-white p-5 shadow-soft ${row.needsAttention ? "border-red-300" : "border-vam-line"}`}>
            <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-vam-ink">{row.personName}</h3>
                  <span className="rounded-full border border-vam-line bg-slate-50 px-2.5 py-0.5 text-xs font-medium">{STATE_LABEL[row.inviteState]}</span>
                  {row.needsAttention ? <span className="rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800">Cần xử lý</span> : null}
                </div>
                <div className="mt-2 grid gap-1 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-4">
                  <div>Email: {displayText(row.personEmail)}</div>
                  <div>Season: {row.seasonCode}</div>
                  <div>Tạo: {formatDate(row.createdAt)}</div>
                  <div>Hết hạn: {formatDate(row.expiresAt)}</div>
                  <div>Application: {row.applicationId ? row.applicationId.slice(0, 8) : "—"}</div>
                  <div>Trạng thái đơn: {displayText(row.applicationStatus)}</div>
                  <div>Kết quả: {displayText(row.renewalOutcome)}</div>
                  <div>Membership: {displayText(row.membershipStatus, "Không có")}</div>
                </div>
                {row.attentionReason ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{row.attentionReason}</p> : null}
              </div>
              <RenewalInviteControls row={row} />
            </div>

            {row.inviteState === "accepted" ? (
              <div className="mt-5">
                <h4 className="text-sm font-semibold text-vam-ink">Thay đổi hồ sơ chờ xác nhận</h4>
                
                {row.commitmentsCompleted === true ? (
                  <p className="mt-2 text-sm text-green-700 font-medium">Cam kết Mentor: Đã xác nhận đầy đủ</p>
                ) : row.commitmentsCompleted === false ? (
                  <p className="mt-2 text-sm text-red-700 font-medium">Cam kết Mentor: Chưa xác nhận đủ hoặc lỗi dữ liệu</p>
                ) : null}

                {row.coreTeamNote ? (
                  <div className="mt-2 rounded-md bg-slate-50 p-3">
                    <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Ý kiến / Lưu ý cho Core Team</span>
                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{row.coreTeamNote}</p>
                  </div>
                ) : null}

                {!row.diff.length ? <p className="mt-2 text-sm text-slate-500">Mentor không đề xuất thay đổi trường hồ sơ canonical nào.</p> : (
                  <div className="mt-2 overflow-x-auto rounded-md border border-vam-line">
                    <table className="min-w-full divide-y divide-vam-line text-sm">
                      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Current</th><th className="px-3 py-2">Proposed</th></tr></thead>
                      <tbody className="divide-y divide-vam-line">
                        {row.diff.map((entry) => <tr key={entry.field}><td className="px-3 py-2 font-medium">{FIELD_LABEL[entry.field] ?? entry.field}</td><td className="px-3 py-2 text-slate-600">{displayText(entry.before)}</td><td className="px-3 py-2 text-vam-ink">{displayText(entry.after)}</td></tr>)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : row.inviteState === "declined" ? (
              <div className="mt-5">
                <div className="rounded-md bg-red-50 p-3 border border-red-100">
                  <span className="block text-xs font-semibold text-red-800 uppercase tracking-wider mb-1">Ý kiến / Góp ý / Lý do chưa thể tiếp tục</span>
                  <p className="text-sm text-red-900 whitespace-pre-wrap">{row.declineFeedback || "—"}</p>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </section>
    </div>
  );
}
