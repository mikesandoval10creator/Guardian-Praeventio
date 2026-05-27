// Praeventio Guard — Bloque 4.3 incidentLessonTrainingFlow coverage.
//
// End-to-end coverage of the 7-node PDCA learning chain. We mock
// `writeNodes` + `createEdge` via injected deps so no Firestore / fetch is
// involved; the test verifies node payloads, edge wiring, idempotency and
// the PDCA status reducer.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RiskNodePayload } from '../types.js';
import type { ZkEdge, EdgeType } from '../edges.js';

// Mock the firebase + offline-queue surface so `writeNodes` (which is the
// production default) doesn't try to call fetch when we don't inject the
// dep. Keeps the test hermetic and matches `writeNode.test.ts` style.
vi.mock('../../firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: vi.fn(async () => 'tok-test'),
    },
  },
}));

vi.mock('../../../utils/pwa-offline', () => ({
  saveForSync: vi.fn(async () => undefined),
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock observability + analytics so the writer's Sentry wrap is a no-op.
vi.mock('../../observability/sentryInstrumentation', () => ({
  withSentryScope: vi.fn((_n, _tags, fn) => fn()),
}));

vi.mock('../../analytics', () => ({
  analytics: { track: vi.fn(() => Promise.resolve()) },
}));

import {
  createIncidentReportedNode,
  createInvestigationOpenedNode,
  createRootCauseNode,
  createLessonPublishedNode,
  createMicrotrainingAssignedNode,
  createMicrotrainingCompletedNode,
  createInvestigationClosedNode,
  onIncidentReported,
  onInvestigationOpened,
  onInvestigationConcluded,
  onLessonPublished,
  onMicrotrainingAssigned,
  onMicrotrainingCompleted,
  onInvestigationClosed,
  runFullChain,
  computePdcaStatus,
  type IncidentReportInput,
  type InvestigationOpeningInput,
  type InvestigationConclusionInput,
  type LessonPublicationInput,
  type MicrotrainingAssignmentInput,
  type MicrotrainingCompletionInput,
  type InvestigationClosureInput,
  type ChainNodeRef,
  type FlowDeps,
} from './incidentLessonTrainingFlow.js';

// ────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────

const baseReport: IncidentReportInput = {
  incidentId: 'inc-001',
  projectId: 'proj-mina-norte',
  tenantId: 't1',
  reportedByUid: 'u-worker-1',
  involvedWorkerUids: ['u-worker-2'],
  occurredAtIso: '2026-05-20T08:30:00Z',
  description: 'Caida desde andamio nivel 3 sin doble linea de vida.',
  severity: 'high',
  location: 'Faena 7, sector C',
  photoStorageUrl: undefined,
};

const baseOpening: InvestigationOpeningInput = {
  incidentId: 'inc-001',
  projectId: 'proj-mina-norte',
  tenantId: 't1',
  investigatorUid: 'u-prev-1',
  openedAtIso: '2026-05-20T09:00:00Z',
  scopeNotes: 'Foco en procedimiento de instalacion de doble linea de vida.',
};

const baseConclusion: InvestigationConclusionInput = {
  incidentId: 'inc-001',
  projectId: 'proj-mina-norte',
  tenantId: 't1',
  closedByUid: 'u-prev-1',
  concludedAtIso: '2026-05-20T14:00:00Z',
  rootCauseSummary:
    'El procedimiento de doble linea de vida no estaba accesible en la faena al momento del trabajo.',
  contributingFactor: 'procedure',
  preventiveActions: [
    'Imprimir y plastificar el procedimiento en cada faena.',
    'Verificar acceso al procedimiento en la charla pre-tarea.',
  ],
};

const baseLesson: LessonPublicationInput = {
  incidentId: 'inc-001',
  projectId: 'proj-mina-norte',
  tenantId: 't1',
  lessonId: 'lesson-inc-001-altura',
  publishedByUid: 'u-admin-1',
  publishedAtIso: '2026-05-20T15:00:00Z',
  summary:
    'Acceso fisico al procedimiento de altura previene omision de doble linea de vida.',
  audienceUids: ['u-worker-1', 'u-worker-2'],
  tags: ['altura', 'procedimiento', 'doble-linea'],
  riskCategories: ['altura'],
};

const baseAssignment: MicrotrainingAssignmentInput = {
  incidentId: 'inc-001',
  projectId: 'proj-mina-norte',
  tenantId: 't1',
  assignmentId: 'mt-assign-inc-001-u-worker-1',
  moduleId: 'mt-altura-v1',
  workerUid: 'u-worker-1',
  assignedByUid: 'u-admin-1',
  assignedAtIso: '2026-05-20T15:05:00Z',
  derivedFromLessonId: 'lesson-inc-001-altura',
};

const baseCompletion: MicrotrainingCompletionInput = {
  incidentId: 'inc-001',
  projectId: 'proj-mina-norte',
  tenantId: 't1',
  assignmentId: 'mt-assign-inc-001-u-worker-1',
  moduleId: 'mt-altura-v1',
  workerUid: 'u-worker-1',
  completedAtIso: '2026-05-20T15:30:00Z',
  score: 100,
  passed: true,
  certified: true,
};

const baseClosure: InvestigationClosureInput = {
  incidentId: 'inc-001',
  projectId: 'proj-mina-norte',
  tenantId: 't1',
  closedByUid: 'u-admin-1',
  closedAtIso: '2026-05-20T16:00:00Z',
  closurePercent: 50,
  closingNotes:
    'Procedimiento de altura ahora visible en faena. 1 de 2 trabajadores completaron capacitacion.',
};

// In-test counter for unique node ids returned by the writer mock.
let nodeIdCounter = 0;
const writtenPayloads: RiskNodePayload[] = [];
const writtenEdges: Array<{ from: string; to: string; type: EdgeType }> = [];

function buildDeps(): FlowDeps {
  return {
    writeNodes: vi.fn(async () => ({ ok: true })) as unknown as FlowDeps['writeNodes'],
    createEdge: vi.fn(async (input) => {
      const edge: ZkEdge = {
        id: `edge-${input.fromNodeId}-${input.toNodeId}-${input.type}`.replace(/:/g, '_'),
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        type: input.type,
        inverseType: 'leads_to',
        createdAt: '2026-05-20T16:00:00Z',
        createdBy: input.createdBy,
        tenantId: input.tenantId,
        projectId: input.projectId,
      };
      writtenEdges.push({
        from: input.fromNodeId,
        to: input.toNodeId,
        type: input.type,
      });
      return edge;
    }),
    nodeIdFor: vi.fn(async (payload) => {
      nodeIdCounter += 1;
      writtenPayloads.push(payload);
      return `node-${nodeIdCounter}-${payload.type}`;
    }),
  };
}

beforeEach(() => {
  nodeIdCounter = 0;
  writtenPayloads.length = 0;
  writtenEdges.length = 0;
});

// ────────────────────────────────────────────────────────────────────────
// NodeFactory pure functions
// ────────────────────────────────────────────────────────────────────────

describe('NodeFactory functions', () => {
  it('createIncidentReportedNode produces a well-shaped payload', () => {
    const p = createIncidentReportedNode(baseReport);
    expect(p.type).toBe('incident-reported');
    expect(p.severity).toBe('high');
    expect(p.metadata.incidentId).toBe('inc-001');
    expect(p.metadata.reportedByUid).toBe('u-worker-1');
    expect(p.metadata.pdcaStep).toBe('report');
    expect(p.connections).toContain('project:proj-mina-norte');
    expect(p.connections).toContain('incident:inc-001');
    expect(p.connections).toContain('worker:u-worker-1');
    expect(p.connections).toContain('worker:u-worker-2');
    expect(p.references).toEqual(['Ley-16744', 'ISO-45001']);
  });

  it('createInvestigationOpenedNode marks PDCA plan phase', () => {
    const p = createInvestigationOpenedNode(baseOpening);
    expect(p.type).toBe('investigation-opened');
    expect(p.metadata.pdcaStep).toBe('plan');
    expect(p.metadata.investigatorUid).toBe('u-prev-1');
  });

  it('createRootCauseNode lists every preventive action and tags PDCA do', () => {
    const p = createRootCauseNode(baseConclusion);
    expect(p.type).toBe('root-cause-identified');
    expect(p.metadata.pdcaStep).toBe('do');
    expect(p.metadata.preventiveActionCount).toBe(2);
    expect(p.description).toContain('Acciones preventivas (2)');
    expect(p.description).toContain('Imprimir y plastificar');
  });

  it('createLessonPublishedNode wires audience as connection edges', () => {
    const p = createLessonPublishedNode(baseLesson);
    expect(p.type).toBe('lesson-published');
    expect(p.metadata.pdcaStep).toBe('check');
    expect(p.metadata.audienceCount).toBe(2);
    expect(p.connections).toContain('worker:u-worker-1');
    expect(p.connections).toContain('worker:u-worker-2');
    expect(p.connections).toContain('lesson:lesson-inc-001-altura');
  });

  it('createMicrotrainingAssignedNode carries derivedFromLessonId metadata', () => {
    const p = createMicrotrainingAssignedNode(baseAssignment);
    expect(p.type).toBe('microtraining-assigned');
    expect(p.metadata.derivedFromLessonId).toBe('lesson-inc-001-altura');
    expect(p.metadata.moduleId).toBe('mt-altura-v1');
    expect(p.metadata.pdcaStep).toBe('act');
  });

  it('createMicrotrainingCompletedNode preserves score + certification flag', () => {
    const p = createMicrotrainingCompletedNode(baseCompletion);
    expect(p.type).toBe('microtraining-completed');
    expect(p.metadata.score).toBe(100);
    expect(p.metadata.passed).toBe(true);
    expect(p.metadata.certified).toBe(true);
    // Founder directive: never punitive — always 'info' severity for
    // the completion node regardless of pass/fail.
    expect(p.severity).toBe('info');
  });

  it('createMicrotrainingCompletedNode stays info-severity even when worker fails', () => {
    const p = createMicrotrainingCompletedNode({
      ...baseCompletion,
      score: 40,
      passed: false,
      certified: false,
    });
    expect(p.severity).toBe('info');
    expect(p.metadata.passed).toBe(false);
    expect(p.description).toContain('No aprobada');
  });

  it('createInvestigationClosedNode encodes closurePercent in title + metadata', () => {
    const p = createInvestigationClosedNode(baseClosure);
    expect(p.type).toBe('incident-investigation-closed');
    expect(p.title).toContain('(50%)');
    expect(p.metadata.closurePercent).toBe(50);
    expect(p.metadata.pdcaStep).toBe('close');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Orchestrator — per-step + full chain
// ────────────────────────────────────────────────────────────────────────

describe('orchestrator — sequential steps', () => {
  it('onIncidentReported returns a node id and zero edges (chain root)', async () => {
    const deps = buildDeps();
    const res = await onIncidentReported(baseReport, deps);
    expect(res.ok).toBe(true);
    expect(res.nodeIds).toHaveLength(1);
    expect(res.edgeIds).toHaveLength(0);
    expect(deps.writeNodes).toHaveBeenCalledTimes(1);
  });

  it('onInvestigationOpened writes one edge causes(report → opening)', async () => {
    const deps = buildDeps();
    const res = await onInvestigationOpened(
      baseOpening,
      'node-report',
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.edgeIds).toHaveLength(1);
    expect(writtenEdges).toEqual([
      {
        from: 'node-report',
        to: res.nodeIds[0],
        type: 'causes',
      },
    ]);
  });

  it('onInvestigationConcluded wires derived_from(rootCause → opening)', async () => {
    const deps = buildDeps();
    const res = await onInvestigationConcluded(
      baseConclusion,
      'node-opening',
      deps,
    );
    expect(res.ok).toBe(true);
    expect(writtenEdges[0]).toEqual({
      from: res.nodeIds[0],
      to: 'node-opening',
      type: 'derived_from',
    });
  });

  it('onLessonPublished wires derived_from(lesson → rootCause)', async () => {
    const deps = buildDeps();
    const res = await onLessonPublished(
      baseLesson,
      'node-rootcause',
      deps,
    );
    expect(res.ok).toBe(true);
    expect(writtenEdges[0]).toEqual({
      from: res.nodeIds[0],
      to: 'node-rootcause',
      type: 'derived_from',
    });
  });

  it('onMicrotrainingAssigned wires derived_from(assigned → lesson)', async () => {
    const deps = buildDeps();
    const res = await onMicrotrainingAssigned(
      baseAssignment,
      'node-lesson',
      deps,
    );
    expect(res.ok).toBe(true);
    expect(writtenEdges[0]).toEqual({
      from: res.nodeIds[0],
      to: 'node-lesson',
      type: 'derived_from',
    });
  });

  it('onMicrotrainingCompleted wires derived_from(completed → assigned)', async () => {
    const deps = buildDeps();
    const res = await onMicrotrainingCompleted(
      baseCompletion,
      'node-assigned',
      deps,
    );
    expect(res.ok).toBe(true);
    expect(writtenEdges[0]).toEqual({
      from: res.nodeIds[0],
      to: 'node-assigned',
      type: 'derived_from',
    });
  });

  it('onInvestigationClosed wires derived_from(closed → completed)', async () => {
    const deps = buildDeps();
    const res = await onInvestigationClosed(
      baseClosure,
      'node-completed',
      deps,
    );
    expect(res.ok).toBe(true);
    expect(writtenEdges[0]).toEqual({
      from: res.nodeIds[0],
      to: 'node-completed',
      type: 'derived_from',
    });
  });

  it('returns ok:false when the writer reports failure', async () => {
    const deps = buildDeps();
    deps.writeNodes = vi.fn(async () => ({
      ok: false,
      error: 'simulated',
    })) as unknown as FlowDeps['writeNodes'];
    const res = await onIncidentReported(baseReport, deps);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('write_failed');
  });

  it('treats writer queued result as success (offline path)', async () => {
    const deps = buildDeps();
    deps.writeNodes = vi.fn(async () => ({
      ok: true,
      queued: true,
    })) as unknown as FlowDeps['writeNodes'];
    const res = await onIncidentReported(baseReport, deps);
    expect(res.ok).toBe(true);
    expect(res.nodeIds).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// runFullChain — creates exactly 7 nodes + 6 edges and closes PDCA
// ────────────────────────────────────────────────────────────────────────

describe('runFullChain', () => {
  it('creates the 7 PDCA nodes + 6 edges in the canonical order', async () => {
    const deps = buildDeps();
    const res = await runFullChain(
      {
        report: baseReport,
        opening: baseOpening,
        conclusion: baseConclusion,
        lesson: baseLesson,
        assignment: baseAssignment,
        completion: baseCompletion,
        closure: baseClosure,
      },
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.nodeIds).toHaveLength(7);
    // 6 edges = causes(1) + derived_from(5).
    expect(res.edgeIds).toHaveLength(6);

    const types = writtenPayloads.map((p) => p.type);
    expect(types).toEqual([
      'incident-reported',
      'investigation-opened',
      'root-cause-identified',
      'lesson-published',
      'microtraining-assigned',
      'microtraining-completed',
      'incident-investigation-closed',
    ]);

    const edgeTypes = writtenEdges.map((e) => e.type);
    expect(edgeTypes).toEqual([
      'causes',
      'derived_from',
      'derived_from',
      'derived_from',
      'derived_from',
      'derived_from',
    ]);

    // Every step produced a perStep entry.
    expect(Object.keys(res.perStep).sort()).toEqual([
      'assignment',
      'closure',
      'completion',
      'conclusion',
      'lesson',
      'opening',
      'report',
    ]);
  });

  it('aborts the chain when an early step fails', async () => {
    const deps = buildDeps();
    let calls = 0;
    deps.writeNodes = vi.fn(async () => {
      calls += 1;
      // Fail the 3rd write (root-cause-identified).
      if (calls === 3) return { ok: false, error: 'rootcause_db_down' };
      return { ok: true };
    }) as unknown as FlowDeps['writeNodes'];

    const res = await runFullChain(
      {
        report: baseReport,
        opening: baseOpening,
        conclusion: baseConclusion,
        lesson: baseLesson,
        assignment: baseAssignment,
        completion: baseCompletion,
        closure: baseClosure,
      },
      deps,
    );
    expect(res.ok).toBe(false);
    expect(res.perStep.conclusion?.ok).toBe(false);
    // Step 4+ should never have been called.
    expect(res.perStep.lesson).toBeUndefined();
    expect(res.perStep.assignment).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// computePdcaStatus — reducer over chain node refs
// ────────────────────────────────────────────────────────────────────────

describe('computePdcaStatus', () => {
  function makeNode(
    type: ChainNodeRef['type'],
    workerUid?: string,
  ): ChainNodeRef {
    return {
      nodeId: `n-${type}-${workerUid ?? 'na'}`,
      type,
      workerUid,
    };
  }

  it('returns idle phase when no nodes exist', () => {
    const s = computePdcaStatus('inc-001', []);
    expect(s.phase).toBe('idle');
    expect(s.hasReport).toBe(false);
    expect(s.closurePercent).toBe(0);
  });

  it('walks through phases as nodes appear', () => {
    const nodes: ChainNodeRef[] = [];
    nodes.push(makeNode('incident-reported'));
    expect(computePdcaStatus('inc-001', nodes).phase).toBe('plan');

    nodes.push(makeNode('investigation-opened'));
    expect(computePdcaStatus('inc-001', nodes).phase).toBe('plan');

    nodes.push(makeNode('root-cause-identified'));
    expect(computePdcaStatus('inc-001', nodes).phase).toBe('do');

    nodes.push(makeNode('lesson-published'));
    expect(computePdcaStatus('inc-001', nodes).phase).toBe('check');

    nodes.push(makeNode('microtraining-assigned', 'u-1'));
    nodes.push(makeNode('microtraining-assigned', 'u-2'));
    expect(computePdcaStatus('inc-001', nodes).phase).toBe('act');

    nodes.push(makeNode('microtraining-completed', 'u-1'));
    const partial = computePdcaStatus('inc-001', nodes);
    expect(partial.assignedWorkerCount).toBe(2);
    expect(partial.completedWorkerCount).toBe(1);
    expect(partial.closurePercent).toBe(50);
    expect(partial.isClosed).toBe(false);

    nodes.push(makeNode('microtraining-completed', 'u-2'));
    const full = computePdcaStatus('inc-001', nodes);
    expect(full.closurePercent).toBe(100);

    nodes.push(makeNode('incident-investigation-closed'));
    const closed = computePdcaStatus('inc-001', nodes);
    expect(closed.phase).toBe('closed');
    expect(closed.isClosed).toBe(true);
  });

  it('deduplicates worker uids across multiple assignment / completion nodes', () => {
    const s = computePdcaStatus('inc-001', [
      { nodeId: 'n1', type: 'microtraining-assigned', workerUid: 'u-1' },
      { nodeId: 'n2', type: 'microtraining-assigned', workerUid: 'u-1' },
      { nodeId: 'n3', type: 'microtraining-completed', workerUid: 'u-1' },
      { nodeId: 'n4', type: 'microtraining-completed', workerUid: 'u-1' },
    ]);
    expect(s.assignedWorkerCount).toBe(1);
    expect(s.completedWorkerCount).toBe(1);
    expect(s.closurePercent).toBe(100);
  });

  it('handles assignments without completions safely (0%)', () => {
    const s = computePdcaStatus('inc-001', [
      { nodeId: 'n1', type: 'microtraining-assigned', workerUid: 'u-1' },
    ]);
    expect(s.closurePercent).toBe(0);
  });
});
