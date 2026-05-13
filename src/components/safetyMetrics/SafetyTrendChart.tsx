// Praeventio Guard — Sprint 45 D.10 cierre UI: Trend Chart con Recharts.
//
// Cierra Fase D.10 (parte UI) — la lógica OSHA/ILO existía como motor
// puro en `services/safetyMetrics/osha.ts` pero el dashboard solo mostraba
// números. Este componente agrega visualización temporal de TRIR / LTIFR /
// DART / SIFR con Recharts LineChart.
//
// Componente presentacional: padre calcula la serie temporal (12 meses
// rolling, por ejemplo) y este renderiza.

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

export interface SafetyTrendPoint {
  /** Etiqueta del período (e.g. "2026-04"). */
  period: string;
  /** Total Recordable Incident Rate. */
  trir?: number;
  /** Lost Time Injury Frequency Rate. */
  ltifr?: number;
  /** Days Away, Restricted, Transferred. */
  dart?: number;
  /** Serious Injuries and Fatalities Rate. */
  sifr?: number;
}

export interface SafetyTrendChartProps {
  data: ReadonlyArray<SafetyTrendPoint>;
  /** Benchmark a mostrar como línea horizontal (default: industria all-US). */
  industryBenchmark?: {
    trir?: number;
    ltifr?: number;
  };
  /** Qué métricas mostrar. */
  metricsShown?: {
    trir?: boolean;
    ltifr?: boolean;
    dart?: boolean;
    sifr?: boolean;
  };
  /** Tono visual. */
  appearance?: 'light' | 'dark';
}

const COLORS = {
  trir: '#0d9488', // teal-600
  ltifr: '#f97316', // orange-500
  dart: '#8b5cf6', // violet-500
  sifr: '#ef4444', // rose-500
};

export function SafetyTrendChart({
  data,
  industryBenchmark,
  metricsShown = { trir: true, ltifr: true, dart: false, sifr: false },
  appearance = 'light',
}: SafetyTrendChartProps) {
  const isDark = appearance === 'dark';
  const gridColor = isDark ? '#334155' : '#e2e8f0';
  const axisColor = isDark ? '#cbd5e1' : '#475569';

  const sortedData = useMemo(
    () => [...data].sort((a, b) => a.period.localeCompare(b.period)),
    [data],
  );

  return (
    <section
      data-testid="safety-trend.chart"
      className={`rounded-2xl border p-4 ${
        isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white'
      }`}
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h3
          data-testid="safety-trend.title"
          className={`text-base font-semibold ${isDark ? 'text-teal-300' : 'text-teal-700'}`}
        >
          Tendencia métricas de seguridad (OSHA/ILO)
        </h3>
        <p className="text-xs opacity-70" data-testid="safety-trend.count">
          {sortedData.length} períodos
        </p>
      </header>

      <div className="h-72 w-full" data-testid="safety-trend.chart-area">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sortedData as SafetyTrendPoint[]} margin={{ top: 10, right: 24, bottom: 24, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="period" stroke={axisColor} />
            <YAxis stroke={axisColor} />
            <Tooltip
              contentStyle={{
                background: isDark ? '#1e293b' : '#ffffff',
                border: `1px solid ${gridColor}`,
                borderRadius: '8px',
              }}
            />
            <Legend />
            {industryBenchmark?.trir !== undefined && (
              <ReferenceLine
                y={industryBenchmark.trir}
                stroke={COLORS.trir}
                strokeDasharray="6 3"
                label={{
                  value: `TRIR industria ${industryBenchmark.trir}`,
                  position: 'right',
                  fill: COLORS.trir,
                  fontSize: 11,
                }}
              />
            )}
            {industryBenchmark?.ltifr !== undefined && (
              <ReferenceLine
                y={industryBenchmark.ltifr}
                stroke={COLORS.ltifr}
                strokeDasharray="6 3"
                label={{
                  value: `LTIFR industria ${industryBenchmark.ltifr}`,
                  position: 'right',
                  fill: COLORS.ltifr,
                  fontSize: 11,
                }}
              />
            )}
            {metricsShown.trir && (
              <Line
                type="monotone"
                dataKey="trir"
                name="TRIR"
                stroke={COLORS.trir}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            )}
            {metricsShown.ltifr && (
              <Line
                type="monotone"
                dataKey="ltifr"
                name="LTIFR"
                stroke={COLORS.ltifr}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            )}
            {metricsShown.dart && (
              <Line
                type="monotone"
                dataKey="dart"
                name="DART"
                stroke={COLORS.dart}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            )}
            {metricsShown.sifr && (
              <Line
                type="monotone"
                dataKey="sifr"
                name="SIFR"
                stroke={COLORS.sifr}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <footer className="mt-2 text-xs opacity-60" data-testid="safety-trend.footer">
        Líneas punteadas: benchmark industria. Tendencia descendente es mejora.
      </footer>
    </section>
  );
}
