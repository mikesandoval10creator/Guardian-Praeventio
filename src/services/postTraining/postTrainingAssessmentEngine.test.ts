import { describe, it, expect } from 'vitest';
import {
  scoreAssessment,
  nextReviewDelayDays,
  scheduleNextReviews,
  findRelevantCaseStudies,
  type AssessmentQuestion,
  type AssessmentAttempt,
  type CaseStudyNode,
} from './postTrainingAssessmentEngine.js';

const NOW = new Date('2026-05-13T10:00:00Z');

const QUESTIONS: AssessmentQuestion[] = [
  {
    id: 'q1',
    topic: 'altura',
    difficulty: 'medium',
    prompt: '¿A qué altura es obligatorio arnés?',
    options: [
      { id: 'a', label: '≥0.5m', isCorrect: false },
      { id: 'b', label: '≥1.8m', isCorrect: true, rationale: 'DS 594 Chile' },
      { id: 'c', label: '≥5m', isCorrect: false },
    ],
    safetyCritical: true,
  },
  {
    id: 'q2',
    topic: 'altura',
    difficulty: 'easy',
    prompt: '¿El casco protege la cabeza?',
    options: [
      { id: 'a', label: 'Sí', isCorrect: true },
      { id: 'b', label: 'No', isCorrect: false },
    ],
  },
  {
    id: 'q3',
    topic: 'electrica',
    difficulty: 'hard',
    prompt: '¿Qué es LOTO?',
    options: [
      { id: 'a', label: 'Lockout/Tagout', isCorrect: true },
      { id: 'b', label: 'Local Operating Tour', isCorrect: false },
    ],
  },
];

function attempt(over: Partial<AssessmentAttempt>): AssessmentAttempt {
  return {
    questionId: 'q1',
    selectedOptionId: 'b',
    durationSeconds: 30,
    attemptAt: NOW.toISOString(),
    ...over,
  };
}

describe('scoreAssessment', () => {
  it('todas correctas → passed + 100%', () => {
    const r = scoreAssessment(
      'w1',
      't1',
      QUESTIONS,
      [
        attempt({ questionId: 'q1', selectedOptionId: 'b' }),
        attempt({ questionId: 'q2', selectedOptionId: 'a' }),
        attempt({ questionId: 'q3', selectedOptionId: 'a' }),
      ],
    );
    expect(r.scorePercent).toBe(100);
    expect(r.passed).toBe(true);
  });

  it('1 mala (no safety_critical) → score 67 + failed depende de threshold', () => {
    const r = scoreAssessment(
      'w1',
      't1',
      QUESTIONS,
      [
        attempt({ questionId: 'q1', selectedOptionId: 'b' }),
        attempt({ questionId: 'q2', selectedOptionId: 'b' }), // mal
        attempt({ questionId: 'q3', selectedOptionId: 'a' }),
      ],
    );
    expect(r.scorePercent).toBe(67);
    expect(r.failedQuestionIds).toContain('q2');
    expect(r.passed).toBe(false); // <80
  });

  it('safety_critical fallido → passed false aunque score≥80', () => {
    const r = scoreAssessment(
      'w1',
      't1',
      QUESTIONS,
      [
        attempt({ questionId: 'q1', selectedOptionId: 'a' }), // mal critical
        attempt({ questionId: 'q2', selectedOptionId: 'a' }),
        attempt({ questionId: 'q3', selectedOptionId: 'a' }),
      ],
    );
    // 2/3 = 67 score
    expect(r.passed).toBe(false);
  });

  it('enforceCritical=false ignora gate critical', () => {
    const r = scoreAssessment(
      'w1',
      't1',
      QUESTIONS,
      [
        attempt({ questionId: 'q1', selectedOptionId: 'a' }),
        attempt({ questionId: 'q2', selectedOptionId: 'a' }),
        attempt({ questionId: 'q3', selectedOptionId: 'a' }),
      ],
      { passingScorePercent: 60, enforceCriticalGate: false },
    );
    expect(r.passed).toBe(true); // 67 ≥ 60 + sin gate
  });

  it('topicsForReinforcement agregado correcto', () => {
    const r = scoreAssessment(
      'w1',
      't1',
      QUESTIONS,
      [
        attempt({ questionId: 'q1', selectedOptionId: 'a' }),
        attempt({ questionId: 'q3', selectedOptionId: 'b' }),
      ],
    );
    expect(r.topicsForReinforcement.sort()).toEqual(['altura', 'electrica']);
  });

  it('attempts a questions desconocidos se ignoran', () => {
    const r = scoreAssessment(
      'w1',
      't1',
      QUESTIONS,
      [attempt({ questionId: 'unknown-q', selectedOptionId: 'a' })],
    );
    expect(r.correctCount).toBe(0);
    expect(r.incorrectCount).toBe(0);
  });

  it('totalSeconds suma duraciones', () => {
    const r = scoreAssessment(
      'w1',
      't1',
      QUESTIONS,
      [
        attempt({ questionId: 'q1', selectedOptionId: 'b', durationSeconds: 30 }),
        attempt({ questionId: 'q2', selectedOptionId: 'a', durationSeconds: 15 }),
      ],
    );
    expect(r.totalSeconds).toBe(45);
  });
});

