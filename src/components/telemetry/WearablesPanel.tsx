import { useEffect, useState } from 'react';
import {
  Activity,
  Watch,
  HeartPulse,
  Loader2,
  Smartphone,
  RefreshCw,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { getHealthFacadeNative } from '../../services/health/healthFacadeNative';
import {
  useHealthMetrics,
  type HealthSource,
} from '../../hooks/useHealthMetrics';

export interface FitnessData {
  heartRate: number | null;
  steps: number | null;
  lastSync: Date | null;
}

interface WearablesPanelProps {
  fitnessData: FitnessData;
  fitTokens: any;
  isConnecting: boolean;
  onConnectBluetooth: () => void;
  onConnectGoogleFit: () => void;
}

const SOURCE_LABEL: Record<HealthSource, string> = {
  healthkit: 'HealthKit',
  'health-connect': 'Health Connect',
  'web-bluetooth': 'BLE',
  'google-fit': 'Google Fit',
  mock: 'Mock',
};

/**
 * Visual panel surfacing heart-rate / step count from BLE, OAuth Google
 * Fit or the native Health stack (HealthKit / Health Connect). Bucket OO
 * (Sprint 25) wires this through `useHealthMetrics` so the same hook
 * powers VitalityMonitor and any other consumer; the BLE / Google Fit
 * handshake still lives in Telemetry.tsx and is fed back as a web
 * override snapshot.
 */
export function WearablesPanel({
  fitnessData,
  fitTokens,
  isConnecting,
  onConnectBluetooth,
  onConnectGoogleFit,
}: WearablesPanelProps) {
  const metrics = useHealthMetrics({
    autoSyncMs: 5 * 60_000,
    webOverride: {
      stepsToday: fitnessData.steps,
      heartRateBpm: fitnessData.heartRate,
      lastSyncMs: fitnessData.lastSync ? fitnessData.lastSync.getTime() : 0,
      source: fitTokens
        ? 'google-fit'
        : fitnessData.heartRate != null
          ? 'web-bluetooth'
          : undefined,
    },
  });

  const [nativeBackend, setNativeBackend] = useState<
    'healthkit' | 'health-connect' | 'none'
  >('none');
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      if (Capacitor.isNativePlatform()) {
        const facade = getHealthFacadeNative();
        if (!cancelled) setNativeBackend(facade.backend);
      }
    } catch {
      /* Capacitor missing — leave backend as 'none'. */
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function onConnectNative() {
    setRequesting(true);
    try {
      const granted = await metrics.requestPermissions();
      if (granted) {
        await metrics.syncNow();
      }
    } finally {
      setRequesting(false);
    }
  }

  // Effective values: the hook merges native + web override into a
  // single source of truth.
  const latestHr =
    metrics.heartRateRecent.length > 0
      ? metrics.heartRateRecent[metrics.heartRateRecent.length - 1].bpm
      : fitnessData.heartRate;
  const effectiveSteps = metrics.stepsToday ?? fitnessData.steps;
  const effectiveLastSync =
    metrics.lastSyncMs > 0
      ? new Date(metrics.lastSyncMs)
      : fitnessData.lastSync;

  const isNativeBackend =
    nativeBackend === 'healthkit' || nativeBackend === 'health-connect';
  const sourceLabel =
    metrics.source !== 'mock'
      ? SOURCE_LABEL[metrics.source]
      : isNativeBackend
        ? SOURCE_LABEL[nativeBackend === 'healthkit' ? 'healthkit' : 'health-connect']
        : null;
  const nativeButtonLabel =
    nativeBackend === 'healthkit'
      ? 'HealthKit'
      : nativeBackend === 'health-connect'
        ? 'Health Connect'
        : 'Salud nativa';

  const isConnected =
    Boolean(fitTokens) ||
    metrics.lastSyncMs > 0 ||
    fitnessData.lastSync !== null;

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
          <Watch className="w-4 h-4 text-emerald-500" />
          Wearables (BLE / Fit)
        </h3>
        <div className="flex items-center gap-2">
          {sourceLabel && (
            <span className="px-2 py-1 rounded-md bg-teal-500/10 text-teal-300 text-[9px] font-black uppercase tracking-widest border border-teal-500/20">
              {sourceLabel}
            </span>
          )}
          {isConnected && (
            <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest border border-emerald-500/20">
              Conectado
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
          <HeartPulse
            className={`w-8 h-8 ${
              latestHr && latestHr > 100
                ? 'text-rose-500 animate-pulse'
                : 'text-emerald-500'
            }`}
          />
          <div>
            <p className="text-2xl font-black text-white">
              {latestHr || '--'} <span className="text-sm">bpm</span>
            </p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              Ritmo Cardíaco
            </p>
          </div>
        </div>
        <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
          <Activity className="w-8 h-8 text-blue-400" />
          <div>
            <p className="text-2xl font-black text-white">
              {effectiveSteps ? effectiveSteps.toLocaleString() : '--'}
            </p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
              Pasos
            </p>
          </div>
        </div>
      </div>

      {!isConnected && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onConnectBluetooth}
            disabled={isConnecting}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isConnecting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Smartphone className="w-4 h-4" />
            )}
            Bluetooth
          </button>
          {isNativeBackend ? (
            <button
              onClick={onConnectNative}
              disabled={isConnecting || requesting}
              className="flex-1 bg-teal-700 hover:bg-teal-600 text-white px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {requesting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <HeartPulse className="w-4 h-4" />
              )}
              {nativeButtonLabel}
            </button>
          ) : (
            <button
              onClick={onConnectGoogleFit}
              disabled={isConnecting}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isConnecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Watch className="w-4 h-4" />
              )}
              Google Fit
            </button>
          )}
        </div>
      )}

      {isConnected && (
        <button
          onClick={() => {
            void metrics.syncNow();
          }}
          disabled={metrics.isLoading}
          className="w-full bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {metrics.isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Sincronizar ahora
        </button>
      )}

      {effectiveLastSync && (
        <p className="text-[10px] text-zinc-500 text-center">
          Última sincronización: {effectiveLastSync.toLocaleTimeString()}
        </p>
      )}
      {metrics.error && metrics.error !== 'permissions-not-granted' && (
        <p className="text-[10px] text-rose-400 text-center">
          {metrics.error === 'permissions-denied'
            ? 'Permisos de salud denegados.'
            : `Error: ${metrics.error}`}
        </p>
      )}
    </div>
  );
}
