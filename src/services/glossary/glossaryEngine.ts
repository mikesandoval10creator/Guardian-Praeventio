// Praeventio Guard — Sprint 50 §97-99: Glosario + FAQ + Feedback Utilidad.
//
// Cierra §97 (glosario términos OHS), §98 (FAQ contextual), §99
// (feedback de utilidad sobre cada entrada) de la 2da tanda usuario.
//
// 100% determinístico. Engine puro que indexa términos + FAQ entries
// + tracking de utilidad/relevancia + búsqueda con relevancia ponderada.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type TermCategory =
  | 'normativa'
  | 'epp'
  | 'riesgo'
  | 'controlIngenieria'
  | 'salud'
  | 'medico'
  | 'procedimiento'
  | 'siglas'
  | 'general';

export interface GlossaryTerm {
  id: string;
  /** Término canónico (singular, lowercase). */
  term: string;
  /** Sinónimos / abreviaciones. */
  synonyms?: string[];
  category: TermCategory;
  /** Definición corta (1-2 líneas). */
  shortDefinition: string;
  /** Definición extensa con ejemplos / contexto Chile. */
  longDefinition?: string;
  /** Referencias normativas o documentos. */
  references?: string[];
  /** Última vez actualizado. */
  updatedAt: string;
  /** Stats utility tracking. */
  helpfulCount?: number;
  notHelpfulCount?: number;
}

export interface FaqEntry {
  id: string;
  /** Pregunta canónica. */
  question: string;
  /** Variants de cómo el usuario podría preguntar lo mismo. */
  questionVariants?: string[];
  /** Respuesta. */
  answer: string;
  /** Términos del glosario citados. */
  relatedTermIds?: string[];
  /** Categoría temática. */
  topic: TermCategory;
  /** Contexto donde aparece (qué página/feature). */
  contextHint?: string[];
  updatedAt: string;
  helpfulCount?: number;
  notHelpfulCount?: number;
}

// ────────────────────────────────────────────────────────────────────────
// Search engine
// ────────────────────────────────────────────────────────────────────────

export interface GlossarySearchResult<T> {
  item: T;
  score: number;
  matchedTokens: string[];
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length >= 2);
}

/**
 * Calcula score relevancia para un term contra una query.
 * Reglas:
 * - Match exacto del término (incluyendo singular/plural rudimentario) = 100
 * - Match exacto sinónimo = 90
 * - Token query coincide con token term/synonym = +30 cada uno
 * - Token query coincide con shortDefinition = +10
 * - helpfulCount - notHelpfulCount aporta bonus pequeño
 */
function scoreTerm(term: GlossaryTerm, queryTokens: string[]): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;

  const termTokens = tokenize(term.term);
  const synonymTokensSet = new Set((term.synonyms ?? []).flatMap(tokenize));
  const definitionTokens = new Set(tokenize(term.shortDefinition));

  for (const q of queryTokens) {
    if (termTokens.includes(q)) {
      score += 30;
      matched.push(q);
    } else if (synonymTokensSet.has(q)) {
      score += 25;
      matched.push(q);
    } else if (definitionTokens.has(q)) {
      score += 8;
      matched.push(q);
    }
  }

  // Exact-match boost si la query (concatenada) coincide con el término
  // o sinónimo.
  const queryStr = queryTokens.join(' ');
  if (queryStr === normalize(term.term)) {
    score = Math.max(score, 100);
  } else if ((term.synonyms ?? []).some((s) => normalize(s) === queryStr)) {
    score = Math.max(score, 90);
  }

  // Utility bonus
  const helpful = term.helpfulCount ?? 0;
  const notHelpful = term.notHelpfulCount ?? 0;
  if (helpful + notHelpful > 0) {
    const ratio = helpful / (helpful + notHelpful);
    score += Math.round(ratio * 5);
  }

  return { score, matched: Array.from(new Set(matched)) };
}

export interface SearchOptions {
  /** Filtrar por categoría. */
  category?: TermCategory;
  /** Min score para aparecer en resultados (default 10). */
  minScore?: number;
  /** Cap N resultados (default 20). */
  maxResults?: number;
}

