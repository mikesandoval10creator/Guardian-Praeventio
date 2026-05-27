// Praeventio Guard — Bloque 4.1: Zettelkasten Flagship 4.1 flow.
//
// Cierra: "Plan Bloque 4.1 — Horometro -> Mantenimiento Preventivo,
// primera demostracion del poder ZK" (founder).
//
// Este es el ORCHESTRATOR de la cadena ZK. Cuando el worker reporta una
// lectura del horometro via QR + entry, este flow:
//
//   1. Crea un nodo ZK `horometro-reading` (lectura puntual).
//   2. Llama `checkThresholdsCrossed(...)` para detectar cruces.
//   3. Por cada cruce → emite un nodo `maintenance-threshold-reached`
//      y materializa la tarea preventiva via `maintenanceScheduler`,
//      emitiendo tambien `maintenance-task-created`.
//   4. Cuando el tecnico completa la tarea (via route + form), el flow
//      emite `maintenance-task-completed` y queda servido para que un
//      sistema externo (equipmentQrService) restablezca el status.
//
// Las aristas entre los nodos se persisten via `edges.ts/createEdge`
// con tipo `causes` (chain temporal) y `references` (link al equipo).
// La cadena resultante es:
//
//   horometro-reading  --causes-->  maintenance-threshold-reached
//                                       --causes-->  maintenance-task-created
//                                                       --causes-->  maintenance-task-completed
//
//   Cada nodo tambien lleva edge --references--> al nodo del equipo
//   (assetsFaenaNodeRegistry: asset-compresor / asset-generador / ...).
//
// El flow es PURO en su nucleo (`buildChainSpecs`) — no escribe a
// Firestore directamente. Devuelve specs que el caller (route handler)
// persiste via writeNodes + createEdge + maintenanceScheduler. Esto
// permite tests deterministas sin red.

import type { RiskNodePayload, RiskNodeSeverity } from '../types.js';
import type {
  HorometroReading,
  ThresholdCross,
} from '../../horometro/horometroService.js';
import { checkThresholdsCrossed } from '../../horometro/horometroService.js';
import {
  buildMaintenanceTask,
  type MaintenanceTask,
  type MaintenanceTaskCompletion,
} from '../../maintenance/maintenanceScheduler.js';
import type { EdgeType } from '../edges.js';

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

/**
 * Especificacion de una arista a materializar tras escribir los nodos.
 * El caller (route handler) toma la lista y llama `createEdge` por cada
 * entrada. Mantenemos los specs puros para que los tests inspeccionen
 * la estructura sin tocar Firestore.
 */
export interface EdgeSpec {
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  /** Razon legible para auditoria. */
  rationale: string;
}

/**
 * Spec completo de la cadena horometro → mantenimiento. Devuelto por
 * `buildChainSpecs` y consumido por `onHorometroReading` (que escribe).
 */
export interface ChainSpec {
  /** Nodo `horometro-reading` siempre presente. */
  readingNode: RiskNodePayload;
  /** Determinista para que el flow pueda referirse a el sin escribir aun. */
  readingNodeId: string;
  /** Por cada cruce, 2 nodos (threshold + task) + 1 task spec. */
  steps: ReadonlyArray<ChainStep>;
  /** Aristas a materializar despues de writeNodes(). */
  edges: ReadonlyArray<EdgeSpec>;
}

export interface ChainStep {
  cross: ThresholdCross;
  thresholdNode: RiskNodePayload;
  thresholdNodeId: string;
  taskCreatedNode: RiskNodePayload;
  taskCreatedNodeId: string;
  task: MaintenanceTask;
}

// ────────────────────────────────────────────────────────────────────
// Deterministic id helpers
//
// El writeNodes layer ya tiene `nodeIdFor(payload, projectId)` que es
// SHA-256 truncado. Pero ese id solo se conoce DESPUES de poder
// hashear, y para construir las aristas necesitamos un id que el flow
// pueda calcular pre-write. Solucion: id determinista propio
// (`horoNodeId`) que se inyecta como `metadata.zkLocalId` para que
// downstream consumers (UI / tests) puedan trazar. La identidad
// "canonica" del nodo en Firestore sigue siendo `idempotencyKey` de
// `writeNode.ts` — los ids del flow solo se usan para los specs
// (edges, references) y son redundantes pero estables.
// ────────────────────────────────────────────────────────────────────

