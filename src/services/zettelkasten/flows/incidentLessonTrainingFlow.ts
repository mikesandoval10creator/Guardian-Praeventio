// Praeventio Guard — Bloque 4.3:
// Accidente → Investigación → Lección Aprendida → Capacitación PDCA flow.
//
// Closes the org-wide PDCA loop for safety learning by materializing each
// step as a Zettelkasten node + typed edge to the previous step. The
// connected sub-graph is the auditable "we learned X from incident Y and
// trained N workers in M minutes" trail demanded by ISO 45001 §10.2.
//
// PDCA mapping:
//   - Plan  → investigation-opened
//   - Do    → root-cause-identified
//   - Check → lesson-published
//   - Act   → microtraining-assigned, microtraining-completed
//   - Close → incident-investigation-closed
//
// Chain (each arrow = a typed edge):
//   incident-reported
//     -[causes]→ investigation-opened
//       -[derived_from]→ root-cause-identified
//         -[derived_from]→ lesson-published
//           -[derived_from]→ microtraining-assigned (one per worker)
//             -[derived_from]→ microtraining-completed (one per worker who completes)
//               -[derived_from]→ incident-investigation-closed
//
// Founder directive (`product_organic_structure_2026-05-04`): nunca XP
// negativo por factores incontrolables. The flow is positive-only — every
// step that closes is a learning win, even when the worker fails the quiz
// (the assignment stays open until they pass; the node simply remains in
// the "assigned" state and the closure percentage drops accordingly).
//
// Founder directive (`product_signing_no_blocking_directives_2026-05-06`):
// nunca push a APIs externas (SUSESO / MINSAL / OSHA / etc). This flow is
// 100% internal — it writes to `tenants/{tenantId}/zettelkasten_nodes`
// and `tenants/{tenantId}/zettelkasten_edges` only.
//
// Design notes:
//   - NodeFactory functions are pure: they produce `RiskNodePayload`
//     objects with deterministic shape so `nodeIdFor(payload, projectId)`
//     yields a stable hash. Re-firing the same step is idempotent.
//   - The orchestrator (`onIncidentReported`, `onInvestigationConcluded`,
//     `onMicrotrainingCompleted`) takes injected `writeNodes` + `createEdge`
//     so tests can drive the chain without touching Firestore/fetch.
//   - The edge layer (`services/zettelkasten/edges.ts`) materializes edges
//     in the canonical direction; bidirectional queries use the inverse
//     label cached on the same row.
//   - `RiskNodePayload.type` was extended in `types.ts` with
//     `IncidentLessonTrainingNodeType` so the writer accepts these kinds.

import type {
  RiskNodePayload,
  RiskNodeSeverity,
  IncidentLessonTrainingNodeType,
} from '../types.js';
import { writeNodes as defaultWriteNodes, nodeIdFor } from '../persistence/writeNode.js';
import {
  createEdge as defaultCreateEdge,
  type EdgeStore,
  type EdgeType,
  type ZkEdge,
} from '../edges.js';

// ────────────────────────────────────────────────────────────────────────
// Public input shapes — what callers (CQRS handlers / route layer) provide
// ────────────────────────────────────────────────────────────────────────

/** Incident report inputs — minimal field set the orchestrator needs. */
export interface IncidentReportInput {
  /** Stable id of the incident aggregate (CQRS aggregateId). */
  incidentId: string;
  projectId: string;
  tenantId: string;
  /** uid of the worker who reported the incident. */
  reportedByUid: string;
  /** uids of workers involved in the event (may be empty). */
  involvedWorkerUids: string[];
  /** ISO-8601 of when the event happened. */
  occurredAtIso: string;
  /** Short free-text describing the event. */
  description: string;
  /** Severity bucket (mapped to `RiskNodeSeverity`). */
  severity: RiskNodeSeverity;
  /** Free-text location (faena / area / mina-norte). */
  location?: string;
  /** Optional storage url for an attached photo. */
  photoStorageUrl?: string;
}

/** Investigation opening inputs — admin/supervisor side. */
export interface InvestigationOpeningInput {
  incidentId: string;
  projectId: string;
  tenantId: string;
  /** uid of the investigator assigned. */
  investigatorUid: string;
  /** ISO-8601 of when the investigation was opened. */
  openedAtIso: string;
  /** Initial scope notes. */
  scopeNotes: string;
}

