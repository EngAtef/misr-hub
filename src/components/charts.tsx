"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { CHART_COLORS } from "@/lib/utils";

const numberFmt = (v: number) => new Intl.NumberFormat("en-EG", { maximumFractionDigits: 0 }).format(v);

// 12500 -> 12.5k for axis ticks
const compactFmt = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return String(v);
};

// "2026-06-14" -> "14 Jun"
const dayFmt = (v: unknown) => {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  return s;
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3.5 py-2.5 shadow-lg backdrop-blur text-xs" dir="ltr">
      <div className="font-bold text-slate-700 mb-1.5">{dayFmt(label)}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-500">{p.name}</span>
          <span className="ms-auto font-bold text-slate-800 ps-3">{numberFmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

const axisStyle = { fontSize: 11, fill: "#94a3b8" };

export function TrendChart({
  data,
  xKey,
  series,
  type = "area",
  height = 280,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; name: string; color?: string }[];
  type?: "line" | "area";
  height?: number;
}) {
  const Chart = type === "line" ? LineChart : AreaChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? CHART_COLORS[i];
            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="4 6" stroke="#eef2f7" vertical={false} />
        <XAxis dataKey={xKey} tick={axisStyle} stroke="#e2e8f0" tickLine={false} tickFormatter={dayFmt} minTickGap={24} />
        <YAxis tick={axisStyle} stroke="transparent" tickLine={false} tickFormatter={compactFmt} width={44} />
        <Tooltip content={<ChartTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={9} />
        {series.map((s, i) =>
          type === "line" ? (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color ?? CHART_COLORS[i]}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            />
          ) : (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color ?? CHART_COLORS[i]}
              fill={`url(#grad-${s.key})`}
              strokeWidth={2.5}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            />
          )
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

export function BarsChart({
  data,
  xKey,
  series,
  height = 280,
  layout = "horizontal",
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; name: string; color?: string }[];
  height?: number;
  layout?: "horizontal" | "vertical";
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="4 6" stroke="#eef2f7" horizontal={layout === "horizontal"} vertical={layout === "vertical"} />
        {layout === "horizontal" ? (
          <>
            <XAxis dataKey={xKey} tick={{ ...axisStyle, fontSize: 10.5 }} stroke="#e2e8f0" tickLine={false} interval={0} angle={-25} textAnchor="end" height={70} />
            <YAxis tick={axisStyle} stroke="transparent" tickLine={false} tickFormatter={compactFmt} width={44} />
          </>
        ) : (
          <>
            <XAxis type="number" tick={axisStyle} stroke="#e2e8f0" tickLine={false} tickFormatter={compactFmt} />
            <YAxis type="category" dataKey={xKey} tick={{ ...axisStyle, fill: "#475569" }} stroke="transparent" tickLine={false} width={150} />
          </>
        )}
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9", opacity: 0.6 }} />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={9} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color ?? CHART_COLORS[i]}
            radius={layout === "horizontal" ? [6, 6, 0, 0] : [0, 6, 6, 0]}
            maxBarSize={38}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({
  data,
  nameKey,
  valueKey,
  height = 280,
}: {
  data: Record<string, unknown>[];
  nameKey: string;
  valueKey: string;
  height?: number;
}) {
  const total = data.reduce((s, d) => s + Number(d[valueKey] ?? 0), 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={96}
          paddingAngle={2.5}
          cornerRadius={4}
          label={({ percent }) => (percent && percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : "")}
          labelLine={false}
          fontSize={11}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="#fff" strokeWidth={2} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v) => [`${numberFmt(Number(v))} (${total ? ((Number(v) / total) * 100).toFixed(1) : 0}%)`]}
          contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} iconType="circle" iconSize={9} />
      </PieChart>
    </ResponsiveContainer>
  );
}
