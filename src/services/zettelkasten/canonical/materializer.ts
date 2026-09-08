// Praeventio Guard — Sprint 39 Fase D.8.c: Zettelkasten canonical materializer.
//
// Cierra: Plan Fase D.8.c "Zettelkasten canonical: `nodes` collection
//         única; materializer Cloud Function; migrar lectores."
//
// El problema: la app tenía DOS colecciones competing:
//   - `zettelkasten_nodes` (escrita por los 15 generadores Bernoulli +
//     handlers de incidentPostmortem; payload con `RiskNodePayload`)
//   - `nodes` (leída por el cliente con el shape `RiskNode` de
//     `src/types/index.ts`)
//
// Esta función pura mapea uno al otro. Es la pieza canónica que la
// Cloud Function materializer (onWrite trigger sobre
// `tenants/{tid}/zettelkasten_nodes/*`) usará para sincronizar el
// shape de cliente.
//
// 100% determinístico — sin I/O, sin firebase. Eso permite tests
// hermets + reuso en migración offline (CLI) sin tocar emulador.

import type { RiskNodePayload, RiskNodeSeverity, RiskNodeType } from '../types.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/** Shape canónico de la colección `nodes`. */
export interface CanonicalNode {
  id: string;
  type: string; // valor del enum NodeType (en español)
  title: string;
  description: string;
  tags: string[];
  metadata: Record<string, unknown>;
  connections: string[];
  projectId?: string;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
  /** Severity propagada al doc para queries eficientes. */
  severity?: RiskNodeSeverity;
  /** Tenant origen (para enforcement multi-tenant). */
  tenantId?: string;
  /** Referencia al tipo de Bernoulli (debugging + analytics). */
  sourceGeneratorType?: string;
  /** Trazabilidad. */
  materializedAt: string;
  materializedFromZkNodeId: string;
}

/** Input del materializer: payload escrito por los generadores + metadata. */
export interface MaterializeInput {
  zkNodeId: string;
  payload: RiskNodePayload;
  projectId: string;
  tenantId?: string;
  /** ISO-8601 cuando se creó (server time del trigger). */
  createdAt?: string;
  /** ISO-8601 cuando se actualizó. */
  updatedAt?: string;
  /** Tags adicionales (ej. ['bernoulli', 'auto']). */
  extraTags?: string[];
  /** Override now para tests. */
  now?: Date;
}

export interface MaterializeValidationIssue {
  code: string;
  field: string;
  message: string;
}

export const MATERIALIZER_LIMITS = {
  id: 256,
  title: 256,
  description: 4096,
  metadataEntries: 100,
  metadataKey: 128,
  metadataString: 4096,
  connections: 200,
  references: 200,
  connectionOrReference: 256,
  extraTags: 50,
  extraTag: 128,
} as const;

const SUPPORTED_RISK_NODE_TYPES = new Set<string>([
  'hidrante-pressure',
  'misting-suppression',
  'scaffold-uplift',
  'confined-space-vent',
  'gas-leak-anomaly',
  'mining-extraction',
  'hazmat-pipe',
  'structural-wind',
  'respirator-fatigue',
  'pulmonary-altitude',
  'micro-wind-energy',
  'slope-stability',
  'slam-mesh',
  'dike-hydrostatic',
  'gas-dispersion',
  'safety-learning',
  'epp_inspection',
  'horometro-reading',
  'maintenance-threshold-reached',
  'maintenance-task-created',
  'maintenance-task-completed',
  'incident-reported',
  'investigation-opened',
  'root-cause-identified',
  'lesson-published',
  'microtraining-assigned',
  'microtraining-completed',
  'incident-investigation-closed',
]);

