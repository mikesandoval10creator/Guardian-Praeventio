// Praeventio Guard — Wearables real (Health Connect / HealthKit / Google Fit).
//
// Antes: `setInterval(3000)` con `Math.random()` simulando heart rate,
// SpO2, HRV, estrés. Vendido como "Telemetría Wearable Nivel Enterprise".
//
// AHORA: integración REAL con `getHealthAdapter()` que ya existe en el
// repo y selecciona automáticamente:
//   - Android nativo + Health Connect instalado → healthConnectAdapter
//   - iOS nativo + HealthKit → healthKitAdapter
//   - Resto → googleFitAdapter (deprecated pero vivo hasta 2026)
//   - Fallback → noopAdapter (devuelve arrays vacíos, NUNCA Math.random)
//
// Sin Math.random. Si el usuario está en web sin permisos otorgados, la
// página muestra estado HONESTO ("No hay dispositivo emparejado") con
// botón para solicitar permisos via el adapter real.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Watch,
  HeartPulse,
  Activity,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Smartphone,
  Footprints,
  Moon,
  Flame,
  X,
  ChevronRight,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, Button } from '../components/shared/Card';
import {
  getHealthAdapter,
  type HealthAdapter,
  type HeartRateSample,
  type StepsSample,
  type SleepSample,
  type CaloriesSample,
} from '../services/health';
import { humanErrorMessage } from '../lib/humanError';


interface VitalsAggregate {
  /** Latest heart rate sample BPM. */
  latestBpm: number | null;
  /** Avg BPM en la ventana solicitada. */
  avgBpm: number | null;
  /** Total steps en la ventana. */
  totalSteps: number | null;
  /** Total kcal en la ventana. */
  totalKcal: number | null;
  /** Total horas dormidas en la ventana. */
  totalSleepHours: number | null;
  /** Adapter usado para audit/visibilidad. */
  adapterName: string;
  /** Plataforma reportada por el adapter. */
  platform: string;
  /** Disponibilidad real del adapter (false = noop). */
  isAvailable: boolean;
  /** Cuántas muestras de heart rate recibimos (UX). */
  hrSampleCount: number;
  /** ISO timestamp de la última sync. */
  lastSyncIso: string;
}

interface HrSeries {
  timestamp: number;
  bpm: number;
}

const SCOPES = ['heart-rate', 'steps', 'calories', 'sleep'] as const;

