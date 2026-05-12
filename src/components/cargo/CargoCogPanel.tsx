// Praeventio Guard — Wire UI #80: <CargoCogPanel />
//
// Visualización del centro de gravedad + utilization + warnings de
// vuelco/distribución. Top-down view simple del contenedor con el
// COG marcado.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, AlertTriangle, Scale, Box } from 'lucide-react';
import {
  validateCogAgainstLimits,
  computeUtilization,
  type CargoItem,
  type Container,
  type PlacedItem,
  type CogSafetyLimits,
} from '../../services/cargo/stowageOptimizer.js';

interface CargoCogPanelProps {
  container: Container;
  placedItems: PlacedItem[];
  limits?: CogSafetyLimits;
}

function defaultLimits(container: Container): CogSafetyLimits {
  return {
    ideal: {
      x: container.dimensions.x / 2,
      y: container.dimensions.y / 2,
      z: 0,
    },
    toleranceX: container.dimensions.x * 0.1,
    toleranceY: container.dimensions.y * 0.1,
    maxHeightZ: container.dimensions.z * 0.5,
  };
}

export function CargoCogPanel({ container, placedItems, limits }: CargoCogPanelProps) {
  const { t } = useTranslation();
  const effectiveLimits = limits ?? defaultLimits(container);
  const validation = useMemo(
    () => validateCogAgainstLimits(placedItems, effectiveLimits),
    [placedItems, effectiveLimits],
  );
  const util = useMemo(
    () => computeUtilization(placedItems, container),
    [placedItems, container],
  );

  const safeTone = validation.isSafe
    ? 'border-emerald-500/30 bg-emerald-500/5'
    : 'border-rose-500/30 bg-rose-500/5';

  // SVG top-down: container es viewport, COG es punto
  const svgW = 240;
  const svgH = svgW * (container.dimensions.y / Math.max(1, container.dimensions.x));
  const cogPx = {
    x: (validation.cog.x / container.dimensions.x) * svgW,
    y: (validation.cog.y / container.dimensions.y) * svgH,
  };
  const idealPx = {
    x: (effectiveLimits.ideal.x / container.dimensions.x) * svgW,
    y: (effectiveLimits.ideal.y / container.dimensions.y) * svgH,
  };
  const tolPx = {
    x: (effectiveLimits.toleranceX / container.dimensions.x) * svgW,
    y: (effectiveLimits.toleranceY / container.dimensions.y) * svgH,
  };

  return (
    <section
      className={`rounded-2xl border p-4 shadow-mode space-y-3 ${safeTone}`}
      data-testid="cargo-cog-panel"
      aria-label={t('cargo.aria', 'Panel COG y estiba') as string}
    >
      <header className="flex items-center gap-2">
        <Truck className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('cargo.title', 'Centro de gravedad')}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
            validation.isSafe
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
          }`}
          data-testid="cargo-cog-safe-badge"
        >
          {validation.isSafe ? t('cargo.safe', 'SEGURO') : t('cargo.unsafe', 'REVISAR')}
        </span>
      </header>

      <div className="flex justify-center bg-surface rounded p-2">
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          data-testid="cargo-cog-svg"
          role="img"
          aria-label={t('cargo.topDownAria', 'Vista superior contenedor') as string}
        >
          {/* Contenedor */}
          <rect
            x={0}
            y={0}
            width={svgW}
            height={svgH}
            fill="transparent"
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={2}
          />
          {/* Zona segura */}
          <rect
            x={idealPx.x - tolPx.x}
            y={idealPx.y - tolPx.y}
            width={tolPx.x * 2}
            height={tolPx.y * 2}
            fill="rgb(16 185 129 / 0.15)"
            stroke="rgb(16 185 129)"
            strokeOpacity={0.5}
            strokeDasharray="3 2"
            data-testid="cargo-cog-safezone"
          />
          {/* Ideal centroid (cross) */}
          <line
            x1={idealPx.x - 4}
            y1={idealPx.y}
            x2={idealPx.x + 4}
            y2={idealPx.y}
            stroke="rgb(16 185 129)"
          />
          <line
            x1={idealPx.x}
            y1={idealPx.y - 4}
            x2={idealPx.x}
            y2={idealPx.y + 4}
            stroke="rgb(16 185 129)"
          />
          {/* Items colocados (footprint) */}
          {placedItems.map((p, i) => (
            <rect
              key={i}
              x={(p.position.x / container.dimensions.x) * svgW}
              y={(p.position.y / container.dimensions.y) * svgH}
              width={(p.item.dimensions.x / container.dimensions.x) * svgW}
              height={(p.item.dimensions.y / container.dimensions.y) * svgH}
              fill="rgb(139 92 246 / 0.15)"
              stroke="rgb(139 92 246 / 0.5)"
              data-testid={`cargo-item-footprint-${p.item.id}`}
            />
          ))}
          {/* COG actual */}
          <circle
            cx={cogPx.x}
            cy={cogPx.y}
            r={6}
            fill={validation.isSafe ? 'rgb(16 185 129)' : 'rgb(244 63 94)'}
            stroke="white"
            strokeWidth={1}
            data-testid="cargo-cog-marker"
          />
        </svg>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface rounded p-2" data-testid="cargo-util-volume">
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <Box className="w-3 h-3" aria-hidden="true" />
            {t('cargo.volume', 'Volumen')}
          </p>
          <p className="text-xl font-black tabular-nums">{util.volumePercent}%</p>
        </div>
        <div className="bg-surface rounded p-2" data-testid="cargo-util-mass">
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <Scale className="w-3 h-3" aria-hidden="true" />
            {t('cargo.mass', 'Masa')}
          </p>
          <p
            className={`text-xl font-black tabular-nums ${
              util.overweight ? 'text-rose-600' : ''
            }`}
          >
            {util.massPercent}%
          </p>
        </div>
        <div className="bg-surface rounded p-2" data-testid="cargo-cog-height">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('cargo.cogHeight', 'COG alto')}
          </p>
          <p className="text-xl font-black tabular-nums">
            {validation.cog.z.toFixed(2)}m
          </p>
        </div>
      </div>

      {util.overweight && (
        <p
          className="text-[11px] bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded font-bold"
          data-testid="cargo-overweight-warning"
        >
          {t('cargo.overweight', 'SOBRECARGA: masa total excede payload máximo del contenedor.')}
        </p>
      )}

      {validation.warnings.length > 0 && (
        <ul className="space-y-1" data-testid="cargo-cog-warnings">
          {validation.warnings.map((w, i) => (
            <li
              key={i}
              className="flex items-start gap-2 text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded"
              data-testid={`cargo-cog-warning-${i}`}
            >
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Re-export helper para callers
export { defaultLimits as buildDefaultCargoLimits };
export type { CargoItem };
