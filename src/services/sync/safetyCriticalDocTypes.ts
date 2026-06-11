// Praeventio Guard — TODO.md §16.2.2: safety-critical doc types.
//
// Design requirement (archive/IMPLEMENTATION_ROADMAP.md:1083-1102, carried
// into TODO.md §16.2.2, CRITICAL): for the five safety doc types
// (`inspection`, `incident_report`, `emergency_alert`, `medical_record`,
// `training_completion`) the sync layer must NEVER apply last-write-wins.
// Any offline/remote divergence requires explicit HUMAN resolution via the
// durable `conflict_queue` (engine: `conflictQueue.ts`, HTTP surface:
// `src/server/routes/conflictQueue.ts`).
//
// This module is the single canonical definition of that set, plus the
// mappings the matrixSyncManager needs to classify its queued RiskNode
// operations:
//   • NodeType (es-CL labels in `src/types`) → safety doc type, and
//   • safety doc type → conflictResolver `DocType`, whose
//     `ALWAYS_REQUIRES_HUMAN_RESOLUTION` semantics make EVERY diverging
//     field critical (no silent merge).
//
// Pure module — no React, no Firestore, no side effects.

import type { DocType } from './conflictResolver';

export type SafetyCriticalDocType =
  | 'inspection'
  | 'incident_report'
  | 'emergency_alert'
  | 'medical_record'
  | 'training_completion';

/**
 * §16.2.2 — the exact five doc types for which last-write-wins is BANNED.
 * Two offline edits of the same document of these types must both be
 * preserved and routed to a human supervisor.
 */
export const SAFETY_CRITICAL_DOC_TYPES: ReadonlySet<SafetyCriticalDocType> =
  new Set<SafetyCriticalDocType>([
    'inspection',
    'incident_report',
    'emergency_alert',
    'medical_record',
    'training_completion',
  ]);

/**
 * Map each safety doc type to the conflictResolver `DocType` used by
 * `detectConflicts`. These resolver types are all listed in
 * `ALWAYS_REQUIRES_HUMAN_RESOLUTION`, so every diverging field is flagged
 * `critical: true` — the resolver never auto-merges them.
 */
export const RESOLVER_DOC_TYPE_BY_SAFETY_TYPE: Record<SafetyCriticalDocType, DocType> = {
  inspection: 'Inspection',
  incident_report: 'IncidentReport',
  emergency_alert: 'EmergencyAlert',
  medical_record: 'MedicalRecord',
  training_completion: 'TrainingCompletion',
};

/**
 * RiskNode `type` labels (es-CL enum values from `src/types` NodeType)
 * that carry safety-critical semantics. The matrixSyncManager queue is
 * keyed by RiskNode, so this is how a queued op is classified.
 */
const SAFETY_DOC_TYPE_BY_NODE_TYPE: Record<string, SafetyCriticalDocType> = {
  // NodeType.INSPECTION
  'Inspección': 'inspection',
  // NodeType.INCIDENT
  'Incidente': 'incident_report',
  // NodeType.EMERGENCY
  'Emergencia': 'emergency_alert',
  // NodeType.MEDICINE
  'Medicina': 'medical_record',
  // NodeType.TRAINING
  'Capacitación': 'training_completion',
};

/**
 * Classify a RiskNode `type` label. Returns the safety doc type when the
 * node is safety-critical (→ conflict diversion required), or `null` for
 * every other node type (→ existing sync behavior untouched).
 */
export function safetyDocTypeForNodeType(
  nodeType: string | undefined | null,
): SafetyCriticalDocType | null {
  if (!nodeType) return null;
  return SAFETY_DOC_TYPE_BY_NODE_TYPE[nodeType] ?? null;
}
