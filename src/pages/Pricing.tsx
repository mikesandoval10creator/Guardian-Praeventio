import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Building2,
  Users,
  Briefcase,
  ArrowRight,
  AlertTriangle,
  Loader2,
  CreditCard,
  Smartphone,
  Sparkles,
  ShieldCheck,
  Crown,
  Mail,
  Info,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useSubscription, SubscriptionPlan } from '../contexts/SubscriptionContext';
import { useNotifications } from '../contexts/NotificationContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import {
  TIERS,
  type Tier,
  type TierId,
  formatCurrency,
  withIVA,
} from '../services/pricing/tiers';
import {
  CurrencyProvider,
  CurrencyToggle,
  useCurrency,
} from '../components/pricing/CurrencyToggle';

import { NormativaSwitch } from '../components/normativa/NormativaSwitch';
import { useInvoicePolling } from '../hooks/useInvoicePolling';
import { logger } from '../utils/logger';

// Payments are processed exclusively through Google Play Billing on the native app.
const isNative = () => typeof (window as any).Capacitor !== 'undefined';

// LATAM countries we route through MercadoPago. Chile stays on Webpay
// (existing path); everything else falls back to Stripe (USD). See
// `src/services/billing/currency.ts` for the currency mapping.
const MP_COUNTRIES = ['PE', 'AR', 'CO', 'MX', 'BR'] as const;
type MpCountry = (typeof MP_COUNTRIES)[number];
const MP_CURRENCY_BY_COUNTRY: Record<MpCountry, 'PEN' | 'ARS' | 'COP' | 'MXN' | 'BRL'> = {
  PE: 'PEN',
  AR: 'ARS',
  CO: 'COP',
  MX: 'MXN',
  BR: 'BRL',
};

/**
 * Best-effort country detection for the Pricing checkout router.
 *
 * Decision matrix (in priority order):
 *   1. URL override `?country=XX` — explicit, lets QA force a path.
 *   2. `navigator.language` BCP-47 region tag — fast, no network.
 *   3. Default to `'CL'` (Chile / Webpay) — our home market.
 *
 * We deliberately do NOT use IP geolocation here. The user may be a
 * Chilean expat traveling abroad; routing by IP would silently switch
 * them to MP/Stripe and surprise-bill in the wrong currency. The user
 * can still override via the URL param if they want a different rail.
 */
function detectCountry(search: string): string {
  // 1. URL override.
  try {
    const params = new URLSearchParams(search);
    const override = params.get('country');
    if (override && /^[A-Z]{2}$/.test(override.toUpperCase())) {
      return override.toUpperCase();
    }
  } catch {
    // URLSearchParams should never throw on a valid string but defend
    // against weird `location.search` shapes (e.g., embedded webview).
  }

  // 2. navigator.language → ISO 3166-1 alpha-2 region.
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const match = navigator.language.match(/-([A-Z]{2})/i);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  // 3. Default Chile.
  return 'CL';
}

// Map our canonical TierId → the legacy SubscriptionPlan id used by the existing
// Google Play Billing handler. Diamante is routed to the B2B sales contact flow
// (still no Play SKU); titanio is mapped now that the legacy union has been
// extended to cover it (R4 Round 14).
const TIER_TO_LEGACY_PLAN: Partial<Record<TierId, SubscriptionPlan>> = {
  gratis: 'free',
  'comite-paritario': 'comite',
  'departamento-prevencion': 'departamento',
  plata: 'plata',
  oro: 'oro',
  titanio: 'titanio',
  diamante: 'platino', // legacy "platino" maps to the diamante (~1000 worker) tier
  empresarial: 'empresarial',
  corporativo: 'corporativo',
  ilimitado: 'ilimitado',
};

const PREMIUM_TIER_IDS: ReadonlySet<TierId> = new Set([
  'titanio',
  'diamante',
  'empresarial',
  'corporativo',
  'ilimitado',
]);

