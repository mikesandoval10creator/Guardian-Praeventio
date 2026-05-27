// Praeventio Guard — Bloque 4.1: end-to-end tests for the horometro
// -> maintenance chain.
//
// Estos tests inyectan stores fake (in-memory) y un writeNodes fake
// para validar que el orchestrator:
//   1. Construye correctamente los nodos ZK con los local ids
//      esperados.
//   2. Detecta cruces de umbral cuando corresponde (250h, 500h,
//      1000h) y genera N tareas + 2N nodos ZK por cada cruce.
//   3. Materializa las aristas en la cadena
//      reading -> threshold -> task_created.
//   4. Completa la cadena con `onMaintenanceCompleted` emitiendo el
//      nodo `maintenance-task-completed` y la arista task_created
//      -> completed.

import { describe, it, expect, vi } from 'vitest';
import {
  buildChainSpecs,
  createHorometroReadingNode,
  createMaintenanceThresholdNode,
  createMaintenanceTaskNode,
  createMaintenanceCompletedNode,
  onHorometroReading,
  onMaintenanceCompleted,
  equipmentTypeToAssetSlug,
  __testOnly__,
  type WriteNodesFn,
  type CreateEdgeFn,
} from './horometroMaintenanceFlow';
import type { HorometroReading } from '../../horometro/horometroService';
import type {
  MaintenanceTask,
  MaintenanceTaskStore,
} from '../../maintenance/maintenanceScheduler';

const PROJECT = 'proj-test';
const TENANT = 'tenant-test';
const EQUIPMENT = 'eq-compresor-001';
const RECORDED_AT = '2026-05-20T10:00:00.000Z';

function makeReading(over: Partial<HorometroReading> = {}): HorometroReading {
  return {
    equipmentId: EQUIPMENT,
    hours: 1000,
    source: 'qr_entry',
    recordedAt: RECORDED_AT,
    ...over,
  };
}

function inMemoryTaskStore(): MaintenanceTaskStore & {
  _all(): MaintenanceTask[];
} {
  const byId = new Map<string, MaintenanceTask>();
  return {
    async saveTask(task) {
      byId.set(task.id, task);
    },
    async getTaskById({ taskId }) {
      return byId.get(taskId) ?? null;
    },
    async listActiveByProject({ projectId, equipmentId, statuses }) {
      const list = statuses ?? ['open', 'scheduled', 'in_progress'];
      return Array.from(byId.values()).filter(
        (t) =>
          t.projectId === projectId &&
          list.includes(t.status) &&
          (!equipmentId || t.equipmentId === equipmentId),
      );
    },
    _all: () => Array.from(byId.values()),
  };
}

function inMemoryWriteNodes(): { fn: WriteNodesFn; calls: Array<{ count: number; types: string[] }> } {
  const calls: Array<{ count: number; types: string[] }> = [];
  const fn: WriteNodesFn = async (nodes, _ctx) => {
    calls.push({
      count: nodes.length,
      types: nodes.map((n) => n.type),
    });
    return { ok: true, ids: nodes.map((_, i) => `srv-id-${calls.length}-${i}`) };
  };
  return { fn, calls };
}

function inMemoryCreateEdge(): { fn: CreateEdgeFn; edges: Array<{ from: string; to: string; type: string }> } {
  const edges: Array<{ from: string; to: string; type: string }> = [];
  const fn: CreateEdgeFn = async (input) => {
    edges.push({ from: input.fromNodeId, to: input.toNodeId, type: input.type });
  };
  return { fn, edges };
}

// ── createHorometroReadingNode ───────────────────────────────────────

describe('createHorometroReadingNode', () => {
  it('builds a RiskNodePayload with type=horometro-reading and severity=info', () => {
    const node = createHorometroReadingNode({
      projectId: PROJECT,
      reading: makeReading(),
      equipmentType: 'compresor',
    });
    expect(node.type).toBe('horometro-reading');
    expect(node.severity).toBe('info');
    expect(node.metadata.equipmentId).toBe(EQUIPMENT);
    expect(node.metadata.hours).toBe(1000);
    expect(node.metadata.zkLocalId).toBe(
      __testOnly__.readingNodeId(EQUIPMENT, 1000, RECORDED_AT),
    );
    expect(node.connections).toContain(PROJECT);
    expect(node.connections).toContain(EQUIPMENT);
    expect(node.references).toContain('asset-compresor');
  });
});

// ── createMaintenanceThresholdNode ───────────────────────────────────

