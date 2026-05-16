// Praeventio Guard — Bucket CC: B2D admin panel page (Sprint 23).
//
// Layout (4 sections):
//   1. API keys table — list + create + revoke
//   2. Métricas — MRR/ARR/churn/customersActive cards + tier charts
//   3. Top customers — top 10 by monthly revenue
//   4. Eventos — audit log of key creations / revocations / quota events
//
// Gated by PremiumFeatureGuard (admin-only consumer-facing copy) — the
// real auth gate is server-side via `assertAdmin` on every endpoint.
// Uses fetch() to talk to /api/admin/b2d/*; the Firebase ID token is
// attached by the existing app-level fetch wrapper (verifyAuth middleware
// reads `Authorization: Bearer …`).

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Key, TrendingUp, Users, AlertOctagon, Plus, Loader2 } from 'lucide-react';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { CreateApiKeyModal } from '../components/admin/CreateApiKeyModal';
import { MrrChart, type MrrPoint } from '../components/admin/MrrChart';
import { RevenueByTierChart } from '../components/admin/RevenueByTierChart';
import { ChurnCohortHeatmap } from '../components/admin/ChurnCohortHeatmap';
import type { B2dMetrics, B2dTier } from '../services/analytics/b2dMetrics';
import type { ApiTierId } from '../services/pricing/aiTier';
import { logger } from '../utils/logger';
import { auth } from '../services/firebase';

interface ApiKeyRow {
  id: string;
  customerId: string;
  tier: B2dTier;
  scopes: string[];
  status: 'active' | 'revoked';
  maskedKey: string | null;
  createdAt: number | null;
  revokedAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
}

interface B2dEvent {
  id: string;
  kind: string;
  keyId: string | null;
  customerId: string | null;
  tier: string | null;
  actor: string | null;
  ts: number | null;
}

async function authedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const user = auth?.currentUser;
  const token = user ? await user.getIdToken() : null;
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function formatCurrency(usd: number): string {
  return `$${usd.toLocaleString('en-US')}`;
}

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-CL');
}

/**
 * Sprint E backend debt (2026-05-16): shape canónico de un snapshot
 * MRR mensual. Match con `B2dMrrSnapshotDoc` en
 * `src/server/jobs/runB2dMrrSnapshot.ts`. No importamos el tipo
 * server-side desde el cliente para mantener separación; si el shape
 * cambia, los dos lados se actualizan en el mismo PR.
 */
interface B2dMrrSnapshot {
  monthKey: string;
  monthLabel: string;
  mrr: number;
  arr: number;
  customersActive: number;
  customersTotal: number;
  churnRate30d: number;
  capturedAt: string;
}