const TIER_FEATURES: Record<TierId, string[]> = {
  gratis: [
    'Calendar predictions completas',
    'Multi-país ilimitado',
    'ISO 45001 fallback global',
    'Inventario básico de EPP',
    'Botón de emergencia siempre activo',
  ],
  'comite-paritario': [
    'Todo lo del plan gratis',
    'Gestión completa de Comité Paritario (DS 54)',
    'Evaluaciones rápidas de riesgo',
    'Informes básicos PDF/Excel',
    'Multi-país sin recargo',
  ],
  'departamento-prevencion': [
    'Todo lo de Comité Paritario',
    'Departamento de Prevención (DS 40)',
    'Generación de PTS con IA',
    'Dashboard SUSESO',
    'Auditorías ISO automatizadas',
  ],
  plata: [
    'Todo lo de Departamento',
    'Hasta 250 trabajadores / 25 proyectos',
    'Risk Network colaborativo',
    'Reportes ejecutivos avanzados',
    'Soporte prioritario por chat',
  ],
  oro: [
    'Todo lo del plan Plata',
    'Hasta 500 trabajadores / 50 proyectos',
    'IPERC con IA personalizada',
    'Análisis predictivo de incidentes',
    'Integración ERP básica',
  ],
  titanio: [
    'Workspace Native: SSO básico',
    '750 trabajadores / 75 proyectos (sin overage)',
    'Customer Success dedicado',
    'SLA 99.5% mensual',
    'Onboarding en sitio',
  ],
  diamante: [
    'Workspace Native: SSO + CASA Tier',
    '1.000 trabajadores / 100 proyectos',
    'Auditoría de seguridad anual',
    'API privada con rate-limit empresarial',
    'Soporte 24/7 con tiempo de respuesta < 1h',
  ],
  empresarial: [
    'Multi-tenant nativo',
    '2.500 trabajadores / 250 proyectos',
    'Múltiples filiales/RUTs',
    'Integraciones SAP / Oracle',
    'Custom reports + data residency CL',
  ],
  corporativo: [
    'Multi-tenant + CSM dedicado',
    '5.000 trabajadores / 500 proyectos',
    'Roadmap influence cuarterly',
    'Penetration testing anual incluido',
    'Hot-line ejecutivo 24/7',
  ],
  ilimitado: [
    'Vertex Fine-Tuned: modelo IA propio',
    'Trabajadores y proyectos ilimitados',
    'Despliegue privado opcional',
    'Compliance ad-hoc (NIST, SOC2)',
    'Equipo de prevención embedded',
  ],
};

const TIER_BADGES: Partial<Record<TierId, { label: string; tone: 'green' | 'gold' | 'blue' | 'silver' }>> = {
  gratis: { label: 'Siempre gratis', tone: 'green' },
  'departamento-prevencion': { label: 'Más popular para PYME', tone: 'blue' },
  diamante: { label: 'Más popular B2B', tone: 'gold' },
  corporativo: { label: 'Elegido por multinacionales', tone: 'silver' },
};

function badgeClasses(tone: 'green' | 'gold' | 'blue' | 'silver'): string {
  switch (tone) {
    case 'green':
      return 'bg-emerald-500 text-white';
    case 'gold':
      return 'bg-gradient-to-r from-amber-400 to-yellow-500 text-zinc-900';
    case 'blue':
      return 'bg-blue-500 text-white';
    case 'silver':
      return 'bg-gradient-to-r from-zinc-300 to-zinc-100 text-zinc-900';
  }
}

interface TierCardProps {
  tier: Tier;
  currentLegacyPlan: SubscriptionPlan;
  isProcessing: string | null;
  onPurchase: (tier: Tier) => void;
  onContactSales: (tier: Tier) => void;
}