describe('createMaintenanceThresholdNode', () => {
  it('builds a threshold node with the cycle severity', () => {
    const node = createMaintenanceThresholdNode({
      projectId: PROJECT,
      equipmentId: EQUIPMENT,
      equipmentType: 'compresor',
      cross: {
        cycleHours: 1000,
        multiplier: 1,
        triggeredAtHours: 1000,
        severity: 'high',
      },
      readingNodeLocalId: 'hr-EQ-1000-x',
      detectedAt: RECORDED_AT,
    });
    expect(node.type).toBe('maintenance-threshold-reached');
    expect(node.severity).toBe('high');
    expect(node.metadata.triggeredAtHours).toBe(1000);
    expect(node.metadata.multiplier).toBe(1);
    expect(node.metadata.sourceReadingNodeId).toBe('hr-EQ-1000-x');
  });
});

// ── createMaintenanceTaskNode / createMaintenanceCompletedNode ───────

describe('createMaintenanceTaskNode + Completed', () => {
  it('builds a task-created node referencing the equipment + threshold', () => {
    const task: MaintenanceTask = {
      id: 'mtask-EQ-1000h-k1',
      projectId: PROJECT,
      equipmentId: EQUIPMENT,
      equipmentType: 'compresor',
      thresholdHours: 1000,
      triggeredAtHours: 1000,
      multiplier: 1,
      severity: 'high',
      status: 'open',
      dueAtIso: '2026-05-20T14:00:00.000Z',
      createdAt: RECORDED_AT,
      createdBy: 'system',
    };
    const node = createMaintenanceTaskNode({
      projectId: PROJECT,
      task,
      thresholdNodeLocalId: 'thr-x',
    });
    expect(node.type).toBe('maintenance-task-created');
    expect(node.metadata.taskId).toBe('mtask-EQ-1000h-k1');
    expect(node.metadata.sourceThresholdNodeId).toBe('thr-x');
    expect(node.connections).toContain('mtask-EQ-1000h-k1');
  });

  it('builds a completed node with biometric metadata when present', () => {
    const task: MaintenanceTask = {
      id: 'mtask-EQ-1000h-k1',
      projectId: PROJECT,
      equipmentId: EQUIPMENT,
      equipmentType: 'compresor',
      thresholdHours: 1000,
      triggeredAtHours: 1000,
      multiplier: 1,
      severity: 'high',
      status: 'completed',
      dueAtIso: '2026-05-20T14:00:00.000Z',
      createdAt: RECORDED_AT,
      createdBy: 'system',
    };
    const node = createMaintenanceCompletedNode({
      projectId: PROJECT,
      task,
      completion: {
        completedByUid: 'tech-1',
        completedAt: '2026-05-20T18:00:00.000Z',
        notes: 'Aceite cambiado, filtros nuevos.',
        biometricSignatureHash: 'abc123def456',
        horometroAtCompletion: 1005,
      },
      taskCreatedNodeLocalId: 'tcr-x',
    });
    expect(node.type).toBe('maintenance-task-completed');
    expect(node.metadata.hasBiometricSignature).toBe(true);
    expect(node.metadata.horometroAtCompletion).toBe(1005);
    expect(node.metadata.sourceTaskCreatedNodeId).toBe('tcr-x');
  });
});

// ── equipmentTypeToAssetSlug ─────────────────────────────────────────

describe('equipmentTypeToAssetSlug', () => {
  it('converts snake_case to kebab-case', () => {
    expect(equipmentTypeToAssetSlug('camion_tolva')).toBe('camion-tolva');
    expect(equipmentTypeToAssetSlug('Grua_Movil')).toBe('grua-movil');
    expect(equipmentTypeToAssetSlug('compresor')).toBe('compresor');
  });
});

// ── buildChainSpecs ──────────────────────────────────────────────────

