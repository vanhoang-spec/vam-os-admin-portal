import Link from "next/link";
import { CrossTabTable, REPORT_NUM, REPORT_TD, REPORT_TH } from "@/components/cross-tab-table";
import { TableSearch } from "@/components/table-search";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import {
  NEW_STAGE_LABELS,
  REPORT_SCOPES,
  type MentorRecruitmentReport,
  type NewStage,
  type PersonLine,
  type YearStats
} from "@/lib/mentor-recruitment-report-core";
import { formatShare, type CrossTabRow } from "@/lib/report-crosstab-core";
import { formatDateTime, formatInt } from "@/lib/utils";

/**
 * Báo cáo tuyển mentor — phần hiển thị, không đọc dữ liệu. page.tsx gác cổng và dựng
 * báo cáo; tách ra để test vẽ được với dữ liệu mẫu.
 */

export const MENTOR_REPORT_PATH = "/interviews/bao-cao-mentor";

/** Lưới một cột không rộng hơn khung: bảng nhiều cột tự cuộn trong khung của nó. */
const COLUMN = "grid grid-cols-[minmax(0,1fr)]";

const YEARS = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

function share(value: number | null): string {
  return value === null ? "—" : formatShare(value);
}

function ratio(part: number, whole: number): string {
  return whole ? formatShare(part / whole) : "—";
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card id={id} className={`${COLUMN} gap-3 scroll-mt-20`}>
      <div>
        <h2 className="text-lg font-semibold text-vam-ink">{title}</h2>
        {intro ? <div className="mt-1 text-sm text-slate-600">{intro}</div> : null}
      </div>
      {children}
    </Card>
  );
}

const TOC: Array<[string, string]> = [
  ["tong-quan", "1. Tổng quan"],
  ["pheu", "2. Phễu tuyển mentor mới"],
  ["ty-le-ho-so", "3. Tỷ lệ đạt vòng hồ sơ theo đặc điểm"],
  ["gia-han", "4. Mentor cũ gia hạn"],
  ["kinh-nghiem", "5. Số năm kinh nghiệm"],
  ["nhom-nganh", "6. Nhóm ngành"],
  ["cap-bac", "7. Cấp bậc"],
  ["cong-ty", "8. Công ty"],
  ["khac", "9. Sức nhận, trường, nguồn biết đến"]
];

