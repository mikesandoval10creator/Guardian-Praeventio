// Praeventio Guard — Línea de Fuego (struck-by / caught-between) self-assessment.
//
// Self-contained safety tool: the worker/supervisor describes an exposure
// (kind, distance, whether people are in the path) and checks the mitigations
// in place; the REAL pure engine `validateLineOfFire` computes whether the
// declared controls cover the canonical required mitigations for that kind.
// No fetch / no aggregation — pure client compute over the user's input.
//
// DIRECTIVE: this is GUIDANCE, never an operational block. A "BLOQUEO" verdict
// is a strong RECOMMENDATION not to proceed; the tool stops nothing — the
// supervisor decides. (Mounts the previously-orphan LineOfFireValidationCard.)

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';
import { LineOfFireValidationCard } from '../components/lineOfFire/LineOfFireValidationCard';
import {
  validateLineOfFire,
  getRequiredMitigationsForKind,
  type LineOfFireKind,
} from '../services/lineOfFire/lineOfFireChecker';

const KIND_LABELS: Record<LineOfFireKind, string> = {
  suspended_load: 'Carga suspendida (grúa, polipasto)',
  mobile_equipment: 'Equipo móvil cerca de personas',
  projection: 'Proyección de partículas (esmerilado, soldadura)',
  stored_energy: 'Energía almacenada (resortes, presión)',
  pressurized_line: 'Línea presurizada (latigazo)',
  falling_object: 'Objeto en altura que puede caer',
  rotating_machinery: 'Maquinaria rotativa (eje, polea, banda)',
  electric_arc: 'Arco eléctrico',
  release_chemical: 'Liberación de químico bajo presión',
};
const KINDS = Object.keys(KIND_LABELS) as LineOfFireKind[];

export function LineaDeFuego() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<LineOfFireKind>('suspended_load');
  const [description, setDescription] = useState('');
  const [proximityMeters, setProximityMeters] = useState<number | ''>(3);
  const [personnelInPath, setPersonnelInPath] = useState(true);
  // checked canonical mitigation phrases (the engine matches the FULL phrase)
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const required = useMemo(() => getRequiredMitigationsForKind(kind), [kind]);

  const result = useMemo(
    () =>
      validateLineOfFire(
        {
          kind,
          description,
          proximityMeters: typeof proximityMeters === 'number' ? proximityMeters : 0,
          personnelInPath,
        },
        required.filter((m) => checked[m]),
      ),
    [kind, description, proximityMeters, personnelInPath, required, checked],
  );

  // Switching kind invalidates the previous kind's mitigation checks.
  const onKindChange = (k: LineOfFireKind) => {
    setKind(k);
    setChecked({});
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 shrink-0">
          <Crosshair className="w-6 h-6 text-rose-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-primary-token leading-tight">
            {t('lineaDeFuego.title', 'Línea de Fuego')}
          </h1>
          <p className="text-xs sm:text-sm text-secondary-token font-medium mt-1">
            {t(
              'lineaDeFuego.subtitle',
              'Evalúa la exposición a golpeado-por / atrapado-entre y verifica las mitigaciones. Es una guía — no detiene la tarea.',
            )}
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-default-token bg-surface p-4 space-y-4 shadow-mode">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
            {t('lineaDeFuego.kind', 'Tipo de exposición')}
          </label>
          <select
            value={kind}
            onChange={(e) => onKindChange(e.target.value as LineOfFireKind)}
            className="mt-1 w-full bg-surface border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token outline-none focus:border-rose-500"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
            {t('lineaDeFuego.description', 'Descripción del contexto')}
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('lineaDeFuego.descriptionPlaceholder', 'Ej: izaje de viga sobre zona de tránsito') as string}
            className="mt-1 w-full bg-surface border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token outline-none focus:border-rose-500"
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('lineaDeFuego.proximity', 'Distancia a la zona de impacto (m)')}
            </label>
            <input
              type="number"
              min={0}
              step={0.5}
              value={proximityMeters}
              onChange={(e) => setProximityMeters(e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-1 w-full bg-surface border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token outline-none focus:border-rose-500"
            />
          </div>
          <label className="flex items-center gap-2 mt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={personnelInPath}
              onChange={(e) => setPersonnelInPath(e.target.checked)}
              className="w-4 h-4 accent-rose-500"
            />
            <span className="text-sm text-primary-token">
              {t('lineaDeFuego.personnelInPath', 'Hay personas en la trayectoria')}
            </span>
          </label>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token mb-2">
            {t('lineaDeFuego.mitigations', 'Mitigaciones en sitio')}
          </p>
          <div className="space-y-2">
            {required.map((m) => (
              <label key={m} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!checked[m]}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [m]: e.target.checked }))}
                  className="w-4 h-4 mt-0.5 accent-emerald-500"
                />
                <span className="text-sm text-primary-token">{m}</span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <LineOfFireValidationCard result={result} />
    </div>
  );
}
