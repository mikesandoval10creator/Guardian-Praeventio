import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Briefcase,
  Sparkles,
  TrendingDown,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import {
  TIERS,
  getTierById,
  formatCurrency,
  calculateMonthlyCost,
  type Tier,
  type TierId,
} from '../../services/pricing/tiers';
import { useCurrency } from './CurrencyToggle';

/**
 * Pick the smallest tier whose capacity covers the requested usage.
 * Falls back to "ilimitado" if nothing else fits.
 */
function recommendTier(workers: number, projects: number): Tier {
  for (const t of TIERS) {
    if (workers <= t.trabajadoresMax && projects <= t.proyectosMax) {
      return t;
    }
  }
  return getTierById('ilimitado');
}

/**
 * Reference comparison: a part-time prevencionista in Chile averages
 * about 550.000 CLP/month (range 400k–700k). We use the midpoint.
 */
const PREVENCIONISTA_PARTTIME_CLP = 550000;
const ACCIDENTE_GRAVE_CLP = 50_000_000;

interface PricingCalculatorProps {
  /** Optional anchor target in the parent page (e.g. "#tier-oro") */
  pricingHref?: string;
  className?: string;
}

export function PricingCalculator({
  pricingHref = '/pricing',
  className = '',
}: PricingCalculatorProps) {
  const { currency } = useCurrency();
  const [workers, setWorkers] = useState(50);
  const [projects, setProjects] = useState(3);

  const recommended = useMemo(() => recommendTier(workers, projects), [workers, projects]);

  const monthly = useMemo(() => {
    try {
      return calculateMonthlyCost(recommended.id, workers, projects);
    } catch {
      return { base: recommended.clpRegular, workerOverage: 0, projectOverage: 0, total: recommended.clpRegular };
    }
  }, [recommended, workers, projects]);

  const annualClp = recommended.clpAnual;
  const monthlyEquivalentAnnual = annualClp / 12;
  const savingsClp = monthly.total * 12 - annualClp;

  const formatMoney = (clp: number) => {
    if (currency === 'CLP') return formatCurrency(clp, 'CLP');
    // Convert CLP → USD using the tier ratio when possible (clpRegular vs usdRegular)
    const usdRate =
      recommended.clpRegular > 0
        ? recommended.usdRegular / recommended.clpRegular
        : 1 / 950; // ~CLP per USD fallback
    return formatCurrency(clp * usdRate, 'USD');
  };

  const ahorroVsPrevencionista =
    monthly.total === 0
      ? 100
      : Math.round(((PREVENCIONISTA_PARTTIME_CLP - monthly.total) / PREVENCIONISTA_PARTTIME_CLP) * 100);

  const accidentesCubiertos = monthly.total === 0 ? Infinity : Math.floor(ACCIDENTE_GRAVE_CLP / (monthly.total * 12));

  return (
    <div
      className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8 shadow-xl ${className}`}
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">
            Calculadora de plan
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ajusta los controles. Te decimos cuál plan te conviene y cuánto ahorras.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <label className="flex items-center justify-between text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-2">
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-500" />
              Trabajadores totales
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-black">{workers.toLocaleString('es-CL')}</span>
          </label>
          <input
            type="range"
            min={1}
            max={5000}
            step={1}
            value={workers}
            onChange={(e) => setWorkers(Number(e.target.value))}
            className="w-full accent-emerald-500"
            aria-label="Trabajadores totales"
          />
          <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
            <span>1</span>
            <span>5.000</span>
          </div>
        </div>

        <div>
          <label className="flex items-center justify-between text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-2">
            <span className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-emerald-500" />
              Proyectos activos
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-black">{projects}</span>
          </label>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={projects}
            onChange={(e) => setProjects(Number(e.target.value))}
            className="w-full accent-emerald-500"
            aria-label="Proyectos activos"
          />
          <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
            <span>1</span>
            <span>100</span>
          </div>
        </div>
      </div>

      <motion.div
        key={recommended.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-emerald-50 to-emerald-100/60 dark:from-emerald-900/30 dark:to-emerald-900/10 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5 sm:p-6 mb-6"
      >
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-xs uppercase tracking-widest text-emerald-700 dark:text-emerald-300 font-bold">
                Plan recomendado
              </p>
              <p className="text-2xl font-black text-zinc-900 dark:text-white">{recommended.nombre}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-black text-zinc-900 dark:text-white">
              {formatMoney(monthly.total)}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">por mes</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="bg-white/70 dark:bg-black/20 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Base</p>
            <p className="font-bold text-zinc-900 dark:text-white">{formatMoney(monthly.base)}</p>
          </div>
          <div className="bg-white/70 dark:bg-black/20 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Overage trabajadores
            </p>
            <p className="font-bold text-zinc-900 dark:text-white">{formatMoney(monthly.workerOverage)}</p>
          </div>
          <div className="bg-white/70 dark:bg-black/20 rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Overage proyectos
            </p>
            <p className="font-bold text-zinc-900 dark:text-white">{formatMoney(monthly.projectOverage)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-zinc-600 dark:text-zinc-400">
            Anual con 20% dto.: <strong>{formatMoney(annualClp)}</strong> ({formatMoney(monthlyEquivalentAnnual)}/mes equivalente)
          </span>
          {savingsClp > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-300 font-bold">
              <TrendingDown className="w-3.5 h-3.5" /> Ahorras {formatMoney(savingsClp)} al año
            </span>
          )}
        </div>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-sm">
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
            vs prevencionista part-time
          </p>
          <p className="font-black text-zinc-900 dark:text-white">
            {ahorroVsPrevencionista >= 0
              ? `Ahorras ${ahorroVsPrevencionista}%`
              : `Costo equivalente`}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Referencia: {formatCurrency(PREVENCIONISTA_PARTTIME_CLP, 'CLP')}/mes
          </p>
        </div>
        <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1">
            vs accidente grave evitado
          </p>
          <p className="font-black text-zinc-900 dark:text-white">
            {accidentesCubiertos === Infinity
              ? 'Infinito'
              : `${accidentesCubiertos.toLocaleString('es-CL')}× años cubiertos`}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Costo accidente: {formatCurrency(ACCIDENTE_GRAVE_CLP, 'CLP')}
          </p>
        </div>
      </div>

      {workers > 750 && projects > 75 && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4 mb-4 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-amber-900 dark:text-amber-200">
            Estás en territorio empresarial. Te conviene hablar con ventas para una propuesta a medida.
          </p>
        </div>
      )}

      <a
        href={`${pricingHref}#tier-${recommended.id}`}
        className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest text-xs px-6 py-3 rounded-xl transition-colors"
      >
        Ver detalles del plan {recommended.nombre}
        <ArrowRight className="w-4 h-4" />
      </a>
    </div>
  );
}

export default PricingCalculator;