/** Investigation conclusion inputs — admin attaches root cause + lesson. */
export interface InvestigationConclusionInput {
  incidentId: string;
  projectId: string;
  tenantId: string;
  /** uid that closed the investigation. */
  closedByUid: string;
  /** ISO-8601 of when the investigation concluded. */
  concludedAtIso: string;
  /** No-blame root cause summary (≥20 chars demanded by CQRS handler). */
  rootCauseSummary: string;
  /** Systemic factor — `procedure` / `training` / `supervision` / etc. */
  contributingFactor?: string;
  /** Preventive actions (ISO 45001 §10.2 requires ≥1). */
  preventiveActions: string[];
}

/** Lesson publication inputs — admin curates lesson + audience. */
export interface LessonPublicationInput {
  incidentId: string;
  projectId: string;
  tenantId: string;
  /** Stable lesson id (`lesson-${slug}` or `lesson-${incidentId}-${n}`). */
  lessonId: string;
  /** uid of the publisher. */
  publishedByUid: string;
  /** ISO-8601 of publication. */
  publishedAtIso: string;
  /** Human summary (≤2000 chars). */
  summary: string;
  /** Audience uids — workers that should receive a microtraining. */
  audienceUids: string[];
  /** Free-text tags (≤50). */
  tags: string[];
  /** Risk categories the lesson covers (≤50). */
  riskCategories: string[];
}

/** Microtraining assignment inputs — one per affected worker. */
export interface MicrotrainingAssignmentInput {
  incidentId: string;
  projectId: string;
  tenantId: string;
  /** Stable id `mt-assign-${incidentId}-${workerUid}` so re-firing is idempotent. */
  assignmentId: string;
  /** Microtraining catalog id (`mt-altura-v1`, `mt-electrico-v1`, etc.). */
  moduleId: string;
  /** Worker receiving the assignment. */
  workerUid: string;
  /** uid that issued the assignment (admin/supervisor). */
  assignedByUid: string;
  /** ISO-8601 of assignment. */
  assignedAtIso: string;
  /** Lesson id that originated this assignment (links chain back). */
  derivedFromLessonId: string;
}

/** Microtraining completion inputs — worker finished the quiz. */
export interface MicrotrainingCompletionInput {
  incidentId: string;
  projectId: string;
  tenantId: string;
  assignmentId: string;
  moduleId: string;
  workerUid: string;
  /** ISO-8601 of completion. */
  completedAtIso: string;
  /** Quiz score 0-100 (canonical from `scoreSession`). */
  score: number;
  /** True if the canonical pass threshold (80) was met. */
  passed: boolean;
  /** True if the module emitted a cert (`shouldCertify`). */
  certified: boolean;
}

/** Investigation closure inputs — PDCA close after enough trainings landed. */
export interface InvestigationClosureInput {
  incidentId: string;
  projectId: string;
  tenantId: string;
  closedByUid: string;
  closedAtIso: string;
  /** Percentage of assigned workers that completed (0-100). */
  closurePercent: number;
  /** Closing remarks summarising preventive actions verified. */
  closingNotes: string;
}

// ────────────────────────────────────────────────────────────────────────
// NodeFactory functions — pure, deterministic, no I/O
// ────────────────────────────────────────────────────────────────────────

const TRUNC = (s: string, max: number): string =>
  s.length <= max ? s : s.slice(0, max - 1) + '…';

/**
 * Create the entry node for the chain. References:
 *   - Ley 16.744 (Chilean OSH base law that mandates reporting).
 *   - ISO 45001 §10.2 (corrective action triggered by incident).
 */