describe('buildChainSpecs', () => {
  it('reading without crosses produces only the reading node (and 1 reference edge)', () => {
    const spec = buildChainSpecs({
      projectId: PROJECT,
      reading: makeReading({ hours: 120 }),
      equipmentType: 'compresor',
      lastMaintenanceHours: 100,
    });
    expect(spec.readingNode.type).toBe('horometro-reading');
    expect(spec.steps).toHaveLength(0);
    // Edge unico: reading -references-> equipment.
    expect(spec.edges).toHaveLength(1);
    expect(spec.edges[0]!.type).toBe('references');
    expect(spec.edges[0]!.toNodeId).toBe(EQUIPMENT);
  });

  it('250h boundary crossing creates 1 step (threshold + task) with severity=low and 4 edges', () => {
    const spec = buildChainSpecs({
      projectId: PROJECT,
      reading: makeReading({ hours: 260 }),
      equipmentType: 'compresor',
      lastMaintenanceHours: 240,
    });
    expect(spec.steps).toHaveLength(1);
    expect(spec.steps[0]!.cross.cycleHours).toBe(250);
    expect(spec.steps[0]!.cross.multiplier).toBe(1);
    expect(spec.steps[0]!.cross.severity).toBe('low');
    expect(spec.steps[0]!.task.id).toBe('mtask-eq-compresor-001-250h-k1');
    // Edges: reading->equipment + reading->threshold + threshold->task +
    // threshold->equipment + task->equipment = 5.
    expect(spec.edges).toHaveLength(5);
    const causes = spec.edges.filter((e) => e.type === 'causes');
    expect(causes).toHaveLength(2);
  });

  it('crossing multiple cycles from 240h to 1100h emits a step per cycle multiple', () => {
    // From 240 -> 1100 with cycles [250, 500, 1000, 2000]:
    //   250: 1, 2, 3, 4   (250, 500, 750, 1000)
    //   500: 1, 2         (500, 1000)
    //   1000: 1           (1000)
    //   2000: none
    // Total: 4 + 2 + 1 = 7 steps.
    const spec = buildChainSpecs({
      projectId: PROJECT,
      reading: makeReading({ hours: 1100 }),
      equipmentType: 'compresor',
      lastMaintenanceHours: 240,
    });
    expect(spec.steps).toHaveLength(7);
    const triggeredAt = spec.steps.map((s) => s.cross.triggeredAtHours).sort((a, b) => a - b);
    expect(triggeredAt).toEqual([250, 500, 500, 750, 1000, 1000, 1000]);
  });

  it('uses default cycles when equipment type is unknown', () => {
    const spec = buildChainSpecs({
      projectId: PROJECT,
      reading: makeReading({ hours: 300 }),
      equipmentType: 'unknown_machine',
      lastMaintenanceHours: 240,
    });
    // Default cycles: only [250h]. From 240->300 → 1 cross at 250.
    expect(spec.steps).toHaveLength(1);
    expect(spec.steps[0]!.cross.cycleHours).toBe(250);
    expect(spec.steps[0]!.cross.severity).toBe('medium');
  });

  it('all task ids are deterministic — re-running buildChainSpecs is idempotent', () => {
    const a = buildChainSpecs({
      projectId: PROJECT,
      reading: makeReading({ hours: 1100 }),
      equipmentType: 'compresor',
      lastMaintenanceHours: 240,
    });
    const b = buildChainSpecs({
      projectId: PROJECT,
      reading: makeReading({ hours: 1100 }),
      equipmentType: 'compresor',
      lastMaintenanceHours: 240,
    });
    expect(a.steps.map((s) => s.task.id)).toEqual(b.steps.map((s) => s.task.id));
  });
});

// ── onHorometroReading orchestrator ──────────────────────────────────

