import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Landmark,
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
import { useTranslation } from 'react-i18next';
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
import { TIER_TO_SUBSCRIPTION_PLAN } from '../services/pricing/subscriptionPlan';

import { NormativaSwitch } from '../components/normativa/NormativaSwitch';
import { TierDowngradeModal } from '../components/billing/TierDowngradeModal';
import { useInvoicePolling } from '../hooks/useInvoicePolling';
import { logger } from '../utils/logger';
import { analytics } from '../services/analytics';
import { IapAdapter, iapAdapter, type BillingProvider } from '../services/billing/iapAdapter';
import { apiAuthHeader } from '../lib/apiAuth';

// Sprint 21 Bucket T — payments now route through `IapAdapter`. Web keeps the
// existing Webpay/MP/Khipu surface; Android/iOS hit the store rails (Google
// Play / App Store) per platform compliance policy. The `isNative()` helper
// is kept as a thin convenience around the adapter's platform detection.
const isNative = () => IapAdapter.getPlatform() !== 'web';
const getIapPlatform = () => IapAdapter.getPlatform();

// LATAM countries we route through MercadoPago. Chile stays on Webpay
// (existing path); everything else cae a `contacto@praeventio.net`
// como fallback B2B (Stripe descartado §2.12 cierre Fase C.2, 2026-05-21).
// Ver `src/services/billing/currency.ts` para el mapping CLP/PEN/etc.
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
 * them to MP/manual-transfer and surprise-bill in the wrong currency. The user
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

// Canonical TierId -> subscription entitlement id. This shared map keeps
// checkout, app-store billing, IPN callbacks and feature gating aligned.
const TIER_TO_LEGACY_PLAN: Record<TierId, SubscriptionPlan> = TIER_TO_SUBSCRIPTION_PLAN;

const PREMIUM_TIER_IDS: ReadonlySet<TierId> = new Set([
  'titanio',
  'platino',
  'diamante',
]);

// Sprint 37 W61 — i18n refactor: feature lists now live in
// `src/i18n/locales/{lang}/common.json` under `pricing.tier_features.{tierId}`.
// They are looked up at render time via `t(key, { returnObjects: true })`.

// Tone is intrinsic to the tier's market position; the user-facing label is
// resolved via i18n (`pricing.badges.{tierId}`).
const TIER_BADGE_TONES: Partial<Record<TierId, 'green' | 'gold' | 'blue' | 'silver'>> = {
  gratis: 'green',
  cobre: 'silver',
  oro: 'blue',
  platino: 'silver',
  diamante: 'gold',
};

