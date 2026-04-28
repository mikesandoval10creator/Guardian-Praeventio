import React from 'react';
import { Link } from 'react-router-dom';
import {
  ShieldCheck,
  Users,
  Briefcase,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  Sparkles,
  Building2,
} from 'lucide-react';
import { TIERS, formatCurrency, getTierById } from '../services/pricing/tiers';
import {
  CurrencyProvider,
  CurrencyToggle,
} from '../components/pricing/CurrencyToggle';
import { PricingCalculator } from '../components/pricing/PricingCalculator';

const OVERAGE_TIER_IDS = ['comite-paritario', 'departamento-prevencion', 'plata', 'oro'] as const;

function Bucket2DSvg() {
  return (
    <svg viewBox="0 0 320 220" role="img" aria-label="Diagrama del bucket 2D" className="w-full max-w-md mx-auto">
      <defs>
        <linearGradient id="grid-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0.04" />
        </linearGradient>
      </defs>
      {/* axes */}
      <line x1="40" y1="180" x2="300" y2="180" stroke="currentColor" strokeWidth="1.5" />
      <line x1="40" y1="20" x2="40" y2="180" stroke="currentColor" strokeWidth="1.5" />

      {/* Y label */}
      <text x="14" y="28" className="fill-current" fontSize="11" fontWeight="700">
        Trabajadores
      </text>
      {/* X label */}
      <text x="200" y="200" className="fill-current" fontSize="11" fontWeight="700">
        Proyectos →
      </text>

      {/* tier rectangles (illustrative — not to scale) */}
      <rect x="40" y="160" width="40" height="20" fill="url(#grid-grad)" stroke="#10b981" />
      <text x="44" y="174" fontSize="9" fontWeight="700" className="fill-emerald-700 dark:fill-emerald-300">
        Gratis
      </text>

      <rect x="40" y="130" width="60" height="50" fill="url(#grid-grad)" stroke="#10b981" />
      <text x="46" y="146" fontSize="9" fontWeight="700" className="fill-emerald-700 dark:fill-emerald-300">
        Comité
      </text>

      <rect x="40" y="90" width="100" height="90" fill="url(#grid-grad)" stroke="#10b981" />
      <text x="46" y="108" fontSize="9" fontWeight="700" className="fill-emerald-700 dark:fill-emerald-300">
        Depto. Prevención
      </text>

      <rect x="40" y="60" width="160" height="120" fill="url(#grid-grad)" stroke="#10b981" />
      <text x="46" y="78" fontSize="9" fontWeight="700" className="fill-emerald-700 dark:fill-emerald-300">
        Plata / Oro
      </text>

      <rect x="40" y="30" width="240" height="150" fill="url(#grid-grad)" stroke="#f59e0b" />
      <text x="46" y="46" fontSize="9" fontWeight="700" className="fill-amber-600 dark:fill-amber-300">
        Titanio+ (Workspace Native)
      </text>

      {/* dot showing example "you are here" */}
      <circle cx="120" cy="120" r="5" fill="#ef4444" />
      <text x="128" y="116" fontSize="9" className="fill-current" fontWeight="700">
        Tú estás aquí
      </text>
    </svg>
  );
}