function readingNodeId(equipmentId: string, hours: number, recordedAt: string): string {
  return `hr-${equipmentId}-${hours}-${Date.parse(recordedAt) || 0}`;
}

function thresholdNodeId(equipmentId: string, cycleHours: number, multiplier: number): string {
  return `thr-${equipmentId}-${cycleHours}h-k${multiplier}`;
}

function taskCreatedNodeId(equipmentId: string, cycleHours: number, multiplier: number): string {
  return `tcr-${equipmentId}-${cycleHours}h-k${multiplier}`;
}

function taskCompletedNodeId(equipmentId: string, cycleHours: number, multiplier: number, completedAt: string): string {
  return `tcp-${equipmentId}-${cycleHours}h-k${multiplier}-${Date.parse(completedAt) || 0}`;
}

// ────────────────────────────────────────────────────────────────────
// Node factories (pure — return RiskNodePayload, do NOT write)
// ────────────────────────────────────────────────────────────────────

export interface CreateHorometroReadingNodeInput {
  projectId: string;
  reading: HorometroReading;
  equipmentType: string;
}

/**
 * NodeFactory 1: lectura puntual del horometro.
 */
export function createHorometroReadingNode(
  input: CreateHorometroReadingNodeInput,
): RiskNodePayload {
  const { reading, equipmentType } = input;
  return {
    type: 'horometro-reading',
    title: `Horometro ${reading.equipmentId} · ${reading.hours}h`,
    description:
      `Lectura del horometro del equipo ${reading.equipmentId} (${equipmentType}). ` +
      `Reportada via ${reading.source} el ${reading.recordedAt}. ` +
      `Horas acumuladas: ${reading.hours}h.`,
    severity: 'info',
    metadata: {
      equipmentId: reading.equipmentId,
      equipmentType,
      hours: reading.hours,
      source: reading.source,
      reportedByUid: reading.reportedByUid ?? null,
      recordedAt: reading.recordedAt,
      projectId: input.projectId,
      zkLocalId: readingNodeId(reading.equipmentId, reading.hours, reading.recordedAt),
    },
    connections: [input.projectId, reading.equipmentId],
    references: [
      `asset-${equipmentTypeToAssetSlug(equipmentType)}`,
      'horometro-reading',
    ],
  };
}

export interface CreateMaintenanceThresholdNodeInput {
  projectId: string;
  equipmentId: string;
  equipmentType: string;
  cross: ThresholdCross;
  readingNodeLocalId: string;
  /** ISO-8601 cuando se detecto el cruce. */
  detectedAt: string;
}

/**
 * NodeFactory 2: umbral alcanzado (gatillo de mantenimiento).
 */
export function createMaintenanceThresholdNode(
  input: CreateMaintenanceThresholdNodeInput,
): RiskNodePayload {
  const { cross } = input;
  return {
    type: 'maintenance-threshold-reached',
    title:
      `Umbral mantencion ${input.equipmentId} · ${cross.triggeredAtHours}h ` +
      `(ciclo ${cross.cycleHours}h x${cross.multiplier})`,
    description:
      `El equipo ${input.equipmentId} (${input.equipmentType}) cruzo el umbral ` +
      `${cross.triggeredAtHours}h (multiplo ${cross.multiplier} del ciclo ` +
      `${cross.cycleHours}h definido por fabricante). Severidad: ${cross.severity}.`,
    severity: cross.severity,
    metadata: {
      equipmentId: input.equipmentId,
      equipmentType: input.equipmentType,
      cycleHours: cross.cycleHours,
      multiplier: cross.multiplier,
      triggeredAtHours: cross.triggeredAtHours,
      detectedAt: input.detectedAt,
      projectId: input.projectId,
      zkLocalId: thresholdNodeId(input.equipmentId, cross.cycleHours, cross.multiplier),
      sourceReadingNodeId: input.readingNodeLocalId,
    },
    connections: [input.projectId, input.equipmentId],
    references: [
      `asset-${equipmentTypeToAssetSlug(input.equipmentType)}`,
      'maintenance-threshold-reached',
    ],
  };
}

