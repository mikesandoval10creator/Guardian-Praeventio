// Praeventio Guard — Sprint 39 Fase G.8: Registro de exposición ocupacional.
//
// Cierra: Documento usuario "Recomendaciones nuevas §36, §37, §38, §39, §40, §41"
//         Plan integral Top 15 #8
//
// Registrar exposición a agentes físicos/químicos/biológicos por trabajador
// y comparar con umbrales normativos (DS 594 art. 60+).

export type ExposureAgent =
  | 'noise'
  | 'silica'
  | 'dust'
  | 'heat'
  | 'cold'
  | 'vibration'
  | 'uv_radiation'
  | 'chemical'
  | 'biohazard';

export interface ExposureMeasurement {
  id: string;
  workerUid: string;
  agent: ExposureAgent;
  /** Valor numérico de la medición. */
  value: number;
  unit: string;
  /** Donde se tomó la medición. */
  location: string;
  /** Duración de la exposición (h). */
  durationHours: number;
  takenAt: string;
  /** UID del técnico/medidor. */
  measuredByUid: string;
}

/**
 * Umbrales normativos chilenos por agente (DS 594 + protocolos MINSAL).
 * value es el LÍMITE MÁXIMO permitido en jornada 8h.
 */
export const REGULATORY_LIMITS: Record<ExposureAgent, { value: number; unit: string; norm: string }> = {
  noise: { value: 85, unit: 'dB(A)', norm: 'DS 594 art. 75 (8h)' },
  silica: { value: 0.025, unit: 'mg/m³', norm: 'DS 594 art. 60 sílice respirable' },
  dust: { value: 5, unit: 'mg/m³', norm: 'DS 594 art. 60 polvo no específico' },
  heat: { value: 27, unit: '°C WBGT', norm: 'DS 594 trabajo continuo moderado' },
  cold: { value: -15, unit: '°C', norm: 'DS 594 art. 92 frío extremo' },
  vibration: { value: 5, unit: 'm/s² (8h)', norm: 'ISO 5349 mano-brazo' },
  uv_radiation: { value: 3, unit: 'UV index', norm: 'Protocolo MINSAL UV ocupacional' },
  chemical: { value: 0, unit: 'TLV', norm: 'Consultar TLV-ACGIH del químico' },
  biohazard: { value: 0, unit: 'NA', norm: 'Protocolo MINSAL agentes biológicos' },
};

export interface ExposureViolation {
  measurement: ExposureMeasurement;
  limit: number;
  unit: string;
  excessPercent: number;
  norm: string;
  severity: 'warning' | 'critical';
}

export function compareToLimit(m: ExposureMeasurement): ExposureViolation | null {
  const limit = REGULATORY_LIMITS[m.agent];
  if (limit.value === 0) return null; // requiere TLV específico
  if (m.value <= limit.value) return null;
  const excess = ((m.value - limit.value) / limit.value) * 100;
  return {
    measurement: m,
    limit: limit.value,
    unit: limit.unit,
    excessPercent: Math.round(excess),
    norm: limit.norm,
    severity: excess > 50 ? 'critical' : 'warning',
  };
}

export interface ExposureMap {
  workerUid: string;
  agents: Array<{ agent: ExposureAgent; measurementCount: number; lastValue: number; lastTakenAt: string }>;
}

export function buildExposureMap(measurements: ExposureMeasurement[]): ExposureMap[] {
  const byWorker = new Map<string, Map<ExposureAgent, ExposureMeasurement[]>>();
  for (const m of measurements) {
    if (!byWorker.has(m.workerUid)) byWorker.set(m.workerUid, new Map());
    const inner = byWorker.get(m.workerUid)!;
    if (!inner.has(m.agent)) inner.set(m.agent, []);
    inner.get(m.agent)!.push(m);
  }
  const result: ExposureMap[] = [];
  for (const [uid, agentMap] of byWorker.entries()) {
    const agents: ExposureMap['agents'] = [];
    for (const [agent, ms] of agentMap.entries()) {
      const sorted = ms.slice().sort((a, b) => a.takenAt.localeCompare(b.takenAt));
      const last = sorted[sorted.length - 1];
      agents.push({
        agent,
        measurementCount: ms.length,
        lastValue: last.value,
        lastTakenAt: last.takenAt,
      });
    }
    result.push({ workerUid: uid, agents });
  }
  return result;
}
