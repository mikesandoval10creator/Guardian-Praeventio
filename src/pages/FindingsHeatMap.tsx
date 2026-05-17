// Praeventio Guard — Sprint 55 Fase F.14 page wrapper.
//
// Mapa de Calor de Hallazgos: visualiza la distribución espacial de
// findings por zona geográfica. El servicio `findingsHeatmapBuilder`
// ya entrega celdas con weight + dominantSeverity; esta página la
// renderiza como un grid color-coded.
//
// Render strategy: SVG top-down sobre el bbox normalizado. NO usa
// Maps API (cero deps externas, offline-safe). Cada celda se pinta
// con el color de su `dominantSeverity` y opacidad proporcional al
// weight. El usuario puede ajustar:
//   - gridSizeM (50 / 100 / 200 / 500 m)
//   - rango de fechas (últimos 7 / 30 / 90 días)
//   - filtro por severidad mínima
//
// Directiva 2: NO bloquea decisiones, sólo asiste. Directiva 4:
// fuentes externas (si las hay) van como dato discreto.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map, WifiOff } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  bboxOf,
  buildHeatmapCells,
  pickHotspots,
  SEVERITY_WEIGHT,
  type FindingPoint,
  type HeatCell,
  type Severity,
} from '../services/heatmap/findingsHeatmapBuilder';

// Severity → color token (consistente con el sistema 4-modos).
const SEVERITY_COLORS: Record<Severity, string> = {
  low: '#4db6ac', // teal — bajo
  medium: '#fbbf24', // amber — medio
  high: '#fb923c', // orange — alto
  critical: '#dc2626', // rojo — crítico
};

const GRID_SIZE_OPTIONS = [50, 100, 200, 500] as const;
const PERIOD_OPTIONS = [7, 30, 90] as const;
const SEVERITY_OPTIONS: Severity[] = ['low', 'medium', 'high', 'critical'];

interface FindingsHeatMapProps {
  /** Inyección de findings (testing). En prod, el caller server-side hace
   *  fetch desde el grafo Zettelkasten. Por ahora la página acepta una
   *  prop opcional + fallback a empty state. */
  findings?: FindingPoint[];
}

/** Filtra findings dentro de la ventana temporal solicitada. */
function filterByWindow(findings: FindingPoint[], windowDays: number, now: Date): FindingPoint[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;
  return findings.filter((f) => {
    const t = Date.parse(f.occurredAt);
    return Number.isFinite(t) && t >= cutoff;
  });
}

/** Filtra findings por severidad mínima. */
function filterBySeverity(findings: FindingPoint[], min: Severity): FindingPoint[] {
  const minWeight = SEVERITY_WEIGHT[min];
  return findings.filter((f) => SEVERITY_WEIGHT[f.severity] >= minWeight);
}

