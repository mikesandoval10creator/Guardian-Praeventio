import { describe, it, expect } from 'vitest';
import {
  analyzeWorkerGaps,
  buildTrainingPlan,
  buildPolyvalenceMatrix,
  findSubstitutes,
  type WorkerSkill,
  type RequiredSkill,
  type SkillDefinition,
  type CrewMember,
} from './skillGapAnalyzer.js';

const NOW = new Date('2026-05-13T10:00:00Z');

const SKILLS_CATALOG: SkillDefinition[] = [
  {
    id: 'altura_r1',
    name: 'Trabajo en Altura R1',
    trainingProgramByLevel: {
      none: { hours: 0 },
      aware: { hours: 1 },
      novice: { hours: 8 },
      competent: { hours: 16, provider: 'ACHS' },
      proficient: { hours: 24 },
      expert: { hours: 40 },
    },
    validityMonths: 24,
    category: 'safety',
  },
  {
    id: 'first_aid',
    name: 'Primeros Auxilios',
    trainingProgramByLevel: {
      none: { hours: 0 },
      aware: { hours: 1 },
      novice: { hours: 4 },
      competent: { hours: 16, provider: 'Mutual' },
      proficient: { hours: 30 },
      expert: { hours: 60 },
    },
    validityMonths: 12,
    category: 'safety',
  },
];

const REQUIRED_FOR_HEIGHT_TASK: RequiredSkill[] = [
  { skillId: 'altura_r1', minLevel: 'competent', critical: true, appliesToTaskCategory: 'altura' },
  { skillId: 'first_aid', minLevel: 'novice', critical: false },
];