const VALID_SEVERITIES = new Set<RiskNodeSeverity>([
  'info',
  'low',
  'medium',
  'high',
  'critical',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(code: string, field: string, message: string): MaterializeValidationIssue {
  return { code, field, message };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeMetadataValue(value: unknown): value is number | string | boolean | null {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

export function isKnownRiskNodeType(value: unknown): value is RiskNodeType {
  return typeof value === 'string' && SUPPORTED_RISK_NODE_TYPES.has(value);
}

/**
 * Single runtime validation contract shared by `materializeNode`,
 * `materializeBatch`, and the Firestore trigger boundary.
 *
 * The TypeScript interface protects typed callers; this function protects the
 * runtime boundary where Firestore, migrations, and legacy writers provide
 * untrusted `unknown` data. It returns an issue instead of throwing so batch
 * migration can skip one bad record without losing the rest.
 */
export function validateMaterializeInput(input: unknown): MaterializeValidationIssue | null {
  if (!isRecord(input)) return issue('invalid_input', 'input', 'input must be an object');
  if (!isNonEmptyString(input.zkNodeId)) {
    return issue('missing_zkNodeId', 'zkNodeId', 'zkNodeId must be a non-empty string');
  }
  if (input.zkNodeId.length > MATERIALIZER_LIMITS.id) {
    return issue('zkNodeId_too_long', 'zkNodeId', 'zkNodeId exceeds the maximum length');
  }
  if (!isNonEmptyString(input.projectId)) {
    return issue('missing_projectId', 'projectId', 'projectId must be a non-empty string');
  }
  if (input.projectId.length > MATERIALIZER_LIMITS.id) {
    return issue('projectId_too_long', 'projectId', 'projectId exceeds the maximum length');
  }
  if (input.tenantId !== undefined && !isNonEmptyString(input.tenantId)) {
    return issue('invalid_tenantId', 'tenantId', 'tenantId must be a non-empty string when present');
  }
  if (typeof input.tenantId === 'string' && input.tenantId.length > MATERIALIZER_LIMITS.id) {
    return issue('tenantId_too_long', 'tenantId', 'tenantId exceeds the maximum length');
  }
  if (!isRecord(input.payload)) {
    return issue('invalid_payload', 'payload', 'payload must be an object');
  }

  const payload = input.payload;
  if (!isNonEmptyString(payload.title)) {
    return issue('invalid_payload', 'payload.title', 'title must be a non-empty string');
  }
  if (payload.title.length > MATERIALIZER_LIMITS.title) {
    return issue('title_too_long', 'payload.title', 'title exceeds the maximum length');
  }
  if (!isNonEmptyString(payload.description)) {
    return issue('invalid_description', 'payload.description', 'description must be a non-empty string');
  }
  if (payload.description.length > MATERIALIZER_LIMITS.description) {
    return issue('description_too_long', 'payload.description', 'description exceeds the maximum length');
  }
  if (!isKnownRiskNodeType(payload.type)) {
    return issue('invalid_type', 'payload.type', 'type is not a supported RiskNodeType');
  }
  if (!VALID_SEVERITIES.has(payload.severity as RiskNodeSeverity)) {
    return issue('invalid_severity', 'payload.severity', 'severity is not supported');
  }
  if (!isRecord(payload.metadata)) {
    return issue('invalid_metadata', 'payload.metadata', 'metadata must contain only finite scalar values');
  }
  const metadataEntries = Object.entries(payload.metadata);
  if (metadataEntries.length > MATERIALIZER_LIMITS.metadataEntries) {
    return issue('metadata_too_many', 'payload.metadata', 'metadata has too many entries');
  }
  for (const [key, value] of metadataEntries) {
    if (key.length > MATERIALIZER_LIMITS.metadataKey) {
      return issue('metadata_key_too_long', `payload.metadata.${key}`, 'metadata key exceeds the maximum length');
    }
    if (!isSafeMetadataValue(value)) {
      return issue('invalid_metadata', `payload.metadata.${key}`, 'metadata value must be finite and scalar');
    }
    if (typeof value === 'string' && value.length > MATERIALIZER_LIMITS.metadataString) {
      return issue('metadata_value_too_long', `payload.metadata.${key}`, 'metadata string exceeds the maximum length');
    }
  }
  if (!Array.isArray(payload.connections)
    || payload.connections.some((value) => !isNonEmptyString(value))) {
    return issue('invalid_connections', 'payload.connections', 'connections must be non-empty strings');
  }
  if (payload.connections.length > MATERIALIZER_LIMITS.connections) {
    return issue('connections_too_many', 'payload.connections', 'connections exceed the maximum count');
  }
  if (payload.connections.some((value) => value.length > MATERIALIZER_LIMITS.connectionOrReference)) {
    return issue('connection_too_long', 'payload.connections', 'connection id exceeds the maximum length');
  }
  if (!Array.isArray(payload.references)
    || payload.references.some((value) => !isNonEmptyString(value))) {
    return issue('invalid_references', 'payload.references', 'references must be non-empty strings');
  }
  if (payload.references.length > MATERIALIZER_LIMITS.references) {
    return issue('references_too_many', 'payload.references', 'references exceed the maximum count');
  }
  if (payload.references.some((value) => value.length > MATERIALIZER_LIMITS.connectionOrReference)) {
    return issue('reference_too_long', 'payload.references', 'reference exceeds the maximum length');
  }
  if (input.extraTags !== undefined
    && (!Array.isArray(input.extraTags) || input.extraTags.some((value) => !isNonEmptyString(value)))) {
    return issue('invalid_extraTags', 'extraTags', 'extraTags must be non-empty strings');
  }
  if (Array.isArray(input.extraTags) && input.extraTags.length > MATERIALIZER_LIMITS.extraTags) {
    return issue('extraTags_too_many', 'extraTags', 'extraTags exceed the maximum count');
  }
  if (Array.isArray(input.extraTags)
    && input.extraTags.some((value) => value.length > MATERIALIZER_LIMITS.extraTag)) {
    return issue('extraTag_too_long', 'extraTags', 'extraTag exceeds the maximum length');
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (input[field] !== undefined && !isNonEmptyString(input[field])) {
      return issue(`invalid_${field}`, field, `${field} must be a non-empty string when present`);
    }
  }
  if (input.now !== undefined && (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime()))) {
    return issue('invalid_now', 'now', 'now must be a valid Date when present');
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Type → canonical NodeType mapping
// ────────────────────────────────────────────────────────────────────────

/**
 * Mapea el tipo Bernoulli del generador a un NodeType del enum.
 * Si no encaja, default = 'Riesgo' (la mayoría de generadores son
 * detección de riesgo). Mantenible: añadir entry por cada nuevo
 * generador.
 */
const BERNOULLI_TYPE_TO_NODE_TYPE: Record<string, string> = {
  'hidrante-pressure': 'Riesgo',
  'misting-suppression': 'Control',
  'scaffold-uplift': 'Riesgo',
  'confined-space-vent': 'Control',
  'gas-leak-anomaly': 'Riesgo',
  'mining-extraction': 'Riesgo',
  'hazmat-pipe': 'Riesgo',
  'structural-wind': 'Riesgo',
  'respirator-fatigue': 'Hallazgo',
  'pulmonary-altitude': 'Hallazgo',
  'micro-wind-energy': 'Activo',
  'slope-stability': 'Riesgo',
  'slam-mesh': 'Riesgo',
  'dike-hydrostatic': 'Riesgo',
  'gas-dispersion': 'Riesgo',
  'safety-learning': 'Lección Aprendida',
  // D2 slice 2 — `incident-reported` ZK nodes (incidentFlow + the SafeDriving
  // on-route report endpoint) materialize as NodeType.INCIDENT ('Incidente'),
  // matching what the old client-side `addNode({ type: NodeType.INCIDENT })`
  // wrote, instead of the generic 'Riesgo' fallback.
  'incident-reported': 'Incidente',
};

export function bernoulliTypeToCanonicalNodeType(t: string): string {
  return BERNOULLI_TYPE_TO_NODE_TYPE[t] ?? 'Riesgo';
}

// ────────────────────────────────────────────────────────────────────────
// Materialization
// ────────────────────────────────────────────────────────────────────────

/**
 * Convierte un RiskNodePayload (shape Bernoulli) en un CanonicalNode
 * (shape `nodes` collection). Determinístico, sin I/O.
 */
export function materializeNode(input: MaterializeInput): CanonicalNode {
  const validationIssue = validateMaterializeInput(input);
  if (validationIssue) {
    throw new Error(`${validationIssue.code}: ${validationIssue.message}`);
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  const tags: string[] = ['materialized', ...(input.extraTags ?? [])];
  if (input.payload.severity) tags.push(`sev:${input.payload.severity}`);
  // Dedupe tags conservando orden.
  const seen = new Set<string>();
  const uniqueTags = tags.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });

  const metadata: Record<string, unknown> = {
    ...input.payload.metadata,
    references: input.payload.references,
    sourceType: input.payload.type,
  };

  return {
    id: input.zkNodeId,
    type: bernoulliTypeToCanonicalNodeType(input.payload.type),
    title: input.payload.title,
    description: input.payload.description,
    tags: uniqueTags,
    metadata,
    connections: [...input.payload.connections],
    projectId: input.projectId,
    createdAt: input.createdAt ?? nowIso,
    updatedAt: input.updatedAt ?? nowIso,
    severity: input.payload.severity,
    tenantId: input.tenantId,
    sourceGeneratorType: input.payload.type,
    materializedAt: nowIso,
    materializedFromZkNodeId: input.zkNodeId,
  };
}

/**
 * Inversa: si el cliente edita un CanonicalNode y queremos persistir
 * el cambio de vuelta en zettelkasten_nodes para que un nuevo trigger
 * lo procese, este helper construye un RiskNodePayload re-empacable.
 * (Solo para edits del usuario sobre títulos/descripciones; los
 * generadores Bernoulli son la fuente real para metadata numérica.)
 */
export function dematerializeNode(node: CanonicalNode): RiskNodePayload {
  const sourceType = (node.metadata?.sourceType as RiskNodePayload['type']) ?? 'safety-learning';
  const references = (node.metadata?.references as string[] | undefined) ?? [];
  const meta: Record<string, number | string | boolean | null> = {};
  const entries = Object.entries((node.metadata ?? {}) as Record<string, unknown>);
  for (const [k, v] of entries) {
    if (k === 'references' || k === 'sourceType') continue;
    if (v === null) {
      meta[k] = null;
    } else if (typeof v === 'string') {
      meta[k] = v;
    } else if (typeof v === 'number') {
      meta[k] = v;
    } else if (typeof v === 'boolean') {
      meta[k] = v;
    }
  }
  return {
    title: node.title,
    description: node.description,
    type: sourceType,
    severity: node.severity ?? 'info',
    metadata: meta,
    connections: [...node.connections],
    references,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Path helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * Path canónico para el doc materializado. Convención:
 *   nodes/{tenantId}_{projectId}_{zkNodeId}
 * Cuando no hay tenantId (legacy): nodes/{projectId}_{zkNodeId}.
 */
export function canonicalNodePath(input: {
  tenantId?: string;
  projectId: string;
  zkNodeId: string;
}): string {
  if (input.tenantId) {
    return `nodes/${input.tenantId}_${input.projectId}_${input.zkNodeId}`;
  }
  return `nodes/${input.projectId}_${input.zkNodeId}`;
}

/**
 * Decodifica el id canonical de vuelta a sus partes (útil para queries
 * agregadas o invalidación selectiva).
 */
export function parseCanonicalNodePath(path: string): {
  tenantId?: string;
  projectId: string;
  zkNodeId: string;
} | null {
  const m = path.match(/^nodes\/(.+)$/);
  if (!m) return null;
  const parts = m[1].split('_');
  if (parts.length === 2) {
    return { projectId: parts[0], zkNodeId: parts[1] };
  }
  if (parts.length >= 3) {
    return {
      tenantId: parts[0],
      projectId: parts[1],
      zkNodeId: parts.slice(2).join('_'),
    };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Materialization batch (for migration / Cloud Function trigger)
// ────────────────────────────────────────────────────────────────────────

export interface MaterializationBatchInput {
  inputs: MaterializeInput[];
}

export interface MaterializationBatchResult {
  /** Documents to upsert into `nodes` collection. */
  upserts: Array<{ path: string; data: CanonicalNode }>;
  /** Skipped inputs (invalid payload). */
  skipped: Array<{ zkNodeId: string; reason: string }>;
}

/**
 * Procesa N inputs en batch. Útil para:
 *  - Migración inicial (one-shot CLI)
 *  - Cloud Function que escucha onWrite y procesa varios documentos
 *  - Tests con scenarios realistas
 */
export function materializeBatch(
  input: MaterializationBatchInput,
): MaterializationBatchResult {
  const upserts: MaterializationBatchResult['upserts'] = [];
  const skipped: MaterializationBatchResult['skipped'] = [];
  for (const inp of input.inputs) {
    const validationIssue = validateMaterializeInput(inp);
    if (validationIssue) {
      const zkNodeId = isRecord(inp) && typeof inp.zkNodeId === 'string' ? inp.zkNodeId : 'unknown';
      skipped.push({ zkNodeId, reason: validationIssue.code });
      continue;
    }
    const data = materializeNode(inp);
    const path = canonicalNodePath({
      tenantId: inp.tenantId,
      projectId: inp.projectId,
      zkNodeId: inp.zkNodeId,
    });
    upserts.push({ path, data });
  }
  return { upserts, skipped };
}