export function createIncidentReportedNode(input: IncidentReportInput): RiskNodePayload {
  const refs = ['Ley-16744', 'ISO-45001'];
  const connections = [
    `project:${input.projectId}`,
    `incident:${input.incidentId}`,
    `worker:${input.reportedByUid}`,
    ...input.involvedWorkerUids.map((u) => `worker:${u}`),
  ];
  return {
    title: TRUNC(`Accidente reportado · ${input.description}`, 120),
    description: [
      `Reporte inicial del incidente ${input.incidentId}.`,
      `Severidad: ${input.severity}.`,
      input.location ? `Ubicacion: ${input.location}.` : null,
      `Reportado por uid ${input.reportedByUid} a las ${input.occurredAtIso}.`,
      input.involvedWorkerUids.length > 0
        ? `Trabajadores involucrados: ${input.involvedWorkerUids.length}.`
        : 'Sin trabajadores adicionales involucrados.',
    ]
      .filter((l): l is string => Boolean(l))
      .join('\n'),
    type: 'incident-reported',
    severity: input.severity,
    metadata: {
      incidentId: input.incidentId,
      reportedByUid: input.reportedByUid,
      occurredAtIso: input.occurredAtIso,
      involvedWorkerCount: input.involvedWorkerUids.length,
      location: input.location ?? null,
      photoStorageUrl: input.photoStorageUrl ?? null,
      pdcaStep: 'report',
    },
    connections,
    references: refs,
  };
}

/**
 * Create the "investigation opened" node. PDCA = Plan. References:
 *   - Ley 16.744 art. 76 (mandates investigation).
 *   - ISO 45001 §10.2 (investigation + corrective action loop).
 */
export function createInvestigationOpenedNode(
  input: InvestigationOpeningInput,
): RiskNodePayload {
  return {
    title: TRUNC(`Investigacion abierta · ${input.incidentId}`, 120),
    description: [
      `Investigacion no-punitiva del incidente ${input.incidentId} abierta.`,
      `Investigador asignado: uid ${input.investigatorUid}.`,
      `Abierta a las ${input.openedAtIso}.`,
      `Alcance inicial: ${TRUNC(input.scopeNotes, 240)}`,
    ].join('\n'),
    type: 'investigation-opened',
    severity: 'medium',
    metadata: {
      incidentId: input.incidentId,
      investigatorUid: input.investigatorUid,
      openedAtIso: input.openedAtIso,
      pdcaStep: 'plan',
    },
    connections: [
      `project:${input.projectId}`,
      `incident:${input.incidentId}`,
      `worker:${input.investigatorUid}`,
    ],
    references: ['Ley-16744', 'ISO-45001'],
  };
}

/**
 * Create the "root cause identified" node. PDCA = Do (execute analysis).
 * References:
 *   - ISO 45001 §10.2 (causal analysis).
 *   - `services/rootCause/noBlameInvestigation.ts` for the
 *     PunitiveLanguage analyzer that gates the rootCauseSummary text.
 */
export function createRootCauseNode(
  input: InvestigationConclusionInput,
): RiskNodePayload {
  return {
    title: TRUNC(`Causa raiz · ${input.incidentId}`, 120),
    description: [
      `Causa raiz no-punitiva: ${TRUNC(input.rootCauseSummary, 800)}`,
      input.contributingFactor ? `Factor contributivo: ${input.contributingFactor}.` : null,
      `Acciones preventivas (${input.preventiveActions.length}):`,
      ...input.preventiveActions.map((a, i) => `  ${i + 1}. ${TRUNC(a, 240)}`),
      `Concluida por uid ${input.closedByUid} a las ${input.concludedAtIso}.`,
    ]
      .filter((l): l is string => Boolean(l))
      .join('\n'),
    type: 'root-cause-identified',
    severity: 'medium',
    metadata: {
      incidentId: input.incidentId,
      closedByUid: input.closedByUid,
      concludedAtIso: input.concludedAtIso,
      preventiveActionCount: input.preventiveActions.length,
      contributingFactor: input.contributingFactor ?? null,
      pdcaStep: 'do',
    },
    connections: [
      `project:${input.projectId}`,
      `incident:${input.incidentId}`,
      `worker:${input.closedByUid}`,
    ],
    references: ['ISO-45001', 'Ley-16744'],
  };
}

/**
 * Create the "lesson published" node. PDCA = Check (verify the learning is
 * captured and ready to share). References:
 *   - F.12 Lessons Library (`services/lessonsLearned/lessonsLibrary.ts`).
 *   - ISO 45001 §7.4 (communication of OH&S information).
 */