export function FindingsHeatMap({ findings = [] }: FindingsHeatMapProps) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  const [gridSizeM, setGridSizeM] = useState<number>(100);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [minSeverity, setMinSeverity] = useState<Severity>('low');

  const filtered = useMemo(() => {
    const w = filterByWindow(findings, windowDays, new Date());
    return filterBySeverity(w, minSeverity);
  }, [findings, windowDays, minSeverity]);

  const cells = useMemo<HeatCell[]>(
    () => (filtered.length > 0 ? buildHeatmapCells(filtered, { gridSizeM }) : []),
    [filtered, gridSizeM],
  );

  const bbox = useMemo(() => bboxOf(filtered), [filtered]);
  const hotspots = useMemo(() => pickHotspots(cells, 5), [cells]);
  const maxWeight = useMemo(
    () => cells.reduce((mx, c) => (c.weight > mx ? c.weight : mx), 0),
    [cells],
  );

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="findings-heatmap-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Map
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('findingsHeatMap.page.title', 'Mapa de Calor de Hallazgos')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'findingsHeatMap.page.selectProject',
              'Selecciona un proyecto para ver la distribución espacial de los hallazgos.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-6xl mx-auto space-y-4"
      data-testid="findings-heatmap-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center border border-rose-500/20">
          <Map className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('findingsHeatMap.page.title', 'Mapa de Calor de Hallazgos')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'findingsHeatMap.page.subtitle',
              'Distribución espacial por zona. {{cells}} celda(s) sobre {{points}} hallazgo(s).',
              { cells: cells.length, points: filtered.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="findings-heatmap-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {/* Controls */}
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 flex flex-wrap gap-4"
        data-testid="findings-heatmap-controls"
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="grid-size"
            className="text-xs font-bold uppercase tracking-wider text-secondary-token"
          >
            {t('findingsHeatMap.controls.gridSize', 'Tamaño celda (m)')}
          </label>
          <select
            id="grid-size"
            value={gridSizeM}
            onChange={(e) => setGridSizeM(Number(e.target.value))}
            className="rounded-lg border border-default-token bg-surface px-3 py-1.5 text-sm text-primary-token"
            data-testid="findings-heatmap-grid-size"
          >
            {GRID_SIZE_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g} m
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="window-days"
            className="text-xs font-bold uppercase tracking-wider text-secondary-token"
          >
            {t('findingsHeatMap.controls.period', 'Período (días)')}
          </label>
          <select
            id="window-days"
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="rounded-lg border border-default-token bg-surface px-3 py-1.5 text-sm text-primary-token"
            data-testid="findings-heatmap-window"
          >
            {PERIOD_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {t('findingsHeatMap.controls.lastN', 'Últimos {{n}}', { n: d })}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="min-severity"
            className="text-xs font-bold uppercase tracking-wider text-secondary-token"
          >
            {t('findingsHeatMap.controls.minSeverity', 'Severidad mínima')}
          </label>
          <select
            id="min-severity"
            value={minSeverity}
            onChange={(e) => setMinSeverity(e.target.value as Severity)}
            className="rounded-lg border border-default-token bg-surface px-3 py-1.5 text-sm text-primary-token"
            data-testid="findings-heatmap-severity"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`findingsHeatMap.severity.${s}`, s)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Heatmap canvas */}
      {filtered.length === 0 && (
        <div
          className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-6 text-center"
          data-testid="findings-heatmap-empty-state"
        >
          <p className="text-sm font-bold text-teal-700 dark:text-teal-400">
            {t(
              'findingsHeatMap.empty',
              'Sin hallazgos en los filtros aplicados — ¡buena señal!',
            )}
          </p>
        </div>
      )}

      {filtered.length > 0 && bbox && (
        <section
          className="rounded-2xl border border-default-token bg-surface p-4"
          data-testid="findings-heatmap-canvas"
          aria-label={t(
            'findingsHeatMap.canvas.aria',
            'Mapa de calor con {{cells}} zonas',
            { cells: cells.length },
          )}
        >
          <HeatmapSvg cells={cells} bbox={bbox} maxWeight={maxWeight} />
        </section>
      )}

      {/* Hotspots list */}
      {hotspots.length > 0 && (
        <section
          className="rounded-2xl border border-default-token bg-surface p-4"
          data-testid="findings-heatmap-hotspots"
        >
          <h2 className="text-sm font-black text-primary-token uppercase tracking-wider mb-3">
            {t('findingsHeatMap.hotspots.title', 'Top 5 zonas críticas')}
          </h2>
          <ul className="space-y-2">
            {hotspots.map((h, idx) => (
              <li
                key={`${h.lat.toFixed(5)}:${h.lng.toFixed(5)}`}
                className="flex items-center gap-3 text-sm"
                data-testid={`findings-heatmap-hotspot-${idx}`}
              >
                <span
                  className="inline-block w-4 h-4 rounded"
                  style={{ backgroundColor: SEVERITY_COLORS[h.dominantSeverity] }}
                  aria-hidden="true"
                />
                <span className="text-primary-token font-medium">
                  {t('findingsHeatMap.hotspots.cell', 'Zona {{idx}}', { idx: idx + 1 })}
                </span>
                <span className="text-secondary-token text-xs">
                  {h.count} {t('findingsHeatMap.hotspots.findings', 'hallazgos')} · weight{' '}
                  {h.weight} · {t(`findingsHeatMap.severity.${h.dominantSeverity}`, h.dominantSeverity)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// SVG renderer — top-down, normalizado al bbox del proyecto.
// ────────────────────────────────────────────────────────────────────────

interface HeatmapSvgProps {
  cells: ReadonlyArray<HeatCell>;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  maxWeight: number;
}

function HeatmapSvg({ cells, bbox, maxWeight }: HeatmapSvgProps) {
  const W = 600;
  const H = 400;
  const PAD = 20;

  // Si bbox degenera (1 sola celda), agregamos margen sintético para no
  // dividir por cero.
  const latSpan = Math.max(bbox.maxLat - bbox.minLat, 1e-5);
  const lngSpan = Math.max(bbox.maxLng - bbox.minLng, 1e-5);

  function project(lat: number, lng: number): { x: number; y: number } {
    const xNorm = (lng - bbox.minLng) / lngSpan;
    const yNorm = 1 - (lat - bbox.minLat) / latSpan; // y-flip
    return {
      x: PAD + xNorm * (W - 2 * PAD),
      y: PAD + yNorm * (H - 2 * PAD),
    };
  }

  const cellW = (W - 2 * PAD) / Math.max(1, Math.ceil(Math.sqrt(cells.length))) || 12;
  const safeCellSize = Math.max(8, Math.min(28, cellW));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      role="img"
      aria-label="Heatmap"
      data-testid="findings-heatmap-svg"
    >
      <rect x={0} y={0} width={W} height={H} fill="transparent" />
      {cells.map((c) => {
        const { x, y } = project(c.lat, c.lng);
        const opacity = maxWeight > 0 ? 0.25 + 0.75 * (c.weight / maxWeight) : 0.5;
        return (
          <rect
            key={`${c.lat.toFixed(5)}:${c.lng.toFixed(5)}`}
            x={x - safeCellSize / 2}
            y={y - safeCellSize / 2}
            width={safeCellSize}
            height={safeCellSize}
            rx={2}
            ry={2}
            fill={SEVERITY_COLORS[c.dominantSeverity]}
            opacity={opacity}
          >
            <title>
              {c.count} hallazgos · weight {c.weight} · {c.dominantSeverity}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

export default FindingsHeatMap;
