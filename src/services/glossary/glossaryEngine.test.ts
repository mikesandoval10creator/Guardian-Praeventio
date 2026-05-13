import { describe, it, expect } from 'vitest';
import {
  searchGlossary,
  searchFaq,
  recordUtilityFeedback,
  summarizeFeedback,
  findLowUtilityItems,
  FeedbackValidationError,
  type GlossaryTerm,
  type FaqEntry,
  type UtilityFeedback,
} from './glossaryEngine.js';

const TERMS: GlossaryTerm[] = [
  {
    id: 'epp',
    term: 'EPP',
    synonyms: ['equipo proteccion personal', 'equipos proteccion personal'],
    category: 'epp',
    shortDefinition: 'Equipo de Protección Personal — casco, arnés, etc.',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'iper',
    term: 'IPER',
    synonyms: ['identificacion peligros'],
    category: 'riesgo',
    shortDefinition: 'Matriz de Identificación de Peligros y Evaluación de Riesgos.',
    updatedAt: '2026-01-01T00:00:00Z',
    helpfulCount: 10,
    notHelpfulCount: 0,
  },
  {
    id: 'ds-594',
    term: 'DS 594',
    synonyms: ['decreto 594'],
    category: 'normativa',
    shortDefinition: 'Reglamento sobre condiciones sanitarias y ambientales básicas Chile.',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'arnes',
    term: 'arnés',
    synonyms: ['arnes', 'cinturon seguridad altura'],
    category: 'epp',
    shortDefinition: 'EPP para trabajo en altura, sostiene al trabajador en caso de caída.',
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

describe('searchGlossary', () => {
  it('match exacto del término → score 100', () => {
    const r = searchGlossary(TERMS, 'EPP');
    expect(r[0]?.item.id).toBe('epp');
    expect(r[0]?.score).toBeGreaterThanOrEqual(100);
  });

  it('match de sinónimo → score 90+', () => {
    const r = searchGlossary(TERMS, 'decreto 594');
    expect(r[0]?.item.id).toBe('ds-594');
    expect(r[0]?.score).toBeGreaterThanOrEqual(90);
  });

  it('match parcial en definición → score más bajo', () => {
    const r = searchGlossary(TERMS, 'casco', { minScore: 5 });
    // 'casco' aparece en definition de EPP — match en def es 8 puntos
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]?.item.id).toBe('epp');
  });

  it('filtra por categoría', () => {
    const r = searchGlossary(TERMS, 'iper', { category: 'normativa' });
    expect(r).toHaveLength(0);
  });

  it('helpfulCount boostea score', () => {
    const r = searchGlossary(TERMS, 'IPER');
    expect(r[0]?.score).toBeGreaterThan(100); // 100 + bonus
  });

  it('case insensitive + acentos', () => {
    const r = searchGlossary(TERMS, 'ARNÉS');
    expect(r[0]?.item.id).toBe('arnes');
  });

  it('query vacía → vacío', () => {
    const r = searchGlossary(TERMS, '');
    expect(r).toHaveLength(0);
  });

  it('respeta maxResults', () => {
    const r = searchGlossary(TERMS, 'equipo', { maxResults: 1 });
    expect(r.length).toBeLessThanOrEqual(1);
  });

  it('matchedTokens incluye tokens que coincidieron', () => {
    const r = searchGlossary(TERMS, 'protección personal');
    expect(r[0]?.matchedTokens.length).toBeGreaterThan(0);
  });
});

const FAQS: FaqEntry[] = [
  {
    id: 'faq-1',
    question: '¿Cuándo debo usar arnés?',
    questionVariants: ['cuando usar arnes', 'cuando arnes obligatorio', 'arnes altura'],
    answer: 'Siempre que trabajes en altura ≥ 1.8m sin protección colectiva (DS 594).',
    topic: 'epp',
    contextHint: ['HeightWorkPage'],
    relatedTermIds: ['arnes', 'ds-594'],
    updatedAt: '2026-01-01T00:00:00Z',
    helpfulCount: 8,
    notHelpfulCount: 1,
  },
  {
    id: 'faq-2',
    question: '¿Qué es IPER?',
    questionVariants: ['que significa iper'],
    answer: 'Identificación de Peligros y Evaluación de Riesgos — matriz fundamental ISO 45001.',
    topic: 'riesgo',
    relatedTermIds: ['iper'],
    updatedAt: '2026-01-01T00:00:00Z',
  },
];