export interface CreateMaintenanceTaskNodeInput {
  projectId: string;
  task: MaintenanceTask;
  thresholdNodeLocalId: string;
}

/**
 * NodeFactory 3: tarea preventiva creada (representacion en el grafo).
 */
export function createMaintenanceTaskNode(
  input: CreateMaintenanceTaskNodeInput,
): RiskNodePayload {
  const { task } = input;
  return {
    type: 'maintenance-task-created',
    title: `Tarea mantencion ${task.equipmentId} · ${task.thresholdHours}h x${task.multiplier}`,
    description:
      `Tarea de mantencion preventiva creada automaticamente para el equipo ` +
      `${task.equipmentId} (${task.equipmentType}) tras cruzar el umbral ` +
      `${task.triggeredAtHours}h. Severidad: ${task.severity}. ` +
      `Vence: ${task.dueAtIso}. Estado inicial: ${task.status}.`,
    severity: task.severity,
    metadata: {
      taskId: task.id,
      equipmentId: task.equipmentId,
      equipmentType: task.equipmentType,
      thresholdHours: task.thresholdHours,
      triggeredAtHours: task.triggeredAtHours,
      multiplier: task.multiplier,
      dueAtIso: task.dueAtIso,
      createdAt: task.createdAt,
      createdBy: task.createdBy,
      projectId: input.projectId,
      zkLocalId: taskCreatedNodeId(task.equipmentId, task.thresholdHours, task.multiplier),
      sourceThresholdNodeId: input.thresholdNodeLocalId,
    },
    connections: [input.projectId, task.equipmentId, task.id],
    references: [
      `asset-${equipmentTypeToAssetSlug(task.equipmentType)}`,
      'maintenance-task-created',
    ],
  };
}

export interface CreateMaintenanceCompletedNodeInput {
  projectId: string;
  task: MaintenanceTask;
  completion: MaintenanceTaskCompletion;
  /** ID local del nodo `maintenance-task-created` para enlazar. */
  taskCreatedNodeLocalId: string;
}

/**
 * NodeFactory 4: tarea completada (cierre de la cadena).
 */
export function createMaintenanceCompletedNode(
  input: CreateMaintenanceCompletedNodeInput,
): RiskNodePayload {
  const { task, completion } = input;
  return {
    type: 'maintenance-task-completed',
    title: `Mantencion completada ${task.equipmentId} · ${task.thresholdHours}h`,
    description:
      `Mantencion preventiva del equipo ${task.equipmentId} (${task.equipmentType}) ` +
      `completada por ${completion.completedByUid} el ${completion.completedAt}. ` +
      `Ciclo ${task.thresholdHours}h x${task.multiplier} cerrado. ` +
      (completion.horometroAtCompletion != null
        ? `Horometro al cierre: ${completion.horometroAtCompletion}h. `
        : '') +
      (completion.biometricSignatureHash
        ? `Firma biometrica WebAuthn presente. `
        : ''),
    severity: 'info',
    metadata: {
      taskId: task.id,
      equipmentId: task.equipmentId,
      equipmentType: task.equipmentType,
      thresholdHours: task.thresholdHours,
      triggeredAtHours: task.triggeredAtHours,
      multiplier: task.multiplier,
      completedAt: completion.completedAt,
      completedByUid: completion.completedByUid,
      horometroAtCompletion: completion.horometroAtCompletion ?? null,
      hasBiometricSignature: completion.biometricSignatureHash != null,
      projectId: input.projectId,
      zkLocalId: taskCompletedNodeId(
        task.equipmentId,
        task.thresholdHours,
        task.multiplier,
        completion.completedAt,
      ),
      sourceTaskCreatedNodeId: input.taskCreatedNodeLocalId,
    },
    connections: [input.projectId, task.equipmentId, task.id],
    references: [
      `asset-${equipmentTypeToAssetSlug(task.equipmentType)}`,
      'maintenance-task-completed',
    ],
  };
}

// ────────────────────────────────────────────────────────────────────
// Chain builder (pure)
// ────────────────────────────────────────────────────────────────────

