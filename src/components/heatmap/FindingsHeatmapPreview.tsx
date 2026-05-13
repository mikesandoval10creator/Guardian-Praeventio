// Praeventio Guard — Sprint 42 Fase F.14: <FindingsHeatmapPreview />
//
// Preview SVG top-down del heatmap de hallazgos. Renderiza las celdas
// generadas por buildHeatmapCells sin depender de Maps API: cada celda
// se pinta como un rect coloreado por weight, sobre un canvas
// proyectado del bounding box. Sirve de fallback offline y de preview
// previo al render real en Maps.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flame, MapPin } from 'lucide-react';
import {
  buildHeatmapCells,
  pickHotspots,
  bboxOf,
  type FindingPoint,
  type HeatCell,
  type Severity,
} from '../../services/heatmap/findingsHeatmapBuilder.js';

interface FindingsHeatmapPreviewProps {
  findings: FindingPoint[];
  gridSizeM?: number;
  topN?: number;
  /** Tamaño del SVG en px. */
  width?: number;
  height?: number;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  low: '#4db6ac',       // teal (preferencia usuario)
  medium: '#f59e0b',    // amber
  high: '#f97316',      // orange
  critical: '#e11d48',  // rose
};

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function FindingsHeatmapPreview({
  findings,
  gridSizeM = 50,
  topN = 5,
  width = 320,
  height = 240,
}: FindingsHeatmapPreviewProps) {
  const { t } = useTranslation();

  const { cells, hotspots, bbox } = useMemo(() => {
    const c = buildHeatmapCells(findings, { gridSizeM });
    return {
      cells: c,
      hotspots: pickHotspots(c, topN),
      bbox: bboxOf(findings),
    };
  }, [findings, gridSizeM, topN]);

  const maxWeight = useMemo(() => {
    let m = 0;
    for (const c of cells) if (c.weight > m) m = c.weight;
    return m;
  }, [cells]);

  if (findings.length === 0 || !bbox) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
        data-testid="findings-heatmap-preview"
        aria-label={t('heatmap.aria', 'Mapa de calor de hallazgos') as string}
      >
        <header className="flex items-center gap-2 mb-2">
          <Flame className="w-4 h-4 text-rose-500" aria-hidden="true" />
          <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
            {t('heatmap.title', 'Mapa de calor de hallazgos')}
          </h2>
        </header>
        <p className="text-sm text-secondary-token" data-testid="heatmap-empty">
          {t('heatmap.empty', 'No hay hallazgos georreferenciados aún.')}
        </p>
      </section>
    );
  }

  // Padding del bbox para que los puntos en el borde sean visibles.
  const padLat = Math.max((bbox.maxLat - bbox.minLat) * 0.1, 0.00005);
  const padLng = Math.max((bbox.maxLng - bbox.minLng) * 0.1, 0.00005);
  const minLat = bbox.minLat - padLat;
  const maxLat = bbox.maxLat + padLat;
  const minLng = bbox.minLng - padLng;
  const maxLng = bbox.maxLng + padLng;
  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;

  function project(c: HeatCell): { x: number; y: number } {
    // lat crece hacia el norte → en SVG, y crece hacia abajo, así que invertimos.
    const xn = clamp01((c.lng - minLng) / spanLng);
    const yn = clamp01(1 - (c.lat - minLat) / spanLat);
    return { x: xn * width, y: yn * height };
  }

  const cellSize = Math.max(6, Math.min(width, height) / 20);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="findings-heatmap-preview"
      aria-label={t('heatmap.aria', 'Mapa de calor de hallazgos') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Flame className="w-4 h-4 text-rose-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('heatmap.title', 'Mapa de calor de hallazgos')}
        </h2>
        <span className="text-xs text-secondary-token ml-auto" data-testid="heatmap-cell-count">
          {cells.length} {t('heatmap.cells', 'celdas')}
        </span>
      </header>

      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('heatmap.svgAria', 'Vista previa SVG del heatmap') as string}
        data-testid="heatmap-svg"
        className="rounded-xl bg-background-token"
      >
        <rect x={0} y={0} width={width} height={height} fill="rgba(77,182,172,0.05)" />
        {cells.map((c, i) => {
          const { x, y } = project(c);
          const intensity = maxWeight > 0 ? c.weight / maxWeight : 0;
          const color = SEVERITY_COLOR[c.dominantSeverity];
          return (
            <rect
              key={`${c.lat}:${c.lng}:${i}`}
              x={x - cellSize / 2}
              y={y - cellSize / 2}
              width={cellSize}
              height={cellSize}
              rx={2}
              ry={2}
              fill={color}
              fillOpacity={0.25 + 0.7 * intensity}
              data-testid="heatmap-cell"
            />
          );
        })}
      </svg>

      <ul className="mt-3 space-y-1" data-testid="heatmap-hotspots">
        {hotspots.map((h, i) => (
          <li
            key={`hot-${i}`}
            className="flex items-center gap-2 text-xs text-secondary-token"
            data-testid="heatmap-hotspot"
          >
            <MapPin className="w-3 h-3 text-rose-500" aria-hidden="true" />
            <span className="font-mono">
              {h.lat.toFixed(5)}, {h.lng.toFixed(5)}
            </span>
            <span className="ml-auto">
              {h.count} {t('heatmap.findings', 'hallazgos')} · {h.dominantSeverity}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
