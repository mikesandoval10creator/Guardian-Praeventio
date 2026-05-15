// Praeventio Guard — Sprint 45 Fase B.11: Matriz de riesgos 5x5 ISO 31000:2018.
//
// Cierra B.11 del plan maestro. Visualización ejecutiva donde cada
// nodo NodeType.RISK/FINDING/INCIDENT se ubica en su celda
// (probabilidad × impacto). Colores por severidad ISO 31000:
//   - Bajo (verde): 1-4
//   - Medio (amarillo): 5-9
//   - Alto (naranja): 10-15
//   - Extremo (rojo): 16-25
//
// Usa Recharts ScatterChart (instalado en Sprint 45). Tooltip personalizado
// y leyenda de cuadrantes.

import { useMemo } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
  Legend,
  ReferenceArea,
} from 'recharts';

export interface RiskMatrixNode {
  id: string;
  /** Etiqueta human-readable. */
  label: string;
  /** Probabilidad 1-5 (1=raro, 5=casi seguro). */
  probability: 1 | 2 | 3 | 4 | 5;
  /** Impacto 1-5 (1=insignificante, 5=catastrófico). */
  impact: 1 | 2 | 3 | 4 | 5;
  /** Tipo de nodo. */
  kind?: 'risk' | 'finding' | 'incident';
}

export interface RiskMatrix5x5Props {
  nodes: ReadonlyArray<RiskMatrixNode>;
  /** Click handler opcional para abrir detalle. */
  onNodeClick?: (node: RiskMatrixNode) => void;
  /** Tono visual. */
  appearance?: 'light' | 'dark';
}

type SeverityBand = 'low' | 'medium' | 'high' | 'extreme';

export function severityForCell(prob: number, impact: number): SeverityBand {
  const score = prob * impact;
  if (score <= 4) return 'low';
  if (score <= 9) return 'medium';
  if (score <= 15) return 'high';
  return 'extreme';
}

const BAND_COLOR: Record<SeverityBand, string> = {
  low: '#10b981', // emerald-500
  medium: '#fbbf24', // amber-400
  high: '#fb923c', // orange-400
  extreme: '#ef4444', // rose-500
};

const PROB_LABELS = ['', 'Raro', 'Improbable', 'Posible', 'Probable', 'Casi seguro'];
const IMPACT_LABELS = ['', 'Insignificante', 'Menor', 'Moderado', 'Mayor', 'Catastrófico'];

interface ChartDatum {
  probability: number;
  impact: number;
  id: string;
  label: string;
  kind: string;
  band: SeverityBand;
}

function buildData(nodes: ReadonlyArray<RiskMatrixNode>): ChartDatum[] {
  // Jitter pequeño determinístico para que nodos en la misma celda no
  // se sobrelapen completamente.
  const cellCounter = new Map<string, number>();
  return nodes.map((n) => {
    const key = `${n.probability}|${n.impact}`;
    const idx = cellCounter.get(key) ?? 0;
    cellCounter.set(key, idx + 1);
    const offset = ((idx % 4) - 1.5) * 0.08;
    return {
      probability: n.probability + offset,
      impact: n.impact + (Math.floor(idx / 4) % 4 - 1.5) * 0.08,
      id: n.id,
      label: n.label,
      kind: n.kind ?? 'risk',
      band: severityForCell(n.probability, n.impact),
    };
  });
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartDatum }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]!.payload;
  return (
    <div
      data-testid="risk-matrix.tooltip"
      className="rounded-lg border border-slate-200 bg-white p-2 shadow-md text-xs"
      style={{ pointerEvents: 'none' }}
    >
      <p className="font-semibold">{d.label}</p>
      <p className="opacity-70">
        Prob: {PROB_LABELS[Math.round(d.probability)] ?? '—'} · Impacto:{' '}
        {IMPACT_LABELS[Math.round(d.impact)] ?? '—'}
      </p>
      <p className="font-medium" style={{ color: BAND_COLOR[d.band] }}>
        Severidad: {d.band}
      </p>
    </div>
  );
}

