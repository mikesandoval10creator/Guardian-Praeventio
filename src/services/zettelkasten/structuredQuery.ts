// Alpha41 ZK-8 — consultas estructuradas sobre el grafo Zettelkasten.
//
// NlQueryPanel hace RAG semántico (LLM) pero la auditoría preventiva
// necesita respuestas EXACTAS y locales: "¿qué controles mitigan riesgos
// críticos?", "¿qué riesgos causaron este incidente?". Este módulo agrega
// un mini query-builder cypher-lite SIN LLM sobre las aristas tipadas ya
// persistidas (edges.ts), ejecutado contra `getRelatedNodes`.
//
// Sintaxis soportada (cypher-lite):
//
//   (:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical
//   (:Incidente)<-[:causes]-(:Riesgo)
//   ()-[:references]-()                       // sin dirección = both
//   ... WHERE from.status='activo' AND to.probability>=0.5
//
//   - `(:Tipo)` filtra por NodeType (los labels del enum, p.ej. 'Control',
//     'Riesgo'); `()` es comodín.
//   - `-[:tipo]->` outgoing, `<-[:tipo]-` incoming, `-[:tipo]-` both.
//     El tipo DEBE ser uno de EDGE_TYPES (canónicos).
//   - WHERE encadena cláusulas con AND. Un campo sin calificar aplica al
//     nodo DESTINO (`to.`); `from.` lo aplica al origen. Operadores:
//     = != > >= < <=. Valores: números, true/false, 'string' o bareword.
//   - `severity` se compara por rango semántico (info<low<medium<high<
//     critical), así `severity>=high` matchea critical.
//
// Puro + DI (EdgeStore inyectado), igual que edges.ts: testeable sin
// Firestore, usable server-side (Admin) o client-side con cualquier
// adapter que cumpla el contrato.

import {
  getRelatedNodes,
  EDGE_TYPES,
  type EdgeStore,
  type EdgeType,
  type InverseEdgeType,
  type ZkEdge,
} from './edges.js';
import type { RiskNodeSeverity } from './types.js';

// ────────────────────────────────────────────────────────────────────────
// Query model
// ────────────────────────────────────────────────────────────────────────

/**
 * Vista mínima de un nodo del grafo que el ejecutor necesita. Estructural
 * a propósito: `RiskNode` (src/types) y los payloads de generadores
 * (types.ts) la cumplen sin adaptación.
 */