/** Một dòng phễu: nhãn, số, % so với mốc, thanh. */
function FunnelLine({ label, count, base, note, tone = "bg-vam-green" }: { label: string; count: number; base: number; note?: string; tone?: string }) {
  const pct = base ? Math.round((count / base) * 100) : 0;
  return (
    <div className="grid gap-1" data-funnel={label}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-vam-ink">{label}</span>
        <span className="tabular-nums text-slate-700">
          <strong>{formatInt(count)}</strong> <span className="text-xs text-slate-500">({ratio(count, base)})</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {note ? <p className="text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}

function StageTable({ caption, counts, order, total }: { caption: string; counts: Record<NewStage, number>; order: readonly NewStage[]; total: number }) {
  const lines = order.filter((s) => counts[s] > 0);
  return (
    <div className="vam-table-frame rounded-lg border border-vam-line bg-white">
      <table className="min-w-full divide-y divide-vam-line text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
          <tr>
            <th className={REPORT_TH}>{caption}</th>
            <th className={`${REPORT_TH} text-right`}>Số người</th>
            <th className={`${REPORT_TH} text-right`}>Tỷ lệ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {lines.map((s) => (
            <tr key={s} data-stage={s}>
              <td className={`${REPORT_TD} font-medium text-vam-ink`}>{NEW_STAGE_LABELS[s]}</td>
              <td className={REPORT_NUM}>{formatInt(counts[s])}</td>
              <td className={REPORT_NUM}>{ratio(counts[s], total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-vam-line bg-slate-50 font-semibold">
          <tr>
            <td className={`${REPORT_TD} text-vam-ink`}>Tổng</td>
            <td className={REPORT_NUM}>{formatInt(total)}</td>
            <td className={REPORT_NUM}>{total ? "100%" : "—"}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PeopleList({ people, showMatched = false }: { people: PersonLine[]; showMatched?: boolean }) {
  return (
    <ul className="grid gap-1 text-sm">
      {people.map((p) => (
        <li key={p.applicationId} className="text-slate-700">
          <a
            href={`/applications/${p.applicationId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-vam-ink underline decoration-vam-line underline-offset-2 hover:text-vam-green"
          >
            {p.name}
          </a>
          <span className="text-slate-500">
            {" "}
            — {p.title ?? "chưa khai chức danh"}
            {p.company ? ` · ${p.company}` : ""}
            {p.stream === "renewal" ? " · gia hạn" : " · mới"}
            {showMatched && p.matched ? ` · khớp “${p.matched}”` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatsLine({ label, stats }: { label: string; stats: YearStats }) {
  if (!stats.count) return null;
  return (
    <li>
      {label}: trung vị <strong>{YEARS.format(stats.median ?? 0)} năm</strong>, trung bình {YEARS.format(stats.average ?? 0)} năm ({formatInt(stats.count)} người khai)
    </li>
  );
}

function ScopeSwitch({ current }: { current: string }) {
  return (
    <nav aria-label="Phạm vi báo cáo hồ sơ mentor" className="flex flex-wrap gap-2" data-testid="scope-switch">
      {REPORT_SCOPES.map((s) => (
        <Link
          key={s.key}
          href={s.key === "chinh-thuc" ? `${MENTOR_REPORT_PATH}#kinh-nghiem` : `${MENTOR_REPORT_PATH}?pham-vi=${s.key}#kinh-nghiem`}
          aria-current={s.key === current ? "page" : undefined}
          className={
            s.key === current
              ? "rounded-md bg-vam-green px-3 py-1 text-xs font-semibold text-white"
              : "rounded-md border border-vam-line bg-white px-3 py-1 text-xs font-medium text-slate-700"
          }
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

export function MentorReportView({ report, seasonCode, generatedAt }: { report: MentorRecruitmentReport; seasonCode: string; generatedAt: string }) {
  const { funnel, renewal, cv, profile } = report;
  const scopeLabel = REPORT_SCOPES.find((s) => s.key === profile.scope)?.label ?? "";
  const passRate = (row: CrossTabRow) => ratio(row.cells[0]?.count ?? 0, row.total);
  const cvPassedTotal = cv.byGroup.columns[0]?.total ?? 0;
  const cvDecidedTotal = cv.byGroup.columns.reduce((s, c) => s + c.total, 0);
  const companiesWithMany = profile.companies.ranked.filter((c) => c.count >= 2);

  return (
    <div className={`${COLUMN} gap-4`} data-testid="mentor-report-root">
      <PageHeader
        title="Báo cáo tuyển mentor"
        description={`Mùa ${seasonCode}. Số liệu đọc trực tiếp lúc ${formatDateTime(generatedAt)} — mở lại trang là có số mới nhất.`}
      />

      <nav aria-label="Mục lục báo cáo" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-vam-green hover:underline">
            {label}
          </a>
        ))}
      </nav>

      <Section id="tong-quan" title="1. Tổng quan">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="totals">
          <KpiCard label="Mentor chính thức" value={formatInt(report.officialTotal)} tone="success" />
          <KpiCard label="Mentor mới chính thức" value={formatInt(funnel.officialTotal)} />
          <KpiCard label="Mentor gia hạn đã duyệt" value={formatInt(renewal.approved)} />
          <KpiCard label="Đạt vòng hồ sơ (mới)" value={share(funnel.cv.passRate)} />
          <KpiCard label="Chính thức / đã phỏng vấn" value={share(funnel.result.officialRate)} />
        </div>
        <ul className="list-disc pl-5 text-sm text-slate-700">
          <li>
            Mentor mới: <strong>{formatInt(funnel.submitted)}</strong> đơn → <strong>{formatInt(funnel.cv.passed)}</strong> vào vòng phỏng vấn →{" "}
            <strong>{formatInt(funnel.result.interviewed)}</strong> đã phỏng vấn → <strong>{formatInt(funnel.officialTotal)}</strong> mentor chính thức.
          </li>
          <li>
            Mentor cũ: mời gia hạn <strong>{formatInt(renewal.invited)}</strong> người → <strong>{formatInt(renewal.accepted)}</strong> đồng ý ({share(renewal.acceptanceRate)}).
          </li>
        </ul>
      </Section>

      <Section
        id="pheu"
        title="2. Phễu tuyển mentor mới"
        intro="Chỉ tính đơn nộp qua form mentor mới. Mentor gia hạn không qua chấm hồ sơ hay phỏng vấn nên có phần riêng ở mục 4."
      >
        <div className="grid gap-3" data-testid="funnel">
          <FunnelLine label="Nộp đơn" count={funnel.submitted} base={funnel.submitted} />
          <FunnelLine
            label="Vào vòng phỏng vấn (đạt vòng hồ sơ)"
            count={funnel.cv.passed}
            base={funnel.submitted}
            note={`${formatInt(funnel.cv.passedByReview)} người có phiếu chấm hồ sơ “Đạt”, ${formatInt(funnel.cv.passedDirect)} người BTC mời / duyệt thẳng không có phiếu chấm hồ sơ.`}
          />
          <FunnelLine label="Đã phỏng vấn (có phiếu phỏng vấn đã nộp)" count={funnel.result.interviewed} base={funnel.submitted} />
          <FunnelLine label="Mentor chính thức" count={funnel.officialTotal} base={funnel.submitted} tone="bg-emerald-600" />
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className={`${COLUMN} gap-2`} data-testid="cv-stage">
            <h3 className="font-semibold text-vam-ink">Vòng hồ sơ</h3>
            <p className="text-sm text-slate-700">
              Tỷ lệ đạt: <strong>{share(funnel.cv.passRate)}</strong> ({formatInt(funnel.cv.passed)} đạt / {formatInt(funnel.cv.passed + funnel.cv.rejected)} đã có kết quả).
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-700">
              <li>Đạt, vào vòng phỏng vấn: {formatInt(funnel.cv.passed)}</li>
              <li>Không đạt: {formatInt(funnel.cv.rejected)}</li>
              <li>Rút đơn trước khi có kết quả: {formatInt(funnel.cv.withdrawn)}</li>
              <li>Đang chờ kết quả: {formatInt(funnel.cv.pending)}</li>
            </ul>
          </div>
          <div className={`${COLUMN} gap-2`} data-testid="interview-stage">
            <h3 className="font-semibold text-vam-ink">Vòng phỏng vấn / trao đổi với Core team</h3>
            <p className="text-sm text-slate-700">
              Đã phỏng vấn <strong>{formatInt(funnel.interview.interviewed)}</strong> / {formatInt(funnel.interview.entered)} người vào vòng. Phiếu đề xuất nhận:{" "}
              <strong>{share(funnel.interview.recommendRate)}</strong>.
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-700">
              <li>Đề xuất nhận: {formatInt(funnel.interview.recommendations.approve)}</li>
              <li>Đề xuất dự bị: {formatInt(funnel.interview.recommendations.waitlist)}</li>
              <li>Đề xuất không nhận: {formatInt(funnel.interview.recommendations.reject)}</li>
              <li>Cần BTC xem: {formatInt(funnel.interview.recommendations.needsAdmin)}</li>
            </ul>
          </div>
          <div className={`${COLUMN} gap-2`} data-testid="result-stage">
            <h3 className="font-semibold text-vam-ink">Sau phỏng vấn</h3>
            <p className="text-sm text-slate-700">
              Trong {formatInt(funnel.result.interviewed)} người đã phỏng vấn: <strong>{share(funnel.result.officialRate)}</strong> đã là mentor chính thức;{" "}
              <strong>{share(funnel.result.continuingRate)}</strong> đi tiếp (chính thức + chờ BTC chốt).
            </p>
          </div>
        </div>

        <StageTable
          caption="Người đã phỏng vấn — đang ở đâu"
          counts={funnel.result.byStage}
          order={["official", "awaiting_decision", "iv_pending", "waitlisted", "iv_rejected", "iv_withdrawn"]}
          total={funnel.result.interviewed}
        />
        <StageTable
          caption="Vào vòng phỏng vấn nhưng chưa có phiếu phỏng vấn trên hệ thống"
          counts={funnel.interview.withoutForm}
          order={["iv_pending", "official", "awaiting_decision", "waitlisted", "iv_rejected", "iv_withdrawn"]}
          total={funnel.interview.entered - funnel.interview.interviewed}
        />
        <p className="text-xs text-slate-500">
          “Mentor chính thức” không có phiếu phỏng vấn: BTC duyệt sau buổi trao đổi ngoài hệ thống hoặc trước khi có phiếu — được tính là chính thức, không tính vào tỷ lệ sau phỏng vấn.
        </p>
      </Section>

      <Section
        id="ty-le-ho-so"
        title="3. Tỷ lệ đạt vòng hồ sơ theo đặc điểm"
        intro={`Mentor mới đã có kết quả vòng hồ sơ: ${formatInt(cvDecidedTotal)} người, ${formatInt(cvPassedTotal)} đạt. Mỗi ô: số người (tỷ lệ trong cột).`}
      >
        <CrossTabTable tab={cv.byGroup} firstLabel="Nhóm ngành" unit="người" extra={{ label: "Tỷ lệ đạt", value: passRate, total: ratio(cvPassedTotal, cvDecidedTotal) }} testId="cv-by-group" />
        <CrossTabTable tab={cv.byExperience} firstLabel="Số năm kinh nghiệm" unit="người" extra={{ label: "Tỷ lệ đạt", value: passRate, total: ratio(cvPassedTotal, cvDecidedTotal) }} />
        <CrossTabTable tab={cv.bySeniority} firstLabel="Cấp bậc" unit="người" extra={{ label: "Tỷ lệ đạt", value: passRate, total: ratio(cvPassedTotal, cvDecidedTotal) }} />
      </Section>

      <Section id="gia-han" title="4. Mentor cũ gia hạn" intro="Theo người: một người được cấp lại link nhiều lần vẫn tính một.">
        <div className="grid gap-3" data-testid="renewal">
          <FunnelLine label="Được mời gia hạn" count={renewal.invited} base={renewal.invited} />
          <FunnelLine label="Đồng ý tham gia mùa này" count={renewal.accepted} base={renewal.invited} tone="bg-emerald-600" />
          <FunnelLine label="Từ chối" count={renewal.declined} base={renewal.invited} tone="bg-red-400" />
          <FunnelLine label="Chưa trả lời, link còn hạn" count={renewal.pending} base={renewal.invited} tone="bg-amber-400" />
          <FunnelLine label="Chưa trả lời, link đã hết hạn / thu hồi" count={renewal.lapsed} base={renewal.invited} tone="bg-slate-400" />
        </div>
        <p className="text-sm text-slate-700">
          Trong {formatInt(renewal.accepted)} người đồng ý: {formatInt(renewal.approved)} đã được BTC duyệt, {formatInt(renewal.awaitingConfirm)} chờ BTC xác nhận.
        </p>
      </Section>

      <div className={`${COLUMN} gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4`} data-testid="scope-banner">
        <p className="text-sm text-amber-950">
          Mục 5–9 đang tính: <strong>{scopeLabel}</strong> — {formatInt(profile.population)} người. Mỗi bảng chia hai cột Mentor mới / Mentor gia hạn.
        </p>
        <ScopeSwitch current={profile.scope} />
      </div>

      <Section id="kinh-nghiem" title="5. Số năm kinh nghiệm làm việc">
        <ul className="list-disc pl-5 text-sm text-slate-700">
          <StatsLine label="Tất cả" stats={profile.experienceStats.all} />
          <StatsLine label="Mentor mới" stats={profile.experienceStats.new} />
          <StatsLine label="Mentor gia hạn" stats={profile.experienceStats.renewal} />
        </ul>
        <CrossTabTable tab={profile.experience} firstLabel="Tổng số năm đi làm" unit="người" testId="experience" />
        <h3 className="font-semibold text-vam-ink">Số năm quản lý nhân sự</h3>
        <CrossTabTable tab={profile.management} firstLabel="Số năm quản lý" unit="người" />
      </Section>

      <Section
        id="nhom-nganh"
        title="6. Nhóm ngành"
        intro={
          profile.groupsProposed
            ? `Theo 9 nhóm ngành của Vòng 2 ghép cặp. ${formatInt(profile.groupsProposed)} người chưa được lưu nhóm ở Vòng 2 — dùng nhóm máy đề xuất.`
            : "Theo 9 nhóm ngành đã lưu ở Vòng 2 ghép cặp (gồm các lần BTC / Support team đổi tay)."
        }
      >
        <CrossTabTable tab={profile.groups} firstLabel="Nhóm ngành" unit="người" testId="groups" />
      </Section>

      <Section
        id="cap-bac"
        title="7. Cấp bậc"
        intro={
          <>
            Đọc từ chức danh tự khai. <strong>Giám đốc trở lên: {formatInt(profile.directorAndAbove)}</strong> người ({ratio(profile.directorAndAbove, profile.population)}).
            Mở từng cấp để xem ai và chức danh khớp chữ nào; “Chưa xếp được” là chức danh máy không đọc ra cấp.
          </>
        }
      >
        <CrossTabTable tab={profile.seniority} firstLabel="Cấp bậc" unit="người" testId="seniority" />
        <div className="grid gap-2" data-testid="seniority-people">
          {profile.seniorityPeople
            .filter((g) => g.people.length)
            .map((g) => (
              <details key={g.level} className="rounded-lg border border-vam-line bg-white px-3 py-2" data-level={g.level}>
                <summary className="cursor-pointer text-sm font-medium text-vam-ink">
                  {g.label} — {formatInt(g.people.length)} người
                </summary>
                <div className="mt-2">
                  <PeopleList people={g.people} showMatched />
                </div>
              </details>
            ))}
        </div>
      </Section>

      <Section
        id="cong-ty"
        title="8. Công ty"
        intro={`${formatInt(profile.companies.distinct)} nơi làm việc khác nhau; ${formatInt(companiesWithMany.length)} nơi có từ 2 mentor. ${formatInt(profile.companies.independent)} người làm tự do / nghỉ hưu, ${formatInt(profile.companies.undeclared)} người không khai công ty. Tên viết khác nhau của cùng một công ty đã được gộp (vd. “NH TMCP Quân Đội” và “MB Bank”).`}
      >
        <div className="vam-table-frame rounded-lg border border-vam-line bg-white" data-testid="companies">
          <table className="min-w-full divide-y divide-vam-line text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className={REPORT_TH}>#</th>
                <th className={REPORT_TH}>Công ty</th>
                <th className={`${REPORT_TH} text-right`}>Số mentor</th>
                <th className={REPORT_TH}>Mentor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line">
              {companiesWithMany.map((c, i) => (
                <tr key={c.key} className="align-top" data-company={c.label}>
                  <td className={REPORT_NUM}>{i + 1}</td>
                  <td className={`${REPORT_TD} font-medium text-vam-ink`}>{c.label}</td>
                  <td className={REPORT_NUM}>{formatInt(c.count)}</td>
                  <td className={REPORT_TD}>
                    <PeopleList people={c.people} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="rounded-lg border border-vam-line bg-white px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-vam-ink">Toàn bộ {formatInt(profile.companies.distinct)} nơi làm việc</summary>
          <div className="mt-2">
            <TableSearch placeholder="Tìm công ty hoặc tên mentor… không cần dấu">
              <div className="vam-table-frame rounded-lg border border-vam-line bg-white">
                <table className="min-w-full divide-y divide-vam-line text-sm">
                  <tbody className="divide-y divide-vam-line">
                    {profile.companies.ranked.map((c) => (
                      <tr key={c.key} className="align-top">
                        <td className={`${REPORT_TD} font-medium text-vam-ink`}>{c.label}</td>
                        <td className={REPORT_NUM}>{formatInt(c.count)}</td>
                        <td className={REPORT_TD}>{c.people.map((p) => p.name).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TableSearch>
          </div>
        </details>
      </Section>

      <Section id="khac" title="9. Sức nhận, trường, nguồn biết đến">
        <p className="text-sm text-slate-700">
          Tổng số mentee nhận được theo đăng ký: <strong>{formatInt(profile.seats)}</strong> chỗ.
        </p>
        <CrossTabTable tab={profile.capacity} firstLabel="Số mentee muốn nhận" unit="người" />
        <CrossTabTable tab={profile.university} firstLabel="Trường đã học" unit="người" />
        <h3 className="font-semibold text-vam-ink">Nguồn biết đến chương trình (chỉ mentor mới — form gia hạn không hỏi)</h3>
        <CrossTabTable tab={profile.referral} firstLabel="Nguồn" unit="người" />
      </Section>
    </div>
  );
}