export function RiskMatrix5x5({ nodes, onNodeClick, appearance = 'light' }: RiskMatrix5x5Props) {
  const data = useMemo(() => buildData(nodes), [nodes]);
  const isDark = appearance === 'dark';

  return (
    <section
      data-testid="risk-matrix"
      className={`rounded-2xl border p-4 ${
        isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white'
      }`}
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h3
          data-testid="risk-matrix.title"
          className={`text-base font-semibold ${isDark ? 'text-teal-300' : 'text-teal-700'}`}
        >
          Matriz de Riesgos 5×5 (ISO 31000:2018)
        </h3>
        <p className="text-xs opacity-70" data-testid="risk-matrix.count">
          {nodes.length} elementos
        </p>
      </header>

      <div className="h-80 w-full" data-testid="risk-matrix.chart-area">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 24, bottom: 36, left: 36 }}>
            {/* Background quadrants — render before scatter so dots appear on top */}
            <ReferenceArea x1={0.5} x2={2.5} y1={0.5} y2={2.5} fill={BAND_COLOR.low} fillOpacity={0.18} stroke="" />
            <ReferenceArea x1={0.5} x2={2.5} y1={2.5} y2={5.5} fill={BAND_COLOR.medium} fillOpacity={0.18} stroke="" />
            <ReferenceArea x1={2.5} x2={5.5} y1={0.5} y2={2.5} fill={BAND_COLOR.medium} fillOpacity={0.18} stroke="" />
            <ReferenceArea x1={2.5} x2={4.5} y1={2.5} y2={4.5} fill={BAND_COLOR.high} fillOpacity={0.18} stroke="" />
            <ReferenceArea x1={4.5} x2={5.5} y1={2.5} y2={5.5} fill={BAND_COLOR.extreme} fillOpacity={0.18} stroke="" />
            <ReferenceArea x1={2.5} x2={4.5} y1={4.5} y2={5.5} fill={BAND_COLOR.extreme} fillOpacity={0.18} stroke="" />

            <XAxis
              type="number"
              dataKey="probability"
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              tickFormatter={(v) => PROB_LABELS[v] ?? ''}
              label={{ value: 'Probabilidad', position: 'insideBottom', offset: -16 }}
              stroke={isDark ? '#cbd5e1' : '#475569'}
            />
            <YAxis
              type="number"
              dataKey="impact"
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              tickFormatter={(v) => IMPACT_LABELS[v] ?? ''}
              label={{ value: 'Impacto', angle: -90, position: 'insideLeft', offset: -10 }}
              stroke={isDark ? '#cbd5e1' : '#475569'}
            />
            <ZAxis range={[80, 80]} />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <Legend
              verticalAlign="top"
              // @ts-expect-error recharts Legend.payload type generic is
              // ultra-strict and doesn't accept this minimal shape; the
              // runtime works fine — recharts only reads value/type/color.
              payload={[
                { value: 'Bajo', type: 'circle', color: BAND_COLOR.low },
                { value: 'Medio', type: 'circle', color: BAND_COLOR.medium },
                { value: 'Alto', type: 'circle', color: BAND_COLOR.high },
                { value: 'Extremo', type: 'circle', color: BAND_COLOR.extreme },
              ]}
            />
            <Scatter
              data={data}
              onClick={(d: unknown) => {
                const payload = (d as { payload?: ChartDatum }).payload;
                if (payload && onNodeClick) {
                  const original = nodes.find((n) => n.id === payload.id);
                  if (original) onNodeClick(original);
                }
              }}
              cursor={onNodeClick ? 'pointer' : 'default'}
            >
              {data.map((d) => (
                <Cell key={d.id} fill={BAND_COLOR[d.band]} stroke="#1e293b" strokeWidth={1} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <footer className="mt-3 text-xs opacity-70" data-testid="risk-matrix.footer">
        Score = Probabilidad × Impacto. Bajo 1-4 · Medio 5-9 · Alto 10-15 · Extremo 16-25.
      </footer>
    </section>
  );
}