function skill(over: Partial<WorkerSkill> & { skillId: string; level: WorkerSkill['level'] }): WorkerSkill {
  return {
    workerUid: 'w1',
    attainedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('analyzeWorkerGaps', () => {
  it('worker sin skills → gap completo', () => {
    const gaps = analyzeWorkerGaps([], REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    expect(gaps).toHaveLength(2);
    expect(gaps.find((g) => g.skillId === 'altura_r1')?.gapLevels).toBe(3); // none → competent = 3
  });

  it('worker con todas skills al nivel exacto → 0 gaps', () => {
    const gaps = analyzeWorkerGaps(
      [
        skill({ skillId: 'altura_r1', level: 'competent' }),
        skill({ skillId: 'first_aid', level: 'novice' }),
      ],
      REQUIRED_FOR_HEIGHT_TASK,
      { now: NOW },
    );
    expect(gaps).toHaveLength(0);
  });

  it('worker con skill SUPERIOR al requerido → 0 gap', () => {
    const gaps = analyzeWorkerGaps(
      [skill({ skillId: 'altura_r1', level: 'expert' }), skill({ skillId: 'first_aid', level: 'expert' })],
      REQUIRED_FOR_HEIGHT_TASK,
      { now: NOW },
    );
    expect(gaps).toHaveLength(0);
  });

  it('skill expirado → cuenta como none', () => {
    const gaps = analyzeWorkerGaps(
      [skill({ skillId: 'altura_r1', level: 'competent', expiresAt: '2026-01-01T00:00:00Z' })],
      [REQUIRED_FOR_HEIGHT_TASK[0]!],
      { now: NOW },
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.expired).toBe(true);
    expect(gaps[0]?.gapLevels).toBe(3);
  });

  it('marca critical correctamente', () => {
    const gaps = analyzeWorkerGaps([], REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    expect(gaps.find((g) => g.skillId === 'altura_r1')?.critical).toBe(true);
    expect(gaps.find((g) => g.skillId === 'first_aid')?.critical).toBe(false);
  });
});

describe('buildTrainingPlan', () => {
  it('plan ordenado: críticas primero, luego más cortas', () => {
    const gaps = analyzeWorkerGaps([], REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    const plan = buildTrainingPlan(gaps, SKILLS_CATALOG, { now: NOW });
    expect(plan.steps[0]?.critical).toBe(true);
    expect(plan.steps[0]?.skillId).toBe('altura_r1');
  });

  it('estimatedCompletionWeeks con 4h/semana default', () => {
    const gaps = analyzeWorkerGaps([], REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    const plan = buildTrainingPlan(gaps, SKILLS_CATALOG, { now: NOW });
    // altura 16h + first_aid 4h = 20h / 4h/sem = 5 sem
    expect(plan.estimatedCompletionWeeks).toBe(5);
  });

  it('blockedFromOperation true cuando hay críticas pendientes', () => {
    const gaps = analyzeWorkerGaps([], REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    const plan = buildTrainingPlan(gaps, SKILLS_CATALOG, { now: NOW });
    expect(plan.blockedFromOperation).toBe(true);
  });

  it('hoursPerWeek custom respeta', () => {
    const gaps = analyzeWorkerGaps([], REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    const plan = buildTrainingPlan(gaps, SKILLS_CATALOG, { now: NOW, hoursPerWeek: 10 });
    expect(plan.estimatedCompletionWeeks).toBe(2);
  });

  it('skill no en catálogo → step omitido', () => {
    const gaps = [
      {
        workerUid: 'w1',
        skillId: 'unknown_skill',
        currentLevel: 'none' as const,
        requiredLevel: 'competent' as const,
        gapLevels: 3,
        critical: true,
      },
    ];
    const plan = buildTrainingPlan(gaps, SKILLS_CATALOG, { now: NOW });
    expect(plan.steps).toHaveLength(0);
  });
});

describe('buildPolyvalenceMatrix', () => {
  const crew: CrewMember[] = [
    {
      uid: 'w1',
      skills: [
        { workerUid: 'w1', skillId: 'altura_r1', level: 'competent', attainedAt: '2026-01-01T00:00:00Z' },
        { workerUid: 'w1', skillId: 'first_aid', level: 'competent', attainedAt: '2026-01-01T00:00:00Z' },
      ],
    },
    {
      uid: 'w2',
      skills: [
        { workerUid: 'w2', skillId: 'altura_r1', level: 'competent', attainedAt: '2026-01-01T00:00:00Z' },
      ],
    },
    {
      uid: 'w3',
      skills: [
        { workerUid: 'w3', skillId: 'first_aid', level: 'novice', attainedAt: '2026-01-01T00:00:00Z' },
      ],
    },
  ];

  it('cuenta coverage correctamente', () => {
    const m = buildPolyvalenceMatrix(crew, REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    expect(m.coverageBySkill.altura_r1?.count).toBe(2); // w1 + w2
    expect(m.coverageBySkill.first_aid?.count).toBe(2); // w1 + w3 (novice OK)
  });

  it('detecta singleCovered', () => {
    const limitedCrew = [crew[0]!]; // solo w1
    const m = buildPolyvalenceMatrix(limitedCrew, REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    expect(m.singleCovered.length).toBeGreaterThan(0);
  });

  it('detecta zeroCovered + recomendaciones URGENTE', () => {
    const m = buildPolyvalenceMatrix(
      [crew[0]!],
      [...REQUIRED_FOR_HEIGHT_TASK, { skillId: 'rescue_advanced', minLevel: 'competent', critical: true }],
      { now: NOW },
    );
    expect(m.zeroCovered).toContain('rescue_advanced');
    expect(m.recommendations.some((r) => /URGENTE/.test(r))).toBe(true);
  });

  it('polyvalenceScore baja con zeroCovered + singleCovered', () => {
    const m = buildPolyvalenceMatrix([crew[0]!], REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    expect(m.polyvalenceScore).toBeLessThan(100);
  });
});

describe('findSubstitutes', () => {
  const crew: CrewMember[] = [
    {
      uid: 'absent',
      skills: [
        { workerUid: 'absent', skillId: 'altura_r1', level: 'expert', attainedAt: '2026-01-01T00:00:00Z' },
        { workerUid: 'absent', skillId: 'first_aid', level: 'proficient', attainedAt: '2026-01-01T00:00:00Z' },
      ],
    },
    {
      uid: 'sub_safe',
      skills: [
        { workerUid: 'sub_safe', skillId: 'altura_r1', level: 'competent', attainedAt: '2026-01-01T00:00:00Z' },
        { workerUid: 'sub_safe', skillId: 'first_aid', level: 'novice', attainedAt: '2026-01-01T00:00:00Z' },
      ],
    },
    {
      uid: 'sub_partial',
      skills: [
        { workerUid: 'sub_partial', skillId: 'first_aid', level: 'competent', attainedAt: '2026-01-01T00:00:00Z' },
      ],
    },
  ];

  it('encuentra substitute seguro (sin critical missing)', () => {
    const candidates = findSubstitutes(crew, 'absent', REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    expect(candidates[0]?.candidateUid).toBe('sub_safe');
    expect(candidates[0]?.canSubstituteSafely).toBe(true);
  });

  it('candidate sin skill crítico → canSubstituteSafely false', () => {
    const candidates = findSubstitutes(crew, 'absent', REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    const partial = candidates.find((c) => c.candidateUid === 'sub_partial');
    expect(partial?.canSubstituteSafely).toBe(false);
    expect(partial?.missingSkills).toContain('altura_r1');
  });

  it('excluye al ausente de candidates', () => {
    const candidates = findSubstitutes(crew, 'absent', REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    expect(candidates.map((c) => c.candidateUid)).not.toContain('absent');
  });

  it('ordena: safe primero, luego coverageScore desc', () => {
    const candidates = findSubstitutes(crew, 'absent', REQUIRED_FOR_HEIGHT_TASK, { now: NOW });
    // sub_safe (seguro) antes que sub_partial (incompleto)
    expect(candidates[0]?.canSubstituteSafely).toBe(true);
    if (candidates.length > 1) {
      expect(candidates[candidates.length - 1]?.canSubstituteSafely).toBe(false);
    }
  });
});