function TierCard({ tier, currentLegacyPlan, isProcessing, onPurchase, onContactSales }: TierCardProps) {
  const { currency } = useCurrency();
  const isPremium = PREMIUM_TIER_IDS.has(tier.id);
  const legacyId = TIER_TO_LEGACY_PLAN[tier.id];
  const isCurrent = legacyId !== undefined && legacyId === currentLegacyPlan;
  const badge = TIER_BADGES[tier.id];

  const monthlyDisplay = useMemo(() => {
    if (currency === 'USD') {
      return formatCurrency(tier.usdRegular, 'USD');
    }
    return formatCurrency(tier.clpRegular, 'CLP');
  }, [tier, currency]);

  const annualDisplay = useMemo(() => {
    if (currency === 'USD') {
      // Approximate annual USD using same 20%-off ratio
      const annualUsd = Math.round((tier.clpAnual * tier.usdRegular) / Math.max(tier.clpRegular, 1));
      return formatCurrency(annualUsd, 'USD');
    }
    return formatCurrency(tier.clpAnual, 'CLP');
  }, [tier, currency]);

  const introDisplay = useMemo(() => {
    if (currency === 'USD') {
      const introUsd = Math.round((tier.clpIntro3mo * tier.usdRegular) / Math.max(tier.clpRegular, 1));
      return formatCurrency(introUsd, 'USD');
    }
    return formatCurrency(tier.clpIntro3mo, 'CLP');
  }, [tier, currency]);

  const ivaBreakdown = useMemo(() => {
    if (currency !== 'CLP' || tier.clpRegular <= 0) return null;
    // Reverse IVA so the displayed retail .990 figure matches: subtotal = total / 1.19
    const subtotal = Math.floor(tier.clpRegular / 1.19);
    const breakdown = withIVA(subtotal);
    // The breakdown.total should be ~tier.clpRegular; ensure visual coherence
    return breakdown;
  }, [tier, currency]);

  const cardBorder = isPremium
    ? 'border-2 border-transparent bg-gradient-to-br from-amber-50 via-white to-zinc-100 dark:from-zinc-800 dark:via-zinc-900 dark:to-zinc-950 shadow-2xl ring-1 ring-amber-300/40'
    : 'border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900';

  const ringClass = isCurrent ? 'ring-4 ring-emerald-500 ring-offset-2 dark:ring-offset-zinc-900' : '';

  return (
    <motion.div
      id={`tier-${tier.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-3xl p-6 sm:p-8 flex flex-col ${cardBorder} ${ringClass}`}
    >
      {badge && (
        <div
          className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${badgeClasses(
            badge.tone,
          )}`}
        >
          {badge.label}
        </div>
      )}
      {isPremium && (
        <div className="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <Crown className="w-3.5 h-3.5" />
          Workspace Native
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">
          {tier.nombre}
        </h3>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mt-1">
          {tier.id === 'gratis'
            ? 'Para equipos pequeños y educación'
            : isPremium
              ? 'B2B Enterprise · Workspace Native'
              : 'Para PYMES y empresas en crecimiento'}
        </p>

        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-3xl sm:text-4xl font-black tracking-tighter text-zinc-900 dark:text-white">
            {monthlyDisplay}
          </span>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">/mes</span>
        </div>

        {ivaBreakdown && (
          <div className="group relative inline-flex items-center gap-1 mt-2 text-[11px] text-zinc-500 dark:text-zinc-400 cursor-help">
            <Info className="w-3 h-3" />
            <span>IVA 19% incluido</span>
            <div className="invisible group-hover:visible group-focus-within:visible absolute left-0 top-full mt-1 z-10 w-60 bg-zinc-900 text-white text-xs p-3 rounded-lg shadow-lg">
              Subtotal {formatCurrency(ivaBreakdown.subtotal, 'CLP')}
              <br />+ IVA 19% {formatCurrency(ivaBreakdown.iva, 'CLP')}
              <br />= Total {formatCurrency(ivaBreakdown.total, 'CLP')}
            </div>
          </div>
        )}

        {tier.clpRegular > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
              Anual {annualDisplay} · ahorra 20%
            </span>
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
              Intro 3 meses {introDisplay}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-6">
        <div className="bg-zinc-50 dark:bg-black/30 rounded-xl p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Users className="w-3 h-3" /> Trabajadores
          </div>
          <p className="font-black text-zinc-900 dark:text-white">
            {tier.trabajadoresMax === Infinity ? 'Ilimitados' : tier.trabajadoresMax.toLocaleString('es-CL')}
          </p>
        </div>
        <div className="bg-zinc-50 dark:bg-black/30 rounded-xl p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Briefcase className="w-3 h-3" /> Proyectos
          </div>
          <p className="font-black text-zinc-900 dark:text-white">
            {tier.proyectosMax === Infinity ? 'Ilimitados' : tier.proyectosMax}
          </p>
        </div>
      </div>

      <ul className="space-y-3 mb-6 flex-1">
        {TIER_FEATURES[tier.id].map((feature, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
            <span className="text-zinc-700 dark:text-zinc-300">{feature}</span>
          </li>
        ))}
      </ul>

      {isPremium ? (
        <button
          onClick={() => onContactSales(tier)}
          className="w-full inline-flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-zinc-900 font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl transition-colors"
        >
          <Mail className="w-4 h-4" />
          Hablar con ventas
        </button>
      ) : (
        <button
          onClick={() => onPurchase(tier)}
          disabled={isCurrent || isProcessing !== null}
          className={`w-full inline-flex items-center justify-center gap-2 font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl transition-colors ${
            isCurrent
              ? 'bg-zinc-300 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400 cursor-not-allowed'
              : 'bg-emerald-500 hover:bg-emerald-600 text-white'
          }`}
        >
          {isProcessing === legacyId ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isCurrent ? (
            'Plan actual'
          ) : tier.id === 'gratis' ? (
            <>
              <Sparkles className="w-4 h-4" />
              Empezar gratis
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4" />
              Seleccionar plan
            </>
          )}
        </button>
      )}
    </motion.div>
  );
}

/**
 * Banner that surfaces the Webpay return outcome to the user. The server
 * `/billing/webpay/return` handler redirects to one of three SPA paths:
 *
 *   /pricing/success?invoice=<id>  → invoice should reach 'paid'
 *   /pricing/failed?invoice=<id>   → card declined ('rejected')
 *   /pricing/retry?invoice=<id>    → transient failure ('pending-payment')
 *
 * The redirect itself is racy: when another worker holds the idempotency
 * lock the server redirects optimistically to /pricing/success before the
 * actual commit finalizes (server.ts:2385 — "ack and let UI handle eventual
 * consistency"). To resolve this race we poll the authoritative invoice via
 * `GET /api/billing/invoice/:id` (Agent D1) and reconcile the URL hint
 * against the server-side truth. The hook handles 404/5xx as transient
 * (server may not have written the doc yet) and bails on 401 / unauth.
 */
function WebpayReturnBanner() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const invoiceId = params.get('invoice');
  const pathname = location.pathname;

  const initialStatus: 'pending-payment' | 'rejected' | null = pathname.endsWith('/pricing/success')
    ? 'pending-payment'
    : pathname.endsWith('/pricing/failed')
      ? 'rejected'
      : pathname.endsWith('/pricing/retry')
        ? 'pending-payment'
        : null;

  // Hook is called unconditionally to satisfy Rules of Hooks; passing
  // `null` short-circuits to {kind:'idle'} with no fetch.
  const pollState = useInvoicePolling(initialStatus ? invoiceId : null);

  if (!initialStatus) return null;

  // ────────────────────────────────────────────────────────────────────
  // Render based on the reconciled state. Priority:
  //   1. Server says terminal → trust server (settled).
  //   2. Server unreachable / pending → fall back to URL hint.
  //   3. Timeout / error → show degraded UX with support contact.
  // ────────────────────────────────────────────────────────────────────

  if (pollState.kind === 'settled') {
    const inv = pollState.invoice;
    const totalLabel = formatCurrency(inv.totals.total, inv.totals.currency);

    if (inv.status === 'paid') {
      return (
        <div
          role="status"
          className="flex items-start gap-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-emerald-900 dark:text-emerald-300 text-sm">
              ¡Pago confirmado!
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
              Cobramos {totalLabel} a tu tarjeta. Tu suscripción ya está activa
              {invoiceId ? ` (factura ${invoiceId})` : ''}. Te enviamos la
              boleta electrónica al correo registrado.
            </p>
          </div>
        </div>
      );
    }

    if (inv.status === 'rejected' || inv.status === 'cancelled') {
      const reason =
        inv.rejectionReason ??
        (inv.status === 'cancelled'
          ? 'La transacción fue cancelada antes de completarse.'
          : 'Tu tarjeta no autorizó el cargo.');
      return (
        <div
          role="alert"
          className="flex items-start gap-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-5"
        >
          <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-900 dark:text-red-300 text-sm">
              El pago fue rechazado
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {reason}
              {invoiceId ? ` (factura ${invoiceId})` : ''} Puedes intentar con
              otro medio de pago seleccionando el plan de nuevo.
            </p>
          </div>
        </div>
      );
    }

    if (inv.status === 'refunded') {
      return (
        <div
          role="status"
          className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-500/30 rounded-2xl p-5"
        >
          <RefreshCw className="w-6 h-6 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-900 dark:text-blue-300 text-sm">
              Reembolso procesado
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              Devolvimos {totalLabel} a tu medio de pago original
              {invoiceId ? ` (factura ${invoiceId})` : ''}. El abono puede
              tardar 1-2 días hábiles según tu banco.
            </p>
          </div>
        </div>
      );
    }

    // Settled with a non-terminal status — shouldn't happen given the
    // default settleStatuses, but render the pending UX defensively.
    // Round 13 NIT: emit a structured warn so the silent fall-through is
    // diagnosable via Cloud Logging (e.g., a value like `processing` that
    // finalised between polls). No test for this branch — Pricing.tsx has
    // no existing component test harness; adding one solely for a log call
    // would be high-effort low-value (see E4 round-13 report).
    logger.warn('webpay_return_banner_unexpected_status', {
      status: inv.status,
      invoiceId: inv.id,
    });
  }

  if (pollState.kind === 'timeout') {
    return (
      <div
        role="alert"
        className="flex items-start gap-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-5"
      >
        <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-amber-900 dark:text-amber-300 text-sm">
            Tu pago tarda más de lo normal
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            No pudimos confirmar el estado de tu transacción
            {invoiceId ? ` (factura ${invoiceId})` : ''} dentro del tiempo
            esperado. Si el cargo aparece en tu cartola pero la suscripción no
            se activó, contáctanos a{' '}
            <a
              href="mailto:soporte@praeventio.net"
              className="underline font-semibold"
            >
              soporte@praeventio.net
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  if (pollState.kind === 'error') {
    return (
      <div
        role="alert"
        className="flex items-start gap-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-5"
      >
        <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-red-900 dark:text-red-300 text-sm">
            No pudimos verificar tu pago
          </p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-1">
            Recibimos la respuesta de Webpay
            {invoiceId ? ` para la factura ${invoiceId}` : ''} pero no pudimos
            confirmarla. Por favor escríbenos a{' '}
            <a
              href="mailto:soporte@praeventio.net"
              className="underline font-semibold"
            >
              soporte@praeventio.net
            </a>{' '}
            y revisaremos tu transacción.
          </p>
        </div>
      </div>
    );
  }

  // idle / loading — also covers the URL-only fallback while the first
  // poll is in flight. Diverge copy by URL hint so /failed and /retry
  // don't show a green spinner.
  if (initialStatus === 'rejected') {
    return (
      <div
        role="alert"
        className="flex items-start gap-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-5"
      >
        <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-red-900 dark:text-red-300 text-sm">
            El pago fue rechazado
          </p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-1">
            Tu tarjeta no autorizó el cargo
            {invoiceId ? ` (factura ${invoiceId})` : ''}. Estamos verificando
            el estado final con Webpay…
          </p>
        </div>
      </div>
    );
  }

  if (pathname.endsWith('/pricing/retry')) {
    return (
      <div
        role="alert"
        className="flex items-start gap-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-5"
      >
        <RefreshCw className="w-6 h-6 text-amber-500 shrink-0 mt-0.5 animate-spin" />
        <div>
          <p className="font-bold text-amber-900 dark:text-amber-300 text-sm">
            Reintenta el pago
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            Tuvimos un problema temporal procesando tu pago
            {invoiceId ? ` (factura ${invoiceId})` : ''}. Verificando estado
            con el banco — selecciona el plan de nuevo si la factura sigue
            pendiente.
          </p>
        </div>
      </div>
    );
  }

  // /pricing/success while still loading — hopeful spinner.
  return (
    <div
      role="status"
      className="flex items-start gap-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5"
    >
      <Loader2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5 animate-spin" />
      <div>
        <p className="font-bold text-emerald-900 dark:text-emerald-300 text-sm">
          Procesando pago…
        </p>
        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
          Recibimos la respuesta de Webpay
          {invoiceId ? ` para la factura ${invoiceId}` : ''}. Confirmando con
          el banco — esto suele tardar unos segundos.
        </p>
      </div>
    </div>
  );
}

function PricingInner() {
  const { plan, totalWorkers, recommendedPlan, requiresUpgrade, upgradePlan } = useSubscription();
  const { addNotification } = useNotifications();
  const { user } = useFirebase();
  const { projects } = useProject();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  /**
   * Web (non-native) checkout uses Transbank Webpay via the existing
   * `/api/billing/checkout` route at server.ts:2115. The server creates the
   * pending invoice, calls webpayAdapter.createTransaction, and returns a
   * `paymentUrl` we redirect the browser to. After Webpay → server return →
   * the SPA lands on /pricing/success|failed|retry?invoice=<id> and the
   * `useInvoicePolling` hook (Round 13) reconciles the URL hint against the
   * authoritative invoice status.
   */
  const startWebpayCheckout = async (tier: Tier, legacyId: SubscriptionPlan) => {
    if (!user) {
      addNotification({
        title: 'Inicia sesión primero',
        message: 'Necesitas iniciar sesión para suscribirte a un plan pago.',
        type: 'error',
      });
      return;
    }

    setCheckoutError(null);
    setIsProcessing(legacyId);
    try {
      const totalProjects = projects.length;
      const idToken = await user.getIdToken();

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tierId: tier.id,
          cycle: 'monthly',
          currency: 'CLP',
          paymentMethod: 'webpay',
          totalWorkers,
          totalProjects,
          cliente: {
            nombre: user.displayName ?? user.email ?? 'Cliente Praeventio',
            email: user.email ?? '',
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          (detail as { error?: string }).error ??
            `Checkout falló con estado ${response.status}`,
        );
      }

      const data = (await response.json()) as {
        invoiceId: string;
        paymentUrl?: string;
        status: string;
      };

      if (data.status === 'pending-config' || !data.paymentUrl) {
        throw new Error(
          'El proveedor de pagos no está disponible. Reintentá en unos segundos o contacta a soporte@praeventio.net.',
        );
      }

      // Redirect the browser to the Webpay hosted form. The user returns to
      // /pricing/success|failed|retry — handled by WebpayReturnBanner.
      window.location.href = data.paymentUrl;
    } catch (err) {
      logger.error('webpay_checkout_start_failed', err, {
        tierId: tier.id,
        uid: user.uid,
      });
      const message =
        err instanceof Error
          ? err.message
          : 'No pudimos iniciar el pago. Reintentá en unos segundos.';
      setCheckoutError(message);
      addNotification({
        title: 'Error al iniciar el pago',
        message: 'No pudimos iniciar el pago. Reintentá en unos segundos.',
        type: 'error',
      });
      setIsProcessing(null);
    }
    // Note: on success we redirect away — leaving isProcessing set is fine
    // because the page unloads.
  };

  /**
   * Web (non-native) MercadoPago checkout for LATAM markets (PE/AR/CO/MX/BR).
   * Posts to `/api/billing/checkout/mercadopago`; the server creates a
   * preference and returns the `init_point` URL we redirect the browser
   * to. The MP-hosted page handles the card form; on success/pending/
   * failure MP redirects back to `/pricing/success|retry|failed?invoice=`
   * — same banner UX as Webpay (`WebpayReturnBanner` reads the URL).
   */
  const startMercadoPagoCheckout = async (
    tier: Tier,
    legacyId: SubscriptionPlan,
    country: MpCountry,
  ) => {
    if (!user) {
      addNotification({
        title: 'Inicia sesión primero',
        message: 'Necesitas iniciar sesión para suscribirte a un plan pago.',
        type: 'error',
      });
      return;
    }

    setCheckoutError(null);
    setIsProcessing(legacyId);
    try {
      const idToken = await user.getIdToken();
      const currency = MP_CURRENCY_BY_COUNTRY[country];
      const response = await fetch('/api/billing/checkout/mercadopago', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          tierKey: tier.id,
          billingCycle: 'monthly',
          country,
          currency,
        }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          (detail as { error?: string }).error ??
            `Checkout falló con estado ${response.status}`,
        );
      }

      const data = (await response.json()) as {
        preferenceId: string;
        init_point: string;
        invoiceId: string;
      };

      if (!data.init_point) {
        throw new Error(
          'MercadoPago no está disponible. Reintentá en unos segundos o contacta a soporte@praeventio.net.',
        );
      }

      window.location.href = data.init_point;
    } catch (err) {
      logger.error('mercadopago_checkout_start_failed', err, {
        tierId: tier.id,
        uid: user.uid,
        country,
      });
      const message =
        err instanceof Error
          ? err.message
          : 'No pudimos iniciar el pago. Reintentá en unos segundos.';
      setCheckoutError(message);
      addNotification({
        title: 'Error al iniciar el pago',
        message: 'No pudimos iniciar el pago. Reintentá en unos segundos.',
        type: 'error',
      });
      setIsProcessing(null);
    }
  };

  const handlePurchase = async (tier: Tier) => {
    const legacyId = TIER_TO_LEGACY_PLAN[tier.id];
    if (!legacyId) {
      // Defensive: premium tiers should never reach here, they use Contact Sales
      addNotification({
        title: 'Contacta ventas',
        message: `${tier.nombre} requiere una propuesta a medida. Te contactaremos.`,
        type: 'info',
      });
      return;
    }

    if (legacyId === 'free') {
      try {
        await upgradePlan('free');
        addNotification({
          title: 'Plan gratis activado',
          message: '¡Bienvenido a Praeventio Guard!',
          type: 'success',
        });
      } catch (err: any) {
        addNotification({ title: 'Error', message: err.message, type: 'error' });
      }
      return;
    }

    // Web (non-native) → route by country.
    //   CL              → Webpay (existing path).
    //   PE/AR/CO/MX/BR  → MercadoPago.
    //   else            → Stripe (TODO: wire when international rollout
    //                     ships; for now show a friendly fallback).
    if (!isNative()) {
      const country = detectCountry(window.location.search);
      if (country === 'CL') {
        await startWebpayCheckout(tier, legacyId);
        return;
      }
      if ((MP_COUNTRIES as readonly string[]).includes(country)) {
        await startMercadoPagoCheckout(tier, legacyId, country as MpCountry);
        return;
      }
      // Fallback (Stripe-eligible markets) — Stripe wiring is scaffolded
      // in `stripeAdapter.ts` but not yet exposed via a public endpoint
      // for non-CLP currencies. Surface a friendly error pointing to
      // sales until the international rollout lands.
      addNotification({
        title: 'Pagos internacionales',
        message:
          'Por el momento sólo procesamos pagos en Chile y mercados LATAM. Escríbenos a ventas@praeventio.cl para tu país.',
        type: 'info',
      });
      return;
    }

    // ── Round 16 (R1) — Google Play IAP gated behind a feature flag ──
    //
    // The legacy implementation read `(window as any).__pendingPurchaseToken`
    // and shipped that empty string to `verifyGooglePlayPurchase`, which
    // then failed silently with a generic error. The token was never set
    // anywhere in `src/`; the real Google Play Billing wiring (Capacitor
    // plugin + Play Console SKU configuration + signed receipt flow) is
    // out of scope for this round. Instead of pretending the path works
    // we expose a feature flag (`canUseGooglePlayIAP`) — currently false
    // everywhere — and surface a clear "use Webpay / MercadoPago" error
    // when a native build hits the button. This keeps the UI honest until
    // the real IAP integration lands (deferred to a future round).
    const canUseGooglePlayIAP = false;

    if (!canUseGooglePlayIAP) {
      addNotification({
        title: 'Compras Google Play no disponibles',
        message:
          'Google Play IAP no disponible en esta versión. Usá Webpay (CL) o MercadoPago (LATAM) desde la versión web.',
        type: 'error',
      });
      return;
    }

    /* istanbul ignore next — gated until Google Play Billing ships. */
    setIsProcessing(legacyId);
  };

  const handleContactSales = (tier: Tier) => {
    // TODO(IMP5): wire Stripe / Webpay invoice + sales CRM. For now: mailto link.
    const subject = encodeURIComponent(`Cotización plan ${tier.nombre}`);
    const body = encodeURIComponent(
      `Hola, me interesa el plan ${tier.nombre} (${tier.trabajadoresMax} trabajadores / ${tier.proyectosMax} proyectos).\n\nPor favor envíenme una propuesta.`,
    );
    window.location.href = `mailto:ventas@praeventio.cl?subject=${subject}&body=${body}`;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <WebpayReturnBanner />
      {checkoutError && (
        <div
          role="alert"
          className="flex items-start gap-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-5"
        >
          <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-red-900 dark:text-red-300 text-sm">
              No pudimos iniciar el pago. Reintentá en unos segundos.
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {checkoutError}
            </p>
          </div>
          <button
            onClick={() => setCheckoutError(null)}
            className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300 hover:underline"
          >
            Cerrar
          </button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="text-center sm:text-left max-w-3xl">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight mb-3">
            Planes y cumplimiento legal
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-base sm:text-lg">
            Capacidad (trabajadores + proyectos) decide el tier · Cumplimiento normativo se cobra por proyecto · Multi-país sin recargo.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <CurrencyToggle />
          <div className="hidden sm:inline-flex">
            <NormativaSwitch />
          </div>
          <Link
            to="/transparencia"
            className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
          >
            Cómo cobramos <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {!isNative() && (
        <div className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-500/30 rounded-2xl p-5">
          <Smartphone className="w-6 h-6 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-900 dark:text-blue-300 text-sm">
              Pagas con Webpay (Transbank) — boleta electrónica incluida
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              Selecciona tu plan y serás redirigido a Webpay para completar el cargo en
              CLP. Para planes B2B (Titanio en adelante) usa el botón{' '}
              <strong>Hablar con ventas</strong>. La app móvil de Google Play sigue
              disponible para suscripciones consumer.
            </p>
          </div>
        </div>
      )}

      {requiresUpgrade && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-4"
        >
          <div className="w-12 h-12 bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="text-lg font-bold text-red-900 dark:text-red-400">
              Alerta de cumplimiento normativo
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              Tienes <strong>{totalWorkers} trabajadores</strong> registrados. Necesitas el plan{' '}
              <strong>{recommendedPlan.toUpperCase()}</strong> para mantener la cobertura.
            </p>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {TIERS.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            currentLegacyPlan={plan}
            isProcessing={isProcessing}
            onPurchase={handlePurchase}
            onContactSales={handleContactSales}
          />
        ))}
      </div>

      <div className="mt-12 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <ShieldCheck className="w-6 h-6 text-emerald-500 shrink-0 mt-1" />
          <div>
            <h3 className="text-xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">
              ¿Por qué la prevención no debe ser opaca?
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              Publicamos cómo cobramos, qué incluye cada tier, y cuándo realmente te conviene
              upgradear. Compáralo contra alternativas reales del mercado chileno.
            </p>
            <Link
              to="/transparencia"
              className="inline-flex items-center gap-2 mt-4 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl"
            >
              <Building2 className="w-4 h-4" />
              Ver transparencia de precios
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Pricing() {
  return (
    <CurrencyProvider>
      <PricingInner />
    </CurrencyProvider>
  );
}

export default Pricing;