export function createLessonPublishedNode(
  input: LessonPublicationInput,
): RiskNodePayload {
  return {
    title: TRUNC(`Leccion publicada · ${input.lessonId}`, 120),
    description: [
      `Leccion aprendida: ${TRUNC(input.summary, 800)}`,
      input.tags.length > 0 ? `Tags: ${input.tags.join(', ')}.` : null,
      input.riskCategories.length > 0
        ? `Categorias de riesgo: ${input.riskCategories.join(', ')}.`
        : null,
      `Audiencia: ${input.audienceUids.length} trabajador(es).`,
      `Publicada por uid ${input.publishedByUid} a las ${input.publishedAtIso}.`,
    ]
      .filter((l): l is string => Boolean(l))
      .join('\n'),
    type: 'lesson-published',
    severity: 'info',
    metadata: {
      incidentId: input.incidentId,
      lessonId: input.lessonId,
      publishedByUid: input.publishedByUid,
      publishedAtIso: input.publishedAtIso,
      audienceCount: input.audienceUids.length,
      tagCount: input.tags.length,
      riskCategoryCount: input.riskCategories.length,
      pdcaStep: 'check',
    },
    connections: [
      `project:${input.projectId}`,
      `incident:${input.incidentId}`,
      `lesson:${input.lessonId}`,
      ...input.audienceUids.map((u) => `worker:${u}`),
    ],
    references: ['ISO-45001'],
  };
}

/**
 * Create one "microtraining assigned" node per worker. PDCA = Act. The
 * `assignmentId` is the stable id so re-firing is a no-op.
 */
export function createMicrotrainingAssignedNode(
  input: MicrotrainingAssignmentInput,
): RiskNodePayload {
  return {
    title: TRUNC(
      `Microcapacitacion asignada · ${input.moduleId} → ${input.workerUid}`,
      120,
    ),
    description: [
      `Microcapacitacion ${input.moduleId} asignada al trabajador uid ${input.workerUid}.`,
      `Derivada de la leccion ${input.derivedFromLessonId}.`,
      `Asignada por uid ${input.assignedByUid} a las ${input.assignedAtIso}.`,
    ].join('\n'),
    type: 'microtraining-assigned',
    severity: 'info',
    metadata: {
      incidentId: input.incidentId,
      assignmentId: input.assignmentId,
      moduleId: input.moduleId,
      workerUid: input.workerUid,
      assignedByUid: input.assignedByUid,
      assignedAtIso: input.assignedAtIso,
      derivedFromLessonId: input.derivedFromLessonId,
      pdcaStep: 'act',
    },
    connections: [
      `project:${input.projectId}`,
      `incident:${input.incidentId}`,
      `worker:${input.workerUid}`,
      `module:${input.moduleId}`,
      `lesson:${input.derivedFromLessonId}`,
    ],
    references: ['ISO-45001'],
  };
}

/**
 * Create one "microtraining completed" node when the worker finishes. PDCA
 * = Act (verified). Founder directive: nunca XP negativo — failing the
 * quiz is still a learning event; we record the score honestly but the
 * node is `info` severity, never punitive.
 */
export function createMicrotrainingCompletedNode(
  input: MicrotrainingCompletionInput,
): RiskNodePayload {
  return {
    title: TRUNC(
      `Microcapacitacion completada · ${input.moduleId} (${input.score}/100)`,
      120,
    ),
    description: [
      `Microcapacitacion ${input.moduleId} completada por uid ${input.workerUid}.`,
      `Puntaje canonico: ${input.score}/100. ${input.passed ? 'Aprobada.' : 'No aprobada — reasignacion pendiente.'}`,
      input.certified ? 'Certificacion emitida.' : 'Sin certificacion (modulo no certifyOnPass o puntaje insuficiente).',
      `Completada a las ${input.completedAtIso}.`,
    ].join('\n'),
    type: 'microtraining-completed',
    severity: 'info',
    metadata: {
      incidentId: input.incidentId,
      assignmentId: input.assignmentId,
      moduleId: input.moduleId,
      workerUid: input.workerUid,
      completedAtIso: input.completedAtIso,
      score: input.score,
      passed: input.passed,
      certified: input.certified,
      pdcaStep: 'act',
    },
    connections: [
      `project:${input.projectId}`,
      `incident:${input.incidentId}`,
      `worker:${input.workerUid}`,
      `module:${input.moduleId}`,
    ],
    references: ['ISO-45001'],
  };
}

