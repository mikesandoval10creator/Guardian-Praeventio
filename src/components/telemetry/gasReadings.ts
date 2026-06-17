import type { IoTEvent } from './IoTEventsFeed';
import { iotEventToMillis } from './IoTEventsFeed';
import type { GasTelemetryReading } from '../../services/workPermits/gasGate';

/**
 * Map the Telemetry page's real `telemetry_events` feed into the gasGate
 * engine's reading shape. This is the wire that lets the Telemetry atmosphere
 * panel reuse the SAME canonical gas thresholds (O₂ 19.5–23.5 %, LEL 5/10 %)
 * the confined-space work-permit gate already applies — no invented heuristic.
 *
 * Notes:
 * - Events with an unparseable timestamp are dropped: evaluateGasTelemetry's
 *   freshness check needs a finite epoch ms, so a null timestamp can never be
 *   counted as a (possibly stale) reading.
 * - Non-gas metrics are passed through unchanged; evaluateGasTelemetry filters
 *   them via classifyGasMetric, keeping a single source of truth for "what is
 *   a gas reading".
 * - Only REAL events belong here. Simulated demo events live in a separate
 *   array and must never reach this panel.
 */
export function selectGasReadings(
  events: IoTEvent[] | null | undefined,
): GasTelemetryReading[] {
  if (!events) return [];
  const out: GasTelemetryReading[] = [];
  for (const e of events) {
    const ms = iotEventToMillis(e.timestamp);
    if (ms == null) continue;
    out.push({
      metric: e.metric,
      value: e.value,
      unit: e.unit,
      timestampMs: ms,
      source: e.source,
    });
  }
  return out;
}
