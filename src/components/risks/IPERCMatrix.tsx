import { AlertTriangle } from 'lucide-react';
import type { IperInput, IperLevel } from '../../services/protocols/iper';

/**
 * Map an IPER level (deterministic, returned by `calculateIper`) to the legacy
 * Spanish criticidad label still used by the rest of the knowledge graph.
 * Keeping this mapping co-located with the matrix UI isolates the legacy UI
 * vocabulary from the regulatory primitive.
 */
export type Criticidad = 'baja' | 'media' | 'alta' | 'crítica';

export const LEVEL_TO_CRITICIDAD: Record<IperLevel, Criticidad> = {
  trivial: 'baja',
  tolerable: 'baja',
  moderado: 'media',
  importante: 'alta',
  intolerable: 'crítica',
};

interface IperResultLike {
  level: IperLevel;
  rawScore: number;
  recommendation: string;
}

interface IPERCMatrixProps {
  probability: IperInput['probability'];
  severity: IperInput['severity'];
  controlEffectiveness: NonNullable<IperInput['controlEffectiveness']>;
  onProbabilityChange: (value: IperInput['probability']) => void;
  onSeverityChange: (value: IperInput['severity']) => void;
  onControlEffectivenessChange: (value: NonNullable<IperInput['controlEffectiveness']>) => void;
  iperResult: IperResultLike | null;
  criticidad: Criticidad | null;
}

const getLevelColor = (level: IperLevel | null) => {
  switch (level) {
    case 'intolerable':
      return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
    case 'importante':
      return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
    case 'moderado':
      return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    case 'tolerable':
      return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    case 'trivial':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    default:
      return 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20';
  }
};

/**
 * Deterministic IPER matrix subcomponent. The level/criticidad MUST come
 * from `calculateIper(P, S)`. Per SUSESO Guía Técnica DS 40 + ACHS Manual
 * IPER, the LLM cannot legally classify the risk; it may only SUGGEST
 * controls. P, S and controlEffectiveness drive the engine.
 */
export function IPERCMatrix({
  probability,
  severity,
  controlEffectiveness,
  onProbabilityChange,
  onSeverityChange,
  onControlEffectivenessChange,
  iperResult,
  criticidad,
}: IPERCMatrixProps) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-200 dark:border-white/5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 ml-1">
            Probabilidad
          </label>
          <select
            value={probability}
            onChange={(e) => onProbabilityChange(Number(e.target.value) as IperInput['probability'])}
            className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          >
            <option value={1}>1 — Raro</option>
            <option value={2}>2 — Improbable</option>
            <option value={3}>3 — Posible</option>
            <option value={4}>4 — Probable</option>
            <option value={5}>5 — Casi cierto</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 ml-1">
            Severidad
          </label>
          <select
            value={severity}
            onChange={(e) => onSeverityChange(Number(e.target.value) as IperInput['severity'])}
            className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          >
            <option value={1}>1 — Insignificante</option>
            <option value={2}>2 — Menor</option>
            <option value={3}>3 — Lesión incapacitante</option>
            <option value={4}>4 — Mayor / invalidante</option>
            <option value={5}>5 — Catastrófico</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 ml-1">
            Eficacia de controles
          </label>
          <select
            value={controlEffectiveness}
            onChange={(e) => onControlEffectivenessChange(e.target.value as NonNullable<IperInput['controlEffectiveness']>)}
            className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-lg py-2 px-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
          >
            <option value="none">Sin controles</option>
            <option value="low">Bajos</option>
            <option value="medium">Medios</option>
            <option value="high">Altos</option>
          </select>
        </div>
      </div>

      {iperResult && (
        <div className={`flex items-center justify-between p-4 rounded-xl border ${getLevelColor(iperResult.level)}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl border border-current">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold opacity-70">
                Nivel IPER (matriz P×S, determinístico)
              </p>
              <p className="text-sm font-black uppercase">{iperResult.level}</p>
              <p className="text-[11px] opacity-80">
                Puntaje bruto: {iperResult.rawScore} · Criticidad legacy: {criticidad}
              </p>
            </div>
          </div>
          <div className="text-right max-w-[55%]">
            <p className="text-[11px] leading-relaxed">{iperResult.recommendation}</p>
          </div>
        </div>
      )}
    </>
  );
}
