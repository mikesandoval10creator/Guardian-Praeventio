import type { IoTEvent } from './IoTEventsFeed';

/**
 * Map the Gemini `generateRealisticIoTEvent` sensor type to a Spanish metric
 * label. The Gemini JSON schema (src/services/gemini/predictions.ts) emits
 * `type ∈ {temperature, gas, noise, vibration, biometric}` plus `deviceId`,
 * `value`, `unit`, `status`, `message` — it does NOT emit `source` or
 * `metric`, and never emits `wearable`. Reading those non-existent fields was
 * the bug this helper fixes (every demo card showed "Sensor simulado /
 * lectura" and biometric events were mislabeled as machinery).
 */
const METRIC_LABEL: Record<string, string> = {
  temperature: 'Temperatura',
  gas: 'Concentración de gas',
  noise: 'Nivel de ruido',
  vibration: 'Vibración',
  biometric: 'Frecuencia cardíaca',
};

/**
 * Build a clearly-labeled, demo-only IoTEvent from the (untyped) Gemini
 * response. Pure: caller supplies the id and timestamp so it stays
 * deterministic and testable. The returned event carries `simulated: true`
 * and is never persisted to `telemetry_events` nor fed to any alerting path.
 */
export function buildSimulatedIoTEvent(raw: unknown, id: string, nowMs: number): IoTEvent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const geminiType = typeof r.type === 'string' ? r.type : '';
  const status: IoTEvent['status'] =
    r.status === 'critical' || r.status === 'warning' ? r.status : 'normal';
  const message = typeof r.message === 'string' && r.message.trim() ? r.message.trim() : '';

  return {
    id,
    // The only Gemini sensor type that maps to a wearable is `biometric`;
    // everything else is machinery/environmental.
    type: geminiType === 'biometric' ? 'wearable' : 'machinery',
    source: typeof r.deviceId === 'string' && r.deviceId.trim() ? r.deviceId.trim() : 'Sensor simulado',
    metric: METRIC_LABEL[geminiType] ?? (message || 'Lectura'),
    value: typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : 0,
    unit: typeof r.unit === 'string' ? r.unit : '',
    timestamp: nowMs,
    status,
    simulated: true,
  };
}
