// Praeventio Guard — Sprint 47 C.11 (cierre completo): Topology-aware
// predictive prefetching engine.
//
// Cierra C.11 del plan maestro extendiendo el `buildPrefetchPlan`
// existente (Sprint 39) con:
//   1. Scoring por probabilidad-de-uso × peso ZK del nodo (severity)
//   2. Budget de bandwidth + storage del cliente (cap)
//   3. Sequencing ordenado por (score desc, payloadBytes asc) — first
//      most useful, then small-to-large para que las descargas paralelas
//      no bloqueen las críticas
//   4. Adaptación por patrones de uso pasado del trabajador
//   5. Watermark per-collection para integración con monotonicSync
//
// 100% determinístico. Tests cubren cada heurística aislada + integración.
//
// Reusa `monotonicSync.PrefetchContext / PrefetchPlan` como base.

import type { PrefetchContext, PrefetchPlan } from './monotonicSync.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type CollectionKind =
  | 'zettelkasten_node'
  | 'document'
  | 'training_module'
  | 'epp_card'
  | 'worker_profile'
  | 'incident_history'
  | 'critical_control'
  | 'permit_template';

export interface PrefetchCandidate {
  /** ID estable (uid del documento). */
  uid: string;
  collection: CollectionKind;
  /** Bytes estimados del documento (para budget cap). */
  estimatedBytes: number;
  /** Severidad/criticidad si aplica (riesgos altos > bajos). */
  severity?: 'low' | 'medium' | 'high' | 'critical' | 'sif';
  /** Watermark conocido del cliente — si lo tiene, skip. */
  clientWatermark?: number;
  /** Watermark actual del servidor (si se conoce). */
  serverRev?: number;
  /** Razón canónica por la que entró al plan — para audit/debug. */
  reason:
    | 'upcoming_task_category'
    | 'work_zone_proximity'
    | 'crew_history'
    | 'recent_usage_pattern'
    | 'normative_dependency'
    | 'critical_control_link';
}

export interface PastUsageSample {
  collection: CollectionKind;
  /** UIDs accedidos por el worker en la última ventana. */
  accessedUids: string[];
  /** Cuántas veces fue accedido (frecuencia ponderada). */
  hitCount: number;
  /** Recency en horas (0 = hoy). */
  recencyHours: number;
}

export interface PredictivePrefetchOptions {
  /** Budget total en bytes (default 50MB para mobile sin cap). */
  maxBytes?: number;
  /** Max items prefetched (default 500). */
  maxItems?: number;
  /** Si se priorizan severidades altas (default true). */
  prioritizeHighSeverity?: boolean;
  /** Si se incluyen muestras de uso pasado (default true). */
  applyUsageHeuristic?: boolean;
}

export interface PredictivePrefetchInput {
  /** Plan base derivado de tareas próximas. */
  basePlan: PrefetchPlan;
  /** Candidatos identificados por el caller para evaluación. */
  candidates: ReadonlyArray<PrefetchCandidate>;
  /** Muestras de uso pasado del worker. */
  pastUsage?: ReadonlyArray<PastUsageSample>;
}

export interface ScoredCandidate extends PrefetchCandidate {
  /** Score 0..100 — mayor = más prioritario. */
  score: number;
  /** Si se incluyó en el plan final. */
  selected: boolean;
  /** Si se omitió, motivo. */
  skipReason?: 'over_budget' | 'already_fresh' | 'duplicate' | 'low_score';
}

