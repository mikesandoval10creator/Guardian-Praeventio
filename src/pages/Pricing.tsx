import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Building2, Users, ShieldAlert, Zap, ArrowRight, AlertTriangle } from 'lucide-react';
import { useSubscription, SubscriptionPlan } from '../contexts/SubscriptionContext';

const PLANS = [
  {
    id: 'free',
    name: 'Plan Gratuito',
    subtitle: 'Educación Básica',
    capacity: 'Hasta 10 personas (1 proyecto)',
    price: '$0',
    period: 'para siempre',
    features: [
      'Acceso a recomendaciones generales',
      'Inventario básico de EPP',
      'Planificación de clima para 3 días',
      'Zettelkasten Core (Gemini Pro)'
    ],
    color: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white',
    buttonColor: 'bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200'
  },
  {
    id: 'comite',
    name: 'Comité Paritario',
    subtitle: 'Obligatorio ≥25 trabajadores',
    capacity: 'Hasta 25 personas',
    price: '$10',
    introPrice: '$7',
    annualPrice: '$96',
    period: 'por mes',
    features: [
      'Todo lo del plan gratis',
      'Gestión de comités paritarios',
      'Evaluaciones rápidas de riesgo',
      'Informes básicos'
    ],
    color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/30',
    buttonColor: 'bg-emerald-500 hover:bg-emerald-600 text-white',
    popular: true
  },
  {
    id: 'departamento',
    name: 'Departamento Prevención',
    subtitle: 'Obligatorio ≥100 trabajadores',
    capacity: 'Hasta 100 personas',
    price: '$30',
    introPrice: '$21',
    annualPrice: '$288',
    period: 'por mes',
    features: [
      'Todo lo del plan Comité',
      'Generación de PTS con IA',
      'Dashboard SUSESO',
      'Auditorías ISO automatizadas'
    ],
    color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-500/30',
    buttonColor: 'bg-blue-500 hover:bg-blue-600 text-white'
  }
];

const ENTERPRISE_PLANS = [
  { id: 'plata', name: 'Plata', capacity: '250', price: '$50', intro: '$35', annual: '$480' },
  { id: 'oro', name: 'Oro', capacity: '500', price: '$90', intro: '$63', annual: '$864' },
  { id: 'platino', name: 'Platino', capacity: '1,000', price: '$160', intro: '$112', annual: '$1,536' },
  { id: 'empresarial', name: 'Empresarial', capacity: '2,500', price: '$350', intro: '$245', annual: '$3,360' },
  { id: 'corporativo', name: 'Corporativo', capacity: '5,000', price: '$600', intro: '$420', annual: '$5,760' },
  { id: 'ilimitado', name: 'Ilimitado', capacity: 'Ilimitado', price: '$1,200', intro: '$840', annual: '$11,520' }
];

export function Pricing() {
  const { plan, totalWorkers, recommendedPlan, requiresUpgrade, upgradePlan } = useSubscription();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight mb-4">
          Planes y Cumplimiento Legal
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400 text-lg">
          Nuestros planes están diseñados para escalar con tu empresa y asegurar el cumplimiento de la normativa chilena (DS 54, DS 40, Ley 16.744).
        </p>
      </div>

      {/* Compliance Alert */}
      {requiresUpgrade && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-4 shadow-lg mb-8"
        >
          <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="text-lg font-bold text-red-900 dark:text-red-400">Alerta de Cumplimiento Normativo</h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              Actualmente tienes <strong>{totalWorkers} trabajadores</strong> registrados. Según la normativa chilena, requieres hacer upgrade al plan <strong>{PLANS.find(p => p.id === recommendedPlan)?.name || 'Superior'}</strong> para cumplir con la ley.
            </p>
          </div>
          <button 
            onClick={() => upgradePlan(recommendedPlan)}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl text-sm font-bold uppercase tracking-wider transition-all whitespace-nowrap"
          >
            Actualizar Ahora
          </button>
        </motion.div>
      )}

      {/* Main Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
        {PLANS.map((p) => (
          <div 
            key={p.id}
            className={`relative rounded-3xl p-8 flex flex-col ${p.color} border ${plan === p.id ? 'ring-4 ring-offset-2 ring-emerald-500 dark:ring-offset-zinc-900' : ''}`}
          >
            {p.popular && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-4 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                Recomendado
              </div>
            )}
            
            <div className="mb-8">
              <h3 className="text-2xl font-black uppercase tracking-tight mb-1">{p.name}</h3>
              <p className="text-sm font-medium opacity-80 mb-4">{p.subtitle}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black tracking-tighter">{p.price}</span>
                <span className="text-sm font-medium opacity-80">{p.period}</span>
              </div>
              {p.introPrice && (
                <p className="text-xs font-bold mt-2 text-emerald-600 dark:text-emerald-400">
                  Precio Introductorio: {p.introPrice}/mes (primeros 3 meses)
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 mb-8 bg-white/50 dark:bg-black/20 p-3 rounded-xl">
              <Users className="w-5 h-5 opacity-70" />
              <span className="text-sm font-bold">{p.capacity}</span>
            </div>

            <ul className="space-y-4 mb-8 flex-1">
              {p.features.map((feature, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 shrink-0 opacity-70 mt-0.5" />
                  <span className="text-sm font-medium">{feature}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={() => upgradePlan(p.id as SubscriptionPlan)}
              disabled={plan === p.id}
              className={`w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all ${p.buttonColor} ${plan === p.id ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {plan === p.id ? 'Plan Actual' : 'Seleccionar Plan'}
            </button>
          </div>
        ))}
      </div>

      {/* Enterprise Table */}
      <div className="mt-16 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl overflow-hidden">
        <div className="p-6 sm:p-8 border-b border-zinc-200 dark:border-white/10">
          <h3 className="text-2xl font-black uppercase tracking-tight flex items-center gap-3">
            <Building2 className="w-6 h-6 text-emerald-500" />
            Planes Corporativos
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            Modelo B2B con Facturación Chilena (IVA incluido). Descuento del 20% en pago anual.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider text-xs font-bold">
              <tr>
                <th className="p-4 sm:p-6">Plan</th>
                <th className="p-4 sm:p-6">Capacidad</th>
                <th className="p-4 sm:p-6">Intro (3 meses)</th>
                <th className="p-4 sm:p-6">Regular/mes</th>
                <th className="p-4 sm:p-6">Anual (-20%)</th>
                <th className="p-4 sm:p-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
              {ENTERPRISE_PLANS.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                  <td className="p-4 sm:p-6 font-bold text-zinc-900 dark:text-white uppercase">{p.name}</td>
                  <td className="p-4 sm:p-6 text-zinc-600 dark:text-zinc-300">{p.capacity} personas</td>
                  <td className="p-4 sm:p-6 text-emerald-600 dark:text-emerald-400 font-bold">{p.intro}</td>
                  <td className="p-4 sm:p-6 font-medium">{p.price}</td>
                  <td className="p-4 sm:p-6 font-bold">{p.annual}</td>
                  <td className="p-4 sm:p-6 text-right">
                    <button 
                      onClick={() => upgradePlan(p.id as SubscriptionPlan)}
                      className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold uppercase tracking-wider text-xs flex items-center gap-1 justify-end w-full"
                    >
                      {plan === p.id ? 'Actual' : 'Seleccionar'} <ArrowRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