// i18n badge key (TierIds are already dot-path safe in the 7-metal scheme).
const TIER_BADGE_KEY: Partial<Record<TierId, string>> = {
  gratis: 'gratis',
  cobre: 'cobre',
  oro: 'oro',
  platino: 'platino',
  diamante: 'diamante',
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
  const { t } = useTranslation();
  const { currency } = useCurrency();
  const isPremium = PREMIUM_TIER_IDS.has(tier.id);
  const legacyId = TIER_TO_LEGACY_PLAN[tier.id];
  const isCurrent = legacyId !== undefined && legacyId === currentLegacyPlan;
  const badgeTone = TIER_BADGE_TONES[tier.id];
  const badgeKey = TIER_BADGE_KEY[tier.id];
  const badgeLabel = badgeKey ? t(`pricing.badges.${badgeKey}`) : null;
  // Resolve features array from i18n. `returnObjects` returns the raw array.
  const features = t(`pricing.tier_features.${tier.id}`, { returnObjects: true }) as string[];
  const featuresArray = Array.isArray(features) ? features : [];

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
      {badgeTone && badgeLabel && (
        <div
          className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${badgeClasses(
            badgeTone,
          )}`}
        >
          {badgeLabel}
        </div>
      )}
      {isPremium && (
        <div className="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
          <Crown className="w-3.5 h-3.5" />
          {t('pricing.workspace_native_tag')}
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-2xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">
          {tier.nombre}
        </h3>
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mt-1">
          {tier.id === 'gratis'
            ? t('pricing.tier_subtitles.free')
            : isPremium
              ? t('pricing.tier_subtitles.premium')
              : t('pricing.tier_subtitles.default')}
        </p>

        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-3xl sm:text-4xl font-black tracking-tighter text-zinc-900 dark:text-white">
            {monthlyDisplay}
          </span>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('pricing.units.per_month_short')}</span>
        </div>

        {ivaBreakdown && (
          <div className="group relative inline-flex items-center gap-1 mt-2 text-[11px] text-zinc-500 dark:text-zinc-400 cursor-help">
            <Info className="w-3 h-3" />
            <span>{t('pricing.iva.included')}</span>
            <div className="invisible group-hover:visible group-focus-within:visible absolute left-0 top-full mt-1 z-10 w-60 bg-zinc-900 text-white text-xs p-3 rounded-lg shadow-lg">
              {t('pricing.iva.subtotal', { amount: formatCurrency(ivaBreakdown.subtotal, 'CLP') })}
              <br />{t('pricing.iva.iva_line', { amount: formatCurrency(ivaBreakdown.iva, 'CLP') })}
              <br />{t('pricing.iva.total', { amount: formatCurrency(ivaBreakdown.total, 'CLP') })}
            </div>
          </div>
        )}

        {tier.clpRegular > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
              {t('pricing.discounts.annual', { price: annualDisplay })}
            </span>
            <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
              {t('pricing.discounts.intro', { price: introDisplay })}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-6">
        <div className="bg-zinc-50 dark:bg-black/30 rounded-xl p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Users className="w-3 h-3" /> {t('pricing.units.workers')}
          </div>
          <p className="font-black text-zinc-900 dark:text-white">
            {tier.trabajadoresMax === Infinity ? t('pricing.units.unlimited') : tier.trabajadoresMax.toLocaleString('es-CL')}
          </p>
        </div>
        <div className="bg-zinc-50 dark:bg-black/30 rounded-xl p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            <Briefcase className="w-3 h-3" /> {t('pricing.units.projects')}
          </div>
          <p className="font-black text-zinc-900 dark:text-white">
            {tier.proyectosMax === Infinity ? t('pricing.units.unlimited') : tier.proyectosMax}
          </p>
        </div>
      </div>

      <ul className="space-y-3 mb-6 flex-1">
        {featuresArray.map((feature, i) => (
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
          {t('pricing.cta.contact_sales')}
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
            t('pricing.cta.current_plan')
          ) : tier.id === 'gratis' ? (
            <>
              <Sparkles className="w-4 h-4" />
              {t('pricing.cta.start_free')}
            </>
          ) : (
            <>
              <CreditCard className="w-4 h-4" />
              {t('pricing.cta.select_plan')}
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
  const { t } = useTranslation();
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

  // Dedupe to one analytics emit per banner instance (kind transitions are stable).
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    if (pollState.kind === 'settled') {
      const inv = pollState.invoice;
      let stash: { gateway?: string; plan_code?: string; amount_clp?: number } = {};
      try {
        const raw = sessionStorage.getItem('__praeventio_pending_checkout');
        if (raw) stash = JSON.parse(raw);
      } catch {}
      const gateway = (stash.gateway === 'mercadopago' ? 'mercadopago' : 'webpay') as 'webpay' | 'mercadopago';
      const plan_code = stash.plan_code ?? 'unknown';
      if (inv.status === 'paid') {
        try {
          analytics.track('payment.transaction.succeeded', {
            gateway,
            plan_code,
            amount_clp: inv.totals.total,
            transaction_id_hash: inv.id,
          });
        } catch {}
        firedRef.current = true;
        try { sessionStorage.removeItem('__praeventio_pending_checkout'); } catch {}
      } else if (inv.status === 'rejected' || inv.status === 'cancelled') {
        try {
          analytics.track('payment.transaction.failed', {
            gateway,
            plan_code,
            failure_code: inv.rejectionReason ?? inv.status,
            amount_clp: inv.totals.total,
          });
        } catch {}
        // Wave-14 analytics: when the user explicitly cancelled (came back
        // from Webpay without authorising), also fire `payment.checkout.
        // cancelled` so dashboards can split funnel-abandonment from
        // gateway-rejection. `failed` covers the transaction outcome;
        // `cancelled` covers the user behaviour. Catalog Payments
        // section, new row added in the 14th wave.
        if (inv.status === 'cancelled') {
          try {
            analytics.track('payment.checkout.cancelled', {
              gateway,
              plan_code,
              amount_clp: inv.totals.total,
            });
          } catch {}
        }
        firedRef.current = true;
        try { sessionStorage.removeItem('__praeventio_pending_checkout'); } catch {}
      }
    } else if (pollState.kind === 'error') {
      let stash: { gateway?: string; plan_code?: string } = {};
      try {
        const raw = sessionStorage.getItem('__praeventio_pending_checkout');
        if (raw) stash = JSON.parse(raw);
      } catch {}
      const gateway = (stash.gateway === 'mercadopago' ? 'mercadopago' : 'webpay') as 'webpay' | 'mercadopago';
      try {
        analytics.track('payment.transaction.failed', {
          gateway,
          plan_code: stash.plan_code ?? 'unknown',
          failure_code: 'poll_error',
        });
      } catch {}
      firedRef.current = true;
      try { sessionStorage.removeItem('__praeventio_pending_checkout'); } catch {}
    }
  }, [pollState]);

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

    const invoiceSuffix = invoiceId ? t('pricing.return_banner.invoice_suffix', { id: invoiceId }) : '';

    if (inv.status === 'paid') {
      return (
        <div
          role="status"
          className="flex items-start gap-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5"
        >
          <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-emerald-900 dark:text-emerald-300 text-sm">
              {t('pricing.return_banner.paid_title')}
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
              {t('pricing.return_banner.paid_body', { total: totalLabel, invoice: invoiceSuffix })}
            </p>
          </div>
        </div>
      );
    }

    if (inv.status === 'rejected' || inv.status === 'cancelled') {
      const reason =
        inv.rejectionReason ??
        (inv.status === 'cancelled'
          ? t('pricing.return_banner.cancelled_default_reason')
          : t('pricing.return_banner.rejected_default_reason'));
      return (
        <div
          role="alert"
          className="flex items-start gap-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-2xl p-5"
        >
          <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-red-900 dark:text-red-300 text-sm">
              {t('pricing.return_banner.rejected_title')}
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {t('pricing.return_banner.rejected_body', { reason, invoice: invoiceSuffix })}
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
              {t('pricing.return_banner.refunded_title')}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              {t('pricing.return_banner.refunded_body', { total: totalLabel, invoice: invoiceSuffix })}
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

  const invoiceSuffix = invoiceId ? t('pricing.return_banner.invoice_suffix', { id: invoiceId }) : '';
  const invoiceFor = invoiceId ? t('pricing.return_banner.invoice_for', { id: invoiceId }) : '';

  if (pollState.kind === 'timeout') {
    return (
      <div
        role="alert"
        className="flex items-start gap-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/30 rounded-2xl p-5"
      >
        <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-amber-900 dark:text-amber-300 text-sm">
            {t('pricing.return_banner.timeout_title')}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            {t('pricing.return_banner.timeout_body', { invoice: invoiceSuffix })}
            <a
              href="mailto:contacto@praeventio.net"
              className="underline font-semibold"
            >
              contacto@praeventio.net
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
            {t('pricing.return_banner.error_title')}
          </p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-1">
            {t('pricing.return_banner.error_body', { invoice: invoiceSuffix })}
            <a
              href="mailto:contacto@praeventio.net"
              className="underline font-semibold"
            >
              contacto@praeventio.net
            </a>
            {t('pricing.return_banner.error_body_suffix')}
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
            {t('pricing.return_banner.rejected_title')}
          </p>
          <p className="text-xs text-red-700 dark:text-red-400 mt-1">
            {t('pricing.return_banner.rejected_loading_body', { invoice: invoiceSuffix })}
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
            {t('pricing.return_banner.retry_title')}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            {t('pricing.return_banner.retry_body', { invoice: invoiceSuffix })}
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
          {t('pricing.return_banner.loading_title')}
        </p>
        <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
          {t('pricing.return_banner.loading_body', { invoice: invoiceFor })}
        </p>
      </div>
    </div>
  );
}

function PricingInner() {
  const { t } = useTranslation();
  const { plan, totalWorkers, recommendedPlan, requiresUpgrade, upgradePlan } = useSubscription();
  const { addNotification } = useNotifications();
  const { user } = useFirebase();
  const { projects } = useProject();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // 2026-06-11 (khipu cableado) — Chile now has TWO web rails: tarjeta
  // (Webpay) y transferencia bancaria (Khipu). Clicking a tier opens this
  // chooser instead of auto-starting Webpay.
  const [methodChooser, setMethodChooser] = useState<{
    tier: Tier;
    legacyId: SubscriptionPlan;
  } | null>(null);
  // Sprint 28 H25 — Tier downgrade flow UI state.
  const [downgradeModal, setDowngradeModal] = useState<{
    fromTier: TierId;
    toTier: TierId;
    toTierLabel: string;
    pendingTier: Tier;
  } | null>(null);

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
        title: t('pricing.checkout.login_required_title'),
        message: t('pricing.checkout.login_required_msg'),
        type: 'error',
      });
      return;
    }

    setCheckoutError(null);
    setIsProcessing(legacyId);
    // Stashed for the return banner to enrich payment.transaction.* events.
    try {
      sessionStorage.setItem(
        '__praeventio_pending_checkout',
        JSON.stringify({ gateway: 'webpay', plan_code: tier.id, amount_clp: tier.clpRegular }),
      );
    } catch {}
    try { analytics.track('payment.checkout.started', { gateway: 'webpay', plan_code: tier.id, amount_clp: tier.clpRegular }); } catch {}
    try {
      const totalProjects = projects.length;
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
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
            t('pricing.checkout.checkout_failed_status', { status: response.status }),
        );
      }

      const data = (await response.json()) as {
        invoiceId: string;
        paymentUrl?: string;
        status: string;
      };

      if (data.status === 'pending-config' || !data.paymentUrl) {
        throw new Error(t('pricing.checkout.provider_unavailable'));
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
          : t('pricing.checkout.error_default');
      setCheckoutError(message);
      addNotification({
        title: t('pricing.checkout.error_title'),
        message: t('pricing.checkout.error_default'),
        type: 'error',
      });
      setIsProcessing(null);
    }
    // Note: on success we redirect away — leaving isProcessing set is fine
    // because the page unloads.
  };

  /**
   * Web (non-native) Khipu checkout — transferencia bancaria (Chile).
   * 2026-06-11 ("khipu cableado"). Posts to `/api/billing/khipu/checkout`
   * with ONLY { planId, cycle } — the server resolves amount/currency from
   * the canonical tier table and returns a `paymentUrl` we redirect to.
   * Khipu then sends the user back to /pricing/success|failed?invoice=<id>
   * (same banner UX as Webpay) and confirms server-side via the signed IPN
   * webhook. If the rail isn't configured, the server answers an honest 503
   * with es-CL copy that we surface as-is.
   */
  const startKhipuCheckout = async (tier: Tier, legacyId: SubscriptionPlan) => {
    if (!user) {
      addNotification({
        title: t('pricing.checkout.login_required_title'),
        message: t('pricing.checkout.login_required_msg'),
        type: 'error',
      });
      return;
    }

    setCheckoutError(null);
    setIsProcessing(legacyId);
    try {
      sessionStorage.setItem(
        '__praeventio_pending_checkout',
        JSON.stringify({ gateway: 'khipu', plan_code: tier.id, amount_clp: tier.clpRegular }),
      );
    } catch {}
    try { analytics.track('payment.checkout.started', { gateway: 'khipu', plan_code: tier.id, amount_clp: tier.clpRegular }); } catch {}
    try {
      const authHeader = await apiAuthHeader();
      const response = await fetch('/api/billing/khipu/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({ planId: tier.id, cycle: 'monthly' }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(
          (detail as { error?: string }).error ??
            t('pricing.checkout.checkout_failed_status', { status: response.status }),
        );
      }

      const data = (await response.json()) as {
        invoiceId: string;
        paymentId: string;
        paymentUrl?: string;
      };

      if (!data.paymentUrl) {
        throw new Error(t('pricing.checkout.khipu_unavailable'));
      }

      window.location.href = data.paymentUrl;
    } catch (err) {
      logger.error('khipu_checkout_start_failed', err, {
        tierId: tier.id,
        uid: user.uid,
      });
      const message =
        err instanceof Error
          ? err.message
          : t('pricing.checkout.error_default');
      setCheckoutError(message);
      addNotification({
        title: t('pricing.checkout.error_title'),
        message: t('pricing.checkout.error_default'),
        type: 'error',
      });
      setIsProcessing(null);
    }
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
        title: t('pricing.checkout.login_required_title'),
        message: t('pricing.checkout.login_required_msg'),
        type: 'error',
      });
      return;
    }

    setCheckoutError(null);
    setIsProcessing(legacyId);
    try {
      sessionStorage.setItem(
        '__praeventio_pending_checkout',
        JSON.stringify({ gateway: 'mercadopago', plan_code: tier.id, amount_clp: tier.clpRegular }),
      );
    } catch {}
    try { analytics.track('payment.checkout.started', { gateway: 'mercadopago', plan_code: tier.id, amount_clp: tier.clpRegular }); } catch {}
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      const currency = MP_CURRENCY_BY_COUNTRY[country];
      const response = await fetch('/api/billing/checkout/mercadopago', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
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
            t('pricing.checkout.checkout_failed_status', { status: response.status }),
        );
      }

      const data = (await response.json()) as {
        preferenceId: string;
        init_point: string;
        invoiceId: string;
      };

      if (!data.init_point) {
        throw new Error(t('pricing.checkout.mp_unavailable'));
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
          : t('pricing.checkout.error_default');
      setCheckoutError(message);
      addNotification({
        title: t('pricing.checkout.error_title'),
        message: t('pricing.checkout.error_default'),
        type: 'error',
      });
      setIsProcessing(null);
    }
  };

  // Sprint 28 H25 — invert TIER_TO_LEGACY_PLAN so we can recover a TierId
  // from the user's current `plan` (which is a SubscriptionPlan legacy id).
  const legacyToTierId = (legacyPlan: SubscriptionPlan): TierId | null => {
    for (const [tierId, legacy] of Object.entries(TIER_TO_LEGACY_PLAN)) {
      if (legacy === legacyPlan) return tierId as TierId;
    }
    return null;
  };

  /**
   * Detect a tier downgrade where current usage exceeds the target capacity.
   * Returns the modal config when a downgrade gate is needed; null otherwise.
   */
  const buildDowngradeGate = (toTier: Tier): {
    fromTier: TierId;
    toTier: TierId;
    toTierLabel: string;
  } | null => {
    const fromTierId = legacyToTierId(plan);
    if (!fromTierId) return null;
    if (fromTierId === toTier.id) return null;
    const fromIdx = TIERS.findIndex((t) => t.id === fromTierId);
    const toIdx = TIERS.findIndex((t) => t.id === toTier.id);
    if (fromIdx === -1 || toIdx === -1) return null;
    if (toIdx >= fromIdx) return null; // upgrade or same — no gate.
    const totalProjects = projects.length;
    if (
      totalWorkers > toTier.trabajadoresMax ||
      totalProjects > toTier.proyectosMax
    ) {
      return {
        fromTier: fromTierId,
        toTier: toTier.id,
        toTierLabel: toTier.nombre,
      };
    }
    return null;
  };

  const handlePurchase = async (tier: Tier) => {
    const legacyId = TIER_TO_LEGACY_PLAN[tier.id];
    if (!legacyId) {
      // Defensive: premium tiers should never reach here, they use Contact Sales
      addNotification({
        title: t('pricing.checkout.contact_sales_title'),
        message: t('pricing.checkout.contact_sales_msg', { tier: tier.nombre }),
        type: 'info',
      });
      return;
    }

    // Sprint 28 H25 — gate downgrades when current usage exceeds the
    // target tier's capacity. The modal lets the user archive/export
    // before completing the downgrade.
    const gate = buildDowngradeGate(tier);
    if (gate) {
      setDowngradeModal({ ...gate, pendingTier: tier });
      return;
    }

    if (legacyId === 'free') {
      try {
        await upgradePlan('free');
        addNotification({
          title: t('pricing.checkout.free_activated_title'),
          message: t('pricing.checkout.free_activated_msg'),
          type: 'success',
        });
      } catch (err: any) {
        addNotification({ title: t('common.error', 'Error'), message: err.message, type: 'error' });
      }
      return;
    }

    // Web (non-native) → route by country.
    //   CL              → chooser: Webpay (tarjeta) o Khipu (transferencia).
    //   PE/AR/CO/MX/BR  → MercadoPago.
    //   else            → fallback B2B contactando ventas (Stripe
    //                     descartado §2.12 cierre Fase C.2 2026-05-21).
    if (!isNative()) {
      const country = detectCountry(window.location.search);
      if (country === 'CL') {
        // 2026-06-11 (khipu cableado): both CL rails are now selectable.
        setMethodChooser({ tier, legacyId });
        return;
      }
      if ((MP_COUNTRIES as readonly string[]).includes(country)) {
        await startMercadoPagoCheckout(tier, legacyId, country as MpCountry);
        return;
      }
      // Fallback B2B — el usuario contacta a contacto@praeventio.net
      // para emisión manual de factura + transferencia. Stripe está
      // descartado oficialmente (§2.12).
      addNotification({
        title: t('pricing.checkout.international_title'),
        message: t('pricing.checkout.international_msg'),
        type: 'info',
      });
      return;
    }

    // ── Sprint 21 Ola 6 Bucket T — native IAP via `IapAdapter` ──
    //
    // Replaces the previous feature-flag stub (Round 16 R1). Android and
    // iOS now flow through `@capacitor-community/in-app-purchases`; the
    // server-side benefit grant still waits for the RTDN / App Store
    // Server Notification webhook, NOT the client receipt. We do call the
    // `validate-receipt` endpoint so the server has a chance to log the
    // attempt and surface obvious fraud (mismatched signature) early.
    const platform = getIapPlatform();
    const provider: BillingProvider =
      platform === 'android' ? 'google-play' : 'app-store';

    setIsProcessing(legacyId);
    setCheckoutError(null);
    try {
      sessionStorage.setItem(
        '__praeventio_pending_checkout',
        JSON.stringify({ gateway: provider, plan_code: tier.id, amount_clp: tier.clpRegular }),
      );
    } catch {}
    // Analytics enum uses underscore form `google_play` and does not yet
    // include `app-store`; fall back to `google_play` for iOS so we still
    // get a payment.checkout.started event, but include the actual
    // provider in the event payload via plan_code suffix once dashboards
    // need iOS-specific funnels (TODO: extend analytics.types.PaymentGateway).
    const analyticsGateway = 'google_play' as const;
    try {
      analytics.track('payment.checkout.started', {
        gateway: analyticsGateway,
        plan_code: tier.id,
        amount_clp: tier.clpRegular,
      });
    } catch {}

    try {
      // §2.13 fix (2026-05-22) — SKU mapping por tier+cycle (no más single
      // SKU para todos). Cada tier ahora tiene su propio productId
      // (`praeventio_<slug>_<cycle>`) que Play Console + App Store Connect
      // deben tener configurado. Esto permite:
      //   - Cobrar el precio correcto por tier en el store
      //   - Reverse lookup tier desde receipt productId (revenue tracking)
      //   - Detectar manipulación del receipt (assertSkuMatchesTier
      //     server-side)
      //
      // Bloqueador externo §5 TODO.md: el SKU debe existir en Play Console
      // antes de que el checkout funcione productivamente. Si no existe,
      // iapAdapter.purchase devuelve error claro al user.
      const { iapSkuForTier } = await import('../services/pricing/iapSkus');
      // Pricing.tsx UI actualmente solo hace checkout monthly (annual es
      // info-only). Cuando se agregue toggle annual, pasar el cycle real.
      const productId = iapSkuForTier(tier.id, 'monthly');
      const result = await iapAdapter.purchase(productId, provider);

      if (!result.success || !result.receiptId) {
        const message =
          result.errorMessage ?? t('pricing.checkout.store_purchase_failed');
        setCheckoutError(message);
        addNotification({
          title: t('pricing.checkout.store_purchase_failed_title'),
          message,
          type: 'error',
        });
        setIsProcessing(null);
        return;
      }

      // Best-effort receipt-validate ping. The server returns 202 here
      // because the authoritative grant flows through the store webhook;
      // this call is for fraud signal + audit trail.
      //
      // Codex P2 (PR #307): the receipt ping is best-effort — if the
      // user is unavailable (e.g. pricing route rendered before auth
      // finishes loading, edge case but real), we must STILL run the
      // success notification + reset `isProcessing`. Earlier
      // `if (!user) return` jumped out of the outer purchase flow and
      // left the button stuck in the processing state. Gate the ping
      // with `if (user)` instead, mirroring the pre-strictNullChecks
      // behavior where the missing-user path was caught by the outer
      // try/catch and the success flow ran anyway.
      if (user) {
        try {
          // §2.20 (2026-05-23) — apiAuthHeader unified.
          const authHeader = await apiAuthHeader();
          const endpoint =
            provider === 'google-play'
              ? '/api/billing/google-play/validate-receipt'
              : '/api/billing/app-store/validate-receipt';
          await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authHeader ? { 'Authorization': authHeader } : {}),
            },
            body: JSON.stringify({
              productId,
              tierId: tier.id,
              receiptId: result.receiptId,
            }),
          });
        } catch (err) {
          // Best-effort — never block the UI on this.
          logger.warn('iap_receipt_ping_failed', { provider, tier: tier.id });
        }
      }

      addNotification({
        title: t('pricing.checkout.store_received_title'),
        message: t('pricing.checkout.store_received_msg'),
        type: 'success',
      });
      setIsProcessing(null);
    } catch (err) {
      logger.error('iap_purchase_failed', err, { tierId: tier.id });
      const message =
        err instanceof Error
          ? err.message
          : t('pricing.checkout.store_start_failed');
      setCheckoutError(message);
      addNotification({
        title: t('pricing.checkout.error_title'),
        message,
        type: 'error',
      });
      setIsProcessing(null);
    }
  };

  const handleContactSales = (tier: Tier) => {
    // §2.12 (Fase C.2): Stripe descartado. Para enterprise/B2B el flujo
    // sigue siendo mailto a contacto@praeventio.net + emisión manual de
    // factura. Si crece volumen suficiente, wire CRM (HubSpot/Salesforce).
    const subject = encodeURIComponent(t('pricing.checkout.mailto_subject', { tier: tier.nombre }));
    const body = encodeURIComponent(
      t('pricing.checkout.mailto_body', {
        tier: tier.nombre,
        workers: tier.trabajadoresMax,
        projects: tier.proyectosMax,
      }),
    );
    window.location.href = `mailto:contacto@praeventio.net?subject=${subject}&body=${body}`;
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
              {t('pricing.checkout.error_default')}
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-1">
              {checkoutError}
            </p>
          </div>
          <button
            onClick={() => setCheckoutError(null)}
            className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-300 hover:underline"
          >
            {t('pricing.cta.close')}
          </button>
        </div>
      )}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="text-center sm:text-left max-w-3xl">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight mb-3">
            {t('pricing.hero.title')}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-base sm:text-lg">
            {t('pricing.hero.subtitle')}
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
            {t('pricing.hero.transparency_link')} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {!isNative() ? (
        <div className="flex items-start gap-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-500/30 rounded-2xl p-5">
          <Smartphone className="w-6 h-6 text-blue-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-900 dark:text-blue-300 text-sm">
              {t('pricing.payment_banners.web_title')}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
              {t('pricing.payment_banners.web_body')}
            </p>
          </div>
        </div>
      ) : getIapPlatform() === 'android' ? (
        <div className="flex items-start gap-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 rounded-2xl p-5">
          <Smartphone className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-emerald-900 dark:text-emerald-300 text-sm">
              {t('pricing.payment_banners.android_title')}
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
              {t('pricing.payment_banners.android_body')}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-4 bg-zinc-100 dark:bg-zinc-900/40 border border-zinc-300 dark:border-white/10 rounded-2xl p-5">
          <Smartphone className="w-6 h-6 text-zinc-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-zinc-900 dark:text-zinc-100 text-sm">
              {t('pricing.payment_banners.ios_title')}
            </p>
            <p className="text-xs text-zinc-700 dark:text-zinc-400 mt-1">
              {t('pricing.payment_banners.ios_body')}
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
              {t('pricing.compliance_alert.title')}
            </h3>
            <p
              className="text-sm text-red-700 dark:text-red-300 mt-1"
              dangerouslySetInnerHTML={{
                __html: t('pricing.compliance_alert.body', {
                  workers: totalWorkers,
                  plan: recommendedPlan.toUpperCase(),
                }),
              }}
            />
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
              {t('pricing.transparency_block.title')}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">
              {t('pricing.transparency_block.body')}
            </p>
            <Link
              to="/transparencia"
              className="inline-flex items-center gap-2 mt-4 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl"
            >
              <Building2 className="w-4 h-4" />
              {t('pricing.cta.view_transparency')}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {methodChooser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('pricing.checkout.method_title')}
          onClick={() => setMethodChooser(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-black uppercase tracking-tight text-zinc-900 dark:text-white">
              {t('pricing.checkout.method_title')}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              {t('pricing.checkout.method_subtitle', { tier: methodChooser.tier.nombre })}
            </p>
            <div className="mt-6 space-y-3">
              <button
                onClick={() => {
                  const { tier, legacyId } = methodChooser;
                  setMethodChooser(null);
                  void startWebpayCheckout(tier, legacyId);
                }}
                disabled={isProcessing !== null}
                className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl transition-colors"
              >
                <CreditCard className="w-4 h-4" />
                {t('pricing.checkout.method_webpay')}
              </button>
              <button
                onClick={() => {
                  const { tier, legacyId } = methodChooser;
                  setMethodChooser(null);
                  void startKhipuCheckout(tier, legacyId);
                }}
                disabled={isProcessing !== null}
                className="w-full inline-flex items-center justify-center gap-2 bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-zinc-900 font-black uppercase tracking-widest text-xs px-5 py-3 rounded-xl transition-colors"
              >
                <Landmark className="w-4 h-4" />
                {t('pricing.checkout.method_khipu')}
              </button>
              <button
                onClick={() => setMethodChooser(null)}
                className="w-full text-center text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:underline pt-1"
              >
                {t('pricing.cta.close')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {downgradeModal && (
        <TierDowngradeModal
          fromTier={downgradeModal.fromTier}
          toTier={downgradeModal.toTier}
          toTierLabel={downgradeModal.toTierLabel}
          currentUsage={{
            workers: totalWorkers,
            projects: projects.length,
          }}
          targetCapacity={{
            workers:
              TIERS.find((t) => t.id === downgradeModal.toTier)
                ?.trabajadoresMax ?? 0,
            projects:
              TIERS.find((t) => t.id === downgradeModal.toTier)
                ?.proyectosMax ?? 0,
          }}
          onCancel={() => setDowngradeModal(null)}
          onConfirm={() => {
            // Usage now fits the target capacity (or no overage); proceed
            // with the actual purchase. We re-call handlePurchase, but the
            // gate will not fire again because usage has been brought down
            // (or was never over capacity for this tier).
            const pending = downgradeModal.pendingTier;
            setDowngradeModal(null);
            void handlePurchase(pending);
          }}
        />
      )}
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
