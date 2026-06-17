import { Wind, ShieldCheck, AlertTriangle, Gauge } from 'lucide-react';
import type { GasGateResult } from '../../services/workPermits/gasGate';
import {
  GAS_OXYGEN_MIN_PCT,
  GAS_OXYGEN_MAX_PCT,
  GAS_LEL_ADVISORY_PCT,
  GAS_LEL_BLOCKING_PCT,
} from '../../services/workPermits/criticalPermitValidators';

interface ZoneAtmospherePanelProps {
  /** Verdict from evaluateGasTelemetry over the zone's real telemetry_events. */
  gas: GasGateResult;
}

/**
 * Real zone-atmosphere readout for the Telemetry page. Replaces the former
 * "GamifiedHUD", whose HP/CO gauges were pure game state (no sensor) shown as
 * safety vitals. This panel renders ONLY real gas telemetry: O₂ and LEL from
 * the canonical gasGate engine (same thresholds as the confined-space permit
 * gate). When there is no fresh gas reading it says so honestly — it never
 * fabricates a number. Per project directive it only RECOMMENDS; it never
 * claims to block work, and the manual pre-entry measurement stays mandatory.
 */
export function ZoneAtmospherePanel({ gas }: ZoneAtmospherePanelProps) {
  const hasData = gas.freshReadingCount > 0;

  // O₂ value the gate is most concerned about: a low violation (asphyxiation)
  // dominates, then a high violation, else the lowest observed reading.
  const o2Low = gas.worstReadings.oxygenLow;
  const o2High = gas.worstReadings.oxygenHigh;
  const o2Danger =
    (!!o2Low && o2Low.value < GAS_OXYGEN_MIN_PCT) ||
    (!!o2High && o2High.value > GAS_OXYGEN_MAX_PCT);
  const o2Reading =
    o2Low && o2Low.value < GAS_OXYGEN_MIN_PCT
      ? o2Low
      : o2High && o2High.value > GAS_OXYGEN_MAX_PCT
        ? o2High
        : (o2Low ?? o2High); // engine sets both or neither today; ?? keeps it robust if that ever changes

  const lel = gas.worstReadings.lel;
  const lelBlocking = !!lel && lel.value >= GAS_LEL_BLOCKING_PCT;
  const lelAdvisory = !!lel && lel.value >= GAS_LEL_ADVISORY_PCT && !lelBlocking;

  const blocking = gas.reasons.some((r) => r.severity === 'blocking');
  const advisory = !blocking && gas.reasons.some((r) => r.severity === 'advisory');

  const bannerTone = blocking
    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
    : advisory
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
      : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';

  return (
    <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <Wind className="w-32 h-32 text-cyan-500" />
      </div>

      <div className="relative z-10 space-y-5">
        <div className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-cyan-400" />
          <h3 className="text-xs font-black text-zinc-300 uppercase tracking-widest">
            Atmósfera de la zona
          </h3>
          <span className="text-[10px] text-zinc-500 font-medium">
            telemetría real · ventana 15 min
          </span>
        </div>

        {!hasData ? (
          <div className="rounded-2xl border border-zinc-700/40 bg-zinc-950/50 p-5 text-center">
            <Wind className="w-7 h-7 text-zinc-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-zinc-400">Sin sensor de gas con lectura reciente</p>
            <p className="text-xs text-zinc-600 mt-1">
              {gas.note ??
                'No hay telemetría de gases reciente. La medición manual pre-ingreso sigue siendo obligatoria.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Oxygen */}
              {o2Reading && (
                <div className="rounded-2xl border border-white/5 bg-zinc-950/50 p-4">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Oxígeno (O₂)
                    </span>
                    <span className={`text-2xl font-black ${o2Danger ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {o2Reading.value}
                      <span className="text-xs text-zinc-500"> %</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    Rango seguro {GAS_OXYGEN_MIN_PCT}–{GAS_OXYGEN_MAX_PCT}%
                    {o2Reading.source ? ` · ${o2Reading.source}` : ''}
                  </p>
                </div>
              )}

              {/* LEL */}
              {lel && (
                <div className="rounded-2xl border border-white/5 bg-zinc-950/50 p-4">
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                      Límite explosivo (LEL)
                    </span>
                    <span
                      className={`text-2xl font-black ${
                        lelBlocking ? 'text-rose-400' : lelAdvisory ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {lel.value}
                      <span className="text-xs text-zinc-500"> %</span>
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-500">
                    Aviso ≥{GAS_LEL_ADVISORY_PCT}% · crítico ≥{GAS_LEL_BLOCKING_PCT}%
                    {lel.source ? ` · ${lel.source}` : ''}
                  </p>
                </div>
              )}
            </div>

            <div className={`rounded-xl border px-4 py-3 ${bannerTone}`}>
              <div className="flex items-start gap-2">
                {blocking || advisory ? (
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <div className="text-xs font-medium space-y-1">
                  {gas.reasons.length > 0 ? (
                    gas.reasons.map((r) => <p key={r.code}>{r.message}</p>)
                  ) : (
                    <p>Atmósfera dentro de rangos seguros según la telemetría de la zona.</p>
                  )}
                  <p className="text-[10px] opacity-80">
                    Recomendación informativa. La medición manual pre-ingreso sigue siendo obligatoria.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
