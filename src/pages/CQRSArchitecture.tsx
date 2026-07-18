// Praeventio Guard — CQRS Architecture page (REAL, NO simulation).
//
// CIERRA el gap de "narrativa CQRS real" reportado en auditoría
// arquitectónica. Antes esta página corría `setInterval` con
// `Math.random()` y se anunciaba como "Arquitectura CQRS" — pure demo.
//
// Ahora consume un Event Store REAL (`InMemoryEventStore` + Incident
// aggregate con events + commands + read model + projecciones):
//
//   - Event Store: append-only log de DomainEvent typed
//   - Read Model: proyección event-sourced reconstruible
//   - Commands: validan invariantes, append a store, auto-apply al model
//   - Queries: leen SOLO del read model (never del store directo)
//
// Las métricas que se muestran son las REALES del store:
//   - totalEvents: cuántos eventos persisten
//   - appendCount + avgAppendLatencyMs (rolling)
//   - readCount + avgReadLatencyMs (rolling)
//   - projectionLag: diferencia entre store y read model (CQRS-in-process
//     debe ser 0)
//   - eventTypesSeen: catálogo de tipos descubiertos en runtime
//
// El botón "Demo append" appendea un evento real al Event Store usando
// los command handlers y refresca las métricas. Es una demo del flujo,
// pero los números son del store REAL, NO Math.random().

import { randomId } from '../utils/randomId';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database,
  ShieldAlert,
  Activity,
  ArrowRightLeft,
  Server,
  HardDrive,
  Layers,
  RefreshCcw,
  Play,
  AlertTriangle,
} from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import {
  getIncidentSystem,
  type CqrsDashboardMetrics,
} from '../services/cqrs/incidents/incidentSystem';
import { humanErrorMessage } from '../lib/humanError';


function generateDemoId(): string {
  return `demo-inc-${randomId()}`;
}