/**
 * Create the closure node. References:
 *   - Ley 16.744 (chilean OSH base law).
 *   - ISO 45001 §10.2 (corrective action verification).
 */
export function createInvestigationClosedNode(
  input: InvestigationClosureInput,
): RiskNodePayload {
  return {
    title: TRUNC(`Investigacion cerrada · ${input.incidentId} (${input.closurePercent}%)`, 120),
    description: [
      `Investigacion del incidente ${input.incidentId} cerrada — ciclo PDCA completo.`,
      `Porcentaje de capacitaciones completadas: ${input.closurePercent}%.`,
      `Notas de cierre: ${TRUNC(input.closingNotes, 800)}`,
      `Cerrada por uid ${input.closedByUid} a las ${input.closedAtIso}.`,
    ].join('\n'),
    type: 'incident-investigation-closed',
    severity: 'info',
    metadata: {
      incidentId: input.incidentId,
      closedByUid: input.closedByUid,
      closedAtIso: input.closedAtIso,
      closurePercent: input.closurePercent,
      pdcaStep: 'close',
    },
    connections: [
      `project:${input.projectId}`,
      `incident:${input.incidentId}`,
      `worker:${input.closedByUid}`,
    ],
    references: ['Ley-16744', 'ISO-45001'],
  };
}

// ────────────────────────────────────────────────────────────────────────
// Orchestrator — wires nodes + edges, idempotent via deterministic ids
// ────────────────────────────────────────────────────────────────────────

/** Dependency-injected writers so tests can swap implementations. */
export interface FlowDeps {
  /** Defaults to the production `writeNodes` in `persistence/writeNode.ts`. */
  writeNodes?: typeof defaultWriteNodes;
  /** Defaults to `createEdge` from `edges.ts`. Requires an `EdgeStore`. */
  createEdge?: (
    input: Parameters<typeof defaultCreateEdge>[1],
  ) => Promise<ZkEdge>;
  /** Override `nodeIdFor` for tests (rare). */
  nodeIdFor?: typeof nodeIdFor;
}

/** Result returned by each orchestrator step. */
export interface StepResult {
  ok: boolean;
  nodeIds: string[];
  edgeIds: string[];
  error?: string;
}

interface EdgeWriteInput {
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  tenantId: string;
  createdBy: string;
  projectId?: string;
}

async function writeOneNode(
  payload: RiskNodePayload,
  projectId: string,
  deps: FlowDeps,
): Promise<string | null> {
  const writer = deps.writeNodes ?? defaultWriteNodes;
  const idFn = deps.nodeIdFor ?? nodeIdFor;
  const id = await idFn(payload, projectId);
  const res = await writer([payload], { projectId });
  if (!res.ok && !res.queued) return null;
  return id;
}

async function writeOneEdge(
  edgeInput: EdgeWriteInput,
  deps: FlowDeps,
): Promise<string | null> {
  if (!deps.createEdge) return null;
  try {
    const edge = await deps.createEdge(edgeInput);
    return edge.id;
  } catch {
    return null;
  }
}

/**
 * Step 1 — Worker reported an accident. Writes the `incident-reported`
 * node only. No edges yet (this is the chain root).
 */
export async function onIncidentReported(
  input: IncidentReportInput,
  deps: FlowDeps = {},
): Promise<StepResult> {
  const payload = createIncidentReportedNode(input);
  const nodeId = await writeOneNode(payload, input.projectId, deps);
  if (!nodeId) {
    return { ok: false, nodeIds: [], edgeIds: [], error: 'write_failed' };
  }
  return { ok: true, nodeIds: [nodeId], edgeIds: [] };
}

/**
 * Step 2 — Admin/supervisor opens the investigation. Writes the
 * `investigation-opened` node and a `causes` edge from the incident
 * report node (`incident-reported` causes `investigation-opened`).
 */
