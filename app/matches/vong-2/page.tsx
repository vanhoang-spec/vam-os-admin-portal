import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, ErrorBox, KpiCard, PageHeader } from "@/components/ui";
import { TableSearch } from "@/components/table-search";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getRound2Data } from "@/lib/matching-round2";
import { REVIEW_FLAG } from "@/lib/matching-round2-classify-core";
import { byGroupThenName, type Round2Row } from "@/lib/matching-round2-core";
import { INDUSTRY_GROUPS, industryGroupLabel } from "@/lib/matching-round2-groups-core";
import { canBrowseOperations } from "@/lib/permissions";
import { ClassifyPanel, GroupEditForm } from "./round2-forms";

export const dynamic = "force-dynamic";

const CONFIDENCE_LABEL: Record<string, string> = { cao: "Cao", trung_binh: "Trung bình", thap: "Thấp" };

type Search = { vai?: string | string[]; nhom?: string | string[]; loc?: string | string[] };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function filterRows(rows: Round2Row[], search: Search) {
  const role = one(search.vai);
  const group = one(search.nhom);
  const flag = one(search.loc);
  return rows.filter((r) => {
    if (role === "mentor" || role === "mentee") {
      if (r.person.role !== role) return false;
    }
    if (group === "chua") {
      if (r.group !== null) return false;
    } else if (group) {
      const shown = r.group ?? r.proposal.group;
      if (String(shown) !== group) return false;
    }
    if (flag === "can-xem" && !(r.assignment ? r.assignment.flags.includes(REVIEW_FLAG) : r.proposal.flags.includes(REVIEW_FLAG))) return false;
    if (flag === "doi-nhom" && !r.assignment?.driftGroup) return false;
    return true;
  });
}