export interface QueryableNode {
  id: string;
  /** Discriminador de tipo — labels del enum NodeType ('Control', 'Riesgo', …). */
  type: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type WhereOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

export interface WhereClause {
  /** A qué extremo del patrón aplica el filtro. */
  target: 'from' | 'to';
  field: string;
  op: WhereOp;
  value: string | number | boolean;
}

export interface NodePattern {
  /** Label de NodeType; case-insensitive. Omitido = cualquier tipo. */
  type?: string;
}

export interface StructuredGraphQuery {
  from: NodePattern;
  edge: { type: EdgeType; direction: 'outgoing' | 'incoming' | 'both' };
  to: NodePattern;
  where: WhereClause[];
  limit?: number;
}

export interface GraphQueryMatch {
  /** Binding del extremo origen del patrón (el seed). */
  from: QueryableNode;
  /** Binding del extremo destino del patrón. */
  to: QueryableNode;
  /** Tipo de arista visto desde `from` (inverso si la arista es entrante). */
  via: EdgeType | InverseEdgeType;
  direction: 'outgoing' | 'incoming';
  edge: ZkEdge;
}

export class GraphQueryParseError extends Error {
  constructor(
    public readonly reason:
      | 'MALFORMED_PATTERN'
      | 'UNKNOWN_EDGE_TYPE'
      | 'MALFORMED_WHERE',
    public readonly input: string,
  ) {
    super(`Graph query parse failed: ${reason} in "${input}"`);
    this.name = 'GraphQueryParseError';
  }
}

// ────────────────────────────────────────────────────────────────────────
// Parser (cypher-lite)
// ────────────────────────────────────────────────────────────────────────

// `(:Tipo)` | `()` — tipo admite letras (incl. acentos), dígitos, _ , - y espacios.
const NODE = String.raw`\(\s*(?::\s*([^)]+?))?\s*\)`;
// `-[:tipo]->` | `<-[:tipo]-` | `-[:tipo]-`
const PATTERN_RE = new RegExp(
  String.raw`^\s*${NODE}\s*(<-|-)\s*\[\s*:\s*([A-Za-z_]+)\s*\]\s*(->|-)\s*${NODE}\s*(?:WHERE\s+(.+?))?\s*$`,
  'i',
);
// `[from.|to.]campo op valor`
const CLAUSE_RE =
  /^(?:(from|to)\s*\.\s*)?([A-Za-z_][\w.-]*)\s*(!=|>=|<=|=|>|<)\s*(\S.*)$/i;

const OP_MAP: Record<string, WhereOp> = {
  '=': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
};

function parseValue(raw: string): string | number | boolean {
  const quoted = raw.match(/^'(.*)'$|^"(.*)"$/);
  if (quoted) return quoted[1] ?? quoted[2] ?? '';
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  const num = Number(raw);
  if (raw !== '' && !Number.isNaN(num)) return num;
  return raw;
}

function parseWhere(rawWhere: string, input: string): WhereClause[] {
  return rawWhere.split(/\s{1,64}AND\s{1,64}/i).map((rawClause) => {
    const m = rawClause.trim().match(CLAUSE_RE);
    if (!m) throw new GraphQueryParseError('MALFORMED_WHERE', input);
    const [, target, field, op, rawValue] = m;
    return {
      // Sin calificador, la cláusula aplica al DESTINO — el caso típico de
      // auditoría filtra el nodo alcanzado, no el seed.
      target: (target?.toLowerCase() as 'from' | 'to') ?? 'to',
      field,
      op: OP_MAP[op],
      value: parseValue(rawValue),
    };
  });
}

/**
 * Parse a cypher-lite pattern string into a StructuredGraphQuery.
 * @throws GraphQueryParseError si el patrón no cumple la gramática o el
 *         tipo de arista no es canónico (EDGE_TYPES).
 */
export function parsePatternQuery(input: string): StructuredGraphQuery {
  const m = input.match(PATTERN_RE);
  if (!m) throw new GraphQueryParseError('MALFORMED_PATTERN', input);
  const [, fromType, leftArrow, rawEdgeType, rightArrow, toType, rawWhere] = m;

  const edgeType = rawEdgeType.toLowerCase() as EdgeType;
  if (!EDGE_TYPES.includes(edgeType)) {
    throw new GraphQueryParseError('UNKNOWN_EDGE_TYPE', input);
  }

  let direction: StructuredGraphQuery['edge']['direction'];
  if (leftArrow === '<-' && rightArrow === '-') direction = 'incoming';
  else if (leftArrow === '-' && rightArrow === '->') direction = 'outgoing';
  else if (leftArrow === '-' && rightArrow === '-') direction = 'both';
  else throw new GraphQueryParseError('MALFORMED_PATTERN', input);

  return {
    from: { type: fromType?.trim() || undefined },
    edge: { type: edgeType, direction },
    to: { type: toType?.trim() || undefined },
    where: rawWhere ? parseWhere(rawWhere, input) : [],
  };
}

// ────────────────────────────────────────────────────────────────────────
// Evaluación de cláusulas
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<RiskNodeSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function severityRank(value: unknown): number | undefined {
  return typeof value === 'string'
    ? SEVERITY_RANK[value.toLowerCase() as RiskNodeSeverity]
    : undefined;
}

/** Campo top-level primero; si no existe, cae a `metadata[field]`. */
function resolveField(node: QueryableNode, field: string): unknown {
  if (field in node) return node[field];
  return node.metadata?.[field];
}

function compare(actual: unknown, op: WhereOp, expected: string | number | boolean): boolean {
  // Severidad: orden semántico, no lexicográfico ('critical' > 'high').
  const aRank = severityRank(actual);
  const eRank = severityRank(expected);
  const [a, e] =
    aRank !== undefined && eRank !== undefined ? [aRank, eRank] : [actual, expected];

  switch (op) {
    case 'eq':
    case 'neq': {
      const equal =
        typeof a === 'string' && typeof e === 'string'
          ? a.toLowerCase() === e.toLowerCase()
          : a === e;
      return op === 'eq' ? equal : !equal;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const an = Number(a);
      const en = Number(e);
      if (Number.isNaN(an) || Number.isNaN(en)) return false;
      if (op === 'gt') return an > en;
      if (op === 'gte') return an >= en;
      if (op === 'lt') return an < en;
      return an <= en;
    }
  }
}

function matchesPattern(
  node: QueryableNode,
  pattern: NodePattern,
  clauses: WhereClause[],
): boolean {
  if (pattern.type && node.type.toLowerCase() !== pattern.type.toLowerCase()) {
    return false;
  }
  return clauses.every((c) => compare(resolveField(node, c.field), c.op, c.value));
}

// ────────────────────────────────────────────────────────────────────────
// Ejecutor
// ────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta una consulta estructurada contra el grafo local.
 *
 * `nodes` es el conjunto de nodos disponible (p.ej. los RiskNode ya
 * cargados del proyecto); las aristas se leen del `store` inyectado vía
 * `getRelatedNodes`, que ya garantiza scope por tenant y bidireccionalidad.
 * Aristas hacia nodos fuera de `nodes` (dangling) se descartan.
 */
export async function runStructuredQuery(
  store: EdgeStore,
  nodes: QueryableNode[],
  query: StructuredGraphQuery,
  tenantId: string,
): Promise<GraphQueryMatch[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fromClauses = query.where.filter((c) => c.target === 'from');
  const toClauses = query.where.filter((c) => c.target === 'to');

  const seeds = nodes.filter((n) => matchesPattern(n, query.from, fromClauses));

  const matches: GraphQueryMatch[] = [];
  // En 'both' una arista aparece desde sus dos extremos con bindings
  // espejados (ambos válidos); la clave edge.id+seed evita duplicar el
  // MISMO binding cuando un seed matchea por más de un camino.
  const seen = new Set<string>();

  for (const seed of seeds) {
    const related = await getRelatedNodes(store, seed.id, tenantId, {
      viaType: query.edge.type,
      direction: query.edge.direction,
    });
    for (const rel of related) {
      const other = byId.get(rel.nodeId);
      if (!other) continue; // dangling: arista a nodo fuera del set local
      if (!matchesPattern(other, query.to, toClauses)) continue;
      const key = `${rel.edge.id}|${seed.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        from: seed,
        to: other,
        via: rel.via,
        direction: rel.direction,
        edge: rel.edge,
      });
      if (query.limit !== undefined && matches.length >= query.limit) {
        return matches;
      }
    }
  }

  return matches;
}