export interface BuildChainSpecsInput {
  projectId: string;
  reading: HorometroReading;
  equipmentType: string;
  /** Horas a las que se ejecuto el ultimo mantenimiento. */
  lastMaintenanceHours: number;
}

/**
 * Construye TODA la cadena: el nodo `horometro-reading`, los nodos
 * `maintenance-threshold-reached` + `maintenance-task-created` por cada
 * cruce, las tareas correspondientes, y todas las aristas. Es PURA.
 *
 * El caller (onHorometroReading) toma la spec y persiste:
 *   1. writeNodes(allNodes)  — 1 batch
 *   2. createEdge(...)       — N edges
 *   3. scheduleMaintenanceTask(task)  — M tareas
 */
export function buildChainSpecs(input: BuildChainSpecsInput): ChainSpec {
  const reading = input.reading;
  const readingLocalId = readingNodeId(reading.equipmentId, reading.hours, reading.recordedAt);

  const readingNode = createHorometroReadingNode({
    projectId: input.projectId,
    reading,
    equipmentType: input.equipmentType,
  });

  const crosses = checkThresholdsCrossed(
    input.equipmentType,
    input.lastMaintenanceHours,
    reading.hours,
  );

  const steps: ChainStep[] = [];
  const edges: EdgeSpec[] = [];

  // Edge: reading -> equipment (references)
  edges.push({
    fromNodeId: readingLocalId,
    toNodeId: reading.equipmentId,
    type: 'references',
    rationale: `Lectura ${reading.hours}h del equipo ${reading.equipmentId}`,
  });

  for (const cross of crosses) {
    const thrLocalId = thresholdNodeId(reading.equipmentId, cross.cycleHours, cross.multiplier);
    const taskLocalId = taskCreatedNodeId(reading.equipmentId, cross.cycleHours, cross.multiplier);

    const thresholdNode = createMaintenanceThresholdNode({
      projectId: input.projectId,
      equipmentId: reading.equipmentId,
      equipmentType: input.equipmentType,
      cross,
      readingNodeLocalId: readingLocalId,
      detectedAt: reading.recordedAt,
    });

    const task = buildMaintenanceTask({
      projectId: input.projectId,
      equipmentId: reading.equipmentId,
      equipmentType: input.equipmentType,
      cross,
      triggeredAtIso: reading.recordedAt,
      createdBy: 'system',
    });

    const taskCreatedNode = createMaintenanceTaskNode({
      projectId: input.projectId,
      task,
      thresholdNodeLocalId: thrLocalId,
    });

    steps.push({
      cross,
      thresholdNode,
      thresholdNodeId: thrLocalId,
      taskCreatedNode,
      taskCreatedNodeId: taskLocalId,
      task,
    });

    // Chain edges: reading -causes-> threshold -causes-> task_created.
    edges.push({
      fromNodeId: readingLocalId,
      toNodeId: thrLocalId,
      type: 'causes',
      rationale: `Lectura ${reading.hours}h cruzo el umbral ${cross.triggeredAtHours}h`,
    });
    edges.push({
      fromNodeId: thrLocalId,
      toNodeId: taskLocalId,
      type: 'causes',
      rationale: `Umbral ${cross.triggeredAtHours}h gatillo la tarea preventiva`,
    });

    // References to equipment + threshold spec.
    edges.push({
      fromNodeId: thrLocalId,
      toNodeId: reading.equipmentId,
      type: 'references',
      rationale: `Umbral cruzado del equipo ${reading.equipmentId}`,
    });
    edges.push({
      fromNodeId: taskLocalId,
      toNodeId: reading.equipmentId,
      type: 'references',
      rationale: `Tarea preventiva del equipo ${reading.equipmentId}`,
    });
  }

  return {
    readingNode,
    readingNodeId: readingLocalId,
    steps,
    edges,
  };
}

// ────────────────────────────────────────────────────────────────────
// Orchestrator (impure — DI for writers + edge store + task store)
// ────────────────────────────────────────────────────────────────────

import type { MaintenanceTaskStore } from '../../maintenance/maintenanceScheduler.js';
import { scheduleMaintenanceTask } from '../../maintenance/maintenanceScheduler.js';

