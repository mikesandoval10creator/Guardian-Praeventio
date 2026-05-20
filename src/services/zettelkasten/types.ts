// SPDX-License-Identifier: MIT
// Shared Zettelkasten payload types for Bernoulli-driven node generators.
// Pure types only — no IO, no React.

export type RiskNodeSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type BernoulliNodeType =
  | 'hidrante-pressure'
  | 'misting-suppression'
  | 'scaffold-uplift'
  | 'confined-space-vent'
  | 'gas-leak-anomaly'
  | 'mining-extraction'
  | 'hazmat-pipe'
  | 'structural-wind'
  | 'respirator-fatigue'
  | 'pulmonary-altitude'
  | 'micro-wind-energy'
  | 'slope-stability'
  | 'slam-mesh'
  | 'dike-hydrostatic'
  | 'gas-dispersion';

/**
 * Sprint 16 — wider Risk node type that includes Bernoulli generators
 * AND non-Bernoulli node kinds (e.g. the safety-learning node emitted
 * by the daily wisdom-capsule pipeline). Keep `BernoulliNodeType`
 * strict so `bernoulliNodeRegistry` (a `Record<BernoulliNodeType, ...>`)
 * remains exhaustive.
 *
 * Bloque 4.1 — Horómetro → Mantenimiento Preventivo flow adds the four
 * ZK node kinds emitted by `services/zettelkasten/flows/horometroMaintenanceFlow.ts`.
 * These appear in the analytics catalog as `knowledge.zk.node.created`
 * events with `zk_node_kind: 'asset'` (mapped by `toZkNodeKind` in
 * `persistence/writeNode.ts`).
 *
 * Bloque 4.3 — Accidente → Investigación → Lección Aprendida → Capacitación
 * adds the seven PDCA learning-chain node kinds emitted by
 * `services/zettelkasten/flows/incidentLessonTrainingFlow.ts`. Each kind
 * materializes one step of the org-wide PDCA cycle (Plan = investigation
 * opened, Do = root cause, Check = lesson published, Act = microtraining
 * assigned/completed → investigation closed). The orchestrator wires the
 * nodes with typed `derived_from` / `causes` / `references` edges so the
 * full learning trail is a connected sub-graph queryable from
 * `RiskNetwork.tsx` and the PDCAClosePanel UI. Mapped to analytics
 * `zk_node_kind: 'incident'` for `incident-reported` and
 * `'finding'` / `'other'` for the rest via the keyword fallback in
 * `toZkNodeKind`.
 */
export type IncidentLessonTrainingNodeType =
  | 'incident-reported'
  | 'investigation-opened'
  | 'root-cause-identified'
  | 'lesson-published'
  | 'microtraining-assigned'
  | 'microtraining-completed'
  | 'incident-investigation-closed';

export type RiskNodeType =
  | BernoulliNodeType
  | 'safety-learning'
  | 'horometro-reading'
  | 'maintenance-threshold-reached'
  | 'maintenance-task-created'
  | 'maintenance-task-completed'
  | IncidentLessonTrainingNodeType;

export interface RiskNodePayload {
  /** Node title (Spanish, short). */
  title: string;
  /** Multi-line Spanish description with calculation summary + standard reference. */
  description: string;
  /** Discriminator for the Zettelkasten edge router. */
  type: RiskNodeType;
  /** Severity inferred from threshold breach. */
  severity: RiskNodeSeverity;
  /** Pre-computed numeric outputs used by downstream alerting/UI. */
  metadata: Record<string, number | string | boolean | null>;
  /** Outgoing connections — entity IDs (project, worker, sensor, etc.). */
  connections: string[];
  /** Standards cited (NCh / DS / NFPA / NIOSH / ANSI). */
  references: string[];
}
