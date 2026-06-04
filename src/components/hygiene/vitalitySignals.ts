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
