import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getExemptionBoard, type ExemptionListItem } from "@/lib/mentee-exemption";
import { CANDIDATE_SIGNAL_LABELS, EXEMPTION_STATE_LABELS } from "@/lib/mentee-exemption-core";
import { canManageMatches } from "@/lib/permissions";
import { applicationStatusLabel } from "@/lib/ui-labels";
import { formatDateTime } from "@/lib/utils";
import { CandidatePicker, ExemptionSendPanel, RevokeButton } from "./panels";

/**
 * /applications/mentee-dac-cach — Mentee đặc cách (Support team), BTC 11/10/2026.
 *
 * Các bạn Support team làm mentee mùa này mà không qua phỏng vấn. BTC chốt danh sách ở đây,
 * bấm gửi thư mời; người nhận mở link riêng và bấm "Xác nhận" là thành mentee của mùa.
 *
 * Trang có họ tên và email của từng người, và là nơi gửi thư ra ngoài: chỉ Core team trở
 * lên xem được (cùng nhóm với người quản lý ghép cặp). Thao tác còn cần quyền vận hành mùa;
 * thiếu quyền đó thì trang chỉ để xem.
 */
export const dynamic = "force-dynamic";

const TITLE = "Mentee đặc cách (Support team)";
const DESCRIPTION =
  "Các bạn Support team tham gia mùa này với vai trò mentee mà không qua phỏng vấn. Ban tổ chức chốt danh sách, gửi thư mời; người nhận bấm xác nhận trên đường dẫn riêng là xong.";

/** Một dòng chữ cho cột "Đơn mentee mùa này": người đọc cần biết bấm xác nhận sẽ làm gì. */
function applicationNote(status: string | null): string {
  if (!status) return "Chưa có đơn — khi xác nhận, hệ thống tạo một đơn đặc cách";
  if (status === "approved_as_mentee") return "Đã duyệt";
  return `${applicationStatusLabel(status)} — khi xác nhận, đơn được duyệt`;
}

