// Praeventio Guard — Bloque 4.1: Mantenimiento preventivo scheduler.
//
// Companion del horometroService. Cuando el flow ZK
// (horometroMaintenanceFlow.ts) detecta uno o varios cruces de umbral,
// llama aqui para materializar la(s) tarea(s) de mantenimiento
// preventivo. Cada tarea es persistida y referenciada por el nodo ZK
// `maintenance-task-created`.
//
// Diseño:
//   - El estado vive en Firestore (`MaintenanceTaskStore`).
//   - El motor (`buildMaintenanceTask`, `deriveStatusFromCompletion`)
//     es puro y testeable sin red.
//   - El servicio NO crea nodos ZK por si solo — eso es responsabilidad
//     del flow. Esto separa "scheduling de mantencion" de "trazado en
//     el grafo de conocimiento" y mantiene a maintenanceScheduler
//     reutilizable desde otros origenes (ej. inspeccion manual).
//
// ADR 0019: Firestore inyectado via interfaz minimal. Sin segundo
// backend.

import type { ThresholdCross } from '../horometro/horometroService.js';

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

export type MaintenanceTaskStatus =
  | 'open' // recien creada, sin asignar/empezar
  | 'scheduled' // agendada con fecha
  | 'in_progress' // tecnico empezo el trabajo
  | 'completed' // cerrada con firma
  | 'cancelled'; // cancelada (decision admin)

export interface MaintenanceTask {
  /** Determinista: `mtask-${equipmentId}-${cycleHours}-${multiplier}`. */
  id: string;
  /** Project / tenant. */
  projectId: string;
  /** Equipo afectado. */
  equipmentId: string;
  /** Tipo de equipo, copiado para queries sin join. */
  equipmentType: string;
  /** Ciclo del fabricante en horas (250, 500, 1000...). */
  thresholdHours: number;
  /** Horas a las que se gatillo el cruce (ej. 1000h = ciclo*multiplier). */
  triggeredAtHours: number;
  /** Multiplo del ciclo (k=1, 2, 3...). */
  multiplier: number;
  /** Severidad heredada del cycle.severity. */
  severity: ThresholdCross['severity'];
  /** Estado actual. */
  status: MaintenanceTaskStatus;
  /** ISO-8601 — cuando deberia ejecutarse (sugerido). */
  dueAtIso: string;
  /** ISO-8601 — creacion. */
  createdAt: string;
  /** UID del operador que creo (puede ser 'system' si fue automatico). */
  createdBy: string;
  /** Notas opcionales. */
  notes?: string;
  /** Datos de cierre (solo cuando status==='completed'). */
  completion?: MaintenanceTaskCompletion;
}

export interface MaintenanceTaskCompletion {
  /** Firebase Auth uid del tecnico que firmo. */
  completedByUid: string;
  /** ISO-8601 cierre. */
  completedAt: string;
  /** Notas tecnicas del cierre (recambios, observaciones). */
  notes: string;
  /** Hash de la firma biometrica WebAuthn (purpose='claim-signing'). */
  biometricSignatureHash?: string;
  /** Lectura del horometro al momento de cerrar. Permite trazar la
   *  proxima ventana de threshold. */
  horometroAtCompletion?: number;
}

// ────────────────────────────────────────────────────────────────────
// Errors
// ────────────────────────────────────────────────────────────────────

