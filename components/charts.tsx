"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#16834c", "#4f9f73", "#7bb995", "#d08a2f", "#5b7c99", "#9c6ade"];

export function BarSummary({
  data,
  highlightedName,
  tooltipLabelPrefix = "Mục",
  valueLabel = "Số lượng"
}: {
  data: Array<{ name: string; value: number }>;
  highlightedName?: string;
  tooltipLabelPrefix?: string;
  valueLabel?: string;
}) {
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-500">Chưa có dữ liệu biểu đồ.</div>;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dce9e2" />
          <XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(value: number | string) => [String(value), valueLabel]} labelFormatter={(label) => `${tooltipLabelPrefix}: ${label}`} />
          <Bar dataKey="value" fill="#16834c" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.name === highlightedName ? "#d08a2f" : "#16834c"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutSummary({ data }: { data: Array<{ name: string; value: number }> }) {
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-500">Chưa có dữ liệu biểu đồ.</div>;
  return (
    <div className="grid gap-4">
      <div className="mx-auto h-64 w-full max-w-sm">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2}>
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value: number | string, name: string) => [String(value), name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-2 text-sm text-slate-600">
        {data.map((item, index) => (
          <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-vam-line bg-white px-3 py-2">
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
              <span className="min-w-0 break-words leading-5">{item.name}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-vam-ink">{item.value.toLocaleString("vi-VN")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
