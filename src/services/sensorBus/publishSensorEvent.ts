// Praeventio Guard — sensor-hook → sensorBus publish bridge (TODO.md §16.2.1).
//
// The 54 sensor hooks were islands: each fired its own toast/alert without
// correlation. This helper is the single, non-throwing entry point hooks use
// to publish their existing detections to the central bus so rules like
// "fall + inactivity + BLE disconnected → critical" can finally fire.
//
// Deliberately side-effectful (it writes to the singleton Zustand bus) — it
// lives NEXT TO the bus, not inside the pure correlation engine. The pure
// decision kernel is `manDownCorrelation.ts` (repo rule #9).

import { useSensorBus, type SensorKind, type SensorSeverity } from './sensorBus';
import { LOCAL_DEVICE_UID } from './manDownCorrelation';
import { randomId } from '../../utils/randomId';

export interface PublishSensorEventInput {
  kind: SensorKind;
  severity: SensorSeverity;
  /** Worker uid when an auth context is available; defaults to LOCAL_DEVICE_UID. */
  workerUid?: string | null;
  /** Project id when available; defaults to LOCAL_DEVICE_UID. */
  projectId?: string | null;
  value?: number;
  unit?: string;
  meta?: Record<string, unknown>;
}

/**
 * Publishes one sensor event to the singleton bus. NEVER throws: a corrupted
 * correlation layer must not break the local alarm/sensor flow that called us
 * (life-safety first — the bus only ADDS confidence, it is never a gate).
 */
export function publishSensorEvent(
  input: PublishSensorEventInput,
  at: Date = new Date(),
): void {
  try {
    useSensorBus.getState().publishReading(
      {
        readingId: randomId(),
        kind: input.kind,
        severity: input.severity,
        workerUid: input.workerUid ?? LOCAL_DEVICE_UID,
        projectId: input.projectId ?? LOCAL_DEVICE_UID,
        value: input.value,
        unit: input.unit,
        at: at.toISOString(),
        meta: input.meta,
      },
      at,
    );
  } catch {
    // Swallow on purpose — see contract above.
  }
}