/**
 * Adaptador minimal del writer del ZK. Pasamos esto en lugar de
 * importar `writeNodes` directamente para que los tests del flow no
 * arrastren firebase + fetch en su grafo de dependencias.
 */
export type WriteNodesFn = (
  nodes: ReadonlyArray<RiskNodePayload>,
  ctx: { projectId: string },
) => Promise<{ ok: boolean; ids?: string[]; queued?: boolean; error?: string }>;

/**
 * Adaptador minimal del edge creator. Igual que arriba: mantenemos los
 * tests hermeticos.
 */
export type CreateEdgeFn = (input: EdgeSpec & {
  tenantId: string;
  createdBy: string;
  projectId?: string;
}) => Promise<void>;

export interface OnHorometroReadingInput {
  tenantId: string;
  projectId: string;
  equipmentId: string;
  equipmentType: string;
  reading: HorometroReading;
  lastMaintenanceHours: number;
  /** UID Firebase del operador que disparo (para createdBy de las
   *  tareas y de los edges). */
  createdByUid?: string;
}

/**
 * Logger compatible con `src/utils/logger.ts` (que tipa `meta` como
 * `Record<string, unknown>`) y con tests que pasan stubs `(msg, ctx) =>
 * void` sin tipar `ctx`. Aceptamos un Record so the project logger
 * encaja sin casteo y los tests usan `() => undefined`.
 */
export type FlowLogger = {
  info?: (msg: string, meta?: Record<string, unknown>) => void;
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
};

export interface OnHorometroReadingDeps {
  writeNodes: WriteNodesFn;
  createEdge: CreateEdgeFn;
  taskStore: MaintenanceTaskStore;
  /** Logger opcional. */
  logger?: FlowLogger;
}

export type OnHorometroReadingResult =
  | {
      ok: true;
      readingNodeId: string;
      crossesDetected: number;
      tasksCreated: number;
      edgesCreated: number;
    }
  | { ok: false; reason: string };

/**
 * Orquestador principal. Llamado por la route `POST /horometro/reading`
 * tras persistir la lectura. Idempotente — re-ejecutar con la misma
 * reading no duplica nodos ni tareas porque los ids son deterministas.
 */
export async function onHorometroReading(
  input: OnHorometroReadingInput,
  deps: OnHorometroReadingDeps,
): Promise<OnHorometroReadingResult> {
  const log = deps.logger ?? {};

  const spec = buildChainSpecs({
    projectId: input.projectId,
    reading: input.reading,
    equipmentType: input.equipmentType,
    lastMaintenanceHours: input.lastMaintenanceHours,
  });

  const allNodes: RiskNodePayload[] = [
    spec.readingNode,
    ...spec.steps.flatMap((s) => [s.thresholdNode, s.taskCreatedNode]),
  ];

  const writeRes = await deps.writeNodes(allNodes, { projectId: input.projectId });
  if (!writeRes.ok) {
    log.warn?.('horometroMaintenanceFlow.writeNodes_failed', {
      error: writeRes.error,
      reading: input.reading.equipmentId,
    });
    return { ok: false, reason: writeRes.error ?? 'writeNodes_failed' };
  }
  // queued (offline) cuenta como exitoso para no bloquear UX — los nodos
  // se sincronizaran cuando vuelva la red.
  log.info?.('horometroMaintenanceFlow.nodes_written', {
    equipmentId: input.reading.equipmentId,
    nodesWritten: allNodes.length,
    queued: writeRes.queued === true,
  });

  // Persistir cada tarea via scheduler.
  let tasksCreated = 0;
  for (const step of spec.steps) {
    try {
      await scheduleMaintenanceTask(
        { tenantId: input.tenantId, task: step.task },
        deps.taskStore,
      );
      tasksCreated += 1;
    } catch (err) {
      log.warn?.('horometroMaintenanceFlow.task_save_failed', {
        taskId: step.task.id,
        err: String(err),
      });
    }
  }

  // Materializar edges.
  let edgesCreated = 0;
  const createdBy = input.createdByUid ?? 'system';
  for (const edge of spec.edges) {
    try {
      await deps.createEdge({
        ...edge,
        tenantId: input.tenantId,
        createdBy,
        projectId: input.projectId,
      });
      edgesCreated += 1;
    } catch (err) {
      log.warn?.('horometroMaintenanceFlow.edge_create_failed', {
        edge: `${edge.fromNodeId} -[${edge.type}]-> ${edge.toNodeId}`,
        err: String(err),
      });
    }
  }

  return {
    ok: true,
    readingNodeId: spec.readingNodeId,
    crossesDetected: spec.steps.length,
    tasksCreated,
    edgesCreated,
  };
}