describe('nextReviewDelayDays', () => {
  it('expert + 0 correct → 1 día', () => {
    expect(nextReviewDelayDays('expert', 0)).toBe(1);
  });

  it('easy + 0 correct → 7 días', () => {
    expect(nextReviewDelayDays('easy', 0)).toBe(7);
  });

  it('medium + 3 consecutivos → multiplier 8 (cap)', () => {
    // base 4 * min(8, 2^3=8) = 32
    expect(nextReviewDelayDays('medium', 3)).toBe(32);
  });

  it('cap a 90 días', () => {
    expect(nextReviewDelayDays('easy', 10)).toBe(56); // 7 * 8 = 56
    expect(nextReviewDelayDays('medium', 10)).toBe(32);
  });

  it('hard + 1 correct → 4 días (2 * 2)', () => {
    expect(nextReviewDelayDays('hard', 1)).toBe(4);
  });
});

describe('scheduleNextReviews', () => {
  it('produce schedule con nextReviewAt futuro', () => {
    const r = scheduleNextReviews(
      'w1',
      [
        { topic: 'altura', difficulty: 'medium', consecutiveCorrect: 0 },
        { topic: 'electrica', difficulty: 'hard', consecutiveCorrect: 2 },
      ],
      { now: NOW },
    );
    expect(r).toHaveLength(2);
    for (const item of r) {
      expect(Date.parse(item.nextReviewAt)).toBeGreaterThan(NOW.getTime());
    }
  });
});

const CASE_STUDIES: CaseStudyNode[] = [
  {
    nodeId: 'cs-1',
    title: 'Caída desde andamio sin arnés',
    kind: 'incident',
    topics: ['altura', 'arnes'],
    severity: 'high',
    industry: 'construction',
    occurredAt: '2026-03-01T00:00:00Z',
  },
  {
    nodeId: 'cs-2',
    title: 'Cortocircuito panel sin LOTO',
    kind: 'lesson_learned',
    topics: ['electrica', 'loto'],
    severity: 'critical',
    industry: 'mining',
    occurredAt: '2025-12-01T00:00:00Z',
  },
  {
    nodeId: 'cs-3',
    title: 'Buena práctica: alarma silenciadora',
    kind: 'good_practice',
    topics: ['ruido'],
    severity: 'low',
    occurredAt: '2025-01-01T00:00:00Z',
  },
];

describe('findRelevantCaseStudies', () => {
  it('match por topic + ordenado por relevancia', () => {
    const matches = findRelevantCaseStudies(['altura'], CASE_STUDIES);
    expect(matches[0]?.node.nodeId).toBe('cs-1');
  });

  it('filtra por industry', () => {
    const matches = findRelevantCaseStudies(['altura', 'electrica'], CASE_STUDIES, {
      industry: 'construction',
    });
    expect(matches.every((m) => m.node.industry === 'construction' || !m.node.industry)).toBe(true);
  });

  it('preferSevere boost', () => {
    const matches = findRelevantCaseStudies(['electrica'], CASE_STUDIES, { preferSevere: true });
    expect(matches[0]?.node.severity).toBe('critical');
  });

  it('sin topic match → vacío', () => {
    const matches = findRelevantCaseStudies(['quimicos'], CASE_STUDIES);
    expect(matches).toHaveLength(0);
  });

  it('maxResults cap', () => {
    const matches = findRelevantCaseStudies(['altura', 'electrica'], CASE_STUDIES, { maxResults: 1 });
    expect(matches).toHaveLength(1);
  });

  it('reasons audit trail', () => {
    const matches = findRelevantCaseStudies(['altura'], CASE_STUDIES);
    expect(matches[0]?.reasons.length).toBeGreaterThan(0);
  });
});
