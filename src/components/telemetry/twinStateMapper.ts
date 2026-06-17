import type { WorkerData, MachineryData } from './DigitalTwin';

export interface IoTEventLite {
  type: 'wearable' | 'machinery';
  source: string;
  metric: string;
  value: number;
  status: 'normal' | 'warning' | 'critical';
}

// Schematic layout slots for the 3D Digital Twin. These are NOT GPS positions:
// IoT events carry no location, and the twin is a schematic scene. An entity is
// placed in a slot ONLY because a REAL telemetry event referenced its source —
// we never seed a phantom roster. Consumers that need REAL worker positions
// (e.g. evacuation routing) must NOT treat these schematic slots as GPS fixes.
const WORKER_SLOTS: ReadonlyArray<[number, number, number]> = [
  [-2, 0, 2], [3, 0, -1], [0, 0, 4], [-4, 0, -3],
  [2, 0, 3], [-3, 0, 1], [4, 0, -2], [1, 0, -4],
];
const MACHINERY_SLOTS: ReadonlyArray<[number, number, number]> = [
  [5, 0, 5], [-5, 0, 0], [5, 0, -5], [-5, 0, 5],
];

function slot(
  slots: ReadonlyArray<[number, number, number]>,
  index: number,
): [number, number, number] {
  const [x, y, z] = slots[index % slots.length];
  return [x, y, z];
}

/**
 * Pure helper: maps a list of REAL IoT events onto Digital-Twin entities.
 *
 * Honesty contract (no fabricated roster):
 *  - No events → EMPTY arrays. The twin shows nothing rather than inventing a
 *    fleet. Previously this seeded 4 phantom workers + 2 machines that were
 *    persisted to `telemetry_state` and silently fed the evacuation route.
 *  - One entity per DISTINCT real event `source`, in first-seen order. The
 *    entity exists only because a real wearable/machine reported.
 *  - Position is a SCHEMATIC layout slot (see WORKER_SLOTS), not GPS — events
 *    carry no location. Machine `type` is unknown from telemetry, so it is
 *    reported as the neutral `'truck'`; the twin does not claim a crane it
 *    cannot know.
 *  - status only escalates: critical > warning > normal. `isFallen` when the
 *    metric mentions "caída" OR ("ritmo" with value > 160).
 *
 * The function is total and idempotent.
 */
export function mapIoTEventsToTwinState(events: IoTEventLite[] | null | undefined): {
  workers: WorkerData[];
  machinery: MachineryData[];
} {
  const workers: WorkerData[] = [];
  const machinery: MachineryData[] = [];

  if (!events || events.length === 0) {
    // Honest empty: no real telemetry → no entities (never a phantom roster).
    return { workers, machinery };
  }

  const workerBySource = new Map<string, WorkerData>();
  const machineryBySource = new Map<string, MachineryData>();

  events.forEach((event) => {
    if (event.type === 'wearable') {
      let worker = workerBySource.get(event.source);
      if (!worker) {
        worker = {
          id: event.source,
          position: slot(WORKER_SLOTS, workerBySource.size),
          status: 'normal',
        };
        workerBySource.set(event.source, worker);
        workers.push(worker);
      }
      if (
        event.status === 'critical' ||
        (event.status === 'warning' && worker.status === 'normal')
      ) {
        worker.status = event.status;
        const metric = String(event.metric || '').toLowerCase();
        if (metric.includes('caída') || (metric.includes('ritmo') && event.value > 160)) {
          worker.isFallen = true;
        }
      }
    } else if (event.type === 'machinery') {
      let mach = machineryBySource.get(event.source);
      if (!mach) {
        mach = {
          id: event.source,
          type: 'truck', // unknown from telemetry — neutral default, not fabricated as crane
          position: slot(MACHINERY_SLOTS, machineryBySource.size),
          status: 'normal',
        };
        machineryBySource.set(event.source, mach);
        machinery.push(mach);
      }
      if (
        event.status === 'critical' ||
        (event.status === 'warning' && mach.status === 'normal')
      ) {
        mach.status = event.status;
      }
    }
  });

  return { workers, machinery };
}
