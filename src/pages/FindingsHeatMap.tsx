// Praeventio Guard — Sprint 55 Fase F.14 page wrapper.
//
// Mapa de Calor de Hallazgos: visualiza la distribución espacial de
// findings por zona geográfica. El servicio `findingsHeatmapBuilder`
// ya entrega celdas con weight + dominantSeverity; esta página la
// renderiza como un grid color-coded vía <FindingsHeatmapPreview/>.
//
// Fuente de datos REAL (2026-06-20): los findings provienen de las
// OBSERVACIONES georreferenciadas de las inspecciones del proyecto
// (`GET /api/sprint-k/:projectId/inspections` → useInspections). Cada
// observación con `locationLatLng` es un hallazgo de terreno con
// coordenadas GPS + `recordedAt` reales. Las observaciones NO almacenan
// un grado de severidad, así que cada hallazgo entra con severidad `low`
// (peso 1): el mapa transmite la DENSIDAD real de hallazgos por zona, no
// una severidad inventada. Si no hay observaciones georreferenciadas, el
// empty-state es honesto (no se fabrican puntos).
//
// Render strategy: SVG top-down sobre el bbox normalizado. NO usa
// Maps API (cero deps externas, offline-safe). El usuario puede ajustar:
//   - gridSizeM (50 / 100 / 200 / 500 m)
//   - rango de fechas (últimos 7 / 30 / 90 días)
//   - filtro por severidad mínima
//
// Directiva 2: NO bloquea decisiones, sólo asiste. Directiva 4:
// fuentes externas (si las hay) van como dato discreto.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Map, WifiOff, Loader2, AlertTriangle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useInspections, type InspectionRecord } from '../hooks/useOfflineInspections';
import { FindingsHeatmapPreview } from '../components/heatmap/FindingsHeatmapPreview';
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
  /** Inyección de findings (sólo testing). En prod la página deriva los
   *  findings desde las inspecciones reales del proyecto vía useInspections;
   *  pasar esta prop cortocircuita el fetch (hermetic component tests). */
  findings?: FindingPoint[];
}

/**
 * Deriva `FindingPoint[]` desde las inspecciones reales del proyecto.
 *
 * Cada observación con `locationLatLng` es un hallazgo de terreno con
 * coordenadas GPS + timestamp reales. Las observaciones no llevan grado de
 * severidad, así que cada finding entra con severidad `low` (peso 1): el
 * mapa muestra DENSIDAD real, sin inventar severidad. Observaciones sin
 * coordenadas se descartan (no se puede ubicar el hallazgo en el mapa).
 */
function inspectionsToFindings(inspections: InspectionRecord[]): FindingPoint[] {
  const out: FindingPoint[] = [];
  for (const insp of inspections) {
    const obs = Array.isArray(insp.observations) ? insp.observations : [];
    for (const o of obs) {
      const loc = o.locationLatLng;
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
        continue;
      }
      out.push({
        id: o.observationId,
        lat: loc.lat,
        lng: loc.lng,
        // Las observaciones de inspección no almacenan severidad — cada
        // hallazgo georreferenciado pesa 1 (densidad real, no inventada).
        severity: 'low',
        occurredAt: o.recordedAt,
        category: o.itemId ?? insp.templateId,
      });
    }
  }
  return out;
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

export function FindingsHeatMap({ findings: findingsOverride }: FindingsHeatMapProps = {}) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();

  const [gridSizeM, setGridSizeM] = useState<number>(100);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [minSeverity, setMinSeverity] = useState<Severity>('low');

  // Real data path: fetch the project's inspections; only enabled when a
  // project is selected AND no test override was injected.
  const inspectionsResp = useInspections(
    findingsOverride === undefined ? (selectedProject?.id ?? null) : null,
  );
  const loading = findingsOverride === undefined && inspectionsResp.loading;
  const fetchError =
    findingsOverride === undefined ? inspectionsResp.error : null;

  const findings = useMemo<FindingPoint[]>(() => {
    if (findingsOverride !== undefined) return findingsOverride;
    return inspectionsToFindings(inspectionsResp.data?.inspections ?? []);
  }, [findingsOverride, inspectionsResp.data]);

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

      {/* Loading — fetching the project's inspections. */}
      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 flex items-center justify-center gap-2 text-secondary-token"
          data-testid="findings-heatmap-loading"
        >
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span className="text-sm">
            {t('findingsHeatMap.loading', 'Cargando hallazgos…')}
          </span>
        </div>
      )}

      {/* Error — the read path failed; honest surface, never silent. */}
      {!loading && fetchError && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 flex items-center gap-2"
          data-testid="findings-heatmap-error"
        >
          <AlertTriangle className="w-4 h-4 text-rose-500" aria-hidden="true" />
          <p className="text-sm font-bold text-rose-700 dark:text-rose-400">
            {t('findingsHeatMap.error', 'No se pudieron cargar los hallazgos.')}{' '}
            {fetchError.message}
          </p>
        </div>
      )}

      {/* Empty — honest: no georeferenced findings, no fabricated points. */}
      {!loading && !fetchError && filtered.length === 0 && (
        <div
          className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-6 text-center"
          data-testid="findings-heatmap-empty-state"
        >
          <p className="text-sm font-bold text-teal-700 dark:text-teal-400">
            {t(
              'findingsHeatMap.empty',
              'Sin hallazgos georreferenciados en los filtros aplicados.',
            )}
          </p>
        </div>
      )}

      {/* Heatmap canvas — mounted <FindingsHeatmapPreview/> rendered over the
          REAL findings derived from inspection observations. topN={0} so the
          preview suppresses its own hotspot list and the page's richer list
          (below, with weight) stays the single hotspots surface. */}
      {!loading && !fetchError && filtered.length > 0 && bbox && (
        <section
          className="rounded-2xl border border-default-token bg-surface p-4"
          data-testid="findings-heatmap-canvas"
          aria-label={t(
            'findingsHeatMap.canvas.aria',
            'Mapa de calor con {{cells}} zonas',
            { cells: cells.length },
          )}
        >
          <FindingsHeatmapPreview
            findings={filtered}
            gridSizeM={gridSizeM}
            topN={0}
            width={600}
            height={400}
          />
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

export default FindingsHeatMap;