export function searchGlossary(
  terms: ReadonlyArray<GlossaryTerm>,
  query: string,
  options: SearchOptions = {},
): GlossarySearchResult<GlossaryTerm>[] {
  const minScore = options.minScore ?? 10;
  const maxResults = options.maxResults ?? 20;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const results: GlossarySearchResult<GlossaryTerm>[] = [];
  for (const t of terms) {
    if (options.category && t.category !== options.category) continue;
    const { score, matched } = scoreTerm(t, queryTokens);
    if (score >= minScore) {
      results.push({ item: t, score, matchedTokens: matched });
    }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ────────────────────────────────────────────────────────────────────────
// FAQ search
// ────────────────────────────────────────────────────────────────────────

function scoreFaq(faq: FaqEntry, queryTokens: string[]): { score: number; matched: string[] } {
  const matched: string[] = [];
  let score = 0;

  const allQuestions = [faq.question, ...(faq.questionVariants ?? [])];
  const questionTokens = new Set(allQuestions.flatMap(tokenize));
  const answerTokens = new Set(tokenize(faq.answer));

  for (const q of queryTokens) {
    if (questionTokens.has(q)) {
      score += 25;
      matched.push(q);
    } else if (answerTokens.has(q)) {
      score += 6;
      matched.push(q);
    }
  }

  // Exact phrase match en alguna question variant
  const queryStr = queryTokens.join(' ');
  for (const q of allQuestions) {
    if (normalize(q) === queryStr) {
      score = Math.max(score, 100);
      break;
    }
  }

  // Utility bonus
  const h = faq.helpfulCount ?? 0;
  const nh = faq.notHelpfulCount ?? 0;
  if (h + nh > 0) {
    score += Math.round((h / (h + nh)) * 5);
  }

  return { score, matched: Array.from(new Set(matched)) };
}

export interface FaqSearchOptions {
  topic?: TermCategory;
  /** Si el caller proporciona contexto (page/feature), priorizar FAQs que mencionen ese hint. */
  contextHint?: string;
  minScore?: number;
  maxResults?: number;
}

export function searchFaq(
  faqs: ReadonlyArray<FaqEntry>,
  query: string,
  options: FaqSearchOptions = {},
): GlossarySearchResult<FaqEntry>[] {
  const minScore = options.minScore ?? 10;
  const maxResults = options.maxResults ?? 10;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const results: GlossarySearchResult<FaqEntry>[] = [];
  for (const f of faqs) {
    if (options.topic && f.topic !== options.topic) continue;
    const { score: initialScore, matched } = scoreFaq(f, queryTokens);
    let score = initialScore;
    // Context boost
    if (options.contextHint && f.contextHint?.includes(options.contextHint)) {
      score += 15;
    }
    if (score >= minScore) {
      results.push({ item: f, score, matchedTokens: matched });
    }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ────────────────────────────────────────────────────────────────────────
// Feedback recording (§99 utilidad de la entrada)
// ────────────────────────────────────────────────────────────────────────

export interface UtilityFeedback {
  itemId: string;
  itemKind: 'term' | 'faq';
  helpful: boolean;
  /** UID del que vota (anti-spam). */
  voterUid: string;
  /** Comentario libre opcional (≤500 chars). */
  comment?: string;
  at: string;
}

export class FeedbackValidationError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'FeedbackValidationError';
  }
}

export function recordUtilityFeedback(
  existing: ReadonlyArray<UtilityFeedback>,
  newFeedback: UtilityFeedback,
): UtilityFeedback[] {
  if (!newFeedback.voterUid) {
    throw new FeedbackValidationError('missing_voter', 'voterUid required');
  }
  if (newFeedback.comment && newFeedback.comment.length > 500) {
    throw new FeedbackValidationError('comment_too_long', 'max 500 chars');
  }
  // Idempotency: un mismo voter no puede votar el mismo item dos veces.
  // Si re-vota, reemplaza su voto previo.
  const filtered = existing.filter(
    (f) => !(f.voterUid === newFeedback.voterUid && f.itemId === newFeedback.itemId && f.itemKind === newFeedback.itemKind),
  );
  return [...filtered, newFeedback];
}

export interface UtilityStats {
  itemId: string;
  helpfulCount: number;
  notHelpfulCount: number;
  ratio: number;
}

export function summarizeFeedback(
  feedbacks: ReadonlyArray<UtilityFeedback>,
  itemKind: 'term' | 'faq',
): UtilityStats[] {
  const byItem = new Map<string, { h: number; nh: number }>();
  for (const f of feedbacks) {
    if (f.itemKind !== itemKind) continue;
    const cur = byItem.get(f.itemId) ?? { h: 0, nh: 0 };
    if (f.helpful) cur.h += 1;
    else cur.nh += 1;
    byItem.set(f.itemId, cur);
  }
  return Array.from(byItem.entries()).map(([id, stats]) => ({
    itemId: id,
    helpfulCount: stats.h,
    notHelpfulCount: stats.nh,
    ratio: stats.h + stats.nh > 0 ? stats.h / (stats.h + stats.nh) : 0,
  }));
}

// Items que necesitan revisión (mala utility) — para que content creators
// vean qué editar.
export function findLowUtilityItems(
  stats: ReadonlyArray<UtilityStats>,
  options: { minVotes?: number; maxRatio?: number } = {},
): UtilityStats[] {
  const minVotes = options.minVotes ?? 5;
  const maxRatio = options.maxRatio ?? 0.5;
  return stats
    .filter((s) => s.helpfulCount + s.notHelpfulCount >= minVotes && s.ratio < maxRatio)
    .sort((a, b) => a.ratio - b.ratio);
}