export function WearablesIntegration() {
  const { t } = useTranslation();
  const [adapter, setAdapter] = useState<HealthAdapter | null>(null);
  const [vitals, setVitals] = useState<VitalsAggregate | null>(null);
  const [hrSeries, setHrSeries] = useState<HrSeries[]>([]);
  const [permissionState, setPermissionState] = useState<
    'unknown' | 'requesting' | 'granted' | 'denied' | 'partial'
  >('unknown');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  // Inicializa el adapter al montar.
  useEffect(() => {
    const a = getHealthAdapter();
    setAdapter(a);
    if (!a.isAvailable) {
      setPermissionState('denied');
    }
  }, []);

  const requestPermissions = useCallback(async () => {
    if (!adapter) return;
    setError(null);
    setPermissionState('requesting');
    try {
      const result = await adapter.requestPermissions([...SCOPES]);
      if (result.denied.length === 0 && result.granted.length > 0) {
        setPermissionState('granted');
      } else if (result.granted.length > 0) {
        setPermissionState('partial');
      } else {
        setPermissionState('denied');
      }
    } catch (err) {
      setPermissionState('denied');
      setError(humanErrorMessage(err instanceof Error ? err.message : String(err)));
    }
  }, [adapter]);

  const syncReadings = useCallback(async () => {
    if (!adapter) return;
    setSyncing(true);
    setError(null);
    try {
      const now = new Date();
      // Ventana: últimas 24h.
      const range = {
        start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        end: now,
      };
      const [hr, steps, kcal, sleep] = await Promise.all([
        adapter.readHeartRate(range).catch(() => [] as HeartRateSample[]),
        adapter.readSteps(range).catch(() => [] as StepsSample[]),
        adapter.readCalories(range).catch(() => [] as CaloriesSample[]),
        adapter.readSleep(range).catch(() => [] as SleepSample[]),
      ]);

      const latestBpm = hr.length > 0 ? hr[hr.length - 1]!.bpm : null;
      const avgBpm =
        hr.length > 0
          ? Math.round(hr.reduce((acc, s) => acc + s.bpm, 0) / hr.length)
          : null;
      const totalSteps = steps.length
        ? steps.reduce((acc, s) => acc + s.count, 0)
        : null;
      const totalKcal = kcal.length
        ? Math.round(kcal.reduce((acc, s) => acc + s.kcal, 0))
        : null;
      const totalSleepMs = sleep.length
        ? sleep.reduce(
            (acc, s) => acc + (s.endTime.getTime() - s.startTime.getTime()),
            0,
          )
        : null;
      const totalSleepHours =
        totalSleepMs !== null ? +(totalSleepMs / 3_600_000).toFixed(1) : null;

      setVitals({
        latestBpm,
        avgBpm,
        totalSteps,
        totalKcal,
        totalSleepHours,
        adapterName: adapter.name,
        platform: adapter.platform,
        isAvailable: adapter.isAvailable,
        hrSampleCount: hr.length,
        lastSyncIso: new Date().toISOString(),
      });
      // Serie HR para el gráfico — downsample si hay muchas muestras
      const downsampled = downsampleHr(hr, 60);
      setHrSeries(downsampled);
    } catch (err) {
      setError(humanErrorMessage(err instanceof Error ? err.message : String(err)));
    } finally {
      setSyncing(false);
    }
  }, [adapter]);

  // Auto-sync inicial cuando hay permisos.
  useEffect(() => {
    if (permissionState === 'granted' || permissionState === 'partial') {
      void syncReadings();
    }
  }, [permissionState, syncReadings]);

  const isConnected =
    permissionState === 'granted' || permissionState === 'partial';

  return (
    <div
      data-testid="wearables-page"
      data-adapter={adapter?.name ?? 'none'}
      data-permission={permissionState}
      className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8"
    >
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Watch className="w-8 h-8 text-rose-500" aria-hidden="true" />
            {t('wearables.title', 'Wearables')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t(
              'wearables.subtitle',
              'Health Connect · HealthKit · Google Fit',
            )}
          </p>
        </div>
        <div className="flex gap-3">
          {isConnected && (
            <Button
              onClick={() => setShowReport(true)}
              className="bg-indigo-600 hover:bg-indigo-700 border-none text-white flex items-center gap-2"
              data-testid="wearables-show-report"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
              {t('wearables.report.button', 'Reporte')}
            </Button>
          )}
          <div
            className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${
              adapter?.isAvailable
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-muted-token bg-elevated border-default-token'
            }`}
            data-testid="wearables-adapter-badge"
          >
            <ShieldAlert className="w-5 h-5" aria-hidden="true" />
            <span className="font-bold uppercase tracking-wider text-sm">
              {adapter?.name ?? '—'}
            </span>
          </div>
        </div>
      </header>

      {error && (
        <div
          data-testid="wearables-error"
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
        {/* Connection panel */}
        <Card className="p-6 border-default-token space-y-5 lg:col-span-1">
          <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
            <Smartphone
              className="w-5 h-5 text-rose-500"
              aria-hidden="true"
            />
            {t('wearables.devices.title', 'Fuente de datos')}
          </h2>

          {adapter ? (
            <div
              className={`p-4 rounded-xl border-2 ${
                adapter.isAvailable
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-default-token bg-surface'
              }`}
              data-testid="wearables-adapter-card"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2.5 rounded-lg ${
                    adapter.isAvailable
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-elevated text-muted-token'
                  }`}
                >
                  <Watch className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-primary-token">
                    {adapterDisplayName(adapter.name)}
                  </h3>
                  <p className="text-[11px] text-muted-token mt-0.5">
                    {t('wearables.platform', 'Plataforma')}: {adapter.platform}
                  </p>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      adapter.isAvailable
                        ? 'text-emerald-400'
                        : 'text-muted-token'
                    }`}
                    data-testid="wearables-availability"
                  >
                    {adapter.isAvailable
                      ? t('wearables.available', 'Disponible')
                      : t(
                          'wearables.notAvailable',
                          'No disponible en este dispositivo',
                        )}
                  </p>
                </div>
                {adapter.isAvailable && (
                  <CheckCircle2
                    className="w-5 h-5 text-emerald-500"
                    aria-hidden="true"
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl border-2 border-default-token bg-surface">
              <p className="text-xs text-muted-token animate-pulse">
                {t('wearables.detecting', 'Detectando adapter…')}
              </p>
            </div>
          )}

          {adapter && !adapter.isAvailable && (
            <div className="p-3 rounded-md bg-amber-500/5 border border-amber-500/30">
              <p className="text-[11px] text-amber-200 leading-relaxed">
                {t(
                  'wearables.notAvailableHint',
                  'En web no hay acceso directo a wearables. Para datos reales: instala la app Android o iOS y vincula tu wearable allí.',
                )}
              </p>
            </div>
          )}

          {adapter?.isAvailable && permissionState !== 'granted' && (
            <Button
              className="w-full"
              onClick={() => void requestPermissions()}
              disabled={permissionState === 'requesting'}
              data-testid="wearables-request-permissions"
            >
              {permissionState === 'requesting' ? (
                <>
                  <RefreshCw
                    className="w-4 h-4 animate-spin mr-2"
                    aria-hidden="true"
                  />
                  {t('wearables.requestingPermissions', 'Solicitando…')}
                </>
              ) : (
                <>
                  <ShieldAlert
                    className="w-4 h-4 mr-2"
                    aria-hidden="true"
                  />
                  {t('wearables.requestPermissions', 'Otorgar permisos')}
                </>
              )}
            </Button>
          )}

          {isConnected && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => void syncReadings()}
              disabled={syncing}
              data-testid="wearables-sync"
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              {syncing
                ? t('wearables.syncing', 'Sincronizando…')
                : t('wearables.sync', 'Sincronizar ahora')}
            </Button>
          )}

          {vitals && (
            <p
              className="text-[10px] text-muted-token italic text-center"
              data-testid="wearables-last-sync"
            >
              {t('wearables.lastSync', 'Última sync')}:{' '}
              {new Date(vitals.lastSyncIso).toLocaleTimeString()}
            </p>
          )}
        </Card>

        {/* Vitals dashboard */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <VitalCard
              testId="vital-bpm"
              icon={HeartPulse}
              iconColor="text-rose-500"
              label={t('wearables.vital.bpm', 'BPM') as string}
              value={vitals?.latestBpm ?? null}
              suffix=""
              subtitle={
                vitals?.avgBpm !== null && vitals?.avgBpm !== undefined
                  ? `${t('wearables.avg', 'Avg')}: ${vitals.avgBpm}`
                  : undefined
              }
            />
            <VitalCard
              testId="vital-steps"
              icon={Footprints}
              iconColor="text-blue-500"
              label={t('wearables.vital.steps', 'Pasos') as string}
              value={vitals?.totalSteps ?? null}
              suffix=""
              subtitle={t('wearables.last24h', 'Últimas 24h') as string}
            />
            <VitalCard
              testId="vital-kcal"
              icon={Flame}
              iconColor="text-amber-500"
              label="kcal"
              value={vitals?.totalKcal ?? null}
              suffix=""
              subtitle={t('wearables.last24h', 'Últimas 24h') as string}
            />
            <VitalCard
              testId="vital-sleep"
              icon={Moon}
              iconColor="text-violet-500"
              label={t('wearables.vital.sleep', 'Sueño') as string}
              value={vitals?.totalSleepHours ?? null}
              suffix="h"
              subtitle={t('wearables.last24h', 'Últimas 24h') as string}
            />
          </div>

          {isConnected && (
            <Card className="p-6 border-default-token">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-primary-token flex items-center gap-2">
                  <HeartPulse
                    className="w-5 h-5 text-rose-500"
                    aria-hidden="true"
                  />
                  {t('wearables.hrSeries', 'Frecuencia cardíaca (24h)')}
                </h3>
                {vitals && vitals.hrSampleCount > 0 && (
                  <span
                    className="text-[10px] text-muted-token font-mono"
                    data-testid="wearables-hr-sample-count"
                  >
                    {vitals.hrSampleCount} samples
                  </span>
                )}
              </div>
              {hrSeries.length > 0 ? (
                <div className="h-48" data-testid="wearables-hr-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hrSeries}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#333"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="timestamp"
                        stroke="#666"
                        fontSize={10}
                        tickFormatter={(v) =>
                          new Date(v).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        }
                      />
                      <YAxis
                        stroke="#666"
                        fontSize={10}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#18181b',
                          border: '1px solid #3f3f46',
                        }}
                        itemStyle={{ color: '#fff' }}
                        labelFormatter={(v) => new Date(v).toLocaleString()}
                      />
                      <Line
                        type="monotone"
                        dataKey="bpm"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        dot={{ fill: '#f43f5e', r: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div
                  className="h-48 flex items-center justify-center text-center"
                  data-testid="wearables-hr-empty"
                >
                  <p className="text-xs text-muted-token max-w-xs leading-relaxed">
                    {syncing
                      ? t('wearables.syncing', 'Sincronizando…')
                      : t(
                          'wearables.noHrData',
                          'No hay muestras de frecuencia cardíaca en las últimas 24h. Si tu wearable está cargado y emparejado, verifica permisos.',
                        )}
                  </p>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showReport && vitals && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface border border-default-token rounded-2xl p-6 max-w-2xl w-full shadow-2xl"
              data-testid="wearables-report-modal"
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-primary-token">
                    {t('wearables.report.title', 'Resumen 24h')}
                  </h2>
                  <p className="text-muted-token text-sm mt-1">
                    {t('wearables.report.adapter', 'Fuente')}: {vitals.adapterName}
                  </p>
                </div>
                <button
                  onClick={() => setShowReport(false)}
                  className="text-muted-token hover:text-primary-token"
                  aria-label={t('common.close', 'Cerrar') as string}
                >
                  <X className="w-6 h-6" aria-hidden="true" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="BPM (último)" value={vitals.latestBpm} />
                <Stat label="BPM (promedio)" value={vitals.avgBpm} />
                <Stat label="Pasos" value={vitals.totalSteps} />
                <Stat label="kcal" value={vitals.totalKcal} />
                <Stat
                  label="Sueño (h)"
                  value={vitals.totalSleepHours}
                  suffix="h"
                />
                <Stat label="Muestras HR" value={vitals.hrSampleCount} />
              </div>

              <p className="text-[11px] text-muted-token italic mt-4">
                {t(
                  'wearables.report.disclaimer',
                  'Datos brutos del adapter. Las decisiones clínicas requieren evaluación profesional — esto es información de apoyo, NO diagnóstico.',
                )}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────

interface VitalCardProps {
  testId: string;
  icon: typeof HeartPulse;
  iconColor: string;
  label: string;
  value: number | null;
  suffix: string;
  subtitle?: string;
}

function VitalCard({
  testId,
  icon: Icon,
  iconColor,
  label,
  value,
  suffix,
  subtitle,
}: VitalCardProps) {
  return (
    <Card className="p-4 border-default-token">
      <div className="flex items-center gap-2 mb-3">
        <Icon className={`w-5 h-5 ${iconColor}`} aria-hidden="true" />
        <span className="text-xs font-bold text-muted-token uppercase">
          {label}
        </span>
      </div>
      <div
        className="text-3xl font-black text-primary-token font-mono"
        data-testid={testId}
      >
        {value !== null ? value.toLocaleString() : '—'}
        {value !== null && suffix && (
          <span className="text-sm text-muted-token ml-1">{suffix}</span>
        )}
      </div>
      {subtitle && (
        <p className="text-[10px] text-muted-token mt-1">{subtitle}</p>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="p-3 rounded-xl bg-elevated">
      <div className="text-xs text-muted-token mb-1">{label}</div>
      <div className="text-xl font-bold text-primary-token font-mono">
        {value !== null ? value.toLocaleString() : '—'}
        {value !== null && suffix && (
          <span className="text-sm text-muted-token ml-1">{suffix}</span>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** Reduce N muestras a maxPoints (downsample uniforme). */
function downsampleHr(samples: HeartRateSample[], maxPoints: number): HrSeries[] {
  if (samples.length === 0) return [];
  if (samples.length <= maxPoints) {
    return samples.map((s) => ({
      timestamp: s.timestamp.getTime(),
      bpm: s.bpm,
    }));
  }
  const step = Math.ceil(samples.length / maxPoints);
  const out: HrSeries[] = [];
  for (let i = 0; i < samples.length; i += step) {
    const chunk = samples.slice(i, i + step);
    const avgBpm = Math.round(
      chunk.reduce((acc, s) => acc + s.bpm, 0) / chunk.length,
    );
    out.push({
      timestamp: chunk[Math.floor(chunk.length / 2)]!.timestamp.getTime(),
      bpm: avgBpm,
    });
  }
  return out;
}

function adapterDisplayName(name: string): string {
  switch (name) {
    case 'health-connect':
      return 'Health Connect (Android)';
    case 'healthkit':
      return 'HealthKit (iOS)';
    case 'google-fit':
      return 'Google Fit (deprecated)';
    case 'noop':
      return 'Sin adapter';
    default:
      return name;
  }
}

export default WearablesIntegration;
