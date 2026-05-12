// Praeventio Guard — Wire UI #73: <BucklingCalculatorCard />
//
// Calculadora interactiva carga crítica de pandeo Euler para andamios
// y puntales. Devuelve P_cr + factor seguridad + alerta si SF<2.

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Construction, AlertTriangle } from 'lucide-react';
import {
  calculateCriticalLoad,
  bucklingSafetyFactor,
  rectangularInertia,
  type EndConditions,
} from '../../services/euler/criticalLoad.js';

interface BucklingCalculatorCardProps {
  onResult?: (criticalLoad: number, safetyFactor: number) => void;
}

const END_CONDITIONS: Array<{ value: EndConditions; label: string; k: number }> = [
  { value: 'fixed-fixed', label: 'Empotrado-empotrado', k: 0.5 },
  { value: 'pinned-pinned', label: 'Articulado-articulado', k: 1.0 },
  { value: 'fixed-pinned', label: 'Empotrado-articulado', k: 0.7 },
  { value: 'fixed-free', label: 'Empotrado-libre (voladizo)', k: 2.0 },
];

// Materiales canónicos
const MATERIALS: Array<{ name: string; E: number }> = [
  { name: 'Acero estructural', E: 200e9 },
  { name: 'Aluminio', E: 69e9 },
  { name: 'Madera estructural', E: 10e9 },
];

export function BucklingCalculatorCard({ onResult }: BucklingCalculatorCardProps) {
  const { t } = useTranslation();
  const [E, setE] = useState(MATERIALS[0].E);
  const [length, setLength] = useState(3);
  const [width, setWidth] = useState(0.05); // 5cm
  const [height, setHeight] = useState(0.05); // 5cm
  const [endConditions, setEndConditions] = useState<EndConditions>('pinned-pinned');
  const [appliedLoad, setAppliedLoad] = useState(5000); // 5 kN

  const result = useMemo(() => {
    const I = rectangularInertia(width, height);
    const r = calculateCriticalLoad({
      youngsModulus: E,
      momentOfInertia: I,
      length,
      endConditions,
    });
    const sf = bucklingSafetyFactor(r.criticalLoad, appliedLoad);
    onResult?.(r.criticalLoad, sf);
    return { ...r, safetyFactor: sf };
  }, [E, length, width, height, endConditions, appliedLoad, onResult]);

  const sfTone =
    !Number.isFinite(result.safetyFactor) || result.safetyFactor >= 2.5
      ? 'text-emerald-500'
      : result.safetyFactor >= 2
        ? 'text-amber-500'
        : 'text-rose-500';

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="buckling-card"
      aria-label={t('buckling.aria', 'Calculadora pandeo Euler') as string}
    >
      <header className="flex items-center gap-2">
        <Construction className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('buckling.title', 'Carga crítica Euler')}
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('buckling.material', 'Material')}
          </span>
          <select
            value={E}
            onChange={(e) => setE(Number(e.target.value))}
            data-testid="buckling-material"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {MATERIALS.map((m) => (
              <option key={m.name} value={m.E}>
                {m.name} (E={m.E / 1e9} GPa)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('buckling.length', 'Longitud (m)')}
          </span>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            data-testid="buckling-length"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('buckling.length', 'Longitud (m)') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('buckling.endConditions', 'Apoyos')}
          </span>
          <select
            value={endConditions}
            onChange={(e) => setEndConditions(e.target.value as EndConditions)}
            data-testid="buckling-end-conditions"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {END_CONDITIONS.map((ec) => (
              <option key={ec.value} value={ec.value}>
                {ec.label} (K={ec.k})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('buckling.width', 'Ancho (m)')}
          </span>
          <input
            type="number"
            min={0.001}
            step={0.001}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            data-testid="buckling-width"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('buckling.width', 'Ancho (m)') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('buckling.height', 'Alto (m)')}
          </span>
          <input
            type="number"
            min={0.001}
            step={0.001}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            data-testid="buckling-height"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('buckling.height', 'Alto (m)') as string}
          />
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('buckling.appliedLoad', 'Carga aplicada (N)')}
          </span>
          <input
            type="number"
            min={0}
            step={100}
            value={appliedLoad}
            onChange={(e) => setAppliedLoad(Number(e.target.value))}
            data-testid="buckling-applied-load"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('buckling.appliedLoad', 'Carga aplicada (N)') as string}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-surface-elevated rounded p-2" data-testid="buckling-pcr">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('buckling.pcr', 'P_cr (N)')}
          </p>
          <p className="text-lg font-black tabular-nums">
            {Number.isFinite(result.criticalLoad)
              ? Math.round(result.criticalLoad).toLocaleString()
              : '—'}
          </p>
        </div>
        <div
          className={`bg-surface-elevated rounded p-2 ${sfTone}`}
          data-testid="buckling-sf"
        >
          <p className="text-[10px] uppercase text-secondary-token">
            {t('buckling.sf', 'Factor seguridad')}
          </p>
          <p className="text-lg font-black tabular-nums">
            {Number.isFinite(result.safetyFactor) ? result.safetyFactor.toFixed(2) : '∞'}
          </p>
        </div>
      </div>

      {Number.isFinite(result.safetyFactor) && result.safetyFactor < 2 && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="buckling-warning"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'buckling.unsafeWarning',
              'Factor de seguridad &lt; 2.0 — REVISAR diseño. Buckling es colapso súbito sin previo aviso.',
            )}
          </span>
        </div>
      )}
    </section>
  );
}
