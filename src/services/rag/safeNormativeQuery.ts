// Praeventio Guard — safeNormativeQuery — TODO.md §12.2.3 CRÍTICA.
//
// Para una app de prevención de riesgos, el SLM/Gemini NUNCA puede
// alucinar texto normativo. La función `searchRelevantContext` existente
// retorna SIEMPRE un string (incluso fallbacks hardcoded "Ley 16.744..."
// cuando el RAG no está inicializado) — eso permite que el modelo invente
// texto que luego cita como autoridad.
//
// Esta función envuelve la búsqueda con un guardrail explícito:
//   1. Recupera top-K resultados con su score real (similarity COSINE).
//   2. Si el mejor score está por debajo de MIN_SIMILARITY (0.75), devuelve
//      `{ ok: false, reason: 'no_verified_match' }` con un mensaje canónico
//      "no tengo información verificada sobre [query]" que el caller debe
//      mostrar tal cual al usuario.
//   3. Si el RAG no está inicializado, devuelve `{ ok: false, reason:
//      'rag_not_ready' }` — no inventa fallback hardcoded.
//   4. Si el caller decide injectar el snippet a un LLM, debe cumplir la
//      condición `ok === true`.
//
// El umbral 0.75 viene de IMPLEMENTATION_ROADMAP.md:1110-1140 — se considera
// que por debajo de eso el embedding no es semánticamente preciso para
// material legal. Conservador: mejor decir "no sé" que arriesgar mal.

import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from '../../utils/logger.js';

export type SafeNormativeQueryReason =
  | 'no_verified_match'
  | 'rag_not_ready'
  | 'query_too_short'
  | 'embedding_failed'
  | 'internal_error';

export interface SafeNormativeQueryResult {
  /** Hit alguna fuente con score ≥ MIN_SIMILARITY. */
  ok: boolean;
  /**
   * Snippet seguro de inyectar a un LLM (solo presente cuando `ok===true`).
   * Lista las fuentes encontradas con `[Fuente: <title>]` headers.
   */
  snippet?: string;
  /** Best similarity score 0-1 (sólo para auditoría/logging). */
  bestScore?: number;
  /** Cuando ok=false. */
  reason?: SafeNormativeQueryReason;
  /**
   * Mensaje canónico a mostrar al usuario tal cual. Garantiza que el
   * caller NO intente "rellenar" con un LLM (que alucinaría).
   */
  userMessage?: string;
  /** Top-K matches con score, para debugging. */
  matches: Array<{ title: string; score: number; preview: string }>;
}

export const MIN_SIMILARITY = 0.75;
const MIN_QUERY_LENGTH = 4;
const PREVIEW_CHARS = 240;

/**
 * Hook de inyección para tests: recibe la firestore instance y la función
 * que genera embeddings. En prod los defaults llaman a Firebase Admin SDK
 * y al adapter Gemini existente.
 */
export interface SafeNormativeDeps {
  firestore?: () => admin.firestore.Firestore;
  generateEmbedding?: (query: string) => Promise<number[]>;
  isRagInitialized?: () => boolean;
}

let _depsOverride: SafeNormativeDeps = {};
export function __setSafeNormativeDepsForTests(deps: SafeNormativeDeps): void {
  _depsOverride = deps;
}
export function __resetSafeNormativeDepsForTests(): void {
  _depsOverride = {};
}

function noVerifiedMatch(query: string): string {
  return (
    `No tengo información verificada sobre "${query}" en mi base ` +
    `normativa. Para obtener guía legal autoritativa, consulta el sitio ` +
    `oficial leychile.cl o un asesor jurídico calificado. No estoy ` +
    `autorizado a generar texto normativo desde cero — eso podría ` +
    `comprometer la seguridad de los trabajadores.`
  );
}

function ragNotReadyMessage(): string {
  return (
    'El sistema RAG no está disponible en este momento. Para evitar ' +
    'información imprecisa sobre normativa, no generaré texto legal. ' +
    'Reintenta más tarde o consulta leychile.cl directamente.'
  );
}