function GroupCell({ row }: { row: Round2Row }) {
  if (row.assignment) {
    return (
      <div>
        <div className="font-medium text-vam-ink">{industryGroupLabel(row.assignment.group)}</div>
        {row.assignment.source === "btc" ? (
          <span className="mt-1 inline-block rounded-full bg-vam-mint px-2 py-0.5 text-[11px] font-semibold text-vam-green">BTC đã duyệt</span>
        ) : null}
        {row.assignment.driftGroup ? (
          <div className="mt-1 text-[11px] text-amber-700">Dữ liệu hôm nay: {industryGroupLabel(row.assignment.driftGroup)}</div>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs text-slate-500">Chưa lưu — đề xuất</div>
      <div className="font-medium text-slate-700">{industryGroupLabel(row.proposal.group)}</div>
    </div>
  );
}

function StatusCell({ row }: { row: Round2Row }) {
  if (!row.person.eligible) return <span className="text-xs text-slate-500">Đã rút / không tham gia</span>;
  if (row.person.role === "mentor") {
    return (
      <div className="text-xs text-slate-600">
        <div>
          Đang có {row.activeMatches.length} · còn <strong>{row.slots}</strong>/{row.round2Cap} chỗ
        </div>
        {row.partnerNames.length ? <div className="text-slate-500">{row.partnerNames.join(", ")}</div> : null}
        {row.person.profileCount !== 1 ? <div className="text-red-600">Có {row.person.profileCount ?? 0} hồ sơ mentor</div> : null}
      </div>
    );
  }
  if (row.menteeState === "matched") {
    return (
      <div className="text-xs text-slate-600">
        Đã có mentor{row.matchedRound ? ` (vòng ${row.matchedRound})` : ""}: {row.partnerNames.join(", ")}
      </div>
    );
  }
  return <span className="text-xs text-green-700">Chưa có mentor</span>;
}

export default async function Round2GroupsPage(props: { searchParams?: Promise<Search> }) {
  const search = (await props.searchParams) ?? {};
  const admin = await getCurrentAdminUser();
  if (!admin) redirect("/login");
  if (!canBrowseOperations(admin.role)) {
    return <PageHeader title="Không có quyền truy cập" description="Bạn không có quyền xem trang ghép cặp." />;
  }
  const result = await getRound2Data();
  if (!result.ok) {
    return (
      <>
        <PageHeader title="Vòng 2 · Phân nhóm ngành" />
        <ErrorBox message={result.message} />
      </>
    );
  }
  const { board, canManage, canEditGroups } = result.data;
  const eligible = board.rows.filter((r) => r.person.eligible);
  const count = (role: "mentor" | "mentee", pred: (r: Round2Row) => boolean) =>
    eligible.filter((r) => r.person.role === role && pred(r)).length;
  const needsReview = board.rows.filter((r) => r.assignment?.flags.includes(REVIEW_FLAG)).length;
  const drift = board.rows.filter((r) => r.assignment?.driftGroup).length;
  const pendingMentors = board.pending.filter((r) => r.person.role === "mentor").length;
  const pendingMentees = board.pending.filter((r) => r.person.role === "mentee").length;
  const rows = filterRows(board.rows, search).sort(byGroupThenName);
  const proposalByGroup = INDUSTRY_GROUPS.map((g) => ({
    label: industryGroupLabel(g.code),
    mentors: board.pending.filter((r) => r.person.role === "mentor" && r.proposal.group === g.code).length,
    mentees: board.pending.filter((r) => r.person.role === "mentee" && r.proposal.group === g.code).length,
    flagged: board.pending.filter((r) => r.proposal.group === g.code && r.proposal.flags.includes(REVIEW_FLAG)).length
  }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader
        title="Vòng 2 · Phân nhóm ngành"
        description="Mỗi mentor và mentee đã duyệt thuộc đúng 1 trong 9 nhóm ngành; ở vòng 2, mentor chỉ thấy mentee cùng nhóm. Nhóm đã lưu bị khoá tới hết mùa."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Mentor đã có nhóm" value={`${count("mentor", (r) => r.group !== null)}/${count("mentor", () => true)}`} />
        <KpiCard label="Mentee đã có nhóm" value={`${count("mentee", (r) => r.group !== null)}/${count("mentee", () => true)}`} />
        <KpiCard label="Chờ phân loại" value={board.pending.length} tone={board.pending.length ? "warning" : "default"} />
        <KpiCard label="Cần BTC xem" value={needsReview} tone={needsReview ? "warning" : "default"} />
        <KpiCard label="Dữ liệu đổi nhóm" value={drift} tone={drift ? "warning" : "default"} />
      </div>

      <Card>
        <h2 className="mb-2 text-base font-semibold text-vam-ink">Phân loại người mới</h2>
        {canManage ? (
          <ClassifyPanel pendingMentors={pendingMentors} pendingMentees={pendingMentees} />
        ) : (
          <p className="text-sm text-slate-500">
            Chỉ Super admin, Admin, Core team có quyền vận hành mùa này mới phân loại người mới.
            {canEditGroups ? " Bạn vẫn đổi / xác nhận được nhóm của từng người ở bảng dưới." : ""}
          </p>
        )}
        {board.pending.length ? (
          <div className="vam-table-frame mt-3 overflow-x-auto rounded-lg border border-vam-line">
            <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="proposal-table">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nhóm đề xuất</th>
                  <th className="px-3 py-2 text-right">Mentor</th>
                  <th className="px-3 py-2 text-right">Mentee</th>
                  <th className="px-3 py-2 text-right">Cần BTC xem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vam-line tabular-nums">
                {proposalByGroup.map((g) => (
                  <tr key={g.label}>
                    <td className="px-3 py-2">{g.label}</td>
                    <td className="px-3 py-2 text-right">{g.mentors}</td>
                    <td className="px-3 py-2 text-right">{g.mentees}</td>
                    <td className="px-3 py-2 text-right">{g.flagged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card>
        <form className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium uppercase text-slate-500">
            Vai trò
            <select name="vai" defaultValue={one(search.vai)} className="mt-1 block rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm normal-case text-vam-ink">
              <option value="">Mentor và mentee</option>
              <option value="mentor">Mentor</option>
              <option value="mentee">Mentee</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase text-slate-500">
            Nhóm
            <select name="nhom" defaultValue={one(search.nhom)} className="mt-1 block rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm normal-case text-vam-ink">
              <option value="">Mọi nhóm</option>
              {INDUSTRY_GROUPS.map((g) => (
                <option key={g.code} value={g.code}>
                  {industryGroupLabel(g.code)}
                </option>
              ))}
              <option value="chua">Chưa lưu nhóm</option>
            </select>
          </label>
          <label className="text-xs font-medium uppercase text-slate-500">
            Lọc
            <select name="loc" defaultValue={one(search.loc)} className="mt-1 block rounded-md border border-vam-line bg-white px-2 py-1.5 text-sm normal-case text-vam-ink">
              <option value="">Tất cả</option>
              <option value="can-xem">Cần BTC xem</option>
              <option value="doi-nhom">Dữ liệu đổi nhóm</option>
            </select>
          </label>
          <button type="submit" className="rounded-md bg-vam-green px-4 py-2 text-sm font-medium text-white">
            Lọc
          </button>
          <Link href="/matches/vong-2" className="rounded-md border border-vam-line px-4 py-2 text-sm text-slate-700">
            Xoá lọc
          </Link>
          <Link href="/matches/vong-2/bao-cao" className="ml-auto text-sm font-medium text-vam-green">
            Xem báo cáo vòng 2 →
          </Link>
        </form>

        {rows.length === 0 ? (
          <EmptyState message="Không có ai khớp bộ lọc." />
        ) : (
          <TableSearch placeholder="Tìm tên, email, chức danh, ngành học… không cần dấu">
            <div className="vam-table-frame overflow-x-auto rounded-lg border border-vam-line bg-white">
              <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="round2-table">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Người</th>
                    <th className="px-3 py-2">Nhóm</th>
                    <th className="px-3 py-2">Căn cứ</th>
                    <th className="px-3 py-2">Hồ sơ</th>
                    <th className="px-3 py-2">Tình trạng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-vam-line">
                  {rows.map((row) => {
                    const c = row.assignment ?? row.proposal;
                    const reasons = row.assignment ? row.assignment.reasons : row.proposal.reasons;
                    return (
                      <tr key={`${row.person.role}-${row.person.personId}`} data-person={row.person.personId} className="align-top">
                        <td className="px-3 py-2">
                          {/* Mở tab mới: BTC đọc hồ sơ mà không mất bộ lọc và vị trí đang rà. */}
                          <a
                            href={`/applications/${row.person.applicationId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Mở hồ sơ đăng ký trong tab mới"
                            data-testid="profile-link"
                            className="font-medium text-vam-ink underline decoration-vam-line underline-offset-2 hover:text-vam-green hover:decoration-vam-green"
                          >
                            {row.person.name}
                            <span aria-hidden="true" className="ml-1 text-xs text-slate-400">↗</span>
                          </a>
                          <div className="text-xs text-slate-500">{row.person.role === "mentor" ? "Mentor" : "Mentee"}</div>
                          {row.person.email ? <div className="break-all text-xs text-slate-400">{row.person.email}</div> : null}
                        </td>
                        <td className="px-3 py-2">
                          <GroupCell row={row} />
                        </td>
                        <td className="max-w-md px-3 py-2 text-xs text-slate-600">
                          <div>
                            Tin cậy: {CONFIDENCE_LABEL[c.confidence] ?? c.confidence}
                            {c.flags.includes(REVIEW_FLAG) ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Cần BTC xem</span>
                            ) : null}
                          </div>
                          <ul className="mt-1 list-disc pl-4">
                            {reasons.map((reason, index) => (
                              <li key={index}>{reason}</li>
                            ))}
                          </ul>
                          {row.assignment?.overrideReason ? <div className="mt-1 text-vam-green">BTC: {row.assignment.overrideReason}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {row.person.details.map(([label, value]) => (
                            <div key={label}>
                              <span className="text-slate-400">{label}:</span> {value}
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2" data-search-skip>
                          <StatusCell row={row} />
                          {canEditGroups && row.assignment ? (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs font-medium text-vam-green">Đổi / xác nhận nhóm</summary>
                              <GroupEditForm assignmentId={row.assignment.id} currentGroup={row.assignment.group} />
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </TableSearch>
        )}
      </Card>
    </div>
  );
}
