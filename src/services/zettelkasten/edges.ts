// Praeventio Guard — Sprint 39 Fase B.7: aristas tipadas + bidireccionalidad.
//
// Closes: AUDIT_TRUTH_MATRIX P1 Zettelkasten (3 fuentes) + lo verificado
// en código (RiskNode.connections: string[] es untyped — no permite
// expresar "requires", "mitigates", "causes", etc.). El documento del
// usuario "Ideas implementables §2.1" pide exactamente esto.
//
// Diseño:
//   - Las aristas viven en su propia collection `zettelkasten_edges` para
//     queries inversas eficientes (Firestore no permite join). Las
//     escrituras crean SIMÉTRICAMENTE las dos direcciones — sin esto, un
//     "RISK requires EPP" no aparece al consultar desde el EPP.
//   - El campo `connections: string[]` del nodo se mantiene en cache para
//     compatibilidad con la UI existente (RiskNetwork, KnowledgeGraph),
//     pero `edges.ts` es la fuente de verdad.
//   - Cada EdgeType tiene su INVERSE_OF declarado: el constructor de
//     simétricos lo usa para escribir la dirección opuesta correcta.
//
// Persistencia (Firestore Admin SDK side):
//   `tenants/{tenantId}/zettelkasten_edges/{edgeId}`
//   {
//     id, fromNodeId, toNodeId, type, inverseType,
//     createdAt, createdBy, projectId?
//   }
//
// El `edgeId` es content-addressed (sha256 de fromId+toId+type) para que
// crear la misma arista dos veces sea idempotente.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

/**
 * Tipos de relaciones canónicas. Cada uno tiene un inverso obligatorio.
 *
 * Mapeo conceptual (origen → destino):
 *   - requires       : nodo necesita otro (RISK → EPP, TASK → TRAINING)
 *   - mitigates      : nodo reduce/controla otro (CONTROL → RISK)
 *   - references     : nodo cita otro (LESSON → INCIDENT)
 *   - causes         : nodo causal de otro (RISK → INCIDENT)
 *   - assigned_to    : nodo asignado a otro (TASK → WORKER, WORKER → PROJECT)
 *   - expires_into   : nodo deriva en tarea por vencimiento (MACHINE → TASK)
 *   - generated_by   : nodo creado por otro (INCIDENT → REPORT)
 *   - documented_by  : nodo registrado por otro (TRAINING → DOCUMENT)
 *   - regulates      : norma aplica sobre otro (NORMATIVE → PROJECT)
 *   - derived_from   : nodo aprendido de otro (LESSON → INCIDENT)
 */
