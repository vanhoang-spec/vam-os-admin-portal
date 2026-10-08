import { formatShare, type CrossTab, type CrossTabRow } from "@/lib/report-crosstab-core";
import { formatInt } from "@/lib/utils";

/**
 * Bảng đếm chéo của các trang báo cáo: mỗi ô "số (tỷ lệ trong cột)". Tách ra từ báo
 * cáo phỏng vấn mentee ngày 08/10/2026 để báo cáo tuyển mentor vẽ y hệt.
 */

export const REPORT_TH = "px-3 py-2";
export const REPORT_TD = "px-3 py-2 text-slate-700";
export const REPORT_NUM = "px-3 py-2 text-right tabular-nums text-slate-700";

export function CrossTabTable({
  tab,
  firstLabel,
  unit = "hồ sơ",
  extra,
  testId
}: {
  tab: CrossTab;
  firstLabel: string;
  /** Chữ dưới tổng mỗi cột: "hồ sơ", "mentor"… */
  unit?: string;
  extra?: { label: string; value: (row: CrossTabRow) => string; total: string };
  testId?: string;
}) {
  const grand = tab.columns.reduce((sum, c) => sum + c.total, 0);
  return (
    <div className="vam-table-frame rounded-lg border border-vam-line bg-white" data-testid={testId}>
      <table className="min-w-full divide-y divide-vam-line text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
          <tr>
            <th className={REPORT_TH}>{firstLabel}</th>
            {tab.columns.map((c) => (
              <th key={c.key} className={`${REPORT_TH} text-right`}>
                {c.label}
                <span className="block font-normal text-slate-400">
                  {formatInt(c.total)} {unit}
                </span>
              </th>
            ))}
            <th className={`${REPORT_TH} text-right`}>Tổng</th>
            {extra ? <th className={`${REPORT_TH} text-right`}>{extra.label}</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {tab.rows.map((row) => (
            <tr key={row.key} data-row={row.key}>
              <td className={`${REPORT_TD} font-medium text-vam-ink`}>{row.label}</td>
              {row.cells.map((cell, i) => (
                <td key={tab.columns[i].key} className={REPORT_NUM}>
                  {cell.count ? (
                    <>
                      {formatInt(cell.count)} <span className="text-xs text-slate-500">({formatShare(cell.share)})</span>
                    </>
                  ) : (
                    <span className="text-slate-300">0</span>
                  )}
                </td>
              ))}
              <td className={`${REPORT_NUM} font-medium`}>{formatInt(row.total)}</td>
              {extra ? <td className={`${REPORT_NUM} font-medium`}>{extra.value(row)}</td> : null}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-vam-line bg-slate-50 font-semibold">
          <tr>
            <td className={`${REPORT_TD} text-vam-ink`}>Tổng</td>
            {tab.columns.map((c) => (
              <td key={c.key} className={REPORT_NUM}>
                {formatInt(c.total)}
              </td>
            ))}
            <td className={REPORT_NUM}>{formatInt(grand)}</td>
            {extra ? <td className={REPORT_NUM}>{extra.total}</td> : null}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