function ExemptionTable({ items, canEdit }: { items: ExemptionListItem[]; canEdit: boolean }) {
  return (
    <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
      <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="exemption-list">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Họ tên</th>
            <th className="px-3 py-2">Email</th>
            <th className="px-3 py-2">Đơn mentee mùa này</th>
            <th className="px-3 py-2">Trạng thái</th>
            <th className="px-3 py-2">Thư gần nhất</th>
            <th className="px-3 py-2">Xác nhận lúc</th>
            <th className="px-3 py-2">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {items.map((item) => (
            <tr key={item.id} data-exemption={item.id} data-state={item.state}>
              <td className="px-3 py-2 font-medium text-vam-ink">
                <Link href={`/people/${item.personId}`} className="underline decoration-vam-line underline-offset-2 hover:text-vam-green">
                  {item.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-slate-600">{item.email ?? "—"}</td>
              <td className="px-3 py-2 text-slate-600">{applicationNote(item.applicationStatus)}</td>
              <td className={`px-3 py-2 ${item.state === "confirmed" ? "font-medium text-green-700" : item.state === "revoked" ? "text-slate-400" : "text-vam-ink"}`}>
                {EXEMPTION_STATE_LABELS[item.state]}
              </td>
              <td className="px-3 py-2 text-slate-600">
                {item.lastSentAt ? `${formatDateTime(item.lastSentAt)} (đã gửi ${item.sendCount} lần)` : "—"}
                {item.lastError ? <div className="text-xs text-red-600">Lần gửi gần nhất lỗi: {item.lastError}</div> : null}
              </td>
              <td className="px-3 py-2 text-slate-600">{item.confirmedAt ? formatDateTime(item.confirmedAt) : "—"}</td>
              <td className="px-3 py-2">
                {canEdit && (item.state === "sent" || item.state === "not_sent") ? <RevokeButton exemptionId={item.id} name={item.name} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function MenteeExemptionPage() {
  const admin = await getCurrentAdminUser();
  if (!admin) redirect("/login");
  if (!canManageMatches(admin.role)) {
    return (
      <div className="grid gap-4">
        <PageHeader title={TITLE} />
        <Card>
          <EmptyState message="Trang này dành cho ban tổ chức (Core team trở lên)." />
        </Card>
      </div>
    );
  }

  const result = await getExemptionBoard();
  if (!result.ok) {
    return (
      <div className="grid gap-4">
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <ErrorBox message={result.message} />
      </div>
    );
  }
  const { data } = result;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader title={TITLE} description={DESCRIPTION} />

      {data.canEdit ? null : (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="exemption-readonly">
          Tài khoản của bạn chưa có quyền vận hành mùa {data.seasonCode}, nên trang này chỉ để xem.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="exemption-kpis">
        <KpiCard label="Trong danh sách" value={data.counts.listed} />
        <KpiCard label="Đã xác nhận" value={data.counts.confirmed} tone="success" />
        <KpiCard label="Đã gửi thư, chờ xác nhận" value={data.counts.waiting} />
        <KpiCard label="Chưa gửi thư" value={data.counts.notSent} />
      </div>

      <Card>
        <h2 className="text-base font-semibold text-vam-ink">Danh sách đặc cách</h2>
        <p className="mt-1 text-sm text-slate-500">
          Người đã xác nhận là mentee của mùa: có đơn ở trạng thái đã duyệt và có tư cách mentee đang hoạt động, nên được tính ở Vòng 2 như mọi mentee
          khác. Người chưa có đơn sẽ vào Vòng 2 ở mục “Chưa phân nhóm” cho tới khi ban tổ chức gán nhóm ngành.
        </p>
        <div className="mt-3">
          {data.items.length ? (
            <ExemptionTable items={data.items} canEdit={data.canEdit} />
          ) : (
            <EmptyState message="Danh sách đang trống. Chọn người ở mục gợi ý bên dưới để thêm." />
          )}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-vam-ink">Gợi ý thêm vào danh sách</h2>
        <p className="mt-1 text-sm text-slate-500">
          Hệ thống gom những người có dấu hiệu đang được đặc cách: có tài khoản vai trò Support team, được gắn tay tư cách mentee mùa này mà chưa có đơn,
          hoặc có đơn mentee được duyệt tay không qua phỏng vấn. Đây chỉ là gợi ý — ban tổ chức tick đúng những bạn thuộc Support team. Ai chưa hiện ở
          đây thì gắn tư cách mentee mùa này ở trang hồ sơ của bạn đó trước.
        </p>
        <div className="mt-3">
          {!data.candidates.length ? (
            <EmptyState message="Không còn ai để gợi ý." />
          ) : data.canEdit ? (
            <CandidatePicker
              candidates={data.candidates.map((c) => ({
                personId: c.personId,
                name: c.name,
                email: c.email,
                signals: c.signals.map((signal) => CANDIDATE_SIGNAL_LABELS[signal]),
                application: applicationNote(c.applicationStatus)
              }))}
            />
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700" data-testid="exemption-candidates-readonly">
              {data.candidates.map((c) => (
                <li key={c.personId}>
                  {c.name} — {c.signals.map((signal) => CANDIDATE_SIGNAL_LABELS[signal]).join("; ")}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {data.canEdit ? (
        <Card>
          <h2 className="text-base font-semibold text-vam-ink">Gửi thư mời xác nhận</h2>
          <p className="mt-1 text-sm text-slate-500">
            Thư đi tới mọi người trong danh sách chưa xác nhận. Bấm gửi lại sau 20 giờ là nhắc những người chưa xác nhận; người đã xác nhận không nhận
            thêm thư. Sửa câu chữ ở Vận hành → Mail → Thư tự động.
          </p>
          <div className="mt-3">
            <ExemptionSendPanel pending={data.pending} sentInWindow={data.sentInWindow} allowance={data.allowance} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
