import { Activity, Watch, HeartPulse, Loader2, Smartphone } from 'lucide-react';

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
 * buttons. The actual Bluetooth and OAuth dance lives in
 * Telemetry.tsx; this component only renders.
 */
export function WearablesPanel({
  fitnessData,
  fitTokens,
  isConnecting,
  onConnectBluetooth,
  onConnectGoogleFit,
}: WearablesPanelProps) {
  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
          <Watch className="w-4 h-4 text-emerald-500" />
          Wearables (BLE / Fit)
        </h3>
        {fitTokens && (
          <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest border border-emerald-500/20">
            Conectado
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
          <HeartPulse className={`w-8 h-8 ${fitnessData.heartRate && fitnessData.heartRate > 100 ? 'text-rose-500 animate-pulse' : 'text-emerald-500'}`} />
          <div>
            <p className="text-2xl font-black text-white">{fitnessData.heartRate || '--'} <span className="text-sm">bpm</span></p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ritmo Cardíaco</p>
          </div>
        </div>
        <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
          <Activity className="w-8 h-8 text-blue-400" />
          <div>
            <p className="text-2xl font-black text-white">{fitnessData.steps ? fitnessData.steps.toLocaleString() : '--'}</p>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Pasos</p>
          </div>
        </div>
      </div>

      {!fitTokens && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onConnectBluetooth}
            disabled={isConnecting}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />}
            Bluetooth
          </button>
          <button
            onClick={onConnectGoogleFit}
            disabled={isConnecting}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Watch className="w-4 h-4" />}
            Google Fit
          </button>
        </div>
      )}
      {fitnessData.lastSync && (
        <p className="text-[10px] text-zinc-500 text-center">
          Última sincronización: {fitnessData.lastSync.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
