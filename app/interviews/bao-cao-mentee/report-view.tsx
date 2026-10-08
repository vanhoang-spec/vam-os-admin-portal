import Link from "next/link";
import { CrossTabTable } from "@/components/cross-tab-table";
import { TableSearch } from "@/components/table-search";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import {
  REPORT_GROUPS,
  REPORT_GROUP_LABELS,
  formatScore,
  formatShare,
  type CrossTabRow,
  type GroupScore,
  type InterviewReport,
  type InterviewWave,
  type ScoreSummary
} from "@/lib/mentee-interview-report-core";
import { sessionDayLabel } from "@/lib/mentee-interview-core";
import { notesDrift, type NoteSection, type WaveNotes } from "@/lib/mentee-interview-report-notes";
import { formatDateTime, formatInt } from "@/lib/utils";

/**
 * Báo cáo phỏng vấn mentee theo đợt — phần hiển thị, không đọc dữ liệu. Trang
 * (page.tsx) gác cổng và dựng InterviewReport; tách ra để test vẽ được với dữ liệu
 * mẫu mà không phải giả cả database.
 */

export const REPORT_PATH = "/interviews/bao-cao-mentee";

/** Dưới chừng này phiếu thì điểm trung bình của một người in nhạt: 1–2 phiếu không nói lên cách chấm. */
const FEW_FORMS = 3;

const TH = "px-3 py-2";
const TD = "px-3 py-2 text-slate-700";
const NUM = "px-3 py-2 text-right tabular-nums text-slate-700";

/**
 * Lưới một cột mà cột KHÔNG được rộng hơn khung chứa. Lưới thường để cột co theo
 * nội dung rộng nhất, nên một bảng nhiều cột đẩy cả trang tràn ngang trên màn hình
 * hẹp (06/10/2026: khung 478px, trang rộng 620px). Có minmax(0,1fr), bảng tự cuộn
 * trong khung vam-table-frame của nó.
 */
const COLUMN = "grid grid-cols-[minmax(0,1fr)]";

function dayLabel(dateKey: string): string {
  // Giữa trưa giờ Việt Nam — không ca nào lệch sang ngày khác vì múi giờ.
  return sessionDayLabel(`${dateKey}T05:00:00.000Z`);
}

