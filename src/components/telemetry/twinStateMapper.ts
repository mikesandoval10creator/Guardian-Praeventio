import type { WorkerData, MachineryData } from './DigitalTwin';

export interface IoTEventLite {
  type: 'wearable' | 'machinery';
  source: string;
  metric: string;
  value: number;
  status: 'normal' | 'warning' | 'critical';
}

export const DEFAULT_WORKERS: WorkerData[] = [
  { id: 'W-01', position: [-2, 0, 2], status: 'normal' },
  { id: 'W-02', position: [3, 0, -1], status: 'normal' },
  { id: 'W-03', position: [0, 0, 4], status: 'normal' },
  { id: 'W-04', position: [-4, 0, -3], status: 'normal' },
];

export const DEFAULT_MACHINERY: MachineryData[] = [
  { id: 'M-01', type: 'truck', position: [5, 0, 5], status: 'normal' },
  { id: 'M-02', type: 'crane', position: [-5, 0, 0], status: 'normal' },
];

/**
 * Pure helper: maps a list of IoT events onto fresh worker/machinery
 * arrays for the Digital Twin. The function is total and idempotent —
 * given the same events list it produces the same output.
 *
 * Rules preserved from the original Telemetry.tsx behaviour:
 *  - status only escalates: critical wins over warning wins over normal.
 *  - a warning replaces normal but never overrides a critical.
 *  - if the metric mentions "caída" OR "ritmo" with value > 160, the
 *    worker is flagged as fallen.
 */
export function mapIoTEventsToTwinState(events: IoTEventLite[] | null | undefined): {
  workers: WorkerData[];
  machinery: MachineryData[];
} {
  const workers: WorkerData[] = DEFAULT_WORKERS.map((w) => ({ ...w }));
  const machinery: MachineryData[] = DEFAULT_MACHINERY.map((m) => ({ ...m }));

  if (!events || events.length === 0) {
    return { workers, machinery };
  }

  events.forEach((event) => {
    if (event.type === 'wearable') {
      const workerIndex = parseInt(event.source.replace(/\D/g, '')) % workers.length || 0;
      const worker = workers[workerIndex];

      if (event.status === 'critical' || (event.status === 'warning' && worker.status === 'normal')) {
        worker.status = event.status;
        const metric = String(event.metric || '').toLowerCase();
        if (metric.includes('caída') || (metric.includes('ritmo') && event.value > 160)) {
          worker.isFallen = true;
        }
      }
    } else if (event.type === 'machinery') {
      const machIndex = parseInt(event.source.replace(/\D/g, '')) % machinery.length || 0;
      const mach = machinery[machIndex];
      if (event.status === 'critical' || (event.status === 'warning' && mach.status === 'normal')) {
        mach.status = event.status;
      }
    }
  });

  return { workers, machinery };
}