export interface PredictivePrefetchResult {
  /** Items ordenados — primero los más útiles, dentro del mismo score
   *  primero los más pequeños (paralelismo). */
  ordered: ScoredCandidate[];
  /** Total bytes que se descargarán si todos los `selected` se ejecutan. */
  totalBytes: number;
  /** Stats agregadas para telemetría. */
  stats: {
    candidatesEvaluated: number;
    selected: number;
    skippedOverBudget: number;
    skippedAlreadyFresh: number;
    skippedLowScore: number;
    skippedDuplicate: number;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Scoring
// ────────────────────────────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<NonNullable<PrefetchCandidate['severity']>, number> = {
  low: 0.4,
  medium: 0.6,
  high: 0.8,
  critical: 1.0,
  sif: 1.0,
};

const COLLECTION_BASE_WEIGHT: Record<CollectionKind, number> = {
  critical_control: 1.0,
  zettelkasten_node: 0.9,
  permit_template: 0.85,
  document: 0.75,
  training_module: 0.7,
  epp_card: 0.65,
  worker_profile: 0.5,
  incident_history: 0.5,
};

function recencyDecay(hours: number): number {
  // 0h → 1.0, 24h → 0.7, 72h → 0.4, 7d → 0.15
  if (hours <= 0) return 1;
  return Math.max(0.1, Math.exp(-hours / 50));
}

function usageBoost(
  uid: string,
  collection: CollectionKind,
  pastUsage: ReadonlyArray<PastUsageSample> | undefined,
): number {
  if (!pastUsage) return 0;
  const matching = pastUsage.filter((p) => p.collection === collection && p.accessedUids.includes(uid));
  if (matching.length === 0) return 0;
  const totalHits = matching.reduce((s, m) => s + m.hitCount, 0);
  const bestRecency = Math.min(...matching.map((m) => m.recencyHours));
  return Math.min(0.4, Math.log1p(totalHits) * 0.15 * recencyDecay(bestRecency));
}

function scoreCandidate(
  candidate: PrefetchCandidate,
  basePlan: PrefetchPlan,
  pastUsage: ReadonlyArray<PastUsageSample> | undefined,
  opts: Required<PredictivePrefetchOptions>,
): number {
  let score = COLLECTION_BASE_WEIGHT[candidate.collection] * 60; // base 0-60

  // Severity boost (0-25)
  if (opts.prioritizeHighSeverity && candidate.severity) {
    score += SEVERITY_WEIGHT[candidate.severity] * 25;
  }

  // Reason-specific bonus (0-10)
  if (candidate.reason === 'critical_control_link') score += 10;
  if (candidate.reason === 'work_zone_proximity') score += 8;
  if (candidate.reason === 'upcoming_task_category') score += 6;
  if (candidate.reason === 'normative_dependency') score += 5;

  // Past usage boost (0-40)
  if (opts.applyUsageHeuristic) {
    score += usageBoost(candidate.uid, candidate.collection, pastUsage) * 100;
  }

  // Match con basePlan (boost si el caller ya identificó las roots/cats)
  if (
    basePlan.zettelkastenRoots.includes(candidate.uid) ||
    basePlan.documentCategories.includes(candidate.uid) ||
    basePlan.trainingCategories.includes(candidate.uid)
  ) {
    score += 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ────────────────────────────────────────────────────────────────────────
// Main API
// ────────────────────────────────────────────────────────────────────────

const DEFAULTS: Required<PredictivePrefetchOptions> = {
  maxBytes: 50 * 1024 * 1024,
  maxItems: 500,
  prioritizeHighSeverity: true,
  applyUsageHeuristic: true,
};

export function buildPredictivePrefetch(
  input: PredictivePrefetchInput,
  options: PredictivePrefetchOptions = {},
): PredictivePrefetchResult {
  const opts: Required<PredictivePrefetchOptions> = { ...DEFAULTS, ...options };

  const stats = {
    candidatesEvaluated: input.candidates.length,
    selected: 0,
    skippedOverBudget: 0,
    skippedAlreadyFresh: 0,
    skippedLowScore: 0,
    skippedDuplicate: 0,
  };

  // Dedupe: misma uid+collection
  const seen = new Set<string>();

  // Score + filter
  const scored: ScoredCandidate[] = [];
  for (const c of input.candidates) {
    const key = `${c.collection}|${c.uid}`;
    if (seen.has(key)) {
      stats.skippedDuplicate += 1;
      scored.push({ ...c, score: 0, selected: false, skipReason: 'duplicate' });
      continue;
    }
    seen.add(key);

    // Already fresh? watermark match
    if (
      typeof c.clientWatermark === 'number' &&
      typeof c.serverRev === 'number' &&
      c.clientWatermark >= c.serverRev
    ) {
      stats.skippedAlreadyFresh += 1;
      scored.push({ ...c, score: 0, selected: false, skipReason: 'already_fresh' });
      continue;
    }

    const score = scoreCandidate(c, input.basePlan, input.pastUsage, opts);
    scored.push({ ...c, score, selected: false });
  }

  // Sort: score desc, then bytes asc (most useful first, smallest first for parallel download)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.estimatedBytes - b.estimatedBytes;
  });

  // Apply budget + max items + low-score floor
  const LOW_SCORE_FLOOR = 20;
  let runningBytes = 0;
  for (const c of scored) {
    if (c.skipReason) continue; // ya marcado dedupe/fresh
    if (c.score < LOW_SCORE_FLOOR) {
      c.skipReason = 'low_score';
      stats.skippedLowScore += 1;
      continue;
    }
    if (stats.selected >= opts.maxItems) {
      c.skipReason = 'over_budget';
      stats.skippedOverBudget += 1;
      continue;
    }
    if (runningBytes + c.estimatedBytes > opts.maxBytes) {
      c.skipReason = 'over_budget';
      stats.skippedOverBudget += 1;
      continue;
    }
    c.selected = true;
    runningBytes += c.estimatedBytes;
    stats.selected += 1;
  }

  return {
    ordered: scored,
    totalBytes: runningBytes,
    stats,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Companion: produce monotonicSync pull batches from a prefetch plan
// ────────────────────────────────────────────────────────────────────────

export interface PrefetchPullBatch {
  collection: CollectionKind;
  /** Uids ordenados como van a ser pulleados. */
  uids: string[];
  /** Watermark mínimo desde el cual pullear (server side filter). */
  minWatermark: number;
}

/**
 * Agrupa los selected del result en batches por collection — el caller
 * los ejecuta en paralelo usando monotonicSync.buildPullResponse.
 */
export function buildPullBatches(result: PredictivePrefetchResult): PrefetchPullBatch[] {
  const byCollection = new Map<CollectionKind, ScoredCandidate[]>();
  for (const c of result.ordered) {
    if (!c.selected) continue;
    if (!byCollection.has(c.collection)) byCollection.set(c.collection, []);
    byCollection.get(c.collection)!.push(c);
  }
  return Array.from(byCollection.entries()).map(([collection, items]) => ({
    collection,
    uids: items.map((i) => i.uid),
    // El watermark mínimo es el menor clientWatermark del batch (o 0)
    minWatermark: Math.min(...items.map((i) => i.clientWatermark ?? 0)),
  }));
}

// ────────────────────────────────────────────────────────────────────────
// Companion: derive candidates from a base PrefetchContext + ZK adapter
// inputs (caller-provided node graph snapshot)
// ────────────────────────────────────────────────────────────────────────

export interface ZkNodeSnapshot {
  uid: string;
  type: string;
  severity?: 'low' | 'medium' | 'high' | 'critical' | 'sif';
  /** Bytes aproximados que ocupa el nodo + descripción. */
  estimatedBytes?: number;
  /** Conexiones a otros nodos (para BFS topology-aware). */
  connections?: string[];
}

/**
 * Expande candidatos desde un PrefetchContext + snapshot de nodos
 * ZK conocidos. BFS limitado por depth (default 2).
 */
export function expandCandidatesFromContext(
  ctx: PrefetchContext,
  zkSnapshot: ReadonlyArray<ZkNodeSnapshot>,
  options: { depth?: number; defaultBytesPerNode?: number } = {},
): PrefetchCandidate[] {
  const depth = options.depth ?? 2;
  const defaultBytes = options.defaultBytesPerNode ?? 8 * 1024; // 8KB default

  const byId = new Map(zkSnapshot.map((n) => [n.uid, n] as const));
  const seen = new Set<string>();
  const out: PrefetchCandidate[] = [];

  // Seed: nodes whose type matches upcomingTaskCategories
  const seeds = zkSnapshot.filter((n) =>
    ctx.upcomingTaskCategories.some((cat) => n.type.toLowerCase().includes(cat.toLowerCase())),
  );

  // BFS
  let frontier: ZkNodeSnapshot[] = seeds;
  for (let d = 0; d < depth; d++) {
    const next: ZkNodeSnapshot[] = [];
    for (const node of frontier) {
      if (seen.has(node.uid)) continue;
      seen.add(node.uid);
      out.push({
        uid: node.uid,
        collection: 'zettelkasten_node',
        estimatedBytes: node.estimatedBytes ?? defaultBytes,
        severity: node.severity,
        reason: d === 0 ? 'upcoming_task_category' : 'critical_control_link',
      });
      for (const connId of node.connections ?? []) {
        const conn = byId.get(connId);
        if (conn && !seen.has(conn.uid)) next.push(conn);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return out;
}
