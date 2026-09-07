"use client";

import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { useLang } from "@/components/shared/language-context";
import { t } from "@/lib/i18n";

export interface MonthPoint {
  label: string;
  count: number;
  earningsSen: number;
}

/** Mechanic 月度趋势：柱=完成工单数，线=总佣金（RM）。 */
export function MonthlyEarningsChart({ data }: { data: MonthPoint[] }) {
  const lang = useLang();
  const rows = data.map((d) => ({ label: d.label, jobs: d.count, earnings: Math.round(d.earningsSen / 100) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={rows} margin={{ top: 8, right: 0, left: -14, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => "RM" + v} />
        <Tooltip
          formatter={(v, name) => (name === t("mech.jobs", lang) ? String(v) + " " + t("mech.jobs", lang) : "RM" + Number(v).toLocaleString())}
          labelStyle={{ fontSize: 12 }}
          contentStyle={{ borderRadius: 12, fontSize: 12 }}
          cursor={{ fill: "hsl(var(--muted))" }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar yAxisId="left" dataKey="jobs" name={t("mech.jobs", lang)} fill="oklch(0.62 0.19 45)" radius={[4, 4, 0, 0]} />
        <Line yAxisId="right" type="monotone" dataKey="earnings" name={t("mech.total-commission", lang)} stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