export class MaintenanceSchedulerError extends Error {
  constructor(
    public readonly code:
      | 'TASK_NOT_FOUND'
      | 'TASK_ALREADY_COMPLETED'
      | 'TASK_CANCELLED'
      | 'INVALID_TASK_STATE'
      | 'MISSING_FIELDS',
    msg: string,
  ) {
    super(`[${code}] ${msg}`);
    this.name = 'MaintenanceSchedulerError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Pure builders
// ────────────────────────────────────────────────────────────────────

/**
 * Compute the canonical task id. Idempotente — el mismo (equipo, ciclo,
 * multiplo) siempre da el mismo id, asi que reescribir es upsert
 * idempotente y NO crea duplicados si el flow corre dos veces.
 */
export function computeTaskId(
  equipmentId: string,
  cycleHours: number,
  multiplier: number,
): string {
  return `mtask-${equipmentId}-${cycleHours}h-k${multiplier}`;
}

export interface BuildMaintenanceTaskInput {
  projectId: string;
  equipmentId: string;
  equipmentType: string;
  cross: ThresholdCross;
  /** ISO-8601 cuando se gatilla (igual a now por convencion). */
  triggeredAtIso: string;
  /** ISO-8601 sugerido para due. Default: triggeredAt + 24h para low,
   *  + 12h medium, + 4h high, + 1h critical. */
  dueAtIso?: string;
  /** Quien creo. Default 'system' (flow automatico). */
  createdBy?: string;
  notes?: string;
}

const DUE_OFFSET_MS_BY_SEVERITY: Record<ThresholdCross['severity'], number> = {
  info: 7 * 86_400_000,
  low: 3 * 86_400_000,
  medium: 24 * 3_600_000,
  high: 4 * 3_600_000,
  critical: 1 * 3_600_000,
};

/**
 * Construye la entidad MaintenanceTask sin persistir. El caller
 * (scheduleMaintenanceTask) la guarda.
 */
export function buildMaintenanceTask(
  input: BuildMaintenanceTaskInput,
): MaintenanceTask {
  if (!input.projectId || !input.equipmentId || !input.equipmentType) {
    throw new MaintenanceSchedulerError(
      'MISSING_FIELDS',
      'projectId, equipmentId, equipmentType are required',
    );
  }
  const triggeredMs = Date.parse(input.triggeredAtIso);
  if (Number.isNaN(triggeredMs)) {
    throw new MaintenanceSchedulerError(
      'MISSING_FIELDS',
      `triggeredAtIso must be a valid ISO-8601 date, got '${input.triggeredAtIso}'`,
    );
  }
  const offset = DUE_OFFSET_MS_BY_SEVERITY[input.cross.severity];
  const dueAtIso =
    input.dueAtIso ?? new Date(triggeredMs + offset).toISOString();
  return {
    id: computeTaskId(
      input.equipmentId,
      input.cross.cycleHours,
      input.cross.multiplier,
    ),
    projectId: input.projectId,
    equipmentId: input.equipmentId,
    equipmentType: input.equipmentType,
    thresholdHours: input.cross.cycleHours,
    triggeredAtHours: input.cross.triggeredAtHours,
    multiplier: input.cross.multiplier,
    severity: input.cross.severity,
    status: 'open',
    dueAtIso,
    createdAt: input.triggeredAtIso,
    createdBy: input.createdBy ?? 'system',
    notes: input.notes,
  };
}

/**
 * Deriva el siguiente estado de una tarea segun su completion. Puro.
 */
export function deriveStatusFromCompletion(
  current: MaintenanceTaskStatus,
): MaintenanceTaskStatus {
  if (current === 'cancelled') {
    throw new MaintenanceSchedulerError(
      'TASK_CANCELLED',
      'cannot complete a cancelled task',
    );
  }
  if (current === 'completed') {
    throw new MaintenanceSchedulerError(
      'TASK_ALREADY_COMPLETED',
      'task already completed',
    );
  }
  return 'completed';
}

// ────────────────────────────────────────────────────────────────────
// Persistence DI
// ────────────────────────────────────────────────────────────────────

export interface MaintenanceTaskStore {
  saveTask(task: MaintenanceTask): Promise<void>;
  getTaskById(input: {
    tenantId: string;
    projectId: string;
    taskId: string;
  }): Promise<MaintenanceTask | null>;
  listActiveByProject(input: {
    tenantId: string;
    projectId: string;
    /** Opcional: solo este equipo. */
    equipmentId?: string;
    /** Por defecto: 'open' | 'scheduled' | 'in_progress'. */
    statuses?: MaintenanceTaskStatus[];
    /** Maximo de filas. Default 100. */
    limit?: number;
  }): Promise<MaintenanceTask[]>;
}

// ────────────────────────────────────────────────────────────────────
// Service API
// ────────────────────────────────────────────────────────────────────

export interface ScheduleMaintenanceTaskInput {
  tenantId: string;
  task: MaintenanceTask;
}

/**
 * Persiste una tarea recien construida. Idempotente — si ya existe una
 * tarea con el mismo id la sobreescribe (set merge:true del adapter).
 */
export async function scheduleMaintenanceTask(
  input: ScheduleMaintenanceTaskInput,
  store: MaintenanceTaskStore,
): Promise<MaintenanceTask> {
  await store.saveTask(input.task);
  return input.task;
}

export interface CompleteMaintenanceTaskInput {
  tenantId: string;
  projectId: string;
  taskId: string;
  completedByUid: string;
  notes: string;
  biometricSignatureHash?: string;
  horometroAtCompletion?: number;
  /** Override now para tests. */
  now?: () => Date;
}

export async function completeMaintenanceTask(
  input: CompleteMaintenanceTaskInput,
  store: MaintenanceTaskStore,
): Promise<MaintenanceTask> {
  const existing = await store.getTaskById({
    tenantId: input.tenantId,
    projectId: input.projectId,
    taskId: input.taskId,
  });
  if (!existing) {
    throw new MaintenanceSchedulerError(
      'TASK_NOT_FOUND',
      `task '${input.taskId}' not found in project '${input.projectId}'`,
    );
  }
  const nextStatus = deriveStatusFromCompletion(existing.status);
  const now = (input.now ?? (() => new Date()))();
  const completion: MaintenanceTaskCompletion = {
    completedByUid: input.completedByUid,
    completedAt: now.toISOString(),
    notes: input.notes,
    biometricSignatureHash: input.biometricSignatureHash,
    horometroAtCompletion: input.horometroAtCompletion,
  };
  const updated: MaintenanceTask = {
    ...existing,
    status: nextStatus,
    completion,
  };
  await store.saveTask(updated);
  return updated;
}

export interface GetActiveTasksByProjectInput {
  tenantId: string;
  projectId: string;
  equipmentId?: string;
  limit?: number;
}

export async function getActiveTasksByProject(
  input: GetActiveTasksByProjectInput,
  store: MaintenanceTaskStore,
): Promise<MaintenanceTask[]> {
  return store.listActiveByProject({
    tenantId: input.tenantId,
    projectId: input.projectId,
    equipmentId: input.equipmentId,
    statuses: ['open', 'scheduled', 'in_progress'],
    limit: input.limit ?? 100,
  });
}
