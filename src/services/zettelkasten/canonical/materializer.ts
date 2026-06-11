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

import type { RiskNodePayload, RiskNodeSeverity } from '../types.js';

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
  const m = /^nodes\/(.+)$/.exec(path);
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
    if (!inp.payload || typeof inp.payload.title !== 'string' || inp.payload.title.length === 0) {
      skipped.push({ zkNodeId: inp.zkNodeId, reason: 'invalid_payload' });
      continue;
    }
    if (typeof inp.projectId !== 'string' || inp.projectId.length === 0) {
      skipped.push({ zkNodeId: inp.zkNodeId, reason: 'missing_projectId' });
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
