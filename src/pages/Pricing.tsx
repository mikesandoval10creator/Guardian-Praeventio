import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Minus, Users, Building2, Zap, ArrowRight, AlertTriangle, Loader2, CreditCard, Infinity as InfinityIcon } from 'lucide-react';
import { useSubscription, SubscriptionPlan, PLAN_LIMITS } from '../contexts/SubscriptionContext';
import { useNotifications } from '../contexts/NotificationContext';

const PLANS: {
  id: SubscriptionPlan;
  name: string;
  subtitle: string;
  price: string;
  period: string;
  color: string;
  buttonColor: string;
  badge?: string;
}[] = [
  {
    id: 'libre',
    name: 'Libre',
    subtitle: 'Para comenzar',
    price: '$0',
    period: 'para siempre',
    color: 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700',
    buttonColor: 'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-black hover:bg-zinc-700 dark:hover:bg-zinc-300',
  },
  {
    id: 'profesional',
    name: 'Profesional',
    subtitle: 'Independiente o equipo pequeño',
    price: '$10',
    period: '/mes',
    color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-500/30',
    buttonColor: 'bg-emerald-500 hover:bg-emerald-600 text-white',
    badge: 'Más Popular',
  },
  {
    id: 'empresa',
    name: 'Empresa',
    subtitle: 'Departamento de Prevención',
    price: '$35',
    period: '/mes',
    color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-500/30',
    buttonColor: 'bg-blue-500 hover:bg-blue-600 text-white',
  },
  {
    id: 'corporativo',
    name: 'Corporativo',
    subtitle: 'Grandes organizaciones',
    price: '$90',
    period: '/mes',
    color: 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-500/30',
    buttonColor: 'bg-violet-600 hover:bg-violet-700 text-white',
  },
];

type FeatureAvailability = 'all' | 'paid' | 'enterprise' | 'corporate';

interface Feature {
  name: string;
  availability: FeatureAvailability;
}

const FEATURES: { category: string; items: Feature[] }[] = [
  {
    category: 'Seguridad Operacional (todos los planes)',
    items: [
      { name: 'Gestión de Riesgos IPER/Zettelkasten', availability: 'all' },
      { name: 'Normativa BCN actualizada (DS 594, Ley 16.744, DS 40, más)', availability: 'all' },
      { name: 'Control de EPP e Inventario', availability: 'all' },
      { name: 'Registro de Incidentes y Accidentes', availability: 'all' },
      { name: 'Capacitaciones y ODI', availability: 'all' },
      { name: 'Inspecciones de Seguridad', availability: 'all' },
      { name: 'Gestión de Higiene Ocupacional', availability: 'all' },
      { name: 'Guía de Implementación de Controles', availability: 'all' },
    ],
  },
  {
    category: 'Funciones IA (Profesional y superiores)',
    items: [
      { name: 'El Asesor — Chat IA de Prevención', availability: 'paid' },
      { name: 'Generador de PTS / AST con IA', availability: 'paid' },
      { name: 'Análisis de Sustancias Químicas (HAZMAT)', availability: 'paid' },
      { name: 'Predicción de Riesgos con Machine Learning', availability: 'paid' },
      { name: 'Auditoría Legal Automatizada (gaps normativos)', availability: 'paid' },
      { name: 'Análisis Psicosocial IA (SUSESO/ISTAS 21)', availability: 'paid' },
    ],
  },
  {
    category: 'Dashboard Ejecutivo (Empresa y superiores)',
    items: [
      { name: 'KPIs de Seguridad para Gerencia', availability: 'enterprise' },
      { name: 'Informes Automáticos ISO 45001 / OHSAS', availability: 'enterprise' },
      { name: 'Análisis Comparativo entre Proyectos', availability: 'enterprise' },
    ],
  },
  {
    category: 'Integración (Corporativo)',
    items: [
      { name: 'API REST para ERP / HRM', availability: 'corporate' },
      { name: 'SSO (Single Sign-On)', availability: 'corporate' },
      { name: 'Soporte prioritario dedicado', availability: 'corporate' },
    ],
  },
];

const formatLimit = (n: number) => (n === Infinity ? '∞' : n.toString());

function AvailabilityIcon({ plan, availability }: { plan: SubscriptionPlan; availability: FeatureAvailability }) {
  const included =
    availability === 'all' ||
    (availability === 'paid' && plan !== 'libre') ||
    (availability === 'enterprise' && (plan === 'empresa' || plan === 'corporativo')) ||
    (availability === 'corporate' && plan === 'corporativo');

  if (included) return <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />;
  if (availability === 'all') return <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto" />;
  return <Minus className="w-4 h-4 text-zinc-300 dark:text-zinc-600 mx-auto" />;
}