describe('searchFaq', () => {
  it('exact phrase match → 100', () => {
    const r = searchFaq(FAQS, '¿Qué es IPER?');
    expect(r[0]?.item.id).toBe('faq-2');
    expect(r[0]?.score).toBeGreaterThanOrEqual(100);
  });

  it('variant match', () => {
    const r = searchFaq(FAQS, 'cuando arnes obligatorio');
    expect(r[0]?.item.id).toBe('faq-1');
  });

  it('contextHint boost', () => {
    const r1 = searchFaq(FAQS, 'arnes');
    const r2 = searchFaq(FAQS, 'arnes', { contextHint: 'HeightWorkPage' });
    expect(r2[0]!.score).toBeGreaterThan(r1[0]!.score);
  });

  it('topic filter', () => {
    const r = searchFaq(FAQS, 'arnes', { topic: 'normativa' });
    expect(r).toHaveLength(0);
  });

  it('match en answer body → score menor', () => {
    const r = searchFaq(FAQS, 'protección colectiva');
    expect(r.length).toBeGreaterThan(0);
  });
});

describe('recordUtilityFeedback', () => {
  const fb = (over: Partial<UtilityFeedback> = {}): UtilityFeedback => ({
    itemId: 'epp',
    itemKind: 'term' as const,
    helpful: true,
    voterUid: 'w1',
    at: '2026-05-13T10:00:00Z',
    ...over,
  });

  it('agrega nuevo feedback', () => {
    const r = recordUtilityFeedback([], fb());
    expect(r).toHaveLength(1);
  });

  it('idempotente — mismo voter mismo item reemplaza', () => {
    let r = recordUtilityFeedback([], fb({ helpful: false }));
    r = recordUtilityFeedback(r, fb({ helpful: true }));
    expect(r).toHaveLength(1);
    expect(r[0]?.helpful).toBe(true);
  });

  it('distinct voters mismo item → ambos', () => {
    let r = recordUtilityFeedback([], fb({ voterUid: 'w1' }));
    r = recordUtilityFeedback(r, fb({ voterUid: 'w2' }));
    expect(r).toHaveLength(2);
  });

  it('rechaza voterUid vacío', () => {
    expect(() => recordUtilityFeedback([], fb({ voterUid: '' }))).toThrowError(FeedbackValidationError);
  });

  it('rechaza comment >500 chars', () => {
    expect(() => recordUtilityFeedback([], fb({ comment: 'x'.repeat(600) }))).toThrowError(/comment_too_long/);
  });
});

describe('summarizeFeedback', () => {
  const feedbacks: UtilityFeedback[] = [
    { itemId: 'epp', itemKind: 'term', helpful: true, voterUid: 'a', at: '' },
    { itemId: 'epp', itemKind: 'term', helpful: true, voterUid: 'b', at: '' },
    { itemId: 'epp', itemKind: 'term', helpful: false, voterUid: 'c', at: '' },
    { itemId: 'faq-1', itemKind: 'faq', helpful: true, voterUid: 'a', at: '' },
  ];

  it('agrega counts y ratio por item', () => {
    const stats = summarizeFeedback(feedbacks, 'term');
    const epp = stats.find((s) => s.itemId === 'epp')!;
    expect(epp.helpfulCount).toBe(2);
    expect(epp.notHelpfulCount).toBe(1);
    expect(epp.ratio).toBeCloseTo(2 / 3);
  });

  it('filtra por itemKind', () => {
    const stats = summarizeFeedback(feedbacks, 'faq');
    expect(stats).toHaveLength(1);
    expect(stats[0]?.itemId).toBe('faq-1');
  });
});

describe('findLowUtilityItems', () => {
  it('detecta items con ratio bajo y suficientes votos', () => {
    const stats = [
      { itemId: 'bad', helpfulCount: 1, notHelpfulCount: 9, ratio: 0.1 },
      { itemId: 'good', helpfulCount: 9, notHelpfulCount: 1, ratio: 0.9 },
      { itemId: 'too-few', helpfulCount: 1, notHelpfulCount: 2, ratio: 0.33 },
    ];
    const low = findLowUtilityItems(stats);
    expect(low.map((l) => l.itemId)).toEqual(['bad']); // too-few < minVotes 5
  });

  it('respeta minVotes y maxRatio config', () => {
    const stats = [
      { itemId: 'mediocre', helpfulCount: 5, notHelpfulCount: 5, ratio: 0.5 },
    ];
    const low = findLowUtilityItems(stats, { minVotes: 5, maxRatio: 0.7 });
    expect(low).toHaveLength(1);
  });
});
