import { describe, it, expect } from 'vitest';
import {
  searchArticles,
  detectObsolescenceCandidates,
  buildEngagementReport,
  type KnowledgeArticle,
} from './knowledgeBaseService.js';

function article(over: Partial<KnowledgeArticle> & { id: string }): KnowledgeArticle {
  return {
    id: over.id,
    kind: over.kind ?? 'glossary',
    title: over.title ?? 'Definición arnés',
    content: over.content ?? 'El arnés de seguridad es equipo individual.',
    tags: over.tags ?? ['epp', 'altura'],
    lastReviewedAt: over.lastReviewedAt ?? '2026-05-01T00:00:00Z',
    viewCount: over.viewCount ?? 10,
    averageRating: over.averageRating,
    isObsolete: over.isObsolete ?? false,
    authorUid: 'a1',
  };
}

describe('searchArticles', () => {
  it('busca por palabra en título', () => {
    const r = searchArticles([article({ id: 'a1' }), article({ id: 'a2', title: 'Casco minero' })], 'arnes');
    expect(r[0].id).toBe('a1');
  });

  it('match en tag suma score', () => {
    const r = searchArticles([article({ id: 'a1' })], 'altura');
    expect(r[0].score).toBeGreaterThan(0);
  });

  it('filtra por kind', () => {
    const r = searchArticles(
      [
        article({ id: 'glo', kind: 'glossary', title: 'arnes' }),
        article({ id: 'faq', kind: 'faq', title: 'arnes' }),
      ],
      'arnes',
      { kind: 'faq' },
    );
    expect(r.every((a) => a.kind === 'faq')).toBe(true);
  });

  it('excludeObsolete oculta articulos marcados', () => {
    const r = searchArticles(
      [article({ id: 'a1', isObsolete: true })],
      'arnes',
      { excludeObsolete: true },
    );
    expect(r).toEqual([]);
  });

  it('ordena por score descendente', () => {
    const r = searchArticles(
      [
        article({ id: 'low', title: 'genérico', content: 'menciona arnes' }),
        article({ id: 'high', title: 'arnes en altura', tags: ['arnes'] }),
      ],
      'arnes',
    );
    expect(r[0].id).toBe('high');
  });
});

describe('detectObsolescenceCandidates', () => {
  it('detecta stale_review (>2 años)', () => {
    const r = detectObsolescenceCandidates(
      [article({ id: 'a1', lastReviewedAt: '2023-01-01T00:00:00Z' })],
      '2026-05-11T00:00:00Z',
    );
    expect(r[0].reason).toBe('stale_review');
  });

  it('detecta low_engagement (0 views >180d)', () => {
    const r = detectObsolescenceCandidates(
      [article({ id: 'a1', viewCount: 0, lastReviewedAt: '2025-10-01T00:00:00Z' })],
      '2026-05-11T00:00:00Z',
    );
    expect(r[0].reason).toBe('low_engagement');
  });

  it('detecta low_rating (<2.5)', () => {
    const r = detectObsolescenceCandidates(
      [article({ id: 'a1', averageRating: 1.5 })],
      '2026-05-11T00:00:00Z',
    );
    expect(r[0].reason).toBe('low_rating');
  });

  it('manualmente flagged → reason manually_flagged', () => {
    const r = detectObsolescenceCandidates(
      [article({ id: 'a1', isObsolete: true })],
      '2026-05-11T00:00:00Z',
    );
    expect(r[0].reason).toBe('manually_flagged');
  });
});

describe('buildEngagementReport', () => {
  it('agrega métricas correctamente', () => {
    const r = buildEngagementReport([
      article({ id: 'a', viewCount: 100, averageRating: 4 }),
      article({ id: 'b', viewCount: 0, averageRating: 3 }),
      article({ id: 'c', viewCount: 50 }),
    ]);
    expect(r.totalArticles).toBe(3);
    expect(r.totalViews).toBe(150);
    expect(r.averageViewsPerArticle).toBe(50);
    expect(r.unreadArticles).toBe(1);
    expect(r.averageRating).toBe(3.5);
  });

  it('top5 ordenado desc', () => {
    const r = buildEngagementReport([
      article({ id: 'top', viewCount: 1000 }),
      article({ id: 'mid', viewCount: 500 }),
      article({ id: 'low', viewCount: 100 }),
    ]);
    expect(r.topArticles[0].id).toBe('top');
  });
});