function TransparenciaInner() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-12">
      {/* Hero */}
      <header className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wider">
          <ShieldCheck className="w-3.5 h-3.5" />
          Transparencia radical
        </div>
        <h1 className="text-3xl sm:text-5xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">
          Cómo cobramos y por qué
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-base sm:text-lg max-w-2xl mx-auto">
          La prevención de salvaguarda de vida no debe ser opaca. Acá explicamos cada peso, cada
          umbral, y cuándo realmente te conviene upgradear (y cuándo NO).
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <CurrencyToggle />
          <Link
            to="/pricing"
            className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
          >
            Ver planes <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      {/* El bucket 2D */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white mb-2">
          El bucket 2D
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Cobramos en dos dimensiones: <strong>trabajadores</strong> totales y{' '}
          <strong>proyectos</strong> activos. Cada tier es un rectángulo en este plano. Si te sales
          del rectángulo en una sola dimensión, pagas overage; si te sales en ambas, conviene
          subir de tier.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <Bucket2DSvg />
          <ul className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
            <li className="flex items-start gap-2">
              <Users className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Eje Y: trabajadores totales contratados, contractistas y subcontratos incluidos.
            </li>
            <li className="flex items-start gap-2">
              <Briefcase className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Eje X: proyectos / faenas activas con cumplimiento normativo individual.
            </li>
            <li className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Multi-país NO suma costo. ISO 45001 cubre tu fallback global.
            </li>
          </ul>
        </div>
      </section>

      {/* Tabla de overage */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white mb-2">
          Tabla de overage (tiers básicos)
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Si pasas de la capacidad por uno o dos trabajadores, no te bloqueamos: simplemente cobramos
          un extra mensual. Los tiers premium (Titanio en adelante) <strong>no</strong> tienen
          overage — la propuesta es predecible.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs font-bold border-b border-zinc-200 dark:border-white/10">
              <tr>
                <th className="py-3 pr-4">Tier</th>
                <th className="py-3 pr-4">Trabajador extra</th>
                <th className="py-3 pr-4">Proyecto extra</th>
                <th className="py-3">Ejemplo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
              {OVERAGE_TIER_IDS.map((id) => {
                const t = getTierById(id);
                return (
                  <tr key={id}>
                    <td className="py-3 pr-4 font-bold text-zinc-900 dark:text-white">{t.nombre}</td>
                    <td className="py-3 pr-4">{formatCurrency(t.trabajadorExtraClp ?? 0, 'CLP')}</td>
                    <td className="py-3 pr-4">{formatCurrency(t.proyectoExtraClp ?? 0, 'CLP')}</td>
                    <td className="py-3 text-zinc-600 dark:text-zinc-400">
                      +5 trabajadores = +{formatCurrency((t.trabajadorExtraClp ?? 0) * 5, 'CLP')}/mes
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cuándo conviene */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white mb-2">
          Cuándo te conviene upgradear (y cuándo NO)
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          La regla: si tu overage mensual supera el delta al siguiente tier, sube. Si no, pagas overage.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs font-bold border-b border-zinc-200 dark:border-white/10">
              <tr>
                <th className="py-3 pr-4">Escenario</th>
                <th className="py-3 pr-4">Overage</th>
                <th className="py-3 pr-4">Costo siguiente tier</th>
                <th className="py-3">Recomendación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
              <tr>
                <td className="py-3 pr-4">Comité @ 30 trabajadores</td>
                <td className="py-3 pr-4">{formatCurrency(5 * 990, 'CLP')}</td>
                <td className="py-3 pr-4">{formatCurrency(30990, 'CLP')}</td>
                <td className="py-3 text-emerald-600 dark:text-emerald-400 font-bold">Quédate en Comité</td>
              </tr>
              <tr>
                <td className="py-3 pr-4">Comité @ 60 trabajadores</td>
                <td className="py-3 pr-4">{formatCurrency(35 * 990, 'CLP')}</td>
                <td className="py-3 pr-4">{formatCurrency(30990, 'CLP')}</td>
                <td className="py-3 text-amber-600 dark:text-amber-400 font-bold">Sube a Departamento</td>
              </tr>
              <tr>
                <td className="py-3 pr-4">Oro @ 800 trabajadores</td>
                <td className="py-3 pr-4">{formatCurrency(300 * 190, 'CLP')}</td>
                <td className="py-3 pr-4">{formatCurrency(249990, 'CLP')}</td>
                <td className="py-3 text-emerald-600 dark:text-emerald-400 font-bold">Quédate en Oro</td>
              </tr>
              <tr>
                <td className="py-3 pr-4">Oro @ 2.000 trabajadores</td>
                <td className="py-3 pr-4">{formatCurrency(1500 * 190, 'CLP')}</td>
                <td className="py-3 pr-4">{formatCurrency(249990, 'CLP')}</td>
                <td className="py-3 text-amber-600 dark:text-amber-400 font-bold">Sube a Titanio</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Comparación con alternativas */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white mb-2">
          Comparación con alternativas reales
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          Costo mensual real de una empresa chilena promedio que necesita prevención.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs font-bold border-b border-zinc-200 dark:border-white/10">
              <tr>
                <th className="py-3 pr-4">Alternativa</th>
                <th className="py-3 pr-4">Costo</th>
                <th className="py-3">Notas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
              <tr>
                <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">
                  Prevencionista part-time (CL)
                </td>
                <td className="py-3 pr-4">$400.000–$700.000 CLP/mes</td>
                <td className="py-3 text-zinc-500 dark:text-zinc-400">No incluye software ni cobertura 24/7</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">
                  SafetyCulture (5 seats)
                </td>
                <td className="py-3 pr-4">~$120 USD/mes (~$114.000 CLP)</td>
                <td className="py-3 text-zinc-500 dark:text-zinc-400">Sin normativa chilena nativa</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">
                  Multa SUSESO promedio
                </td>
                <td className="py-3 pr-4">$1–25 millones CLP por incumplimiento</td>
                <td className="py-3 text-zinc-500 dark:text-zinc-400">Una sola multa cubre años de Praeventio</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-white">
                  Accidente grave promedio (CL)
                </td>
                <td className="py-3 pr-4">~$50 millones CLP</td>
                <td className="py-3 text-zinc-500 dark:text-zinc-400">Costo directo + indirecto + reputacional</td>
              </tr>
              <tr className="bg-emerald-50 dark:bg-emerald-900/20">
                <td className="py-3 pr-4 font-black text-emerald-700 dark:text-emerald-300">
                  Praeventio Comité Paritario
                </td>
                <td className="py-3 pr-4 font-black text-emerald-700 dark:text-emerald-300">
                  {formatCurrency(11990, 'CLP')}/mes
                </td>
                <td className="py-3 text-zinc-600 dark:text-zinc-400">Hasta 25 trabajadores · 3 proyectos</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Calculator */}
      <section className="space-y-3">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">
          Calcula tu plan
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Mueve los controles. La fuente única es <code className="text-xs">tiers.ts</code> — los
          mismos números que ves en la página de planes.
        </p>
        <PricingCalculator />
      </section>

      {/* Tier ladder */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8">
        <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white mb-4">
          Los 10 tiers de un vistazo
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs font-bold border-b border-zinc-200 dark:border-white/10">
              <tr>
                <th className="py-3 pr-4">Tier</th>
                <th className="py-3 pr-4">Cap. trabajadores</th>
                <th className="py-3 pr-4">Cap. proyectos</th>
                <th className="py-3 pr-4">CLP/mes</th>
                <th className="py-3">USD/mes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
              {TIERS.map((t) => (
                <tr key={t.id}>
                  <td className="py-3 pr-4 font-bold text-zinc-900 dark:text-white">{t.nombre}</td>
                  <td className="py-3 pr-4">
                    {t.trabajadoresMax === Infinity ? 'Ilimitados' : t.trabajadoresMax.toLocaleString('es-CL')}
                  </td>
                  <td className="py-3 pr-4">{t.proyectosMax === Infinity ? 'Ilimitados' : t.proyectosMax}</td>
                  <td className="py-3 pr-4">{formatCurrency(t.clpRegular, 'CLP')}</td>
                  <td className="py-3">{formatCurrency(t.usdRegular, 'USD')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTAs */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/pricing#tier-gratis"
          className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl p-6 flex items-center justify-between gap-4 transition-colors"
        >
          <div>
            <p className="text-xs uppercase tracking-widest opacity-90">Empieza gratis</p>
            <p className="text-xl font-black">Plan Gratuito · 10 trabajadores</p>
          </div>
          <Sparkles className="w-6 h-6" />
        </Link>
        <Link
          to="/pricing"
          className="bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 rounded-2xl p-6 flex items-center justify-between gap-4 transition-colors"
        >
          <div>
            <p className="text-xs uppercase tracking-widest opacity-90">Ver todos los planes</p>
            <p className="text-xl font-black">Pricing completo</p>
          </div>
          <Building2 className="w-6 h-6" />
        </Link>
      </section>

      {/* Disclosures */}
      <section className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 pt-4 border-t border-zinc-200 dark:border-white/10">
        <p className="flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" /> Facturación chilena. IVA 19% incluido en precios CLP. RUT emisor 78231119-0.
        </p>
        <p className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" /> Precios USD calculados al tipo de cambio nominal del tier; refresco trimestral.
        </p>
      </section>
    </div>
  );
}

export function Transparencia() {
  return (
    <CurrencyProvider>
      <TransparenciaInner />
    </CurrencyProvider>
  );
}

export default Transparencia;
