import { useEffect, useState } from 'react';
import { Activity, Watch, HeartPulse, Loader2, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { getHealthFacadeNative } from '../../services/health/healthFacadeNative';

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

/**
 * Visual panel that surfaces heart-rate / step count from BLE or
 * Health Connect / HealthKit / Google Fit, plus the connection
 * buttons. The Bluetooth and OAuth dance still lives in
 * Telemetry.tsx; on native iOS/Android this component additionally
 * pulls fresh samples from the OS Health stack via
 * `healthFacadeNative` and overlays them on top of the props-fed
 * fitnessData when available.
 */
export function WearablesPanel({
  fitnessData,
  fitTokens,
  isConnecting,
  onConnectBluetooth,
  onConnectGoogleFit,
}: WearablesPanelProps) {
  const [nativeData, setNativeData] = useState<{
    heartRate: number | null;
    steps: number | null;
    lastSync: Date | null;
  }>({ heartRate: null, steps: null, lastSync: null });
  const [nativeBackend, setNativeBackend] = useState<
    'healthkit' | 'health-connect' | 'none'
  >('none');
  const [nativeRequested, setNativeRequested] = useState(false);

  // Detect native runtime once and probe backend identity. We do NOT auto-
  // request permissions here — that's a privileged sheet the user must trigger
  // from a button click (see `onConnectNative`).
  useEffect(() => {
    let cancelled = false;
    try {
      if (Capacitor.isNativePlatform()) {
        const facade = getHealthFacadeNative();
        if (!cancelled) setNativeBackend(facade.backend);
      }
    } catch {
      // Capacitor not available on this runtime — leave backend as 'none'.
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function onConnectNative() {
    try {
      const facade = getHealthFacadeNative();
      const perm = await facade.requestPermissions([
        'steps',
        'heartRate',
        'activeEnergy',
        'distance',
      ]);
      setNativeRequested(true);
      if (perm.granted.length === 0) return;

      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
      const [steps, heartRatePoints] = await Promise.all([
        facade.getStepsToday(),
        facade.getHeartRate(fiveMinAgo, now),
      ]);
      const latestHr = heartRatePoints.length
        ? heartRatePoints[heartRatePoints.length - 1].bpm
        : null;
      setNativeData({
        heartRate: latestHr,
        steps: steps || null,
        lastSync: new Date(),
      });
    } catch {
      // Surface nothing — the user already saw the permission sheet, and the
      // data card stays in its previous state.
    }
  }

  // Effective values: prefer fresh native data when present, else props.
  const effectiveHeartRate = nativeData.heartRate ?? fitnessData.heartRate;
  const effectiveSteps = nativeData.steps ?? fitnessData.steps;
  const effectiveLastSync = nativeData.lastSync ?? fitnessData.lastSync;

  const isNativeBackend =
    nativeBackend === 'healthkit' || nativeBackend === 'health-connect';
  const nativeBadgeLabel =
    nativeBackend === 'healthkit'
      ? 'HealthKit'
      : nativeBackend === 'health-connect'
        ? 'Health Connect'
        : null;
  const nativeButtonLabel =
    nativeBackend === 'healthkit'
      ? 'HealthKit'
      : nativeBackend === 'health-connect'
        ? 'Health Connect'
        : 'Salud nativa';

  // Show "connected" if either the legacy Google Fit OAuth dance succeeded
  // OR the native facade returned at least one sample after a permission
  // request. Anything else falls back to the connect buttons.
  const isConnected = Boolean(fitTokens) || nativeData.lastSync !== null;

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
          <Watch className="w-4 h-4 text-emerald-500" />
          Wearables (BLE / Fit)
        </h3>
        <div className="flex items-center gap-2">
          {nativeBadgeLabel && (
            <span className="px-2 py-1 rounded-md bg-teal-500/10 text-teal-300 text-[9px] font-black uppercase tracking-widest border border-teal-500/20">
              {nativeBadgeLabel}
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
          <HeartPulse className={`w-8 h-8 ${effectiveHeartRate && effectiveHeartRate > 100 ? 'text-rose-500 animate-pulse' : 'text-emerald-500'}`} />
          <div>
            <p className="text-2xl font-black text-white">{effectiveHeartRate || '--'} <span className="text-sm">bpm</span></p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ritmo Cardíaco</p>
          </div>
        </div>
        <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
          <Activity className="w-8 h-8 text-blue-400" />
          <div>
            <p className="text-2xl font-black text-white">{effectiveSteps ? effectiveSteps.toLocaleString() : '--'}</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Pasos</p>
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
            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
            Bluetooth
          </button>
          {isNativeBackend ? (
            <button
              onClick={onConnectNative}
              disabled={isConnecting || nativeRequested}
              className="flex-1 bg-teal-700 hover:bg-teal-600 text-white px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartPulse className="w-4 h-4" />}
              {nativeButtonLabel}
            </button>
          ) : (
            <button
              onClick={onConnectGoogleFit}
              disabled={isConnecting}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Watch className="w-4 h-4" />}
              Google Fit
            </button>
          )}
        </div>
      )}
      {effectiveLastSync && (
        <p className="text-[10px] text-zinc-500 text-center">
          Última sincronización: {effectiveLastSync.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