describe('onHorometroReading', () => {
  it('happy path: 1000h crossing — writes 1 reading + 1 threshold + 1 task node, creates 1 task, materializes 5 edges', async () => {
    const taskStore = inMemoryTaskStore();
    const writer = inMemoryWriteNodes();
    const edgesAdapter = inMemoryCreateEdge();
    const result = await onHorometroReading(
      {
        tenantId: TENANT,
        projectId: PROJECT,
        equipmentId: EQUIPMENT,
        equipmentType: 'compresor',
        reading: makeReading({ hours: 1000 }),
        lastMaintenanceHours: 750,
      },
      {
        writeNodes: writer.fn,
        createEdge: edgesAdapter.fn,
        taskStore,
        logger: { info: () => undefined, warn: () => undefined },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // From 750 -> 1000 with cycles [250, 500, 1000]:
    //   250: cross at 1000 (k=4)
    //   500: cross at 1000 (k=2)
    //   1000: cross at 1000 (k=1)
    // Three steps.
    expect(result.crossesDetected).toBe(3);
    expect(result.tasksCreated).toBe(3);
    // Three steps -> 3 thresholds + 3 task-created nodes + 1 reading = 7.
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]!.count).toBe(7);
    // Edges: 1 (reading->eq) + 4 per step (reading->thr, thr->task,
    // thr->eq, task->eq) = 1 + 12 = 13.
    expect(result.edgesCreated).toBe(13);
    expect(edgesAdapter.edges).toHaveLength(13);
    // Verify tasks exist with deterministic ids.
    expect(taskStore._all()).toHaveLength(3);
    const ids = taskStore._all().map((t) => t.id).sort();
    expect(ids).toEqual([
      'mtask-eq-compresor-001-1000h-k1',
      'mtask-eq-compresor-001-250h-k4',
      'mtask-eq-compresor-001-500h-k2',
    ]);
  });

  it('returns ok:false when writeNodes fails — does not save tasks or edges', async () => {
    const taskStore = inMemoryTaskStore();
    const writer: WriteNodesFn = async () => ({ ok: false, error: 'simulated_failure' });
    const edgesAdapter = inMemoryCreateEdge();
    const result = await onHorometroReading(
      {
        tenantId: TENANT,
        projectId: PROJECT,
        equipmentId: EQUIPMENT,
        equipmentType: 'compresor',
        reading: makeReading({ hours: 1000 }),
        lastMaintenanceHours: 750,
      },
      { writeNodes: writer, createEdge: edgesAdapter.fn, taskStore },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('simulated_failure');
    expect(taskStore._all()).toHaveLength(0);
    expect(edgesAdapter.edges).toHaveLength(0);
  });

  it('reading without crosses still writes the reading node and 1 edge', async () => {
    const taskStore = inMemoryTaskStore();
    const writer = inMemoryWriteNodes();
    const edgesAdapter = inMemoryCreateEdge();
    const result = await onHorometroReading(
      {
        tenantId: TENANT,
        projectId: PROJECT,
        equipmentId: EQUIPMENT,
        equipmentType: 'compresor',
        reading: makeReading({ hours: 120 }),
        lastMaintenanceHours: 100,
      },
      { writeNodes: writer.fn, createEdge: edgesAdapter.fn, taskStore },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossesDetected).toBe(0);
    expect(result.tasksCreated).toBe(0);
    expect(result.edgesCreated).toBe(1);
    expect(writer.calls[0]!.count).toBe(1);
    expect(writer.calls[0]!.types).toEqual(['horometro-reading']);
  });

  it('queued (offline) writes still count as success and persist tasks/edges', async () => {
    const taskStore = inMemoryTaskStore();
    const writer: WriteNodesFn = vi
      .fn()
      .mockResolvedValue({ ok: true, queued: true, ids: ['q1', 'q2', 'q3'] });
    const edgesAdapter = inMemoryCreateEdge();
    const result = await onHorometroReading(
      {
        tenantId: TENANT,
        projectId: PROJECT,
        equipmentId: EQUIPMENT,
        equipmentType: 'compresor',
        reading: makeReading({ hours: 260 }),
        lastMaintenanceHours: 240,
      },
      { writeNodes: writer, createEdge: edgesAdapter.fn, taskStore },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossesDetected).toBe(1);
    expect(result.tasksCreated).toBe(1);
    expect(taskStore._all()).toHaveLength(1);
  });
});

// ── onMaintenanceCompleted ───────────────────────────────────────────

describe('onMaintenanceCompleted', () => {
  it('emits the completed node and creates 2 edges', async () => {
    const writer = inMemoryWriteNodes();
    const edgesAdapter = inMemoryCreateEdge();
    const task: MaintenanceTask = {
      id: 'mtask-EQ-1000h-k1',
      projectId: PROJECT,
      equipmentId: EQUIPMENT,
      equipmentType: 'compresor',
      thresholdHours: 1000,
      triggeredAtHours: 1000,
      multiplier: 1,
      severity: 'high',
      status: 'completed',
      dueAtIso: '2026-05-20T14:00:00.000Z',
      createdAt: RECORDED_AT,
      createdBy: 'system',
    };
    const result = await onMaintenanceCompleted(
      {
        tenantId: TENANT,
        projectId: PROJECT,
        task,
        completion: {
          completedByUid: 'tech-1',
          completedAt: '2026-05-20T18:00:00.000Z',
          notes: 'Done',
          biometricSignatureHash: 'sig',
          horometroAtCompletion: 1010,
        },
      },
      { writeNodes: writer.fn, createEdge: edgesAdapter.fn, logger: undefined },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]!.count).toBe(1);
    expect(writer.calls[0]!.types).toEqual(['maintenance-task-completed']);
    expect(result.edgesCreated).toBe(2);
    const types = edgesAdapter.edges.map((e) => e.type).sort();
    expect(types).toEqual(['causes', 'references']);
  });

  it('returns ok:false when writeNodes fails', async () => {
    const edgesAdapter = inMemoryCreateEdge();
    const result = await onMaintenanceCompleted(
      {
        tenantId: TENANT,
        projectId: PROJECT,
        task: {
          id: 't',
          projectId: PROJECT,
          equipmentId: EQUIPMENT,
          equipmentType: 'compresor',
          thresholdHours: 1000,
          triggeredAtHours: 1000,
          multiplier: 1,
          severity: 'high',
          status: 'completed',
          dueAtIso: RECORDED_AT,
          createdAt: RECORDED_AT,
          createdBy: 'system',
        },
        completion: {
          completedByUid: 'tech',
          completedAt: RECORDED_AT,
          notes: 'x',
        },
      },
      {
        writeNodes: async () => ({ ok: false, error: 'boom' }),
        createEdge: edgesAdapter.fn,
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('boom');
    expect(edgesAdapter.edges).toHaveLength(0);
  });
});