export async function onInvestigationOpened(
  input: InvestigationOpeningInput,
  /** Id of the `incident-reported` node — caller computes via `nodeIdFor`. */
  reportNodeId: string,
  deps: FlowDeps = {},
): Promise<StepResult> {
  const payload = createInvestigationOpenedNode(input);
  const nodeId = await writeOneNode(payload, input.projectId, deps);
  if (!nodeId) {
    return { ok: false, nodeIds: [], edgeIds: [], error: 'write_failed' };
  }
  const edgeIds: string[] = [];
  const edgeId = await writeOneEdge(
    {
      fromNodeId: reportNodeId,
      toNodeId: nodeId,
      type: 'causes',
      tenantId: input.tenantId,
      createdBy: input.investigatorUid,
      projectId: input.projectId,
    },
    deps,
  );
  if (edgeId) edgeIds.push(edgeId);
  return { ok: true, nodeIds: [nodeId], edgeIds };
}

/**
 * Step 3 — Investigator concludes the analysis. Writes the
 * `root-cause-identified` node + `derived_from` edge from
 * `investigation-opened`.
 */
export async function onInvestigationConcluded(
  input: InvestigationConclusionInput,
  /** Id of the `investigation-opened` node. */
  investigationOpenedNodeId: string,
  deps: FlowDeps = {},
): Promise<StepResult> {
  const payload = createRootCauseNode(input);
  const nodeId = await writeOneNode(payload, input.projectId, deps);
  if (!nodeId) {
    return { ok: false, nodeIds: [], edgeIds: [], error: 'write_failed' };
  }
  const edgeIds: string[] = [];
  const edgeId = await writeOneEdge(
    {
      fromNodeId: nodeId,
      toNodeId: investigationOpenedNodeId,
      type: 'derived_from',
      tenantId: input.tenantId,
      createdBy: input.closedByUid,
      projectId: input.projectId,
    },
    deps,
  );
  if (edgeId) edgeIds.push(edgeId);
  return { ok: true, nodeIds: [nodeId], edgeIds };
}

/**
 * Step 4 — Admin publishes the lesson. Writes `lesson-published` +
 * `derived_from` edge from `root-cause-identified`.
 */
export async function onLessonPublished(
  input: LessonPublicationInput,
  /** Id of the `root-cause-identified` node. */
  rootCauseNodeId: string,
  deps: FlowDeps = {},
): Promise<StepResult> {
  const payload = createLessonPublishedNode(input);
  const nodeId = await writeOneNode(payload, input.projectId, deps);
  if (!nodeId) {
    return { ok: false, nodeIds: [], edgeIds: [], error: 'write_failed' };
  }
  const edgeIds: string[] = [];
  const edgeId = await writeOneEdge(
    {
      fromNodeId: nodeId,
      toNodeId: rootCauseNodeId,
      type: 'derived_from',
      tenantId: input.tenantId,
      createdBy: input.publishedByUid,
      projectId: input.projectId,
    },
    deps,
  );
  if (edgeId) edgeIds.push(edgeId);
  return { ok: true, nodeIds: [nodeId], edgeIds };
}

/**
 * Step 5 — Admin assigns microtraining to one worker. One call per worker;
 * the orchestrator at the route level fans this out. Writes
 * `microtraining-assigned` + `derived_from` edge from `lesson-published`.
 */
export async function onMicrotrainingAssigned(
  input: MicrotrainingAssignmentInput,
  /** Id of the `lesson-published` node. */
  lessonNodeId: string,
  deps: FlowDeps = {},
): Promise<StepResult> {
  const payload = createMicrotrainingAssignedNode(input);
  const nodeId = await writeOneNode(payload, input.projectId, deps);
  if (!nodeId) {
    return { ok: false, nodeIds: [], edgeIds: [], error: 'write_failed' };
  }
  const edgeIds: string[] = [];
  const edgeId = await writeOneEdge(
    {
      fromNodeId: nodeId,
      toNodeId: lessonNodeId,
      type: 'derived_from',
      tenantId: input.tenantId,
      createdBy: input.assignedByUid,
      projectId: input.projectId,
    },
    deps,
  );
  if (edgeId) edgeIds.push(edgeId);
  return { ok: true, nodeIds: [nodeId], edgeIds };
}

/**
 * Step 6 — Worker finishes the microtraining. Writes
 * `microtraining-completed` + `derived_from` edge from
 * `microtraining-assigned`.
 */
