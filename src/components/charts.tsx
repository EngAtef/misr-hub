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
      <Chart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} stroke="#94a3b8" />
        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={numberFmt} width={55} />
        <Tooltip formatter={(v) => numberFmt(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) =>
          type === "line" ? (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color ?? CHART_COLORS[i]}
              strokeWidth={2}
              dot={false}
            />
          ) : (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color ?? CHART_COLORS[i]}
              fill={s.color ?? CHART_COLORS[i]}
              fillOpacity={0.12}
              strokeWidth={2}
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
      <BarChart data={data} layout={layout} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        {layout === "horizontal" ? (
          <>
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} stroke="#94a3b8" interval={0} angle={-25} textAnchor="end" height={70} />
            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={numberFmt} width={55} />
          </>
        ) : (
          <>
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={numberFmt} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11 }} stroke="#94a3b8" width={140} />
          </>
        )}
        <Tooltip formatter={(v) => numberFmt(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color ?? CHART_COLORS[i]} radius={[4, 4, 0, 0]} />
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={95}
          paddingAngle={2}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => numberFmt(Number(v))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
