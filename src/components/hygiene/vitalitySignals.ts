// SPDX-License-Identifier: MIT
//
// ADR 0012 — Praeventio NUNCA diagnostica.
//
// Pure signal→recommendation logic for VitalityMonitor, extracted so it can be
// unit-tested without importing Firebase/React contexts. It observes
// physiological/environmental SIGNALS (heart rate, heat, manual load) and emits
// NON-diagnostic safety RECOMMENDATIONS (pause, hydrate, seek medical
// evaluation). It must NEVER name a pathology or assign a clinical code (e.g.
// CIE-10) — that is the treating physician's exclusive role.

export interface SafetyRecommendation {
  /** Observed signal — descriptive, not a diagnosis. */
  signal: string;
  severity: 'low' | 'medium' | 'high';
  /** Suggested self-care / escalation action. */
  recommendation: string;
}

export interface VitalitySignalInput {
  hrSustainedHigh: boolean; // HR > 120 bpm sustained ~5min
  hrIrregular: boolean;
  stepsLowAfterShift: boolean;
  temperature: number;
  toolWeight: number;
}

export function evaluateSafetyRecommendations(
  input: VitalitySignalInput,
): SafetyRecommendation[] {
  const out: SafetyRecommendation[] = [];
  if (input.hrSustainedHigh && input.toolWeight > 5) {
    out.push({
      signal: 'Frecuencia cardíaca alta sostenida con carga manual',
      severity: 'high',
      recommendation:
        'Haz una pausa e hidrátate ahora. Si el malestar persiste, avisa a tu supervisor y busca atención.',
    });
  }
  if (input.stepsLowAfterShift && input.temperature >= 30) {
    out.push({
      signal: `Baja actividad con calor elevado (${input.temperature}°C)`,
      severity: 'high',
      recommendation: 'Busca sombra e hidrátate. Avisa a tu supervisor.',
    });
  }
  if (input.hrIrregular) {
    out.push({
      signal: 'Variabilidad alta de frecuencia cardíaca',
      severity: 'medium',
      recommendation: 'Toma una pausa. Si tienes mareo o malestar, busca evaluación médica.',
    });
  }
  return out;
}

export interface VitalityIndexInput {
  /** Entered ambient temperature (°C). */
  temperature: number;
  /** Entered altitude (m). */
  altitude: number;
  /** Entered manual load (kg). */
  toolWeight: number;
  /** Real telemetry: HR > 120 bpm sustained ~5 min. */
  hrSustainedHigh: boolean;
  /** Real telemetry: high HR variability. */
  hrIrregular: boolean;
  /** Real telemetry: low step count after shift. */
  stepsLowAfterShift: boolean;
}

/**
 * Physical-load index (0–100, higher = lower load / more headroom) derived
 * DETERMINISTICALLY from the CURRENT signals: the entered ambient conditions
 * (temp/altitude/load) plus real heart-rate/activity telemetry when present.
 *
 * This replaces VitalityMonitor's previous `setInterval` "battery" that drained
 * a fabricated 100→0 counter over a simulated shift ("accelerated for demo") and
 * presented it as a live reading. There is no real "vitality drain" sensor; the
 * honest value is a snapshot of how demanding the current conditions are. It is
 * a safety signal, NOT a diagnosis (ADR 0012).
 */
export function computeVitalityIndex(input: VitalityIndexInput): number {
  let score = 100;
  // Ambient load (entered conditions).
  if (input.temperature > 30) score -= Math.min(30, (input.temperature - 30) * 3);
  if (input.altitude > 2500) score -= Math.min(20, (input.altitude - 2500) / 100);
  if (input.toolWeight > 10) score -= Math.min(20, (input.toolWeight - 10) * 2);
  // Physiological signals (real telemetry when available; false when absent).
  if (input.hrSustainedHigh) score -= 25;
  if (input.hrIrregular) score -= 15;
  if (input.stepsLowAfterShift) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}
