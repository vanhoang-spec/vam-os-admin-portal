"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Card } from "@/components/ui";
import {
  METRIC_SPECS,
  formatNumber,
  metricSpec,
  toCsv,
  type MetricKey,
  type ProgramColumn,
  type ReportTable
} from "@/lib/cross-program-report-core";

/**
 * The three selectors and the table they produce.
 *
 * Every choice lives in the URL rather than in component state, so a report can
 * be bookmarked and sent to somebody — which is most of what a reporting screen
 * is for. The table itself is rendered on the server; this component only
 * changes the address and offers the two exports.
 */

const chipBase =
  "rounded-full border px-3 py-1 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vam-green";
const chipOn = "border-vam-green bg-vam-mint text-vam-ink";
const chipOff = "border-vam-line bg-white text-slate-600 hover:bg-slate-50";

export function ReportClient({
  availablePrograms,
  selectedProgramIds,
  table
}: {
  availablePrograms: ProgramColumn[];
  selectedProgramIds: string[];
  table: ReportTable | null;
}) {
  const router = useRouter();

  const [programs, setPrograms] = useState<string[]>(selectedProgramIds);
  const [metrics, setMetrics] = useState<MetricKey[]>(table?.metrics ?? []);
  const [from, setFrom] = useState(table?.range.from ?? "");
  const [to, setTo] = useState(table?.range.to ?? "");

  const allSelected = programs.length === 0 || programs.length === availablePrograms.length;

  const apply = () => {
    const query = new URLSearchParams();
    if (!allSelected) for (const id of programs) query.append("program", id);
    for (const metric of metrics) query.append("metric", metric);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    router.push(`/bao-cao${query.toString() ? `?${query.toString()}` : ""}`);
  };

  const toggleProgram = (programId: string) =>
    setPrograms((current) =>
      current.includes(programId)
        ? current.filter((value) => value !== programId)
        : [...current, programId]
    );

  const toggleMetric = (metric: MetricKey) =>
    setMetrics((current) =>
      current.includes(metric) ? current.filter((value) => value !== metric) : [...current, metric]
    );

  return (
    <div className="grid gap-6">
      <Card>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Từ ngày
              </span>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="h-10 rounded-md border border-vam-line px-2 text-sm"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Đến ngày
              </span>
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="h-10 rounded-md border border-vam-line px-2 text-sm"
              />
            </label>
            <div className="grid gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Hoặc</span>
              <button
                type="button"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
                className={`h-10 ${chipBase} ${!from && !to ? chipOn : chipOff}`}
              >
                Toàn bộ thời gian
              </button>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Chương trình
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPrograms([])}
                className={`${chipBase} ${allSelected ? chipOn : chipOff}`}
              >
                Tất cả chương trình
              </button>
              {availablePrograms.map((program) => (
                <button
                  key={program.programId}
                  type="button"
                  onClick={() => toggleProgram(program.programId)}
                  className={`${chipBase} ${
                    !allSelected && programs.includes(program.programId) ? chipOn : chipOff
                  }`}
                >
                  {program.programName}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Loại số liệu
            </div>
            <div className="flex flex-wrap gap-2">
              {METRIC_SPECS.map((spec) => (
                <button
                  key={spec.key}
                  type="button"
                  onClick={() => toggleMetric(spec.key)}
                  className={`${chipBase} ${metrics.includes(spec.key) ? chipOn : chipOff}`}
                >
                  {spec.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={apply}
              className="h-11 rounded-md bg-vam-green px-5 text-sm font-medium text-white hover:bg-vam-green/90"
            >
              Xem báo cáo
            </button>
          </div>
        </div>
      </Card>

      {table && table.columns.length > 0 ? <ReportTableView table={table} /> : null}
    </div>
  );
}

function ReportTableView({ table }: { table: ReportTable }) {
  const download = (filename: string, content: string, type: string) => {
    // The BOM is what makes Excel on Windows read Vietnamese correctly.
    const blob = new Blob(["﻿", content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const stamp = `${table.range.from || "tatca"}_${table.range.to || "tatca"}`;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-vam-ink">Kết quả</h2>
          <p className="mt-1 text-sm text-slate-500">{table.range.label}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => download(`vam-bao-cao-${stamp}.csv`, toCsv(table), "text/csv;charset=utf-8")}
            className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
          >
            Xuất CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-vam-line px-3 py-2 text-sm font-medium text-vam-green hover:bg-vam-mint"
          >
            Xuất PDF
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="border-b border-vam-line px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Chỉ số
              </th>
              {table.columns.map((column) => (
                <th
                  key={column.programId}
                  className="border-b border-vam-line px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  {column.programName}
                </th>
              ))}
              {table.totals ? (
                <th className="border-b border-vam-line px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-vam-green">
                  Tổng
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {table.metrics.map((metric) => (
              <tr key={metric}>
                <td className="border-b border-vam-line px-3 py-2 text-vam-ink">
                  {metricSpec(metric).label}
                </td>
                {table.columns.map((column) => (
                  <td
                    key={column.programId}
                    className="border-b border-vam-line px-3 py-2 text-right text-vam-ink"
                  >
                    {formatNumber(table.byProgram[column.programId]?.[metric] ?? 0)}
                  </td>
                ))}
                {table.totals ? (
                  <td className="border-b border-vam-line px-3 py-2 text-right font-semibold text-vam-ink">
                    {formatNumber(table.totals[metric])}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-1 text-xs text-slate-500">
        {table.metrics.map((metric) => (
          <p key={metric}>
            <strong className="font-medium text-slate-600">{metricSpec(metric).label}:</strong>{" "}
            {metricSpec(metric).note}
          </p>
        ))}
      </div>

      {table.totalCaveats.length > 0 ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Cột <strong>Tổng</strong> của{" "}
          {table.totalCaveats.map((metric) => metricSpec(metric).label).join(", ")} là phép cộng các
          chương trình. Một người tham gia hai chương trình sẽ được đếm ở cả hai cột, nên tổng là con
          số tối đa, không phải số người thật.
        </p>
      ) : null}
    </Card>
  );
}
