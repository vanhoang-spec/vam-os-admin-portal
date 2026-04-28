"use client";

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["#16834c", "#4f9f73", "#7bb995", "#d08a2f", "#5b7c99", "#9c6ade"];

export function BarSummary({ data }: { data: Array<{ name: string; value: number }> }) {
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-500">Chưa có dữ liệu biểu đồ.</div>;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dce9e2" />
          <XAxis dataKey="name" angle={-20} textAnchor="end" interval={0} tick={{ fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#16834c" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutSummary({ data }: { data: Array<{ name: string; value: number }> }) {
  if (!data.length) return <div className="py-8 text-center text-sm text-slate-500">Chưa có dữ liệu biểu đồ.</div>;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
        {data.map((item, index) => (
          <span key={item.name} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
            {item.name}: {item.value}
          </span>
        ))}
      </div>
    </div>
  );
}