export function B2dAdminPanel() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [metrics, setMetrics] = useState<B2dMetrics | null>(null);
  const [events, setEvents] = useState<B2dEvent[]>([]);
  const [mrrHistory, setMrrHistory] = useState<B2dMrrSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [keysRes, metricsRes, eventsRes, mrrHistoryRes] = await Promise.all([
        authedFetch('/api/admin/b2d/keys'),
        authedFetch('/api/admin/b2d/metrics'),
        authedFetch('/api/admin/b2d/events'),
        authedFetch('/api/admin/b2d/mrr-history?limit=12'),
      ]);
      if (keysRes.ok) {
        const data = await keysRes.json();
        setKeys(Array.isArray(data.keys) ? data.keys : []);
      }
      if (metricsRes.ok) {
        const data = await metricsRes.json();
        setMetrics(data.metrics ?? null);
      }
      if (eventsRes.ok) {
        const data = await eventsRes.json();
        setEvents(Array.isArray(data.events) ? data.events : []);
      }
      if (mrrHistoryRes.ok) {
        const data = await mrrHistoryRes.json();
        setMrrHistory(Array.isArray(data.snapshots) ? data.snapshots : []);
      }
    } catch (err) {
      logger.error('b2d_admin_panel_load_failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreate = useCallback(
    async (input: {
      customerId: string;
      tier: ApiTierId;
      scopes: string[];
      expiresInDays?: number;
    }) => {
      const res = await authedFetch('/api/admin/b2d/keys', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      // Refresh the list so the new key shows masked.
      void loadAll();
      return { id: data.id, rawKey: data.rawKey, maskedKey: data.maskedKey };
    },
    [loadAll],
  );

  const handleRevoke = useCallback(
    async (id: string) => {
      if (!window.confirm(t('b2dAdmin.confirms.revoke', '¿Revocar API key {{id}}? Esto es irreversible.', { id }))) return;
      try {
        const res = await authedFetch(`/api/admin/b2d/keys/${id}/revoke`, { method: 'POST' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        void loadAll();
      } catch (err) {
        logger.error('b2d_admin_revoke_failed', err);
        window.alert(t('b2dAdmin.alerts.revokeFailed', 'No se pudo revocar la API key.'));
      }
    },
    [loadAll],
  );

  // Customers-by-tier derived from the active keys list.
  const customersByTier = useMemo<Record<B2dTier, number> | undefined>(() => {
    if (!keys.length) return undefined;
    const counts = {} as Record<B2dTier, number>;
    for (const k of keys) {
      if (k.status !== 'active') continue;
      counts[k.tier] = (counts[k.tier] ?? 0) + 1;
    }
    return counts;
  }, [keys]);

  // MRR-over-time series. Histórico real desde `b2d_mrr_snapshots`
  // collection (escrito por el cron `runB2dMrrSnapshot` cada mes,
  // wireado en /api/maintenance/run-b2d-mrr-snapshot).
  //
  // Estados:
  //   - mrrHistory NO vacío → chart con snapshots históricos.
  //   - mrrHistory vacío + metrics presente → fallback al punto único
  //     del mes actual (sin synthesis falsa). El usuario ve la realidad:
  //     todavía no hay histórico capturado.
  //   - mrrHistory vacío + metrics ausente → [] (loading).
  //
  // 2026-05-16 (Sprint E): cierra el TODO Sprint D fix sustituyendo
  // el placeholder del mes actual con datos reales mensuales cuando
  // están disponibles. Sigue siendo honesto en el caso vacío.
  const mrrSeries = useMemo<MrrPoint[]>(() => {
    if (mrrHistory.length > 0) {
      return mrrHistory.map((s) => ({
        monthLabel: s.monthLabel,
        mrr: s.mrr,
      }));
    }
    if (!metrics) return [];
    const now = new Date();
    const monthLabel = now.toLocaleDateString('es-CL', {
      month: 'short',
      year: '2-digit',
    });
    return [{ monthLabel, mrr: metrics.mrr }];
  }, [mrrHistory, metrics]);

  return (
    <PremiumFeatureGuard
      featureName={t('b2dAdmin.guard.featureName', 'Panel B2D Admin')}
      description={t('b2dAdmin.guard.description', 'Gestiona API keys de los 8 tiers B2D y revisa MRR/ARR/churn en tiempo real.')}
    >
      <div className="p-4 lg:p-8 space-y-8 max-w-7xl mx-auto">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
              {t('b2dAdmin.header.title', 'Panel B2D Admin')}
            </h1>
            <p className="text-sm text-zinc-500">
              {t('b2dAdmin.header.subtitle', 'Gestión de API keys, ingresos y eventos del producto B2D.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4db6ac] text-white font-bold hover:bg-[#3a9b91]"
          >
            <Plus className="w-4 h-4" /> {t('b2dAdmin.actions.createKey', 'Crear API key')}
          </button>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('b2dAdmin.common.loading', 'Cargando…')}
          </div>
        )}

        {/* Section 2 — Métricas (rendered above keys for at-a-glance view). */}
        <section aria-labelledby="b2d-metrics-heading" className="space-y-4">
          <h2 id="b2d-metrics-heading" className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#4db6ac]" /> {t('b2dAdmin.metrics.title', 'Métricas')}
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <MetricCard label={t('b2dAdmin.metrics.mrr', 'MRR')} value={metrics ? formatCurrency(metrics.mrr) : '—'} />
            <MetricCard label={t('b2dAdmin.metrics.arr', 'ARR')} value={metrics ? formatCurrency(metrics.arr) : '—'} />
            <MetricCard label={t('b2dAdmin.metrics.customersActive', 'Clientes activos')} value={metrics ? String(metrics.customersActive) : '—'} />
            <MetricCard label={t('b2dAdmin.metrics.customersTotal', 'Clientes totales')} value={metrics ? String(metrics.customersTotal) : '—'} />
            <MetricCard
              label={t('b2dAdmin.metrics.churn30d', 'Churn 30d')}
              value={metrics ? `${(metrics.churnRate30d * 100).toFixed(1)}%` : '—'}
            />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4"
          >
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
              {t('b2dAdmin.metrics.mrrChart', 'MRR — mes actual')}
            </h3>
            <MrrChart data={mrrSeries} />
            <p className="mt-2 text-[10px] text-zinc-500 leading-relaxed">
              {t(
                'b2dAdmin.metrics.mrrChartNote',
                'Solo se muestra el valor actual. El histórico mensual se llenará automáticamente cuando el cron `runB2dMrrSnapshot` empiece a poblar la colección b2d_mrr_snapshots.',
              )}
            </p>
          </motion.div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
            <RevenueByTierChart
              revenueByTier={metrics?.revenueByTier ?? ({} as Record<B2dTier, number>)}
              customersByTier={customersByTier}
            />
          </div>

          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">
              {t('b2dAdmin.cohorts.title', 'Cohortes de retención')}
            </h3>
            {/* Placeholder: real cohort matrix needs a monthly snapshot job. */}
            <ChurnCohortHeatmap cohorts={[]} />
          </div>
        </section>

        {/* Section 1 — API Keys table. */}
        <section aria-labelledby="b2d-keys-heading" className="space-y-3">
          <h2 id="b2d-keys-heading" className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-[#4db6ac]" /> API Keys ({keys.length})
          </h2>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr className="text-left text-xs uppercase tracking-widest text-zinc-500">
                  <th className="px-4 py-2">{t('b2dAdmin.table.customer', 'Customer')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.tier', 'Tier')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.scopes', 'Scopes')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.status', 'Status')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.lastUsed', 'Last used')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.created', 'Created')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.actions', 'Acciones')}</th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-zinc-500">
                      {t('b2dAdmin.table.emptyKeys', 'Sin API keys todavía.')}
                    </td>
                  </tr>
                )}
                {keys.map((k) => (
                  <tr key={k.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-4 py-2 font-mono text-xs">{k.customerId}</td>
                    <td className="px-4 py-2">{k.tier}</td>
                    <td className="px-4 py-2 text-xs">{k.scopes.join(', ')}</td>
                    <td className="px-4 py-2">
                      <span className={k.status === 'active'
                        ? 'inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 text-xs'
                        : 'inline-block px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs'}
                      >
                        {k.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">{formatDate(k.lastUsedAt)}</td>
                    <td className="px-4 py-2 text-xs text-zinc-500">{formatDate(k.createdAt)}</td>
                    <td className="px-4 py-2">
                      {k.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(k.id)}
                          className="text-xs text-rose-600 hover:underline"
                        >
                          {t('b2dAdmin.actions.revoke', 'Revocar')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3 — Top customers. */}
        <section aria-labelledby="b2d-top-heading" className="space-y-3">
          <h2 id="b2d-top-heading" className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-[#4db6ac]" /> {t('b2dAdmin.topCustomers.title', 'Top 10 customers')}
          </h2>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr className="text-left text-xs uppercase tracking-widest text-zinc-500">
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.customer', 'Customer')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.topCustomers.mainTier', 'Tier principal')}</th>
                  <th className="px-4 py-2 text-right">{t('b2dAdmin.topCustomers.usdPerMonth', 'USD/mes')}</th>
                </tr>
              </thead>
              <tbody>
                {(metrics?.topCustomers ?? []).slice(0, 10).map((row, i) => (
                  <tr key={row.customerId} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-4 py-2 text-zinc-500">{i + 1}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.customerId}</td>
                    <td className="px-4 py-2">{row.tier}</td>
                    <td className="px-4 py-2 text-right font-bold">{formatCurrency(row.revenueMonthly)}</td>
                  </tr>
                ))}
                {(!metrics || metrics.topCustomers.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                      {t('b2dAdmin.topCustomers.empty', 'Sin clientes B2D activos todavía.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4 — Eventos. */}
        <section aria-labelledby="b2d-events-heading" className="space-y-3">
          <h2 id="b2d-events-heading" className="text-lg font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-amber-500" /> {t('b2dAdmin.events.title', 'Eventos')}
          </h2>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-800/50">
                <tr className="text-left text-xs uppercase tracking-widest text-zinc-500">
                  <th className="px-4 py-2">{t('b2dAdmin.events.when', 'Cuándo')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.events.type', 'Tipo')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.customer', 'Customer')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.table.tier', 'Tier')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.events.key', 'Key')}</th>
                  <th className="px-4 py-2">{t('b2dAdmin.events.actor', 'Actor')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-4 py-2 text-xs text-zinc-500">{formatDate(ev.ts)}</td>
                    <td className="px-4 py-2 text-xs">{ev.kind}</td>
                    <td className="px-4 py-2 text-xs font-mono">{ev.customerId ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{ev.tier ?? '—'}</td>
                    <td className="px-4 py-2 text-xs font-mono">{ev.keyId ?? '—'}</td>
                    <td className="px-4 py-2 text-xs font-mono">{ev.actor ?? '—'}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                      {t('b2dAdmin.events.empty', 'Sin eventos en los últimos 30 días.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <CreateApiKeyModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreate}
        />
      </div>
    </PremiumFeatureGuard>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
}

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{label}</p>
      <p className="text-xl font-bold text-zinc-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}