export async function onMicrotrainingCompleted(
  input: MicrotrainingCompletionInput,
  /** Id of the `microtraining-assigned` node for this worker. */
  assignmentNodeId: string,
  deps: FlowDeps = {},
): Promise<StepResult> {
  const payload = createMicrotrainingCompletedNode(input);
  const nodeId = await writeOneNode(payload, input.projectId, deps);
  if (!nodeId) {
    return { ok: false, nodeIds: [], edgeIds: [], error: 'write_failed' };
  }
  const edgeIds: string[] = [];
  const edgeId = await writeOneEdge(
    {
      fromNodeId: nodeId,
      toNodeId: assignmentNodeId,
      type: 'derived_from',
      tenantId: input.tenantId,
      createdBy: input.workerUid,
      projectId: input.projectId,
    },
    deps,
  );
  if (edgeId) edgeIds.push(edgeId);
  return { ok: true, nodeIds: [nodeId], edgeIds };
}

/**
 * Step 7 — Admin closes the investigation (PDCA Act). Writes
 * `incident-investigation-closed` + `derived_from` edge from the last
 * `microtraining-completed` node (caller decides which). The
 * `closurePercent` quantifies how much of the audience completed.
 */
export async function onInvestigationClosed(
  input: InvestigationClosureInput,
  /** Id of any `microtraining-completed` node that anchors the close (typically the most recent). */
  completionNodeId: string,
  deps: FlowDeps = {},
): Promise<StepResult> {
  const payload = createInvestigationClosedNode(input);
  const nodeId = await writeOneNode(payload, input.projectId, deps);
  if (!nodeId) {
    return { ok: false, nodeIds: [], edgeIds: [], error: 'write_failed' };
  }
  const edgeIds: string[] = [];
  const edgeId = await writeOneEdge(
    {
      fromNodeId: nodeId,
      toNodeId: completionNodeId,
      type: 'derived_from',
      tenantId: input.tenantId,
      createdBy: input.closedByUid,
      projectId: input.projectId,
    },
    deps,
  );
  if (edgeId) edgeIds.push(edgeId);
  return { ok: true, nodeIds: [nodeId], edgeIds };
}

// ────────────────────────────────────────────────────────────────────────
// End-to-end helper for tests — drives the whole chain in one call
// ────────────────────────────────────────────────────────────────────────

/**
 * Test/route helper that drives all seven steps in order and returns the
 * full collection of node ids + edge ids created. Each step's node id is
 * computed via `nodeIdFor` BEFORE the next step writes so the next step's
 * edge can reference it (the chain is sequential).
 *
 * Caller is responsible for fanning out per-worker steps (assignments +
 * completions); this helper assumes a single audience worker for
 * simplicity. The route layer (`incidentFlow.ts`) handles the multi-worker
 * case by calling the per-step orchestrators directly.
 */
export interface FullChainInput {
  report: IncidentReportInput;
  opening: InvestigationOpeningInput;
  conclusion: InvestigationConclusionInput;
  lesson: LessonPublicationInput;
  assignment: MicrotrainingAssignmentInput;
  completion: MicrotrainingCompletionInput;
  closure: InvestigationClosureInput;
}

export async function runFullChain(
  input: FullChainInput,
  deps: FlowDeps = {},
): Promise<{
  ok: boolean;
  nodeIds: string[];
  edgeIds: string[];
  perStep: Record<string, StepResult>;
}> {
  const perStep: Record<string, StepResult> = {};
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];

  const r1 = await onIncidentReported(input.report, deps);
  perStep.report = r1;
  if (!r1.ok) return { ok: false, nodeIds, edgeIds, perStep };
  nodeIds.push(...r1.nodeIds);
  edgeIds.push(...r1.edgeIds);

  const r2 = await onInvestigationOpened(input.opening, r1.nodeIds[0], deps);
  perStep.opening = r2;
  if (!r2.ok) return { ok: false, nodeIds, edgeIds, perStep };
  nodeIds.push(...r2.nodeIds);
  edgeIds.push(...r2.edgeIds);

  const r3 = await onInvestigationConcluded(input.conclusion, r2.nodeIds[0], deps);
  perStep.conclusion = r3;
  if (!r3.ok) return { ok: false, nodeIds, edgeIds, perStep };
  nodeIds.push(...r3.nodeIds);
  edgeIds.push(...r3.edgeIds);

  const r4 = await onLessonPublished(input.lesson, r3.nodeIds[0], deps);
  perStep.lesson = r4;
  if (!r4.ok) return { ok: false, nodeIds, edgeIds, perStep };
  nodeIds.push(...r4.nodeIds);
  edgeIds.push(...r4.edgeIds);

  const r5 = await onMicrotrainingAssigned(input.assignment, r4.nodeIds[0], deps);
  perStep.assignment = r5;
  if (!r5.ok) return { ok: false, nodeIds, edgeIds, perStep };
  nodeIds.push(...r5.nodeIds);
  edgeIds.push(...r5.edgeIds);

  const r6 = await onMicrotrainingCompleted(input.completion, r5.nodeIds[0], deps);
  perStep.completion = r6;
  if (!r6.ok) return { ok: false, nodeIds, edgeIds, perStep };
  nodeIds.push(...r6.nodeIds);
  edgeIds.push(...r6.edgeIds);

  const r7 = await onInvestigationClosed(input.closure, r6.nodeIds[0], deps);
  perStep.closure = r7;
  if (!r7.ok) return { ok: false, nodeIds, edgeIds, perStep };
  nodeIds.push(...r7.nodeIds);
  edgeIds.push(...r7.edgeIds);

  return { ok: true, nodeIds, edgeIds, perStep };
}