export function CQRSArchitecture() {
  const { t } = useTranslation();
  const [metrics, setMetrics] = useState<CqrsDashboardMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appending, setAppending] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await getIncidentSystem().getDashboardMetrics();
      setMetrics(m);
    } catch (err) {
      setError(humanErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * "Demo append" — crea un incidente real en el Event Store. Útil para
   * ver las métricas moverse. Cada append:
   *   1. Genera UUID + payload
   *   2. Pasa por handleCreateIncident (valida + append + actualiza read model)
   *   3. Re-lee métricas
   */
  const handleDemoAppend = useCallback(async () => {
    setAppending(true);
    try {
      const sys = getIncidentSystem();
      const id = generateDemoId();
      await sys.commands.createIncident({
        kind: 'incident.create',
        aggregateId: id,
        issuedByUid: 'demo-user',
        tenantId: 'demo-tenant',
        projectId: 'demo-project',
        payload: {
          description: 'Demo incident appended desde la UI CQRS dashboard',
          occurredAtIso: new Date().toISOString(),
          initialSeverity: 'low',
        },
      });
      await refresh();
    } catch (err) {
      setError(humanErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setAppending(false);
    }
  }, [refresh]);

  return (
    <PremiumFeatureGuard
      feature="canUseMultiTenant"
      featureName={t('cqrs.featureName', 'Arquitectura CQRS Multi-Tenant') as string}
      description={t(
        'cqrs.featureDesc',
        'Event Store + read models segregados disponible desde el plan Corporativo.',
      ) as string}
    >
      <div
        data-testid="cqrs-architecture-page"
        className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
              <Layers className="w-8 h-8 text-fuchsia-500" aria-hidden="true" />
              {t('cqrs.title', 'Arquitectura CQRS')}
            </h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
              {t('cqrs.subtitle', 'Event Store + Read Models — métricas en vivo')}
            </p>
          </div>
          <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-fuchsia-500 bg-fuchsia-500/10 border-fuchsia-500/20">
            <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            <span className="font-bold uppercase tracking-wider text-sm">
              {t('cqrs.tierBadge', 'Nivel: Corporativo')}
            </span>
          </div>
        </div>

        {error && (
          <div
            data-testid="cqrs-error"
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2"
          >
            <AlertTriangle
              className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-rose-300 font-mono">{humanErrorMessage(error)}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Topología real */}
          <Card className="p-6 border-default-token lg:col-span-2 space-y-6">
            <div className="flex justify-between items-center flex-wrap gap-2">
              <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
                <Server className="w-5 h-5 text-fuchsia-500" aria-hidden="true" />
                {t('cqrs.topologySection', 'Topología del sistema')}
              </h2>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => void handleDemoAppend()}
                  disabled={appending || loading}
                  className="text-xs py-2"
                  data-testid="cqrs-demo-append"
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                  {appending
                    ? t('cqrs.appending', 'Appendeando…')
                    : t('cqrs.demoAppend', 'Append demo event')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void refresh()}
                  disabled={loading || appending}
                  className="text-xs py-2"
                  data-testid="cqrs-refresh"
                >
                  <RefreshCcw
                    className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                </Button>
              </div>
            </div>

            <div className="relative h-[360px] bg-elevated rounded-xl border border-default-token p-8 flex flex-col justify-between">
              <div className="flex justify-center">
                <div className="px-6 py-3 bg-surface border border-default-token rounded-xl text-primary-token font-bold flex items-center gap-2 z-10">
                  <Activity className="w-5 h-5 text-muted-token" aria-hidden="true" />
                  {t('cqrs.layerClients', 'Clientes (Web / Móvil)')}
                </div>
              </div>

              <div className="flex justify-between w-full px-12 z-10">
                <div className="flex flex-col items-center gap-3">
                  <div className="px-4 py-2 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 font-bold flex items-center gap-2 text-sm">
                    <ArrowRightLeft className="w-4 h-4" aria-hidden="true" />
                    {t('cqrs.commandSide', 'Command handlers')}
                  </div>
                  <div className="p-4 bg-surface border border-default-token rounded-full">
                    <Database className="w-7 h-7 text-rose-500" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-bold text-muted-token uppercase tracking-widest text-center">
                    {t('cqrs.eventStoreLabel', 'Event Store')}
                  </span>
                  <span
                    data-testid="cqrs-event-count"
                    className="text-2xl font-black text-rose-400 font-mono"
                  >
                    {metrics?.totalEvents ?? '—'}
                  </span>
                  <span className="text-[9px] text-muted-token uppercase tracking-wider">
                    {t('cqrs.eventsLabel', 'eventos')}
                  </span>
                </div>

                <div className="flex flex-col items-center gap-3">
                  <div className="px-4 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 font-bold flex items-center gap-2 text-sm">
                    <ArrowRightLeft className="w-4 h-4" aria-hidden="true" />
                    {t('cqrs.querySide', 'Query handlers')}
                  </div>
                  <div className="p-4 bg-surface border border-default-token rounded-full">
                    <HardDrive className="w-7 h-7 text-emerald-500" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-bold text-muted-token uppercase tracking-widest text-center">
                    {t('cqrs.readModelLabel', 'Read Model')}
                  </span>
                  <span
                    data-testid="cqrs-aggregate-count"
                    className="text-2xl font-black text-emerald-400 font-mono"
                  >
                    {metrics?.readModelAggregateCount ?? '—'}
                  </span>
                  <span className="text-[9px] text-muted-token uppercase tracking-wider">
                    {t('cqrs.aggregatesLabel', 'aggregates')}
                  </span>
                </div>
              </div>
            </div>

            <div
              data-testid="cqrs-projection-lag"
              data-lag={metrics?.projectionLag ?? -1}
              className={`p-3 rounded-lg border ${
                (metrics?.projectionLag ?? 0) === 0
                  ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/5 border-amber-500/30 text-amber-300'
              }`}
            >
              <p className="text-xs font-bold uppercase tracking-wider mb-1">
                {t('cqrs.projectionLagLabel', 'Lag de proyección')}
              </p>
              <p className="text-sm">
                {metrics
                  ? metrics.projectionLag === 0
                    ? t(
                        'cqrs.lagZero',
                        'Read model 100% sincronizado con Event Store (lag = 0).',
                      )
                    : t('cqrs.lagPositive', '{{lag}} eventos en cola de proyección.', {
                        lag: metrics.projectionLag,
                      })
                  : t('cqrs.lagLoading', 'Midiendo…')}
              </p>
            </div>
          </Card>

          {/* Métricas reales */}
          <Card className="p-6 border-default-token space-y-4">
            <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
              <Activity className="w-5 h-5 text-fuchsia-500" aria-hidden="true" />
              {t('cqrs.metricsSection', 'Métricas en vivo')}
            </h2>

            <MetricRow
              testId="cqrs-metric-appends"
              label={t('cqrs.metricAppends', 'Appends totales') as string}
              value={metrics?.appendCount}
              suffix=""
              colorClass="text-rose-400"
            />
            <MetricRow
              testId="cqrs-metric-reads"
              label={t('cqrs.metricReads', 'Reads totales') as string}
              value={metrics?.readCount}
              suffix=""
              colorClass="text-emerald-400"
            />
            <MetricRow
              testId="cqrs-metric-append-lat"
              label={t('cqrs.metricAppendLat', 'Latencia append (avg)') as string}
              value={metrics?.avgAppendLatencyMs}
              suffix="ms"
              colorClass="text-fuchsia-400"
            />
            <MetricRow
              testId="cqrs-metric-read-lat"
              label={t('cqrs.metricReadLat', 'Latencia read (avg)') as string}
              value={metrics?.avgReadLatencyMs}
              suffix="ms"
              colorClass="text-fuchsia-400"
            />

            <div className="pt-2 border-t border-default-token">
              <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest mb-1.5">
                {t('cqrs.eventTypesLabel', 'Tipos de evento')}
              </p>
              {metrics?.eventTypesSeen && metrics.eventTypesSeen.length > 0 ? (
                <ul
                  data-testid="cqrs-event-types"
                  className="flex flex-wrap gap-1"
                >
                  {metrics.eventTypesSeen.map((t) => (
                    <li
                      key={t}
                      className="px-2 py-0.5 rounded-full bg-surface border border-default-token text-[10px] text-secondary-token font-mono"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-muted-token">
                  {t(
                    'cqrs.eventTypesEmpty',
                    'Aún no hay eventos — usa "Append demo event" para empezar.',
                  )}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </PremiumFeatureGuard>
  );
}

interface MetricRowProps {
  testId: string;
  label: string;
  value: number | undefined;
  suffix: string;
  colorClass: string;
}

function MetricRow({ testId, label, value, suffix, colorClass }: MetricRowProps) {
  return (
    <div className="p-3 rounded-xl bg-surface border border-default-token">
      <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest mb-1">
        {label}
      </p>
      <div className="flex items-end gap-2">
        <p
          data-testid={testId}
          className={`text-2xl font-black font-mono ${colorClass}`}
        >
          {value !== undefined ? value.toLocaleString() : '—'}
        </p>
        {suffix && <p className="text-xs text-muted-token mb-0.5">{suffix}</p>}
      </div>
    </div>
  );
}
