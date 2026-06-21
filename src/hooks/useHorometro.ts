// Praeventio Guard — Bloque 4.1: useHorometro client hook.
//
// Wraps the three endpoints of `src/server/routes/horometro.ts`:
//   • recordHorometroReading        — POST   /api/sprint-k/:projectId/horometro/reading
//   • listMaintenanceTasks          — GET    /api/sprint-k/:projectId/horometro/equipment/:eqId/maintenance-tasks
//   • completeMaintenanceTask       — POST   /api/sprint-k/:projectId/horometro/maintenance-task/:taskId/complete
//
// Founder directive — NUNCA bloquear maquinaria:
//   El flow nunca devuelve un 409/403 con la idea de "no operes". Las
//   recomendaciones viven en el grafo ZK (tareas con severidad). La UI
//   las surface como banners; el operador sigue siendo el que decide.

import { apiAuthHeaders } from '../lib/apiAuth';
import type {
  HorometroReading,
  HorometroSource,
} from '../services/horometro/horometroService';
import type {
  MaintenanceTask,
} from '../services/maintenance/maintenanceScheduler';
import type {
  OnHorometroReadingResult,
} from '../services/zettelkasten/flows/horometroMaintenanceFlow';
import type {
  HorometerStatus,
  MachineHorometer,
  MaintenancePolicy,
} from '../services/maintenance/horometerEngine';

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
      ...(await apiAuthHeaders()),
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      code?: string;
    };
    const msg = body.message ?? body.error ?? `http_${res.status}`;
    throw new Error(body.code ? `${body.code}: ${msg}` : msg);
  }
  return (await res.json()) as T;
}

// ── 1. record reading ───────────────────────────────────────────────

export interface RecordHorometroReadingInput {
  equipmentId: string;
  hours: number;
  source: HorometroSource;
  notes?: string;
}

export interface RecordHorometroReadingResponse {
  reading: HorometroReading;
  flow: OnHorometroReadingResult;
}

export async function recordHorometroReading(
  projectId: string,
  input: RecordHorometroReadingInput,
  idempotencyKey?: string,
): Promise<RecordHorometroReadingResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/horometro/reading`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    },
  );
  return json<RecordHorometroReadingResponse>(res);
}

// ── 2. list maintenance tasks ───────────────────────────────────────

export interface ListMaintenanceTasksResponse {
  tasks: MaintenanceTask[];
  currentHours: number;
}

export async function listMaintenanceTasks(
  projectId: string,
  equipmentId: string,
): Promise<ListMaintenanceTasksResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/horometro/equipment/` +
      `${encodeURIComponent(equipmentId)}/maintenance-tasks`,
    { method: 'GET' },
  );
  return json<ListMaintenanceTasksResponse>(res);
}

// ── 2b. horometer status (state of one machine) ─────────────────────

export interface HorometerStatusResponse {
  horometer: MachineHorometer;
  policy: MaintenancePolicy;
  status: HorometerStatus;
}

export async function getHorometerStatus(
  projectId: string,
  equipmentId: string,
): Promise<HorometerStatusResponse> {
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/horometro/equipment/` +
      `${encodeURIComponent(equipmentId)}/status`,
    { method: 'GET' },
  );
  return json<HorometerStatusResponse>(res);
}

// ── 3. complete maintenance task ────────────────────────────────────

export interface CompleteMaintenanceTaskInput {
  notes: string;
  /** Hash hex de la firma biometrica (WebAuthn purpose 'claim-signing'). */
  biometricSignatureHash?: string;
  /** Lectura final del horometro al cierre — facilita siguiente ventana. */
  horometroAtCompletion?: number;
}

export interface CompleteMaintenanceTaskResponse {
  task: MaintenanceTask;
  flow: OnHorometroReadingResult;
}

export async function completeMaintenanceTaskRequest(
  projectId: string,
  taskId: string,
  input: CompleteMaintenanceTaskInput,
  idempotencyKey?: string,
): Promise<CompleteMaintenanceTaskResponse> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await authedFetch(
    `/api/sprint-k/${encodeURIComponent(projectId)}/horometro/maintenance-task/` +
      `${encodeURIComponent(taskId)}/complete`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    },
  );
  return json<CompleteMaintenanceTaskResponse>(res);
}