// ────────────────────────────────────────────────────────────────────────
// PDCA status helper — what the GET /:projectId/incident-flow/:incidentId/status
// route returns. Pure: caller passes the node specs it has already loaded
// from Firestore; this function computes the closure %.
// ────────────────────────────────────────────────────────────────────────

export interface ChainNodeRef {
  nodeId: string;
  type: IncidentLessonTrainingNodeType;
  workerUid?: string;
  /** ISO when the node was created. */
  createdAt?: string;
}

export interface PdcaStatus {
  incidentId: string;
  hasReport: boolean;
  hasOpening: boolean;
  hasRootCause: boolean;
  hasLesson: boolean;
  assignedWorkerCount: number;
  completedWorkerCount: number;
  closurePercent: number;
  isClosed: boolean;
  /** PDCA phase the incident is currently in. */
  phase: 'idle' | 'plan' | 'do' | 'check' | 'act' | 'closed';
}

export function computePdcaStatus(
  incidentId: string,
  nodes: ChainNodeRef[],
): PdcaStatus {
  const hasReport = nodes.some((n) => n.type === 'incident-reported');
  const hasOpening = nodes.some((n) => n.type === 'investigation-opened');
  const hasRootCause = nodes.some((n) => n.type === 'root-cause-identified');
  const hasLesson = nodes.some((n) => n.type === 'lesson-published');
  const assignments = nodes.filter((n) => n.type === 'microtraining-assigned');
  const completions = nodes.filter((n) => n.type === 'microtraining-completed');
  const isClosed = nodes.some((n) => n.type === 'incident-investigation-closed');

  const assignedWorkers = new Set(
    assignments.map((n) => n.workerUid).filter((u): u is string => Boolean(u)),
  );
  const completedWorkers = new Set(
    completions.map((n) => n.workerUid).filter((u): u is string => Boolean(u)),
  );

  // Closure % = workers who completed / workers who were assigned. If no
  // assignments exist yet we report 0 (no audience to close on).
  const closurePercent =
    assignedWorkers.size === 0
      ? 0
      : Math.round((completedWorkers.size / assignedWorkers.size) * 100);

  let phase: PdcaStatus['phase'] = 'idle';
  if (isClosed) phase = 'closed';
  else if (assignedWorkers.size > 0 || completedWorkers.size > 0) phase = 'act';
  else if (hasLesson) phase = 'check';
  else if (hasRootCause) phase = 'do';
  else if (hasOpening) phase = 'plan';
  else if (hasReport) phase = 'plan';

  return {
    incidentId,
    hasReport,
    hasOpening,
    hasRootCause,
    hasLesson,
    assignedWorkerCount: assignedWorkers.size,
    completedWorkerCount: completedWorkers.size,
    closurePercent,
    isClosed,
    phase,
  };
}

// Re-export EdgeStore so callers wiring this from a route can give the
// orchestrator a Firestore-backed store without re-importing edges.ts.
export type { EdgeStore };

// Re-export the node-type union so route + UI consumers can `import type`
// from a single module rather than reaching back into `types.ts`.
export type { IncidentLessonTrainingNodeType };
