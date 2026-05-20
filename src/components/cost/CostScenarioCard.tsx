// Praeventio Guard — Bloque 3.15 — <CostScenarioCard />
//
// Tarjeta presentacional para una scenario guardada del CostSimulator.
// Recibe un StoredCostScenario y muestra resumen: nombre, industria,
// inversión, ROI badge, neto, fecha. Pure presentational — el padre
// orquesta carga/refetch via usePreventionScenarios.

import { TrendingUp, TrendingDown, DollarSign, Calendar, Building2 } from 'lucide-react';
import type {
  StoredCostScenario,
  RoiLevel,
  Industry,
} from '../../hooks/usePreventionCost';

interface CostScenarioCardProps {
  scenario: StoredCostScenario;
  onSelect?: (scenario: StoredCostScenario) => void;
}

const ROI_TONE: Record<RoiLevel, string> = {
  underwater:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  breakeven:
    'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  positive:
    'bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800',
  excellent:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700',
};

const ROI_LABEL: Record<RoiLevel, string> = {
  underwater: 'ROI negativo',
  breakeven: 'En equilibrio',
  positive: 'ROI positivo',
  excellent: 'ROI excelente',
};

const INDUSTRY_LABEL: Record<Industry, string> = {
  mining: 'Minería',
  construction: 'Construcción',
  agriculture: 'Agricultura',
  manufacturing: 'Manufactura',
  energy: 'Energía',
  transport: 'Transporte',
  services: 'Servicios',
  health: 'Salud',
  education: 'Educación',
  retail: 'Retail',
  other: 'Otro',
};

const formatClp = (n: number): string =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);

const formatRatio = (r: number): string => {
  if (!Number.isFinite(r)) return '∞';
  return `${(r * 100).toFixed(0)}%`;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

export function CostScenarioCard({ scenario, onSelect }: CostScenarioCardProps) {
  const { name, description, input, simulation, createdAt } = scenario;
  const { roiLevel, netBenefitClp, roiRatio, expectedSavingsClp } = simulation;
  const Icon = roiLevel === 'underwater' ? TrendingDown : TrendingUp;
  const tone = ROI_TONE[roiLevel];

  const interactive = typeof onSelect === 'function';

  return (
    <article
      className={`rounded-2xl border-2 p-4 space-y-3 transition-shadow shadow-sm ${
        interactive ? 'cursor-pointer hover:shadow-md focus-within:shadow-md' : ''
      } ${tone}`}
      data-testid="costScenario.card"
      aria-label={`Escenario guardado: ${name}`}
      onClick={interactive ? () => onSelect!(scenario) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect!(scenario);
              }
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <header className="flex items-start gap-2">
        <Icon className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h3
            className="text-sm font-bold truncate"
            data-testid="costScenario.card.name"
          >
            {name}
          </h3>
          {description && (
            <p
              className="text-[11px] opacity-80 line-clamp-2"
              data-testid="costScenario.card.description"
            >
              {description}
            </p>
          )}
        </div>
        <span
          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/70 dark:bg-black/30"
          data-testid="costScenario.card.roiLabel"
        >
          {ROI_LABEL[roiLevel]}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="flex items-start gap-1.5">
          <Building2 className="w-3 h-3 mt-0.5 opacity-70 shrink-0" aria-hidden="true" />
          <div>
            <dt className="uppercase opacity-70">Industria</dt>
            <dd
              className="font-bold"
              data-testid="costScenario.card.industry"
            >
              {INDUSTRY_LABEL[input.industry]}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-1.5">
          <DollarSign className="w-3 h-3 mt-0.5 opacity-70 shrink-0" aria-hidden="true" />
          <div>
            <dt className="uppercase opacity-70">Inversión</dt>
            <dd
              className="font-bold tabular-nums"
              data-testid="costScenario.card.investment"
            >
              {formatClp(input.preventionInvestmentClp)}
            </dd>
          </div>
        </div>
        <div>
          <dt className="uppercase opacity-70">Ahorro estimado</dt>
          <dd
            className="font-bold tabular-nums"
            data-testid="costScenario.card.savings"
          >
            {formatClp(expectedSavingsClp)}
          </dd>
        </div>
        <div>
          <dt className="uppercase opacity-70">Neto</dt>
          <dd
            className="font-bold tabular-nums"
            data-testid="costScenario.card.net"
          >
            {formatClp(netBenefitClp)}
          </dd>
        </div>
      </dl>

      <footer className="flex items-center justify-between pt-2 border-t border-current/20">
        <span
          className="text-base font-black tabular-nums"
          data-testid="costScenario.card.ratio"
        >
          ROI {formatRatio(roiRatio)}
        </span>
        <span
          className="text-[10px] opacity-70 flex items-center gap-1"
          data-testid="costScenario.card.createdAt"
        >
          <Calendar className="w-3 h-3" aria-hidden="true" />
          {formatDate(createdAt)}
        </span>
      </footer>
    </article>
  );
}