function joinVi(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} và ${items[items.length - 1]}`;
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

function WaveBanner({ report, waves, generatedAt }: { report: InterviewReport; waves: InterviewWave[]; generatedAt: string }) {
  const { wave } = report;
  return (
    <div className={`${COLUMN} gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950`} data-testid="wave-banner">
      <p className="text-base font-semibold">{wave.label}</p>
      <p>
        Báo cáo này <strong>chỉ tính hồ sơ đặt lịch vào các ca phỏng vấn ngày {joinVi(wave.dateKeys.map(dayLabel))}</strong>.
        Các đợt phỏng vấn sau có báo cáo riêng, không cộng dồn vào đây.
      </p>
      <p>Số liệu đọc trực tiếp lúc {formatDateTime(generatedAt)} — mở lại trang là có số mới nhất của đợt này.</p>
      {waves.length > 1 ? (
        <nav aria-label="Chọn đợt phỏng vấn" className="flex flex-wrap gap-2 pt-1">
          {waves.map((w) => (
            <Link
              key={w.key}
              href={`${REPORT_PATH}?dot=${w.key}`}
              aria-current={w.key === wave.key ? "page" : undefined}
              className={
                w.key === wave.key
                  ? "rounded-md bg-amber-900 px-3 py-1 text-xs font-semibold text-white"
                  : "rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900"
              }
            >
              {w.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

const TOC: Array<[string, string]> = [
  ["tong-quan", "1. Tổng quan"],
  ["nam-hoc", "2. Theo năm học"],
  ["nganh-nghe", "3. Theo ngành nghề mục tiêu"],
  ["diem", "4. Điểm quy đổi tham khảo"],
  ["nhan-xet", "5. Mẫu hình trong nhận xét của mentor"],
  ["chon-ngay", "6. Được mentor chọn ngay so với còn lại"]
];

function ScoreTable({ columns }: { columns: Array<{ key: string; label: string; summary: ScoreSummary }> }) {
  const criteria = columns.find((c) => c.summary.criteria.length)?.summary.criteria ?? [];
  return (
    <div className="vam-table-frame rounded-lg border border-vam-line bg-white">
      <table className="min-w-full divide-y divide-vam-line text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
          <tr>
            <th className={TH}>Tiêu chí (trọng số)</th>
            {columns.map((c) => (
              <th key={c.key} className={`${TH} text-right`}>
                {c.label}
                <span className="block font-normal text-slate-400">{formatInt(c.summary.count)} phiếu</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {criteria.map((criterion, index) => (
            <tr key={criterion.key}>
              <td className={TD}>
                {criterion.label} <span className="text-xs text-slate-500">({criterion.weight}%)</span>
              </td>
              {columns.map((c) => (
                <td key={c.key} className={NUM}>{formatScore(c.summary.criteria[index]?.avg ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-vam-line bg-slate-50 font-semibold">
          <tr>
            <td className={`${TD} text-vam-ink`}>Điểm quy đổi tham khảo (thang 5)</td>
            {columns.map((c) => (
              <td key={c.key} className={NUM}>{formatScore(c.summary.weighted)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GroupCell({ score }: { score: GroupScore }) {
  if (!score.count) return <span className="text-slate-300">—</span>;
  const few = score.count < FEW_FORMS;
  return (
    <span className={few ? "text-slate-400" : undefined} title={few ? "Ít phiếu — đọc thận trọng" : undefined}>
      {formatScore(score.avg)} <span className="text-xs text-slate-500">· {formatInt(score.count)} phiếu</span>
    </span>
  );
}

function InterviewerTable({ report }: { report: InterviewReport }) {
  const { rows, all } = report.interviewers;
  return (
    <div className={`${COLUMN} gap-2`}>
      <p className="text-sm text-slate-600">
        Trung bình chung của {formatInt(all.forms)} phiếu: <strong>{formatScore(all.avg)}</strong>
        {REPORT_GROUPS.map((g) => ` · ${REPORT_GROUP_LABELS[g]}: ${formatScore(all.byGroup[g].avg)}`).join("")}.
        Số in nhạt: người đó chấm dưới {FEW_FORMS} phiếu trong nhóm — chưa đủ để nói chấm chặt hay rộng.
      </p>
      <TableSearch placeholder="Tìm tên người phỏng vấn…">
        <div className="vam-table-frame rounded-lg border border-vam-line bg-white">
          <table className="min-w-full divide-y divide-vam-line text-sm" data-testid="interviewer-table">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className={TH}>Người phỏng vấn</th>
                <th className={`${TH} text-right`}>Số phiếu</th>
                <th className={`${TH} text-right`}>Điểm TB chung</th>
                {REPORT_GROUPS.map((g) => (
                  <th key={g} className={`${TH} text-right`}>{REPORT_GROUP_LABELS[g]}</th>
                ))}
                <th className={`${TH} text-right`}>Nhận ngay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vam-line">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className={`${TD} font-medium text-vam-ink`}>{row.name}</td>
                  <td className={NUM}>{formatInt(row.forms)}</td>
                  <td className={NUM}>{formatScore(row.avg)}</td>
                  {REPORT_GROUPS.map((g) => (
                    <td key={g} className={NUM}><GroupCell score={row.byGroup[g]} /></td>
                  ))}
                  <td className={NUM}>{row.taken ? formatInt(row.taken) : <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableSearch>
    </div>
  );
}

function NotesBlock({ sections }: { sections: NoteSection[] }) {
  return (
    <div className={`${COLUMN} gap-4`}>
      {sections.map((section) => (
        <div key={section.title} className={`${COLUMN} gap-2`}>
          <h4 className="font-semibold text-vam-ink">{section.title}</h4>
          {section.intro ? <p className="text-sm text-slate-600">{section.intro}</p> : null}
          {section.patterns?.length ? (
            <ol className={`${COLUMN} gap-2`}>
              {section.patterns.map((p) => (
                <li key={p.title} className="rounded-md border border-vam-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-vam-ink">{p.title}</p>
                    {p.count ? <span className="rounded bg-vam-mint px-2 py-0.5 text-xs font-medium text-vam-green">{p.count}</span> : null}
                  </div>
                  {p.where ? <p className="text-xs text-slate-500">Phần phiếu: {p.where}</p> : null}
                  <p className="mt-1 text-sm text-slate-700">{p.detail}</p>
                  {p.quotes?.length ? (
                    <ul className="mt-2 grid gap-1">
                      {p.quotes.map((q) => (
                        <li key={q} className="border-l-2 border-vam-line pl-2 text-sm italic text-slate-600">“{q}”</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {section.themes?.length ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {section.themes.map((t) => (
                <li key={t.label} className="flex items-baseline justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-700">{t.label}</span>
                  <span className="shrink-0 text-xs font-medium text-slate-500">{t.count}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {section.bullets?.length ? (
            <ul className="list-disc pl-5 text-sm text-slate-700">
              {section.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function ReportView({
  report,
  waves,
  notes,
  generatedAt
}: {
  report: InterviewReport;
  waves: InterviewWave[];
  notes: WaveNotes | null;
  generatedAt: string;
}) {
  const t = report.totals;
  const drift = notes ? notesDrift(notes, { passed: t.passed, rejected: t.rejected, needs_review: t.needs_review, taken: t.taken }) : null;
  const rest = t.passed - t.taken;
  const passRate = (row: CrossTabRow) => ratio(row.cells[0]?.count ?? 0, row.total);
  const takeRate = (row: CrossTabRow) => ratio(row.cells[0]?.count ?? 0, row.total);
  const groupScoreColumns = [
    ...REPORT_GROUPS.map((g) => ({ key: g, label: REPORT_GROUP_LABELS[g], summary: report.scores[g] })),
    { key: "all", label: "Tất cả", summary: report.scores.all }
  ];

  return (
    <div className={`${COLUMN} gap-4`} data-testid="report-root">
      <PageHeader
        title="Báo cáo phỏng vấn mentee"
        description="Kết quả phỏng vấn trực tiếp theo từng đợt: phân loại hồ sơ, năm học, ngành nghề mục tiêu, điểm theo người phỏng vấn và mẫu hình trong nhận xét của mentor."
      />
      <WaveBanner report={report} waves={waves} generatedAt={generatedAt} />

      <nav aria-label="Mục lục báo cáo" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {TOC.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="font-medium text-vam-green underline">{label}</a>
        ))}
      </nav>

      <Section
        id="tong-quan"
        title="1. Tổng quan"
        intro={
          <>
            Tỷ lệ của ba nhóm tính trên {formatInt(t.results)} hồ sơ đã có kết quả. {formatInt(t.interviewers)} người phỏng vấn
            {t.online ? `; ${formatInt(t.online)} buổi phỏng vấn online` : ""}.
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="totals">
          <KpiCard label="Hồ sơ đã đặt lịch" value={t.booked} helper={`${formatInt(t.notArrived)} bạn không đến${t.withdrawn ? ` · ${formatInt(t.withdrawn)} đã rút` : ""}`} />
          <KpiCard label="Đã đến phỏng vấn" value={t.attended} helper={t.pending ? `${formatInt(t.pending)} bạn đã đến nhưng chưa có kết quả` : "Mọi bạn đã đến đều có kết quả"} />
          <KpiCard label={REPORT_GROUP_LABELS.passed} value={t.passed} tone="success" helper={`${ratio(t.passed, t.results)} · ${formatInt(t.taken)} bạn được mentor chọn ngay`} />
          <KpiCard label={REPORT_GROUP_LABELS.rejected} value={t.rejected} tone="danger" helper={ratio(t.rejected, t.results)} />
          <KpiCard label={REPORT_GROUP_LABELS.needs_review} value={t.needs_review} tone="warning" helper={ratio(t.needs_review, t.results)} />
          <KpiCard label="Đạt, chờ vòng ghép cặp sau" value={rest} helper={`${formatInt(t.taken)} bạn đạt khác đã có mentor ở vòng 1 (${formatInt(t.mentorsTaking)} mentor nhận)`} />
        </div>
      </Section>

      <Section
        id="nam-hoc"
        title="2. Theo năm học"
        intro="Mỗi ô: số hồ sơ (tỷ lệ trong cột — so được cơ cấu giữa các nhóm có cỡ khác nhau). Cột cuối: trong các hồ sơ của dòng, bao nhiêu phần trăm Đạt."
      >
        <CrossTabTable tab={report.byYear} firstLabel="Năm học" extra={{ label: "Tỷ lệ đạt", value: passRate, total: ratio(t.passed, t.results) }} />
      </Section>

      <Section id="nganh-nghe" title="3. Theo ngành nghề mục tiêu" intro="Ngành mentee chọn trên form đăng ký, xếp theo số hồ sơ. Cách đọc như bảng năm học.">
        <CrossTabTable tab={report.byIndustry} firstLabel="Ngành nghề mục tiêu" extra={{ label: "Tỷ lệ đạt", value: passRate, total: ratio(t.passed, t.results) }} />
      </Section>

      <Section
        id="diem"
        title="4. Điểm quy đổi tham khảo"
        intro="Điểm thang 5 = tổng (điểm từng tiêu chí × trọng số) / 100, trọng số theo phiếu chấm của mùa. Chỉ để BTC tham khảo — phiếu không cộng tổng và không có điểm sàn."
      >
        <h3 className="font-semibold text-vam-ink">Điểm trung bình từng tiêu chí theo nhóm kết quả</h3>
        <ScoreTable columns={groupScoreColumns} />
        <h3 className="font-semibold text-vam-ink">Mức phù hợp về kỳ vọng (mục B của phiếu)</h3>
        <CrossTabTable tab={report.alignment} firstLabel="Mentor đánh giá" />
        <h3 className="font-semibold text-vam-ink">Theo từng người phỏng vấn</h3>
        <InterviewerTable report={report} />
      </Section>

      <Section
        id="nhan-xet"
        title="5. Mẫu hình trong nhận xét của mentor"
        intro={
          notes ? (
            <>
              {notes.method} Phân tích ngày {notes.writtenOn}. Trích dẫn đã bỏ mọi tên người, tên trường, tên công ty.
            </>
          ) : undefined
        }
      >
        {drift ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="notes-drift">{drift}</p>
        ) : null}
        {notes ? (
          <div className={`${COLUMN} gap-6`}>
            {REPORT_GROUPS.map((g) => (
              <div key={g} className={`${COLUMN} gap-3`}>
                <h3 className="border-b border-vam-line pb-1 text-base font-semibold text-vam-ink">
                  {REPORT_GROUP_LABELS[g]} — {formatInt(notes.basis[g])} phiếu
                </h3>
                <NotesBlock sections={notes.groups[g]} />
              </div>
            ))}
            {notes.dataQuality?.length ? (
              <div className={`${COLUMN} gap-1`}>
                <h3 className="font-semibold text-vam-ink">Chất lượng ghi chép trên phiếu</h3>
                <ul className="list-disc pl-5 text-sm text-slate-700">
                  {notes.dataQuality.map((d) => <li key={d}>{d}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-600" data-testid="notes-missing">
            Phần phân tích nhận xét của đợt này chưa có. Số liệu ở các mục khác vẫn là số hiện tại.
          </p>
        )}
      </Section>

      <Section
        id="chon-ngay"
        title="6. Trong nhóm (a): được mentor chọn ngay so với còn lại"
        intro={
          <>
            {formatInt(t.taken)}/{formatInt(t.passed)} bạn đạt ({ratio(t.taken, t.passed)}) được chính mentor phỏng vấn nhận ngay tại buổi,
            do {formatInt(t.mentorsTaking)} mentor nhận — đây là ghép cặp vòng 1. {formatInt(rest)} bạn đạt còn lại chờ các vòng ghép cặp sau.
            Cặp bấm nhầm đã huỷ không tính.
          </>
        }
      >
        <h3 className="font-semibold text-vam-ink">Theo năm học</h3>
        <CrossTabTable tab={report.taken.byYear} firstLabel="Năm học" extra={{ label: "Tỷ lệ được chọn", value: takeRate, total: ratio(t.taken, t.passed) }} />
        <h3 className="font-semibold text-vam-ink">Theo ngành nghề mục tiêu</h3>
        <CrossTabTable tab={report.taken.byIndustry} firstLabel="Ngành nghề mục tiêu" extra={{ label: "Tỷ lệ được chọn", value: takeRate, total: ratio(t.taken, t.passed) }} />
        <h3 className="font-semibold text-vam-ink">Điểm trung bình từng tiêu chí</h3>
        <ScoreTable
          columns={[
            { key: "taken", label: "Được mentor chọn ngay", summary: report.taken.scores.taken },
            { key: "rest", label: "Đạt, chưa có mentor", summary: report.taken.scores.rest }
          ]}
        />
        <h3 className="font-semibold text-vam-ink">Mức phù hợp về kỳ vọng (mục B)</h3>
        <CrossTabTable tab={report.taken.alignment} firstLabel="Mentor đánh giá" />
        <h3 className="font-semibold text-vam-ink">Nhóm còn lại: mentor phỏng vấn đã chọn gì ở mục C</h3>
        <CrossTabTable tab={report.taken.restChoices} firstLabel="Lựa chọn ở mục C" />
        {notes?.takenVsRest.length ? (
          <>
            <h3 className="font-semibold text-vam-ink">Khác biệt trong nhận xét</h3>
            <NotesBlock sections={notes.takenVsRest} />
          </>
        ) : null}
      </Section>
    </div>
  );
}