export function Pricing() {
  const { plan, totalWorkers, recommendedPlan, requiresUpgrade, upgradePlan } = useSubscription();
  const { addNotification } = useNotifications();
  const [isProcessing, setIsProcessing] = React.useState<string | null>(null);

  const handlePayment = async (planId: SubscriptionPlan) => {
    if (planId === plan) return;
    setIsProcessing(planId);
    try {
      console.log(`[Billing] Iniciando flujo de compra para: ${planId}`);
      await new Promise(resolve => setTimeout(resolve, 800));
      const mockPurchaseToken = `google_play_token_${Math.random().toString(36).substring(7)}`;

      const { verifyGooglePlayPurchase } = await import('../services/billingService');
      addNotification({ title: 'Verificando con Google Play', message: 'Validando transacción...', type: 'info' });

      const verification = await verifyGooglePlayPurchase(mockPurchaseToken, planId as string, 'subscription');
      if (verification.success) {
        await upgradePlan(planId, mockPurchaseToken);
        addNotification({
          title: 'Plan activado',
          message: `Bienvenido al plan ${PLANS.find(p => p.id === planId)?.name}. Tu equipo puede crecer.`,
          type: 'success',
        });
      } else {
        throw new Error(verification.error || 'No se pudo verificar la compra');
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Error al conectar con Google Play Billing.';
      addNotification({ title: 'Error de pago', message: msg, type: 'error' });
    } finally {
      setIsProcessing(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-12">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter mb-4">
          Paga por escala, no por funciones
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-base leading-relaxed">
          Todas las herramientas de prevención de riesgos están disponibles en cada plan. La diferencia está en cuántos proyectos, trabajadores y personas en tu equipo puedes gestionar.
        </p>
      </div>

      {/* Compliance alert */}
      {requiresUpgrade && (
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-5 flex flex-col sm:flex-row items-center gap-4"
        >
          <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-sm font-bold text-red-800 dark:text-red-300">Límite de capacidad alcanzado</p>
            <p className="text-sm text-red-700 dark:text-red-400 mt-0.5">
              Tienes <strong>{totalWorkers} trabajadores</strong> registrados. Tu plan actual no cubre esa cantidad.{' '}
              Actualiza al plan <strong>{PLANS.find(p => p.id === recommendedPlan)?.name}</strong> para continuar creciendo.
            </p>
          </div>
          <button
            onClick={() => handlePayment(recommendedPlan)}
            disabled={!!isProcessing}
            className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold uppercase tracking-wide whitespace-nowrap disabled:opacity-50"
          >
            {isProcessing === recommendedPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Actualizar ahora'}
          </button>
        </motion.div>
      )}

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {PLANS.map((p) => {
          const limits = PLAN_LIMITS[p.id];
          const isCurrent = plan === p.id;
          return (
            <div
              key={p.id}
              className={`relative rounded-2xl p-6 flex flex-col border ${p.color} ${isCurrent ? 'ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-zinc-950' : ''}`}
            >
              {p.badge && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                  {p.badge}
                </span>
              )}

              <div className="mb-6">
                <h3 className="text-xl font-black uppercase tracking-tight">{p.name}</h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{p.subtitle}</p>
                <div className="flex items-baseline gap-1 mt-4">
                  <span className="text-3xl font-black tracking-tighter">{p.price}</span>
                  <span className="text-sm text-zinc-500">{p.period}</span>
                </div>
              </div>

              {/* Scale limits */}
              <ul className="space-y-2 mb-6 text-sm">
                <li className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 opacity-50 shrink-0" />
                  <span>
                    <span className="font-bold">{formatLimit(limits.projects)}</span>{' '}
                    {limits.projects === 1 ? 'proyecto' : 'proyectos'}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Users className="w-4 h-4 opacity-50 shrink-0" />
                  <span>
                    <span className="font-bold">{formatLimit(limits.workersPerProject)}</span>{' '}
                    trabajadores/proyecto
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Users className="w-4 h-4 opacity-50 shrink-0" />
                  <span>
                    <span className="font-bold">{formatLimit(limits.teamPerProject)}</span>{' '}
                    {limits.teamPerProject === 1 ? 'miembro' : 'miembros'} de equipo
                  </span>
                </li>
                {limits.totalWorkers !== Infinity && (
                  <li className="flex items-center gap-2 text-zinc-500">
                    <InfinityIcon className="w-4 h-4 opacity-50 shrink-0" />
                    <span>Máx. <span className="font-bold">{limits.totalWorkers}</span> trabajadores totales</span>
                  </li>
                )}
              </ul>

              <div className="mt-auto">
                <button
                  onClick={() => handlePayment(p.id)}
                  disabled={isCurrent || !!isProcessing}
                  className={`w-full py-3 rounded-xl text-sm font-black uppercase tracking-wider transition-all ${p.buttonColor} ${isCurrent || !!isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isProcessing === p.id ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : isCurrent ? (
                    'Plan Actual'
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <CreditCard className="w-4 h-4" />
                      Seleccionar
                    </span>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature comparison table */}
      <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-100 dark:border-white/10">
          <h3 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-500" />
            Comparativa de funciones
          </h3>
          <p className="text-sm text-zinc-500 mt-1">
            Las funciones de seguridad son iguales en todos los planes. Solo varía la capacidad operacional y el acceso a IA.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* Header row */}
            <thead>
              <tr className="border-b border-zinc-100 dark:border-white/10">
                <th className="text-left p-4 font-medium text-zinc-500 w-1/2">Función</th>
                {PLANS.map(p => (
                  <th key={p.id} className={`p-4 text-center font-black uppercase text-xs tracking-wider ${plan === p.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>
                    {p.name}
                    {plan === p.id && <span className="block text-[10px] normal-case font-medium text-emerald-500">actual</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((section) => (
                <React.Fragment key={section.category}>
                  <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                    <td colSpan={5} className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      {section.category}
                    </td>
                  </tr>
                  {section.items.map((feature) => (
                    <tr key={feature.name} className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                      <td className="p-4 text-zinc-700 dark:text-zinc-300">{feature.name}</td>
                      {PLANS.map(p => (
                        <td key={p.id} className="p-4">
                          <AvailabilityIcon plan={p.id} availability={feature.availability} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/30 flex items-center gap-3 text-xs text-zinc-500">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>Incluido</span>
          <Minus className="w-4 h-4 text-zinc-400 ml-4 shrink-0" />
          <span>No incluido en este plan</span>
        </div>
      </div>

      {/* Footer note */}
      <p className="text-center text-xs text-zinc-400 pb-4">
        Precios en USD. Facturación mensual. Descuento 20% en pago anual. IVA según legislación chilena aplicable.
      </p>
    </div>
  );
}