// ────────────────────────────────────────────────────────────────────
// Completion orchestrator
// ────────────────────────────────────────────────────────────────────

export interface OnMaintenanceCompletedInput {
  tenantId: string;
  projectId: string;
  task: MaintenanceTask;
  completion: MaintenanceTaskCompletion;
}

/**
 * Llamado tras `completeMaintenanceTask`. Emite el nodo
 * `maintenance-task-completed` y la arista
 * `task-created --causes--> task-completed` para cerrar la cadena.
 */
export async function onMaintenanceCompleted(
  input: OnMaintenanceCompletedInput,
  deps: Pick<OnHorometroReadingDeps, 'writeNodes' | 'createEdge' | 'logger'>,
): Promise<OnHorometroReadingResult> {
  const log = deps.logger ?? {};
  const { task, completion } = input;
  const taskCreatedLocal = taskCreatedNodeId(
    task.equipmentId,
    task.thresholdHours,
    task.multiplier,
  );
  const completedLocal = taskCompletedNodeId(
    task.equipmentId,
    task.thresholdHours,
    task.multiplier,
    completion.completedAt,
  );

  const completedNode = createMaintenanceCompletedNode({
    projectId: input.projectId,
    task,
    completion,
    taskCreatedNodeLocalId: taskCreatedLocal,
  });

  const writeRes = await deps.writeNodes([completedNode], { projectId: input.projectId });
  if (!writeRes.ok) {
    log.warn?.('horometroMaintenanceFlow.complete_write_failed', {
      taskId: task.id,
      err: writeRes.error,
    });
    return { ok: false, reason: writeRes.error ?? 'writeNodes_failed' };
  }
  log.info?.('horometroMaintenanceFlow.complete_node_written', {
    taskId: task.id,
    queued: writeRes.queued === true,
  });

  let edgesCreated = 0;
  const edges: EdgeSpec[] = [
    {
      fromNodeId: taskCreatedLocal,
      toNodeId: completedLocal,
      type: 'causes',
      rationale: `Tarea ${task.id} completada`,
    },
    {
      fromNodeId: completedLocal,
      toNodeId: task.equipmentId,
      type: 'references',
      rationale: `Mantencion completada del equipo ${task.equipmentId}`,
    },
  ];
  for (const e of edges) {
    try {
      await deps.createEdge({
        ...e,
        tenantId: input.tenantId,
        createdBy: completion.completedByUid,
        projectId: input.projectId,
      });
      edgesCreated += 1;
    } catch (err) {
      log.warn?.('horometroMaintenanceFlow.complete_edge_failed', {
        edge: `${e.fromNodeId} -[${e.type}]-> ${e.toNodeId}`,
        err: String(err),
      });
    }
  }

  return {
    ok: true,
    readingNodeId: completedLocal,
    crossesDetected: 0,
    tasksCreated: 0,
    edgesCreated,
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Convierte un `equipment.type` (snake_case, internal) en el slug usado
 * por `assetsFaenaNodeRegistry` (`asset-camion-tolva`, `asset-grua-movil`,
 * etc.). Funcion conservadora: pasamos del guion bajo al guion medio y
 * lowercase. Si no hay match exacto el caller persistira de todos modos
 * con la string que devolvemos — el grafo es tolerante a `references`
 * que apuntan a un id que aun no existe.
 */
export function equipmentTypeToAssetSlug(equipmentType: string): string {
  return equipmentType.toLowerCase().trim().replace(/_/g, '-');
}

// ────────────────────────────────────────────────────────────────────
// Test-only / debug exports
// ────────────────────────────────────────────────────────────────────

export const __testOnly__ = {
  readingNodeId,
  thresholdNodeId,
  taskCreatedNodeId,
  taskCompletedNodeId,
};