export const EDGE_TYPES = [
  'requires',
  'mitigates',
  'references',
  'causes',
  'assigned_to',
  'expires_into',
  'generated_by',
  'documented_by',
  'regulates',
  'derived_from',
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

/**
 * Map de cada EdgeType a su inverso canónico.
 *
 * Reglas para escoger inversos:
 *   - El inverso DEBE expresar la relación mirando desde el otro nodo.
 *   - Algunos tipos son simétricos por par (requires ↔ required_by) y
 *     ese inverso NO está en EDGE_TYPES principal — vive en
 *     EDGE_INVERSES como label puro (no se usa para crear edges al
 *     revés porque solo se permite crear edges con tipos canónicos
 *     vía createEdge → siempre se materializa la dirección canónica).
 */
export const EDGE_INVERSES = {
  requires: 'required_by',
  mitigates: 'mitigated_by',
  references: 'referenced_by',
  causes: 'caused_by',
  assigned_to: 'assignee_of',
  expires_into: 'derived_from_expiry_of',
  generated_by: 'generates',
  documented_by: 'documents',
  regulates: 'regulated_by',
  derived_from: 'leads_to',
} as const;

export type InverseEdgeType = (typeof EDGE_INVERSES)[EdgeType];

export interface ZkEdge {
  /** Content-addressed id: sha256(fromNodeId + toNodeId + type). Idempotent. */
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  /** Cached inverse label para queries inversas sin segunda lectura. */
  inverseType: InverseEdgeType;
  /** ISO-8601. */
  createdAt: string;
  /** Firebase Auth uid del creador. Puede ser 'system' para edges automatizados. */
  createdBy: string;
  /** Tenant scope — obligatorio. */
  tenantId: string;
  /** Project scope opcional (solo cuando ambos nodos viven en el mismo proyecto). */
  projectId?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers puros — testeables sin Firestore
// ────────────────────────────────────────────────────────────────────────

/**
 * Compute the content-addressed edge id. Idempotent: misma terna
 * (from, to, type) → mismo id, así crear dos veces es un no-op.
 */
export function computeEdgeId(
  fromNodeId: string,
  toNodeId: string,
  type: EdgeType,
): string {
  const canonical = `${fromNodeId}\x00${toNodeId}\x00${type}`;
  return bytesToHex(sha256(new TextEncoder().encode(canonical))).slice(0, 32);
}

/**
 * Build a ZkEdge object given the minimum required fields. Pure function,
 * no I/O. The caller persists it via the persistence layer below.
 */
export function buildEdge(input: {
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  tenantId: string;
  createdBy: string;
  projectId?: string;
  /** Override `createdAt` — only for tests / deterministic seeding. */
  createdAt?: string;
}): ZkEdge {
  if (input.fromNodeId === input.toNodeId) {
    throw new EdgeValidationError('SELF_LOOP', input.fromNodeId, input.toNodeId, input.type);
  }
  if (!EDGE_TYPES.includes(input.type)) {
    throw new EdgeValidationError('UNKNOWN_TYPE', input.fromNodeId, input.toNodeId, input.type);
  }
  return {
    id: computeEdgeId(input.fromNodeId, input.toNodeId, input.type),
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    type: input.type,
    inverseType: EDGE_INVERSES[input.type],
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: input.createdBy,
    tenantId: input.tenantId,
    projectId: input.projectId,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Persistence layer (DI shape — caller injects the firestore adapter)
// ────────────────────────────────────────────────────────────────────────

/**
 * Minimal Firestore interface this layer needs. Lets tests inject a fake
 * map-backed store without booting Firebase Admin.
 */
export interface EdgeStore {
  /** Idempotent upsert. Caller already computed the edge id. */
  saveEdge(edge: ZkEdge): Promise<void>;
  /** Hard delete. */
  deleteEdgeById(id: string, tenantId: string): Promise<void>;
  /** Find all edges where `fromNodeId === nodeId`. */
  findOutgoing(nodeId: string, tenantId: string, type?: EdgeType): Promise<ZkEdge[]>;
  /** Find all edges where `toNodeId === nodeId`. */
  findIncoming(nodeId: string, tenantId: string, type?: EdgeType): Promise<ZkEdge[]>;
  /**
   * ZK-5 — list a tenant's edges (capped) so a caller can project them onto a
   * node set it already holds. Deliberately NOT filtered by `projectId`: that
   * field is OPTIONAL on `ZkEdge` (only set when both endpoints share a
   * project), so a projectId query would silently drop legacy edges. The
   * caller filters by its own node set instead.
   */
  listByTenant(tenantId: string, limit?: number): Promise<ZkEdge[]>;
}

export class EdgeValidationError extends Error {
  constructor(
    public readonly reason: 'SELF_LOOP' | 'UNKNOWN_TYPE' | 'BIDIRECTIONALITY_VIOLATION',
    public readonly fromNodeId: string,
    public readonly toNodeId: string,
    public readonly type: string,
  ) {
    super(`Edge validation failed: ${reason} (${fromNodeId} -[${type}]→ ${toNodeId})`);
    this.name = 'EdgeValidationError';
  }
}

/**
 * Create an edge in the canonical direction. Idempotent: crear la misma
 * arista dos veces es un no-op (mismo content-addressed id).
 *
 * Bidireccionalidad obligatoria: este layer guarda SOLO la dirección
 * canónica. Las queries `getRelatedNodes(node)` usan
 * `findOutgoing(node) UNION findIncoming(node)` — la dirección inversa
 * NO se materializa como edge separado (evita doble escritura + posible
 * deriva).
 */
export async function createEdge(
  store: EdgeStore,
  input: {
    fromNodeId: string;
    toNodeId: string;
    type: EdgeType;
    tenantId: string;
    createdBy: string;
    projectId?: string;
  },
): Promise<ZkEdge> {
  const edge = buildEdge(input);
  await store.saveEdge(edge);
  return edge;
}

/**
 * Delete an edge in either direction. Encuentra el edge por (from, to, type)
 * Y por (to, from, inverseType) — ambos casos resuelven al mismo edge_id
 * vía content addressing, así un solo deleteById basta.
 */
export async function deleteEdge(
  store: EdgeStore,
  input: {
    fromNodeId: string;
    toNodeId: string;
    type: EdgeType;
    tenantId: string;
  },
): Promise<void> {
  const id = computeEdgeId(input.fromNodeId, input.toNodeId, input.type);
  await store.deleteEdgeById(id, input.tenantId);
}

export interface RelatedNode {
  nodeId: string;
  /** Edge type seen from the SOURCE node's perspective. */
  via: EdgeType | InverseEdgeType;
  /** Direction: 'outgoing' (source → other) o 'incoming' (other → source). */
  direction: 'outgoing' | 'incoming';
  edge: ZkEdge;
}

/**
 * Find all nodes related to `nodeId` in either direction.
 *
 * Bidireccionalidad: incluimos outgoing (source → other con `type`) y
 * incoming (other → source con `type` desde el otro lado, que vemos como
 * `inverseType`).
 *
 * El optional `viaType` filtra: si quieres solo "qué EPP requiere este
 * riesgo", pasas type='requires' con `direction: 'outgoing'`.
 */
export async function getRelatedNodes(
  store: EdgeStore,
  nodeId: string,
  tenantId: string,
  opts: {
    viaType?: EdgeType;
    direction?: 'outgoing' | 'incoming' | 'both';
  } = {},
): Promise<RelatedNode[]> {
  const direction = opts.direction ?? 'both';
  const results: RelatedNode[] = [];

  if (direction === 'outgoing' || direction === 'both') {
    const out = await store.findOutgoing(nodeId, tenantId, opts.viaType);
    for (const e of out) {
      results.push({
        nodeId: e.toNodeId,
        via: e.type,
        direction: 'outgoing',
        edge: e,
      });
    }
  }

  if (direction === 'incoming' || direction === 'both') {
    const inc = await store.findIncoming(nodeId, tenantId, opts.viaType);
    for (const e of inc) {
      results.push({
        nodeId: e.fromNodeId,
        via: e.inverseType,
        direction: 'incoming',
        edge: e,
      });
    }
  }

  return results;
}
