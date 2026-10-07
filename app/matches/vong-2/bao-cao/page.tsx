import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { TableSearch } from "@/components/table-search";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getRound2Data } from "@/lib/matching-round2";
import type { GroupSummary, Round2Row } from "@/lib/matching-round2-core";
import { industryGroupLabel } from "@/lib/matching-round2-groups-core";
import { canAssignReview, canBrowseOperations } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const COLUMN = "grid grid-cols-[minmax(0,1fr)] gap-4";

function detail(row: Round2Row, label: string): string {
  return row.person.details.find(([l]) => l === label)?.[1] ?? "—";
}

function byGroupThenName(a: Round2Row, b: Round2Row) {
  const g = (a.group ?? 99) - (b.group ?? 99);
  return g !== 0 ? g : a.person.name.localeCompare(b.person.name, "vi");
}

function GroupTable({ groups, unclassified }: { groups: GroupSummary[]; unclassified: GroupSummary }) {
  const all = [...groups, unclassified];
  const sum = (key: keyof GroupSummary) => all.reduce((s, g) => s + Number(g[key] ?? 0), 0);
  const cell = "px-3 py-2 text-right";
  return (
    <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
      <table className="min-w-full divide-y divide-vam-line text-sm tabular-nums" data-testid="group-table">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Nhóm</th>
            <th className={cell}>Mentor</th>
            <th className={cell}>Mentor còn chỗ</th>
            <th className={cell}>Tổng chỗ còn</th>
            <th className={cell}>Mentee</th>
            <th className={cell}>Ghép vòng 1</th>
            <th className={cell}>Ghép vòng 2</th>
            <th className={cell}>Ghép khác</th>
            <th className={cell}>Chưa có mentor</th>
            <th className={cell}>Chỗ − mentee chờ</th>
            <th className="px-3 py-2">Đối soát</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {all.map((g) => {
            const waiting = g.code === null ? g.mentees - g.matchedR1 - g.matchedR2 - g.matchedOther : g.visible;
            return (
              <tr key={g.label} data-group={g.code ?? "chua"}>
                <td className="px-3 py-2">{g.label}</td>
                <td className={cell}>{g.mentors}</td>
                <td className={cell}>{g.mentorsWithSlots}</td>
                <td className={cell}>{g.slots}</td>
                <td className={cell}>{g.mentees}</td>
                <td className={cell}>{g.matchedR1}</td>
                <td className={cell}>{g.matchedR2}</td>
                <td className={cell}>{g.matchedOther}</td>
                <td className={cell}>{waiting}</td>
                <td className={`${cell} ${g.slots - waiting < 0 ? "text-red-600" : ""}`}>{g.code === null ? "—" : g.slots - waiting}</td>
                <td className="px-3 py-2">{g.reconciled ? <span className="text-green-700">Khớp</span> : <span className="text-red-600">Lệch</span>}</td>
              </tr>
            );
          })}
          <tr className="bg-slate-50 font-semibold">
            <td className="px-3 py-2">Tổng</td>
            <td className={cell}>{sum("mentors")}</td>
            <td className={cell}>{sum("mentorsWithSlots")}</td>
            <td className={cell}>{sum("slots")}</td>
            <td className={cell}>{sum("mentees")}</td>
            <td className={cell}>{sum("matchedR1")}</td>
            <td className={cell}>{sum("matchedR2")}</td>
            <td className={cell}>{sum("matchedOther")}</td>
            <td className={cell}>{sum("mentees") - sum("matchedR1") - sum("matchedR2") - sum("matchedOther")}</td>
            <td className={cell}>—</td>
            <td className="px-3 py-2" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function Round2ReportPage() {
  const admin = await getCurrentAdminUser();
  if (!admin) redirect("/login");
  if (!canBrowseOperations(admin.role)) {
    return <PageHeader title="Không có quyền truy cập" description="Bạn không có quyền xem trang ghép cặp." />;
  }
  const result = await getRound2Data();
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Vòng 2 · Báo cáo" />
        <ErrorBox message={result.message} />
      </>
    );
  }
  const { board } = result.data;
  const mentorsWithSlots = board.rows.filter((r) => r.person.role === "mentor" && r.receivesList).sort(byGroupThenName);
  const waitingMentees = board.rows
    .filter((r) => r.person.role === "mentee" && r.menteeState === "visible" && r.group !== null)
    .sort(byGroupThenName);
  const slots = mentorsWithSlots.reduce((s, r) => s + (r.slots ?? 0), 0);
  const warnings = board.anomalies.filter((a) => a.severity === "warning");
  const infos = board.anomalies.filter((a) => a.severity === "info");
  const canExport = canAssignReview(admin.role);
  const exportLink = (list: string, label: string) =>
    canExport ? (
      <a href={`/api/exports/matching-round2?list=${list}`} className="text-sm font-medium text-vam-green">
        {label}
      </a>
    ) : null;

  return (
    <div className={COLUMN}>
      <PageHeader
        title="Vòng 2 · Báo cáo"
        description="Số liệu trực tiếp: cặp đã ghép ở vòng 2, chỗ mentor còn nhận (tối đa 2 mentee/mentor, không vượt số đã đăng ký), mentee chưa có mentor — theo 9 nhóm ngành."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Đã ghép ở vòng 2" value={board.round2Matches.length} tone="success" />
        <KpiCard label="Mentor còn nhận" value={mentorsWithSlots.length} helper={`${slots} chỗ`} />
        <KpiCard label="Mentee chưa có mentor" value={waitingMentees.length} />
        <KpiCard label="Cảnh báo" value={warnings.length} tone={warnings.length ? "warning" : "default"} />
      </div>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-vam-ink">Đối soát theo nhóm</h2>
          {exportLink("nhom", "Tải CSV")}
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Mỗi nhóm: Mentee = ghép vòng 1 + ghép vòng 2 + ghép khác + chưa có mentor. “Chưa phân nhóm” là người đã duyệt mà chưa có nhóm — chưa ai thấy họ
          trong danh sách. Mentor “còn chỗ” chỉ tính người có nhóm và có đúng một hồ sơ mentor.
        </p>
        <GroupTable groups={board.groups} unclassified={board.unclassified} />
        <p className="mt-2 text-xs text-slate-500">
          Phân nhóm, đổi nhóm: <Link href="/matches/vong-2" className="text-vam-green">Vòng 2 · Phân nhóm ngành</Link>.
        </p>
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-vam-ink">Đã ghép ở vòng 2 ({board.round2Matches.length})</h2>
          {exportLink("da-ghep", "Tải CSV")}
        </div>
        {board.round2Matches.length === 0 ? (
          <EmptyState message="Chưa có cặp nào ở vòng 2." />
        ) : (
          <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
            <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="round2-matches">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nhóm</th>
                  <th className="px-3 py-2">Mentor</th>
                  <th className="px-3 py-2">Mentee</th>
                  <th className="px-3 py-2">Thời điểm chọn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line">
                {board.round2Matches.map(({ match, mentor, mentee }) => (
                  <tr key={match.id}>
                    <td className="px-3 py-2">{industryGroupLabel(mentee?.group ?? mentor?.group)}</td>
                    <td className="px-3 py-2">{mentor?.person.name ?? "—"}</td>
                    <td className="px-3 py-2">{mentee?.person.name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(match.createdAt) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-vam-ink">
            Mentor còn nhận ({mentorsWithSlots.length} người, {slots} chỗ)
          </h2>
          {exportLink("mentor", "Tải CSV")}
        </div>
        {mentorsWithSlots.length === 0 ? (
          <EmptyState message="Không còn mentor nào còn chỗ." />
        ) : (
          <TableSearch placeholder="Tìm tên, nhóm… không cần dấu">
            <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
              <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="mentors-with-slots">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nhóm</th>
                    <th className="px-3 py-2">Mentor</th>
                    <th className="px-3 py-2">Chức danh</th>
                    <th className="px-3 py-2 text-right">Đăng ký</th>
                    <th className="px-3 py-2 text-right">Đang có</th>
                    <th className="px-3 py-2 text-right">Còn</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line tabular-nums">
                  {mentorsWithSlots.map((r) => (
                    <tr key={r.person.personId}>
                      <td className="px-3 py-2">{industryGroupLabel(r.group)}</td>
                      <td className="px-3 py-2">{r.person.name}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{detail(r, "Chức danh")}</td>
                      <td className="px-3 py-2 text-right">{r.capacity}</td>
                      <td className="px-3 py-2 text-right">{r.activeMatches.length}</td>
                      <td className="px-3 py-2 text-right font-semibold">{r.slots}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableSearch>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-vam-ink">Mentee chưa có mentor ({waitingMentees.length})</h2>
          {exportLink("mentee", "Tải CSV")}
        </div>
        {waitingMentees.length === 0 ? (
          <EmptyState message="Mọi mentee đã có nhóm đều đã có mentor." />
        ) : (
          <TableSearch placeholder="Tìm tên, ngành học… không cần dấu">
            <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
              <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="waiting-mentees">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Nhóm</th>
                    <th className="px-3 py-2">Mentee</th>
                    <th className="px-3 py-2">Chức năng mục tiêu</th>
                    <th className="px-3 py-2">Ngành học</th>
                    <th className="px-3 py-2">Năm học</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {waitingMentees.map((r) => (
                    <tr key={r.person.personId}>
                      <td className="px-3 py-2">{industryGroupLabel(r.group)}</td>
                      <td className="px-3 py-2">{r.person.name}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{detail(r, "Chức năng mục tiêu")}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{detail(r, "Ngành học")}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{detail(r, "Năm học")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableSearch>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold text-vam-ink">Bất thường ({board.anomalies.length})</h2>
        {board.anomalies.length === 0 ? (
          <EmptyState message="Không có bất thường." />
        ) : (
          <div className="flex flex-col gap-3" data-testid="anomalies">
            {warnings.length ? (
              <ul className="list-disc pl-5 text-sm text-red-700">
                {warnings.map((a, index) => (
                  <li key={`w${index}`}>{a.message}</li>
                ))}
              </ul>
            ) : null}
            {infos.length ? (
              <details>
                <summary className="cursor-pointer text-sm text-slate-600">{infos.length} ghi chú khác</summary>
                <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
                  {infos.map((a, index) => (
                    <li key={`i${index}`}>{a.message}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