export async function safeNormativeQuery(
  query: string,
  topK: number = 3,
): Promise<SafeNormativeQueryResult> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return {
      ok: false,
      reason: 'query_too_short',
      userMessage: `La consulta es demasiado breve. Escribe al menos ${MIN_QUERY_LENGTH} caracteres para que pueda buscar normativa relevante.`,
      matches: [],
    };
  }

  // Lazy-resolve deps: tests pueden inyectar; prod usa Firebase Admin.
  const fsFn = _depsOverride.firestore;
  const embedFn = _depsOverride.generateEmbedding;
  const initFn = _depsOverride.isRagInitialized;

  const ragReady = initFn ? initFn() : admin.apps.length > 0;
  if (!ragReady) {
    return {
      ok: false,
      reason: 'rag_not_ready',
      userMessage: ragNotReadyMessage(),
      matches: [],
    };
  }

  let embedding: number[];
  try {
    if (embedFn) {
      embedding = await embedFn(trimmed);
    } else {
      // Default path: import lazy para no contaminar cold-start.
      const { generateEmbedding } = await import('../ragService.js');
      embedding = await generateEmbedding(trimmed);
    }
  } catch (err) {
    logger.error?.('safeNormativeQuery.embedding.error', err);
    return {
      ok: false,
      reason: 'embedding_failed',
      userMessage: noVerifiedMatch(trimmed),
      matches: [],
    };
  }

  try {
    const db = fsFn ? fsFn() : admin.firestore();
    const vectorCollection = db.collection('vector_store');
    // Nota: en la versión Admin actual, `findNearest` retorna distancia
    // implícita; algunos snapshots la exponen como `_distance` o
    // `distance` campo, según versión. Leemos defensivo abajo.
    // PRIVACY / cross-tenant (2026-06-16): vector_store mixes the PUBLIC
    // normative corpus (law-* chunks from indexLaw, carry `lawId`) with
    // per-project knowledge nodes (node-* from networkBackend, carry `nodeId` +
    // `projectId`). An unfiltered findNearest could surface ANOTHER tenant's
    // private node text as "legal context". The LEGAL RAG must return ONLY
    // public law, so we over-fetch and post-filter to law vectors (have `lawId`,
    // lack `nodeId`), dropping every per-project node. No schema/index/migration
    // change — purely a read-scope tightening.
    const results = await vectorCollection
      .findNearest('embedding', FieldValue.vector(embedding), {
        limit: Math.max(topK * 8, 24),
        distanceMeasure: 'COSINE',
      })
      .get();

    const allDocs = results.empty ? [] : results.docs;
    const docs = allDocs
      .filter((d) => {
        const x = d.data();
        return x.lawId !== undefined && x.nodeId === undefined;
      })
      .slice(0, topK);
    const matches = docs.map((d) => {
      const data = d.data();
      // COSINE distance 0..2; similarity = 1 - (distance/2) when normalized,
      // or `(2 - distance) / 2` when not. Firestore findNearest with COSINE
      // returns distance in [0, 2] where 0 == identical.
      const distance = typeof data.distance === 'number' ? data.distance : 2;
      const score = Math.max(0, Math.min(1, 1 - distance / 2));
      const content: string = typeof data.content === 'string' ? data.content : '';
      const title: string = typeof data.title === 'string' ? data.title : 'sin título';
      return {
        title,
        score,
        preview: content.slice(0, PREVIEW_CHARS),
      };
    });

    const bestScore = matches.length > 0 ? matches[0].score : 0;
    const meetsThreshold = matches.some((m) => m.score >= MIN_SIMILARITY);

    if (!meetsThreshold) {
      return {
        ok: false,
        reason: 'no_verified_match',
        userMessage: noVerifiedMatch(trimmed),
        bestScore,
        matches,
      };
    }

    const snippet = matches
      .filter((m) => m.score >= MIN_SIMILARITY)
      .map((m) => `[Fuente: ${m.title} | similarity=${m.score.toFixed(2)}]\n${m.preview}`)
      .join('\n\n');

    return {
      ok: true,
      snippet,
      bestScore,
      matches,
    };
  } catch (err) {
    logger.error?.('safeNormativeQuery.search.error', err);
    return {
      ok: false,
      reason: 'internal_error',
      userMessage: noVerifiedMatch(trimmed),
      matches: [],
    };
  }
}

/**
 * Helper para callers que solo quieren el snippet o un mensaje canónico,
 * sin discriminar el motivo del fail.
 */
export async function safeNormativeContextOrFallback(
  query: string,
  topK: number = 3,
): Promise<{ injectable: string; verified: boolean }> {
  const r = await safeNormativeQuery(query, topK);
  if (r.ok && r.snippet) {
    return { injectable: r.snippet, verified: true };
  }
  return { injectable: r.userMessage ?? noVerifiedMatch(query), verified: false };
}
