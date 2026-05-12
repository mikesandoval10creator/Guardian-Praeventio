// Praeventio Guard — Sprint K: Base conocimiento + Glosario + FAQ + Curador.
//
// Cierra: Documento usuario "§97-99, §185-190"
//
// Repositorio de artículos de ayuda:
//   - Glosario términos preventivos
//   - FAQ frecuentes
//   - Procedimientos consultables
//   - Detector de obsolescencia
//   - Reutilización entre proyectos
//
// Determinístico. Búsqueda léxica con scoring + tag filtering.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ArticleKind = 'glossary' | 'faq' | 'procedure' | 'guide' | 'norm_summary';

export interface KnowledgeArticle {
  id: string;
  kind: ArticleKind;
  title: string;
  /** Cuerpo plain text (markdown soportado por la UI). */
  content: string;
  tags: string[];
  /** ISO-8601 última revisión. */
  lastReviewedAt: string;
  /** ¿Cuántas veces fue consultado? */
  viewCount: number;
  /** Rating promedio 1-5. */
  averageRating?: number;
  /** Si está marcado como obsoleto. */
  isObsolete: boolean;
  /** UID del autor / curador. */
  authorUid: string;
}

// ────────────────────────────────────────────────────────────────────────
// Search
// ────────────────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export interface SearchResult extends KnowledgeArticle {
  /** Score 0-100 relevance. */
  score: number;
}

export interface SearchOptions {
  kind?: ArticleKind;
  tag?: string;
  excludeObsolete?: boolean;
}

export function searchArticles(
  library: KnowledgeArticle[],
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) return [];

  return library
    .filter((a) => {
      if (options.kind && a.kind !== options.kind) return false;
      if (options.tag && !a.tags.includes(options.tag)) return false;
      if (options.excludeObsolete && a.isObsolete) return false;
      return true;
    })
    .map((a) => {
      const titleTokens = new Set(tokenize(a.title));
      const contentTokens = new Set(tokenize(a.content.slice(0, 500)));
      let score = 0;
      for (const qt of queryTokens) {
        if (titleTokens.has(qt)) score += 30;
        if (contentTokens.has(qt)) score += 10;
        if (a.tags.includes(qt)) score += 15;
      }
      // Bonus por popularidad
      score += Math.min(20, a.viewCount / 10);
      // Penalty por obsoleto
      if (a.isObsolete) score = Math.floor(score * 0.5);
      return { ...a, score: Math.min(100, score) };
    })
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ────────────────────────────────────────────────────────────────────────
// Obsolescence detector (§186)
// ────────────────────────────────────────────────────────────────────────

const STALE_DAYS = 365 * 2;

export interface ObsolescenceCandidate {
  articleId: string;
  daysSinceReview: number;
  reason: 'stale_review' | 'low_engagement' | 'low_rating' | 'manually_flagged';
}

export function detectObsolescenceCandidates(
  library: KnowledgeArticle[],
  nowIso: string = new Date().toISOString(),
): ObsolescenceCandidate[] {
  const nowMs = Date.parse(nowIso);
  const candidates: ObsolescenceCandidate[] = [];

  for (const article of library) {
    if (article.isObsolete) {
      candidates.push({
        articleId: article.id,
        daysSinceReview: Math.floor((nowMs - Date.parse(article.lastReviewedAt)) / 86_400_000),
        reason: 'manually_flagged',
      });
      continue;
    }
    const days = Math.floor((nowMs - Date.parse(article.lastReviewedAt)) / 86_400_000);
    if (days > STALE_DAYS) {
      candidates.push({ articleId: article.id, daysSinceReview: days, reason: 'stale_review' });
      continue;
    }
    if (article.viewCount === 0 && days > 180) {
      candidates.push({ articleId: article.id, daysSinceReview: days, reason: 'low_engagement' });
      continue;
    }
    if (article.averageRating !== undefined && article.averageRating < 2.5) {
      candidates.push({ articleId: article.id, daysSinceReview: days, reason: 'low_rating' });
    }
  }
  return candidates;
}

// ────────────────────────────────────────────────────────────────────────
// Engagement metrics
// ────────────────────────────────────────────────────────────────────────

export interface EngagementReport {
  totalArticles: number;
  totalViews: number;
  averageViewsPerArticle: number;
  topArticles: KnowledgeArticle[];
  unreadArticles: number;
  averageRating: number;
}

export function buildEngagementReport(library: KnowledgeArticle[]): EngagementReport {
  const totalArticles = library.length;
  const totalViews = library.reduce((s, a) => s + a.viewCount, 0);
  const avgViews =
    totalArticles > 0 ? Math.round((totalViews / totalArticles) * 10) / 10 : 0;
  const topArticles = [...library].sort((a, b) => b.viewCount - a.viewCount).slice(0, 5);
  const unreadArticles = library.filter((a) => a.viewCount === 0).length;
  const rated = library.filter((a) => a.averageRating !== undefined);
  const averageRating =
    rated.length > 0
      ? Math.round(
          (rated.reduce((s, a) => s + (a.averageRating ?? 0), 0) / rated.length) * 10,
        ) / 10
      : 0;
  return {
    totalArticles,
    totalViews,
    averageViewsPerArticle: avgViews,
    topArticles,
    unreadArticles,
    averageRating,
  };
}
